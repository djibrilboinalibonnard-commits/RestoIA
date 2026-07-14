import type { PrismaClient } from "@/generated/prisma/client";
import {
  checkAvailability,
  type AvailabilityContext,
  type AvailabilityRequest,
  type AvailabilityResult,
} from "./availability";
import { utcToWallTime, wallTimeToUtc } from "./timezone";

/**
 * Service de réservation : charge le contexte de capacité depuis la base
 * et applique le moteur pur. La création est transactionnelle (Serializable)
 * pour empêcher deux appels simultanés de sur-réserver le même créneau.
 */

type Db =
  PrismaClient | Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

async function loadContext(
  db: Db,
  businessId: string,
  date: string,
  timeZone: string,
): Promise<AvailabilityContext> {
  const dayStartUtc = wallTimeToUtc(date, "00:00", timeZone);
  const dayEndUtc = new Date(dayStartUtc.getTime() + 36 * 3600 * 1000);

  const [rules, overrides, bookings] = await Promise.all([
    db.capacityRule.findMany({ where: { businessId } }),
    db.capacityOverride.findMany({ where: { businessId } }),
    db.booking.findMany({
      where: {
        businessId,
        status: { in: ["CONFIRMED", "MODIFIED"] },
        startsAt: { gte: dayStartUtc, lt: dayEndUtc },
      },
      select: { startsAt: true, covers: true },
    }),
  ]);

  return {
    timeZone,
    rules,
    overrides: overrides.map((o) => ({
      date: utcToWallTime(o.date, "UTC").date, // colonne DATE → YYYY-MM-DD
      closed: o.closed,
      maxCovers: o.maxCovers,
    })),
    bookings,
  };
}

export async function getAvailability(
  db: PrismaClient,
  business: { id: string; timezone: string },
  request: AvailabilityRequest,
): Promise<AvailabilityResult> {
  const ctx = await loadContext(
    db,
    business.id,
    request.date,
    business.timezone,
  );
  return checkAvailability(ctx, request);
}

export type CreateBookingRequest = AvailabilityRequest & {
  customerName: string;
  customerPhone?: string;
  notes?: string;
  callId?: string;
};

export type CreateBookingResult =
  | { ok: true; booking: { id: string; startsAt: Date; covers: number } }
  | { ok: false; refusal: Exclude<AvailabilityResult, { available: true }> };

/**
 * Vérifie PUIS crée dans la même transaction Serializable : si deux appels
 * simultanés visent le dernier créneau, l'un des deux échoue proprement et
 * est rejoué (jusqu'à 3 tentatives), puis re-vérifié.
 */
export async function createBookingChecked(
  db: PrismaClient,
  business: { id: string; organizationId: string; timezone: string },
  request: CreateBookingRequest,
): Promise<CreateBookingResult> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await db.$transaction(
        async (tx) => {
          const ctx = await loadContext(
            tx,
            business.id,
            request.date,
            business.timezone,
          );
          const availability = checkAvailability(ctx, request);
          if (!availability.available) {
            return { ok: false as const, refusal: availability };
          }

          const booking = await tx.booking.create({
            data: {
              organizationId: business.organizationId,
              businessId: business.id,
              startsAt: availability.startsAt,
              covers: request.covers,
              customerName: request.customerName,
              customerPhone: request.customerPhone,
              notes: request.notes,
              source: "CALL",
              callId: request.callId,
            },
            select: { id: true, startsAt: true, covers: true },
          });
          return { ok: true as const, booking };
        },
        { isolationLevel: "Serializable" },
      );
    } catch (error) {
      // P2034 = échec de sérialisation (accès concurrent) → on rejoue.
      const code = (error as { code?: string }).code;
      if (code === "P2034" && attempt < 3) continue;
      throw error;
    }
  }
}

/** Annule la prochaine réservation active correspondant au téléphone du client. */
export async function cancelBookingByPhone(
  db: PrismaClient,
  business: { id: string; organizationId: string },
  customerPhone: string,
  date?: string,
  timeZone = "Europe/Paris",
): Promise<{ cancelled: boolean; startsAt?: Date; covers?: number }> {
  const where = {
    organizationId: business.organizationId,
    businessId: business.id,
    customerPhone,
    status: { in: ["CONFIRMED" as const, "MODIFIED" as const] },
    startsAt: date
      ? {
          gte: wallTimeToUtc(date, "00:00", timeZone),
          lt: new Date(
            wallTimeToUtc(date, "00:00", timeZone).getTime() + 36 * 3600 * 1000,
          ),
        }
      : { gte: new Date() },
  };

  const booking = await db.booking.findFirst({
    where,
    orderBy: { startsAt: "asc" },
  });
  if (!booking) return { cancelled: false };

  await db.booking.update({
    where: { id: booking.id },
    data: { status: "CANCELLED", cancelledAt: new Date() },
  });
  return {
    cancelled: true,
    startsAt: booking.startsAt,
    covers: booking.covers,
  };
}
