import {
  minutesToTime,
  timeToMinutes,
  utcToWallTime,
  wallTimeToUtc,
} from "./timezone";

/**
 * Moteur de disponibilité — PUR (aucun accès base, entièrement testable).
 *
 * Règle d'or produit : l'agent vocal n'énonce JAMAIS une disponibilité qui
 * ne sort pas de ce moteur. Le LLM formule, le moteur décide.
 */

export type CapacityRuleInput = {
  dayOfWeek: number; // 0 = dimanche … 6 = samedi (heure locale du commerce)
  startTime: string; // "12:00"
  endTime: string; // "14:30" (exclu)
  slotMinutes: number;
  maxCovers: number;
  maxPartySize: number;
};

export type CapacityOverrideInput = {
  date: string; // YYYY-MM-DD (heure locale)
  closed: boolean;
  maxCovers: number | null;
};

export type ExistingBookingInput = {
  startsAt: Date; // UTC
  covers: number;
};

export type AvailabilityContext = {
  timeZone: string;
  rules: CapacityRuleInput[];
  overrides: CapacityOverrideInput[];
  /** Réservations actives du jour demandé (statuts CONFIRMED/MODIFIED). */
  bookings: ExistingBookingInput[];
  now?: Date; // injectable pour les tests
};

export type AvailabilityRequest = {
  date: string; // YYYY-MM-DD, heure locale du commerce
  time: string; // HH:mm
  covers: number;
};

export type SlotAlternative = { date: string; time: string };

export type AvailabilityResult =
  | { available: true; startsAt: Date; slotTime: string }
  | {
      available: false;
      reason: "PAST" | "CLOSED" | "NO_SERVICE" | "FULL" | "PARTY_TOO_LARGE";
      maxPartySize?: number;
      alternatives: SlotAlternative[];
    };

type Slot = { startMinutes: number; rule: CapacityRuleInput };

/** Tous les créneaux du jour (selon les règles du jour de semaine). */
function daySlots(rules: CapacityRuleInput[], dayOfWeek: number): Slot[] {
  const slots: Slot[] = [];
  for (const rule of rules.filter((r) => r.dayOfWeek === dayOfWeek)) {
    const start = timeToMinutes(rule.startTime);
    const end = timeToMinutes(rule.endTime);
    for (let m = start; m < end; m += rule.slotMinutes) {
      slots.push({ startMinutes: m, rule });
    }
  }
  return slots.sort((a, b) => a.startMinutes - b.startMinutes);
}

/** Créneau contenant l'heure demandée (les réservations « 19:10 » comptent dans le créneau 19:00). */
function slotFor(slots: Slot[], minutes: number): Slot | undefined {
  return slots.find(
    (s) =>
      minutes >= s.startMinutes &&
      minutes < s.startMinutes + s.rule.slotMinutes,
  );
}

function coversInSlot(
  ctx: AvailabilityContext,
  date: string,
  slot: Slot,
): number {
  let total = 0;
  for (const booking of ctx.bookings) {
    const wall = utcToWallTime(booking.startsAt, ctx.timeZone);
    if (wall.date !== date) continue;
    const minutes = timeToMinutes(wall.time);
    if (
      minutes >= slot.startMinutes &&
      minutes < slot.startMinutes + slot.rule.slotMinutes
    ) {
      total += booking.covers;
    }
  }
  return total;
}

function slotCapacity(
  slot: Slot,
  override: CapacityOverrideInput | undefined,
): number {
  if (override?.maxCovers != null) return override.maxCovers;
  return slot.rule.maxCovers;
}

/** Jusqu'à `limit` alternatives disponibles le même jour, les plus proches de l'heure demandée. */
export function findAlternatives(
  ctx: AvailabilityContext,
  request: AvailabilityRequest,
  limit = 3,
): SlotAlternative[] {
  const override = ctx.overrides.find((o) => o.date === request.date);
  if (override?.closed) return [];

  const dayOfWeek = utcToWallTime(
    wallTimeToUtc(request.date, "12:00", ctx.timeZone),
    ctx.timeZone,
  ).dayOfWeek;
  const slots = daySlots(ctx.rules, dayOfWeek);
  const requestedMinutes = timeToMinutes(request.time);
  const now = ctx.now ?? new Date();

  return slots
    .filter((slot) => {
      const startsAt = wallTimeToUtc(
        request.date,
        minutesToTime(slot.startMinutes),
        ctx.timeZone,
      );
      if (startsAt <= now) return false;
      if (request.covers > slot.rule.maxPartySize) return false;
      const used = coversInSlot(ctx, request.date, slot);
      return used + request.covers <= slotCapacity(slot, override);
    })
    .sort(
      (a, b) =>
        Math.abs(a.startMinutes - requestedMinutes) -
        Math.abs(b.startMinutes - requestedMinutes),
    )
    .slice(0, limit)
    .map((slot) => ({
      date: request.date,
      time: minutesToTime(slot.startMinutes),
    }))
    .sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time));
}

export function checkAvailability(
  ctx: AvailabilityContext,
  request: AvailabilityRequest,
): AvailabilityResult {
  const now = ctx.now ?? new Date();
  const startsAtRequested = wallTimeToUtc(
    request.date,
    request.time,
    ctx.timeZone,
  );

  if (startsAtRequested <= now) {
    return { available: false, reason: "PAST", alternatives: [] };
  }

  const override = ctx.overrides.find((o) => o.date === request.date);
  if (override?.closed) {
    return { available: false, reason: "CLOSED", alternatives: [] };
  }

  const dayOfWeek = utcToWallTime(startsAtRequested, ctx.timeZone).dayOfWeek;
  const slots = daySlots(ctx.rules, dayOfWeek);
  if (slots.length === 0) {
    // Aucun service ce jour-là (ex. fermé le lundi).
    return { available: false, reason: "CLOSED", alternatives: [] };
  }

  const slot = slotFor(slots, timeToMinutes(request.time));
  if (!slot) {
    // Jour ouvert mais heure hors service (ex. 16:00 entre midi et soir).
    return {
      available: false,
      reason: "NO_SERVICE",
      alternatives: findAlternatives(ctx, request),
    };
  }

  if (request.covers > slot.rule.maxPartySize) {
    // Groupe trop grand → l'agent doit proposer un rappel humain.
    return {
      available: false,
      reason: "PARTY_TOO_LARGE",
      maxPartySize: slot.rule.maxPartySize,
      alternatives: [],
    };
  }

  const used = coversInSlot(ctx, request.date, slot);
  if (used + request.covers > slotCapacity(slot, override)) {
    return {
      available: false,
      reason: "FULL",
      alternatives: findAlternatives(ctx, request),
    };
  }

  // Le créneau retenu est le début du slot (19:10 demandé → créneau 19:00,
  // mais on confirme l'heure demandée par le client).
  return {
    available: true,
    startsAt: startsAtRequested,
    slotTime: minutesToTime(slot.startMinutes),
  };
}
