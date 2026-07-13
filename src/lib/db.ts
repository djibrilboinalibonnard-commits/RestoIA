import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "./env";

/**
 * Client Prisma singleton (évite l'épuisement des connexions en dev
 * à cause du hot-reload de Next.js).
 *
 * IMPORTANT : ce client ne doit JAMAIS être utilisé directement dans les
 * routes ou composants pour les données tenant — passer par la couche
 * repository (src/server/repositories) qui exige un TenantContext.
 */
function createPrismaClient() {
  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
  return new PrismaClient({ adapter });
}

const globalForPrisma = globalThis as unknown as {
  prisma?: ReturnType<typeof createPrismaClient>;
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
