import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestClient } from "../helpers/db";
import { bookingsRepo } from "@/server/repositories/bookings";
import { callsRepo } from "@/server/repositories/calls";
import { businessesRepo } from "@/server/repositories/businesses";
import type { TenantContext } from "@/server/tenant";

/**
 * TEST CRITIQUE — Isolation multi-tenant.
 * Prouve qu'un tenant ne peut ni lire, ni modifier, ni créer des données
 * dans le périmètre d'un autre tenant via la couche repository.
 */

const db = createTestClient();

let ctxA: TenantContext;
let ctxB: TenantContext;
let businessA: { id: string };
let businessB: { id: string };
let bookingB: { id: string };

beforeAll(async () => {
  // Deux organisations distinctes, chacune avec un commerce et des données.
  const orgA = await db.organization.create({
    data: { name: "Resto A", slug: `resto-a-${Date.now()}` },
  });
  const orgB = await db.organization.create({
    data: { name: "Resto B", slug: `resto-b-${Date.now()}` },
  });

  ctxA = { organizationId: orgA.id, userId: "user-a", role: "owner" };
  ctxB = { organizationId: orgB.id, userId: "user-b", role: "owner" };

  businessA = await db.business.create({
    data: { organizationId: orgA.id, name: "Chez A" },
  });
  businessB = await db.business.create({
    data: { organizationId: orgB.id, name: "Chez B" },
  });

  await db.booking.create({
    data: {
      organizationId: orgA.id,
      businessId: businessA.id,
      startsAt: new Date("2030-01-15T19:30:00Z"),
      covers: 2,
      customerName: "Client de A",
    },
  });
  bookingB = await db.booking.create({
    data: {
      organizationId: orgB.id,
      businessId: businessB.id,
      startsAt: new Date("2030-01-15T20:00:00Z"),
      covers: 4,
      customerName: "Client de B",
    },
  });

  await db.call.create({
    data: {
      organizationId: orgB.id,
      businessId: businessB.id,
      providerCallId: `call-b-${Date.now()}`,
      startedAt: new Date(),
    },
  });
});

afterAll(async () => {
  await db.organization.deleteMany({
    where: { id: { in: [ctxA.organizationId, ctxB.organizationId] } },
  });
  await db.$disconnect();
});

describe("Isolation multi-tenant (couche repository)", () => {
  it("list() ne retourne que les réservations du tenant courant", async () => {
    const bookingsSeenByA = await bookingsRepo(db, ctxA).list();
    expect(bookingsSeenByA).toHaveLength(1);
    expect(bookingsSeenByA[0].customerName).toBe("Client de A");
    expect(
      bookingsSeenByA.every((b) => b.organizationId === ctxA.organizationId),
    ).toBe(true);
  });

  it("byId() d'une réservation d'un autre tenant retourne null", async () => {
    const result = await bookingsRepo(db, ctxA).byId(bookingB.id);
    expect(result).toBeNull();
  });

  it("cancel() d'une réservation d'un autre tenant n'affecte aucune ligne", async () => {
    const result = await bookingsRepo(db, ctxA).cancel(bookingB.id);
    expect(result.count).toBe(0);

    const untouched = await db.booking.findUnique({
      where: { id: bookingB.id },
    });
    expect(untouched?.status).toBe("CONFIRMED");
  });

  it("create() vers le business d'un autre tenant est rejeté", async () => {
    await expect(
      bookingsRepo(db, ctxA).create({
        businessId: businessB.id, // business du tenant B !
        startsAt: new Date("2030-02-01T19:00:00Z"),
        covers: 2,
        customerName: "Intrus",
      }),
    ).rejects.toThrow(/TENANT_VIOLATION/);
  });

  it("le journal d'appels est scellé par tenant", async () => {
    const callsSeenByA = await callsRepo(db, ctxA).list();
    expect(callsSeenByA).toHaveLength(0);

    const callsSeenByB = await callsRepo(db, ctxB).list();
    expect(callsSeenByB).toHaveLength(1);
  });

  it("la liste des commerces est scellée par tenant", async () => {
    const businessesSeenByA = await businessesRepo(db, ctxA).list();
    expect(businessesSeenByA.map((b) => b.id)).toEqual([businessA.id]);
  });
});
