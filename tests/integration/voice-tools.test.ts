import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestClient } from "../helpers/db";
import { createVoiceFixture, fakeDeps } from "../helpers/voice-fixtures";
import { executeToolCall, type VoiceCallContext } from "@/server/voice/tools";
import { createBookingChecked } from "@/server/booking/service";

/**
 * Tools de l'agent vocal contre une vraie base : le LLM ne décide rien,
 * ces tests prouvent que le serveur décide juste.
 */

const db = createTestClient();
let ctx: VoiceCallContext;
let orgId: string;
let businessId: string;

// Un samedi lointain.
const DATE = "2030-06-15";

beforeAll(async () => {
  const fixture = await createVoiceFixture(db, "tools");
  orgId = fixture.org.id;
  businessId = fixture.business.id;
  const call = await db.call.create({
    data: {
      organizationId: orgId,
      businessId,
      providerCallId: `call-tools-${Date.now()}`,
      fromE164: "+33612345678",
      startedAt: new Date(),
    },
  });
  ctx = {
    organizationId: orgId,
    businessId,
    businessName: fixture.business.name,
    timezone: "Europe/Paris",
    callId: call.id,
    fromE164: "+33612345678",
  };
});

afterAll(async () => {
  await db.organization.delete({ where: { id: orgId } });
  await db.$disconnect();
});

describe("check_availability", () => {
  it("répond disponible sur un créneau libre", async () => {
    const { result } = await executeToolCall(
      db,
      fakeDeps().deps,
      ctx,
      "check_availability",
      { date: DATE, time: "20:00", covers: 4 },
    );
    expect(JSON.parse(result)).toMatchObject({ disponible: true });
  });

  it("refuse hors service avec alternatives", async () => {
    const { result } = await executeToolCall(
      db,
      fakeDeps().deps,
      ctx,
      "check_availability",
      { date: DATE, time: "15:00", covers: 4 },
    );
    const parsed = JSON.parse(result);
    expect(parsed.disponible).toBe(false);
    expect(parsed.alternatives.length).toBeGreaterThan(0);
  });

  it("rejette des paramètres malformés sans lever d'exception", async () => {
    const { result } = await executeToolCall(
      db,
      fakeDeps().deps,
      ctx,
      "check_availability",
      { date: "samedi prochain", time: "20h", covers: "quatre" },
    );
    expect(JSON.parse(result).erreur).toBe("paramètres invalides");
  });
});

describe("create_booking", () => {
  it("crée la réservation, envoie le SMS et notifie le commerçant", async () => {
    const { deps, sentSms, notifications } = fakeDeps();
    const execution = await executeToolCall(db, deps, ctx, "create_booking", {
      date: DATE,
      time: "20:00",
      covers: 4,
      customer_name: "Dupont",
    });
    expect(JSON.parse(execution.result)).toMatchObject({
      enregistree: true,
      heure: "20:00",
      sms_envoye: true,
    });

    // Les effets de bord sont différés : rien n'est parti avant exécution.
    expect(sentSms).toHaveLength(0);
    for (const effect of execution.sideEffects) await effect();
    expect(sentSms).toHaveLength(1);
    expect(sentSms[0].to).toBe("+33612345678"); // numéro de l'appelant
    expect(sentSms[0].body).toContain("20:00");
    expect(notifications).toHaveLength(1);

    const booking = await db.booking.findFirst({
      where: { businessId, customerName: "Dupont" },
    });
    expect(booking).not.toBeNull();
    expect(booking!.source).toBe("CALL");
    expect(booking!.callId).toBe(ctx.callId);

    const call = await db.call.findUnique({ where: { id: ctx.callId } });
    expect(call!.outcome).toBe("BOOKING_CREATED");
  });

  it("est idempotent si le provider rejoue le tool call", async () => {
    const { deps, sentSms } = fakeDeps();
    const replay = await executeToolCall(db, deps, ctx, "create_booking", {
      date: DATE,
      time: "20:00",
      covers: 4,
      customer_name: "Dupont",
    });
    expect(JSON.parse(replay.result)).toMatchObject({
      enregistree: true,
      deja_existante: true,
    });
    for (const effect of replay.sideEffects) await effect();
    expect(sentSms).toHaveLength(0); // pas de second SMS

    const count = await db.booking.count({
      where: { businessId, customerName: "Dupont" },
    });
    expect(count).toBe(1);
  });

  it("refuse quand le créneau est complet", async () => {
    // Sature le créneau 21:00 (20 couverts).
    await db.booking.create({
      data: {
        organizationId: orgId,
        businessId,
        startsAt: new Date("2030-06-15T19:00:00Z"), // 21:00 Paris (été)
        covers: 18,
        customerName: "Groupe",
      },
    });
    const { result } = await executeToolCall(
      db,
      fakeDeps().deps,
      ctx,
      "create_booking",
      { date: DATE, time: "21:00", covers: 6, customer_name: "Martin" },
    );
    const parsed = JSON.parse(result);
    expect(parsed.enregistree).toBe(false);
    expect(parsed.raison).toContain("complet");
  });
});

