import type { PrismaClient } from "@/generated/prisma/client";
import type { TenantContext } from "../tenant";

/** Repository des appels (journal), scellé par tenant. */
export function callsRepo(db: PrismaClient, ctx: TenantContext) {
  const tenantWhere = { organizationId: ctx.organizationId };

  return {
    list(params: { limit?: number; businessId?: string } = {}) {
      return db.call.findMany({
        where: { ...tenantWhere, businessId: params.businessId },
        orderBy: { startedAt: "desc" },
        take: params.limit ?? 50,
      });
    },

    byId(id: string) {
      return db.call.findFirst({
        where: { id, ...tenantWhere },
        include: { bookings: true, orders: true, messages: true },
      });
    },

    countSince(since: Date) {
      return db.call.count({
        where: { ...tenantWhere, startedAt: { gte: since } },
      });
    },
  };
}
