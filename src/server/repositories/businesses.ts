import type { PrismaClient } from "@/generated/prisma/client";
import type { TenantContext } from "../tenant";

/** Repository des commerces du tenant. */
export function businessesRepo(db: PrismaClient, ctx: TenantContext) {
  const tenantWhere = { organizationId: ctx.organizationId };

  return {
    list() {
      return db.business.findMany({
        where: tenantWhere,
        orderBy: { createdAt: "asc" },
      });
    },

    byId(id: string) {
      return db.business.findFirst({ where: { id, ...tenantWhere } });
    },

    create(input: { name: string; city?: string; contactPhone?: string }) {
      return db.business.create({
        data: { organizationId: ctx.organizationId, ...input },
      });
    },
  };
}
