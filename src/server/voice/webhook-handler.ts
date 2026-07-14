import type { PrismaClient } from "@/generated/prisma/client";
import type { ToolCallResponse, VoiceEvent } from "./provider";
import {
  executeToolCall,
  type ToolDependencies,
  type VoiceCallContext,
} from "./tools";

/**
 * Cœur métier des webhooks voix — indépendant du framework HTTP et du
 * provider (reçoit des VoiceEvent normalisés), donc intégralement testable.
 *
 * Latence : pour tool.calls, la réponse HTTP est attendue par le client AU
 * TÉLÉPHONE. Les effets lents (SMS, notifications, stockage audio, analyse
 * LLM) sont retournés dans `sideEffects` et exécutés après la réponse.
 */

export type HandlerResult = {
  /** Corps de réponse à renvoyer au provider (tool.calls uniquement). */
  response?: ToolCallResponse;
  sideEffects: Array<() => Promise<void>>;
};

/** Retrouve le tenant d'un appel via le numéro ou l'assistant provider. */
async function resolveBusiness(
  db: PrismaClient,
  event: { providerNumberId?: string; providerAssistantId?: string },
) {
  if (event.providerNumberId) {
    const phoneNumber = await db.phoneNumber.findFirst({
      where: { providerImportId: event.providerNumberId },
      include: { business: true },
    });
    if (phoneNumber)
      return { business: phoneNumber.business, phoneNumberId: phoneNumber.id };
  }
  if (event.providerAssistantId) {
    const assistant = await db.assistant.findFirst({
      where: { providerAssistantId: event.providerAssistantId },
      include: { business: true },
    });
    if (assistant) return { business: assistant.business, phoneNumberId: null };
  }
  return null;
}

/** Crée (ou retrouve) la ligne Call — les événements peuvent arriver dans le désordre. */
async function upsertCall(
  db: PrismaClient,
  event: Extract<VoiceEvent, { type: "call.started" | "tool.calls" }>,
  startedAt: Date,
) {
  const existing = await db.call.findUnique({
    where: { providerCallId: event.providerCallId },
    include: { business: true },
  });
  if (existing) return existing;

  const resolved = await resolveBusiness(db, event);
  if (!resolved) return null;

  return db.call.create({
    data: {
      organizationId: resolved.business.organizationId,
      businessId: resolved.business.id,
      phoneNumberId: resolved.phoneNumberId,
      providerCallId: event.providerCallId,
      fromE164: event.fromE164,
      startedAt,
    },
    include: { business: true },
  });
}

/** Incrémente le compteur de minutes du mois (rattaché à Stripe en Phase 5). */
async function recordUsage(
  db: PrismaClient,
  organizationId: string,
  durationSec: number,
) {
  const now = new Date();
  const periodStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  );
  const periodEnd = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
  );
  await db.usageRecord.upsert({
    where: { organizationId_periodStart: { organizationId, periodStart } },
    create: {
      organizationId,
      periodStart,
      periodEnd,
      usedSeconds: durationSec,
    },
    update: { usedSeconds: { increment: durationSec } },
  });
}

export type WebhookHandlerDeps = ToolDependencies & {
  storeRecording: (args: {
    sourceUrl: string;
    organizationId: string;
    callId: string;
  }) => Promise<{ url: string; stored: boolean }>;
  runPostCallAnalysis: (db: PrismaClient, callId: string) => Promise<void>;
};

export async function handleVoiceEvent(
  db: PrismaClient,
  deps: WebhookHandlerDeps,
  event: VoiceEvent,
): Promise<HandlerResult> {
  switch (event.type) {
    case "call.started": {
      await upsertCall(db, event, event.startedAt);
      return { sideEffects: [] };
    }

    case "tool.calls": {
      const call = await upsertCall(db, event, new Date());
      if (!call) {
        // Tenant introuvable : on répond quand même pour ne pas bloquer
        // l'appel, l'agent basculera sur la prise de message.
        return {
          response: {
            results: event.calls.map((c) => ({
              toolCallId: c.toolCallId,
              name: c.name,
              result: JSON.stringify({
                erreur: "configuration introuvable",
                consigne: "propose de prendre un message",
              }),
            })),
          },
          sideEffects: [],
        };
      }

      const ctx: VoiceCallContext = {
        organizationId: call.organizationId,
        businessId: call.businessId,
        businessName: call.business.name,
        timezone: call.business.timezone,
        callId: call.id,
        fromE164: call.fromE164 ?? event.fromE164,
      };

      const results: ToolCallResponse["results"] = [];
      const sideEffects: HandlerResult["sideEffects"] = [];
      for (const toolCall of event.calls) {
        const execution = await executeToolCall(
          db,
          deps,
          ctx,
          toolCall.name,
          toolCall.args,
        );
        results.push({
          toolCallId: toolCall.toolCallId,
          name: toolCall.name,
          result: execution.result,
        });
        sideEffects.push(...execution.sideEffects);
      }
      return { response: { results }, sideEffects };
    }

    case "call.ended": {
      const call = await db.call.findUnique({
        where: { providerCallId: event.providerCallId },
      });
      if (!call) return { sideEffects: [] };
      // Idempotence : un end-of-call-report rejoué est ignoré.
      if (call.status === "COMPLETED") return { sideEffects: [] };

      const failed =
        event.endedReason?.includes("error") ||
        event.endedReason?.includes("failed");

      const updated = await db.call.update({
        where: { id: call.id },
        data: {
          status: failed ? "FAILED" : "COMPLETED",
          endedAt: event.endedAt ?? new Date(),
          durationSec: event.durationSec,
          transcript: event.transcript ?? undefined,
          audioUrl: event.recordingUrl,
          costTelephony: event.costs?.telephony,
          costStt: event.costs?.stt,
          costLlm: event.costs?.llm,
          costTts: event.costs?.tts,
          costPlatform: event.costs?.platform,
          costTotal: event.costs?.total,
          // Appel terminé sans action enregistrée → abandonné.
          outcome: call.outcome ?? (failed ? "ERROR" : "ABANDONED"),
        },
      });

      if (event.durationSec && event.durationSec > 0) {
        await recordUsage(db, call.organizationId, event.durationSec);
      }

      const sideEffects: HandlerResult["sideEffects"] = [];
      if (event.recordingUrl) {
        sideEffects.push(async () => {
          const stored = await deps.storeRecording({
            sourceUrl: event.recordingUrl!,
            organizationId: call.organizationId,
            callId: call.id,
          });
          if (stored.stored) {
            await db.call.update({
              where: { id: call.id },
              data: { audioUrl: stored.url },
            });
          }
        });
      }
      if (updated.transcript) {
        sideEffects.push(() => deps.runPostCallAnalysis(db, call.id));
      }
      return { sideEffects };
    }

    case "ignored":
      return { sideEffects: [] };
  }
}
