import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Provisionnement d'un numéro pour un commerce :
 *   npx tsx scripts/provision-number.ts --business <businessId> --number <+33...>
 *
 * Prérequis (une fois, dans la console Twilio — obligation réglementaire
 * française, non automatisable proprement par API) :
 *   1. Créer un « Regulatory Bundle » FR approuvé + une adresse.
 *   2. Acheter un numéro français (+33) rattaché à ce bundle.
 * Le script : synchronise l'assistant chez Vapi, importe le numéro Twilio
 * dans Vapi, le rattache à l'assistant et enregistre le tout en base.
 */

function arg(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1 || !process.argv[index + 1]) {
    console.error(
      "Usage : npx tsx scripts/provision-number.ts --business <businessId> --number <+33...>",
    );
    process.exit(1);
  }
  return process.argv[index + 1];
}

async function main() {
  const businessId = arg("business");
  const e164 = arg("number");
  if (!/^\+\d{6,15}$/.test(e164)) {
    throw new Error(
      `Numéro invalide : ${e164} (format attendu : +33XXXXXXXXX)`,
    );
  }

  const { env } = await import("../src/lib/env");
  if (!env.VAPI_API_KEY || !env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) {
    throw new Error(
      "VAPI_API_KEY, TWILIO_ACCOUNT_SID et TWILIO_AUTH_TOKEN sont requis (.env).",
    );
  }

  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  const { vapiProvider } = await import("../src/server/voice/providers/vapi");
  const { syncAssistant } =
    await import("../src/server/voice/assistant-service");

  const business = await prisma.business.findUniqueOrThrow({
    where: { id: businessId },
  });
  console.log(`→ Commerce : ${business.name}`);

  console.log("→ Synchronisation de l'assistant chez Vapi…");
  const { providerAssistantId } = await syncAssistant(
    prisma,
    vapiProvider,
    businessId,
  );
  console.log(`  assistant Vapi : ${providerAssistantId}`);

  console.log(`→ Import du numéro ${e164} dans Vapi…`);
  const { providerNumberId } = await vapiProvider.importTwilioNumber({
    e164,
    twilioAccountSid: env.TWILIO_ACCOUNT_SID,
    twilioAuthToken: env.TWILIO_AUTH_TOKEN,
    providerAssistantId,
  });
  console.log(`  numéro Vapi : ${providerNumberId}`);

  await prisma.phoneNumber.upsert({
    where: { e164 },
    create: {
      organizationId: business.organizationId,
      businessId: business.id,
      e164,
      provider: "twilio",
      providerImportId: providerNumberId,
      status: "ACTIVE",
    },
    update: {
      businessId: business.id,
      providerImportId: providerNumberId,
      status: "ACTIVE",
    },
  });
  await prisma.assistant.update({
    where: { businessId: business.id },
    data: { status: "LIVE" },
  });

  console.log(`\n✅ ${e164} répond désormais pour « ${business.name} ».`);
  console.log("   Appelle le numéro pour tester la prise de réservation.");
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
