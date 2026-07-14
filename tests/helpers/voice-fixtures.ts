import type { PrismaClient } from "@/generated/prisma/client";
import type { ToolDependencies } from "@/server/voice/tools";
import type { WebhookHandlerDeps } from "@/server/voice/webhook-handler";

/** Crée un tenant complet (org + business + assistant + numéro + capacité). */
export async function createVoiceFixture(db: PrismaClient, suffix: string) {
  const org = await db.organization.create({
    data: { name: `Resto ${suffix}`, slug: `resto-${suffix}-${Date.now()}` },
  });
  const business = await db.business.create({
    data: {
      organizationId: org.id,
      name: `Chez ${suffix}`,
      city: "Lyon",
      timezone: "Europe/Paris",
      contactPhone: "+33600000001",
    },
  });
  await db.assistant.create({
    data: {
      organizationId: org.id,
      businessId: business.id,
      displayName: "Léa",
      providerAssistantId: `vapi-assistant-${suffix}`,
      status: "LIVE",
    },
  });
  const phoneNumber = await db.phoneNumber.create({
    data: {
      organizationId: org.id,
      businessId: business.id,
      e164: `+3390000${Math.floor(Math.random() * 9000) + 1000}`,
      providerImportId: `vapi-number-${suffix}`,
      status: "ACTIVE",
    },
  });
  // Service du soir tous les jours : 19:00–22:30, 20 couverts / 30 min.
  await db.capacityRule.createMany({
    data: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
      businessId: business.id,
      dayOfWeek,
      startTime: "19:00",
      endTime: "22:30",
      slotMinutes: 30,
      maxCovers: 20,
      maxPartySize: 8,
    })),
  });
  return { org, business, phoneNumber };
}

/** Dépendances de tools instrumentées pour les assertions. */
export function fakeDeps() {
  const sentSms: { to: string; body: string }[] = [];
  const notifications: { title: string; body: string }[] = [];
  const deps: ToolDependencies = {
    sendSms: async (args) => {
      sentSms.push(args);
    },
    notifyOwner: async (args) => {
      notifications.push(args);
    },
  };
  return { deps, sentSms, notifications };
}

export function fakeWebhookDeps() {
  const base = fakeDeps();
  const storedRecordings: string[] = [];
  const analyzedCalls: string[] = [];
  const deps: WebhookHandlerDeps = {
    ...base.deps,
    storeRecording: async (args) => {
      storedRecordings.push(args.sourceUrl);
      return { url: `s3://test/${args.callId}.wav`, stored: true };
    },
    runPostCallAnalysis: async (_db, callId) => {
      analyzedCalls.push(callId);
    },
  };
  return { ...base, deps, storedRecordings, analyzedCalls };
}
