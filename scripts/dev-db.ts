import "dotenv/config";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";

/**
 * Base PostgreSQL de développement locale, sans Docker :
 *   npm run db:dev
 * Démarre un Postgres persistant sur le port 5433 (données dans .pgdata-dev),
 * crée la base voxemploy_dev, applique les migrations, puis reste actif
 * jusqu'à Ctrl+C. À lancer dans un terminal à côté de `npm run dev`.
 */
const DATA_DIR = path.resolve(__dirname, "../.pgdata-dev");
const DB_NAME = "voxemploy_dev";
const URL = `postgresql://postgres:postgres@localhost:5433/${DB_NAME}`;

async function main() {
  const pg = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: "postgres",
    password: "postgres",
    port: 5433,
    persistent: true,
    initdbFlags: ["--encoding=UTF8", "--locale=C", "--no-sync"],
  });

  const isFirstRun = !existsSync(DATA_DIR);
  if (isFirstRun) await pg.initialise();
  await pg.start();
  if (isFirstRun) await pg.createDatabase(DB_NAME);

  execSync("npx prisma migrate deploy", {
    cwd: path.resolve(__dirname, ".."),
    env: { ...process.env, DATABASE_URL: URL },
    stdio: "inherit",
    shell: process.platform === "win32" ? "cmd.exe" : undefined,
  });

  console.log(`\n✅ Base de dev prête : ${URL}`);
  console.log("   (Ctrl+C pour arrêter — les données sont conservées)\n");

  const stop = async () => {
    await pg.stop();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
