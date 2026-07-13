import { defineConfig } from "vitest/config";

/**
 * URL de la base de test :
 * - en CI : fournie via DATABASE_URL (service container Postgres)
 * - en local : Postgres embarqué démarré par tests/global-setup.ts (port 5433)
 */
const TEST_DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5433/voxemploy_test";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    globalSetup: "./tests/global-setup.ts",
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: "test",
      DATABASE_URL: TEST_DATABASE_URL,
      BETTER_AUTH_SECRET:
        process.env.BETTER_AUTH_SECRET ??
        "test-secret-0123456789abcdef0123456789abcdef",
      BETTER_AUTH_URL: "http://localhost:3000",
    },
  },
});
