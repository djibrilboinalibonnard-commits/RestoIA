import { execSync } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";

/**
 * Prépare la base de test avant la suite :
 * - en CI (DATABASE_URL fournie) : applique simplement les migrations ;
 * - en local : démarre un Postgres embarqué jetable sur le port 5433,
 *   crée la base et applique les migrations. Aucun Docker requis.
 */

const LOCAL_URL =
  "postgresql://postgres:postgres@localhost:5433/voxemploy_test";

function migrate(databaseUrl: string) {
  execSync("npx prisma migrate deploy", {
    cwd: path.resolve(__dirname, ".."),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "inherit",
    shell: process.platform === "win32" ? "cmd.exe" : undefined,
  });
}

export default async function setup() {
  if (process.env.DATABASE_URL) {
    migrate(process.env.DATABASE_URL);
    return;
  }

  const dataDir = path.resolve(__dirname, "../.pgdata-test");
  // Nettoie les restes d'une exécution précédente interrompue.
  await rm(dataDir, { recursive: true, force: true });

  const { default: EmbeddedPostgres } = await import("embedded-postgres");
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "postgres",
    password: "postgres",
    port: 5433,
    persistent: false,
    // Locale C + UTF-8 : évite un crash initdb connu sous Windows avec les
    // locales françaises (WIN1252).
    initdbFlags: ["--encoding=UTF8", "--locale=C", "--no-sync"],
  });

  await pg.initialise();
  await pg.start();
  await pg.createDatabase("voxemploy_test");
  migrate(LOCAL_URL);

  return async () => {
    await pg.stop();
  };
}
