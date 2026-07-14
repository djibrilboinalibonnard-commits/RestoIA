import type { PrismaClient } from "@/generated/prisma/client";
import { env } from "@/lib/env";
import type { VoiceProvider } from "./provider";
import { AGENT_TOOLS } from "./tool-definitions";
import { buildFirstMessage, buildSystemPrompt } from "./prompt";

/**
 * Synchronise l'assistant d'un commerce chez le provider vocal :
 * (re)construit le prompt depuis la config tenant + le template versionné,
 * crée ou met à jour l'assistant, persiste providerAssistantId.
 * Appelé par le script de provisionnement (Phase 2) puis par l'onboarding
 * du dashboard (Phase 4) à chaque changement de config.
 */
export async function syncAssistant(
  db: PrismaClient,
  provider: VoiceProvider,
  businessId: string,
): Promise<{ providerAssistantId: string }> {
  const business = await db.business.findUniqueOrThrow({
    where: { id: businessId },
    include: { assistant: true },
  });
  const assistant = business.assistant;
  if (!assistant) {
    throw new Error(`Aucun assistant configuré pour le business ${businessId}`);
  }
  if (!env.VAPI_WEBHOOK_SECRET) {
    throw new Error("VAPI_WEBHOOK_SECRET manquante (voir .env.example)");
  }

  const config = {
    displayName: `${business.name} — ${assistant.displayName}`,
    systemPrompt: buildSystemPrompt({
      assistantName: assistant.displayName,
      businessName: business.name,
      city: business.city,
      timeZone: business.timezone,
      openingHours: business.openingHours,
      faq: business.faq,
      personality: assistant.personality,
      customInstructions: assistant.customInstructions,
      promptVersion: assistant.promptVersion,
    }),
    firstMessage: buildFirstMessage({
      assistantName: assistant.displayName,
      businessName: business.name,
    }),
    language: "fr" as const,
    voice: assistant.voiceId,
    recordingEnabled: assistant.recordingEnabled,
    forwardingPhoneNumber: business.contactPhone,
    tools: AGENT_TOOLS,
    serverUrl: `${env.BETTER_AUTH_URL}/api/webhooks/voice`,
    serverSecret: env.VAPI_WEBHOOK_SECRET,
  };

  if (assistant.providerAssistantId) {
    await provider.updateAssistant(assistant.providerAssistantId, config);
    return { providerAssistantId: assistant.providerAssistantId };
  }

  const created = await provider.createAssistant(config);
  await db.assistant.update({
    where: { id: assistant.id },
    data: {
      providerAssistantId: created.providerAssistantId,
      status: "READY",
    },
  });
  return created;
}
