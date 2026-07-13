import type { PrismaClient } from "@/generated/prisma/client";
import type { TenantContext } from "../tenant";

export type CreateBookingInput = {
  businessId: string;
  startsAt: Date;
  covers: number;
  customerName: string;
  customerPhone?: string;
  notes?: string;
  source?: "CALL" | "DASHBOARD";
  callId?: string;
};

/**
 * Repository des réservations, scellé par tenant.
 * Toute requête est filtrée par organizationId — il est structurellement
 * impossible de lire ou modifier les données d'un autre tenant via ce module.
 */
export function bookingsRepo(db: PrismaClient, ctx: TenantContext) {
  const tenantWhere = { organizationId: ctx.organizationId };

  return {
    list(params: { from?: Date; to?: Date; businessId?: string } = {}) {
      return db.booking.findMany({
        where: {
          ...tenantWhere,
          businessId: params.businessId,
          startsAt: {
            gte: params.from,
            lte: params.to,
          },
        },
        orderBy: { startsAt: "asc" },
      });
    },

    byId(id: string) {
      return db.booking.findFirst({ where: { id, ...tenantWhere } });
    },

    async create(input: CreateBookingInput) {
      // Garde-fou : le business ciblé doit appartenir au tenant.
      const business = await db.business.findFirst({
        where: { id: input.businessId, ...tenantWhere },
        select: { id: true },
      });
      if (!business) {
        throw new Error(
          "TENANT_VIOLATION: business inexistant ou hors organisation",
        );
      }

      return db.booking.create({
        data: {
          organizationId: ctx.organizationId,
          businessId: input.businessId,
          startsAt: input.startsAt,
          covers: input.covers,
          customerName: input.customerName,
          customerPhone: input.customerPhone,
          notes: input.notes,
          source: input.source ?? "DASHBOARD",
          callId: input.callId,
        },
      });
    },

    /** Annulation scellée : ne touche jamais une réservation d'un autre tenant. */
    cancel(id: string) {
      return db.booking.updateMany({
        where: { id, ...tenantWhere, status: { not: "CANCELLED" } },
        data: { status: "CANCELLED", cancelledAt: new Date() },
      });
    },

    countUpcoming(businessId?: string) {
      return db.booking.count({
        where: {
          ...tenantWhere,
          businessId,
          status: "CONFIRMED",
          startsAt: { gte: new Date() },
        },
      });
    },
  };
}
