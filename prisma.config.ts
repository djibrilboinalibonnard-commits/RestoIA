import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    // Utilisée par le CLI (migrate, db push). Le client applicatif reçoit
    // son adaptateur dans src/lib/db.ts.
    url: process.env.DATABASE_URL ?? "postgresql://localhost:5432/unset",
  },
  migrations: {
    path: "prisma/migrations",
    seed: "npx tsx prisma/seed.ts",
  },
});