describe("concurrence sur le dernier créneau", () => {
  it("deux créations simultanées ne sur-réservent jamais", async () => {
    // Créneau 22:00 : 16 couverts déjà pris, il reste 4 places.
    await db.booking.create({
      data: {
        organizationId: orgId,
        businessId,
        startsAt: new Date("2030-06-15T20:00:00Z"), // 22:00 Paris
        covers: 16,
        customerName: "Base",
      },
    });

    const business = {
      id: businessId,
      organizationId: orgId,
      timezone: "Europe/Paris",
    };
    const request = (name: string) =>
      createBookingChecked(db, business, {
        date: DATE,
        time: "22:00",
        covers: 4,
        customerName: name,
      });

    const [a, b] = await Promise.all([
      request("Course A"),
      request("Course B"),
    ]);

    // Exactement UNE des deux doit passer (4 + 4 > 4 places restantes).
    const successes = [a, b].filter((r) => r.ok);
    expect(successes).toHaveLength(1);

    const total = await db.booking.aggregate({
      where: {
        businessId,
        startsAt: new Date("2030-06-15T20:00:00Z"),
        status: "CONFIRMED",
      },
      _sum: { covers: true },
    });
    expect(total._sum.covers).toBeLessThanOrEqual(20);
  });
});

describe("cancel_booking / take_message", () => {
  it("annule la réservation retrouvée par le numéro de l'appelant", async () => {
    const { deps, notifications } = fakeDeps();
    const execution = await executeToolCall(
      db,
      deps,
      ctx,
      "cancel_booking",
      {},
    );
    expect(JSON.parse(execution.result)).toMatchObject({ annulee: true });
    for (const effect of execution.sideEffects) await effect();
    expect(notifications).toHaveLength(1);

    const booking = await db.booking.findFirst({
      where: { businessId, customerName: "Dupont" },
    });
    expect(booking!.status).toBe("CANCELLED");
  });

  it("prend un message et notifie", async () => {
    const { deps, notifications } = fakeDeps();
    const execution = await executeToolCall(db, deps, ctx, "take_message", {
      content: "M. Bernard souhaite privatiser la salle le 14 juillet.",
      urgent: true,
    });
    expect(JSON.parse(execution.result)).toMatchObject({
      message_transmis: true,
    });
    for (const effect of execution.sideEffects) await effect();
    expect(notifications[0].title).toContain("urgent");

    const message = await db.message.findFirst({ where: { businessId } });
    expect(message!.urgent).toBe(true);
    expect(message!.fromE164).toBe("+33612345678");
  });

  it("un outil inconnu retourne une consigne de repli, pas une exception", async () => {
    const { result } = await executeToolCall(
      db,
      fakeDeps().deps,
      ctx,
      "outil_fantome",
      {},
    );
    expect(JSON.parse(result).erreur).toContain("outil inconnu");
  });
});
