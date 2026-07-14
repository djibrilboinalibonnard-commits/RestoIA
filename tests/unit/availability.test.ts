import { describe, it, expect } from "vitest";
import {
  checkAvailability,
  type AvailabilityContext,
} from "@/server/booking/availability";
import { wallTimeToUtc, utcToWallTime } from "@/server/booking/timezone";

/**
 * Moteur de disponibilité — la logique la plus critique du produit :
 * l'agent vocal ne doit jamais confirmer un créneau que ce moteur refuse.
 */

const TZ = "Europe/Paris";
// Un mercredi (dayOfWeek = 3).
const DATE = "2030-06-12";
const NOW = new Date("2030-06-01T10:00:00Z");

function ctx(partial: Partial<AvailabilityContext> = {}): AvailabilityContext {
  return {
    timeZone: TZ,
    now: NOW,
    rules: [
      {
        dayOfWeek: 3,
        startTime: "12:00",
        endTime: "14:30",
        slotMinutes: 30,
        maxCovers: 20,
        maxPartySize: 8,
      },
      {
        dayOfWeek: 3,
        startTime: "19:00",
        endTime: "22:30",
        slotMinutes: 30,
        maxCovers: 20,
        maxPartySize: 8,
      },
    ],
    overrides: [],
    bookings: [],
    ...partial,
  };
}

describe("checkAvailability", () => {
  it("accepte un créneau libre pendant le service", () => {
    const result = checkAvailability(ctx(), {
      date: DATE,
      time: "19:30",
      covers: 4,
    });
    expect(result.available).toBe(true);
    if (result.available) {
      // 19:30 heure de Paris en juin = 17:30 UTC (heure d'été).
      expect(result.startsAt.toISOString()).toBe("2030-06-12T17:30:00.000Z");
      expect(result.slotTime).toBe("19:30");
    }
  });

  it("rattache une heure non alignée à son créneau (19:10 → slot 19:00)", () => {
    const result = checkAvailability(ctx(), {
      date: DATE,
      time: "19:10",
      covers: 2,
    });
    expect(result.available).toBe(true);
    if (result.available) expect(result.slotTime).toBe("19:00");
  });

  it("refuse un jour sans service (dimanche) : CLOSED", () => {
    const result = checkAvailability(ctx(), {
      // 2030-06-16 est un dimanche, aucune règle ce jour-là.
      date: "2030-06-16",
      time: "19:30",
      covers: 2,
    });
    expect(result).toMatchObject({ available: false, reason: "CLOSED" });
  });

  it("refuse une heure hors service un jour ouvert : NO_SERVICE + alternatives", () => {
    const result = checkAvailability(ctx(), {
      date: DATE,
      time: "16:00",
      covers: 2,
    });
    expect(result).toMatchObject({ available: false, reason: "NO_SERVICE" });
    if (!result.available) {
      expect(result.alternatives.length).toBeGreaterThan(0);
      // Les alternatives proposées doivent être de vrais créneaux du jour.
      expect(result.alternatives[0].date).toBe(DATE);
    }
  });

  it("refuse dans le passé : PAST", () => {
    const result = checkAvailability(ctx({ now: new Date("2031-01-01") }), {
      date: DATE,
      time: "19:30",
      covers: 2,
    });
    expect(result).toMatchObject({ available: false, reason: "PAST" });
  });

  it("refuse au-delà de maxPartySize : PARTY_TOO_LARGE (escalade humaine)", () => {
    const result = checkAvailability(ctx(), {
      date: DATE,
      time: "19:30",
      covers: 12,
    });
    expect(result).toMatchObject({
      available: false,
      reason: "PARTY_TOO_LARGE",
      maxPartySize: 8,
    });
  });

  it("refuse un créneau plein : FULL, et propose les créneaux voisins", () => {
    // 18 couverts déjà réservés sur le créneau 19:30 (capacité 20).
    const bookings = [
      { startsAt: wallTimeToUtc(DATE, "19:30", TZ), covers: 10 },
      { startsAt: wallTimeToUtc(DATE, "19:45", TZ), covers: 8 }, // même slot 19:30
    ];
    const result = checkAvailability(ctx({ bookings }), {
      date: DATE,
      time: "19:30",
      covers: 4,
    });
    expect(result).toMatchObject({ available: false, reason: "FULL" });
    if (!result.available) {
      expect(result.alternatives).not.toHaveLength(0);
      expect(result.alternatives.map((a) => a.time)).not.toContain("19:30");
    }

    // Mais 2 couverts passent encore (18 + 2 = 20).
    const smaller = checkAvailability(ctx({ bookings }), {
      date: DATE,
      time: "19:30",
      covers: 2,
    });
    expect(smaller.available).toBe(true);
  });

  it("les réservations d'un autre créneau ne comptent pas", () => {
    const bookings = [
      { startsAt: wallTimeToUtc(DATE, "12:30", TZ), covers: 20 },
    ];
    const result = checkAvailability(ctx({ bookings }), {
      date: DATE,
      time: "19:30",
      covers: 4,
    });
    expect(result.available).toBe(true);
  });

  it("respecte une fermeture exceptionnelle (override closed)", () => {
    const result = checkAvailability(
      ctx({ overrides: [{ date: DATE, closed: true, maxCovers: null }] }),
      { date: DATE, time: "19:30", covers: 2 },
    );
    expect(result).toMatchObject({ available: false, reason: "CLOSED" });
  });

  it("respecte une capacité réduite exceptionnelle (override maxCovers)", () => {
    const result = checkAvailability(
      ctx({ overrides: [{ date: DATE, closed: false, maxCovers: 4 }] }),
      { date: DATE, time: "19:30", covers: 6 },
    );
    expect(result).toMatchObject({ available: false, reason: "FULL" });
  });
});

describe("timezone", () => {
  it("convertit l'heure de Paris en UTC (été et hiver)", () => {
    expect(wallTimeToUtc("2030-06-12", "19:30", TZ).toISOString()).toBe(
      "2030-06-12T17:30:00.000Z", // UTC+2 en été
    );
    expect(wallTimeToUtc("2030-01-16", "19:30", TZ).toISOString()).toBe(
      "2030-01-16T18:30:00.000Z", // UTC+1 en hiver
    );
  });

  it("fait l'aller-retour UTC ⇄ heure locale", () => {
    const utc = wallTimeToUtc("2030-06-12", "19:30", TZ);
    const wall = utcToWallTime(utc, TZ);
    expect(wall).toEqual({ date: "2030-06-12", time: "19:30", dayOfWeek: 3 });
  });
});
