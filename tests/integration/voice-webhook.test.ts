import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestClient } from "../helpers/db";
import { createVoiceFixture, fakeWebhookDeps } from "../helpers/voice-fixtures";
import { vapiProvider } from "@/server/voice/providers/vapi";
import { handleVoiceEvent } from "@/server/voice/webhook-handler";

/**
 * Cycle de vie complet d'un appel, avec des payloads Vapi rejoués tels que
 * documentés (docs.vapi.ai, vérifiés le 14/07/2026) : status-update →
 * tool-calls → end-of-call-report.
 */

const db = createTestClient();
let orgId: string;
let providerNumberId: string;

const PROVIDER_CALL_ID = `vapi-call-${Date.now()}`;

function vapiCallObject() {
  return {
    id: PROVIDER_CALL_ID,
    assistantId: "vapi-assistant-webhook",
    phoneNumberId: providerNumberId,
    customer: { number: "+33698765432" },
    startedAt: "2030-06-14T17:58:00.000Z",
  };
}

beforeAll(async () => {
  const fixture = await createVoiceFixture(db, "webhook");
  orgId = fixture.org.id;
  providerNumberId = fixture.phoneNumber.providerImportId!;
});

afterAll(async () => {
  await db.organization.delete({ where: { id: orgId } });
  await db.$disconnect();
});

describe("cycle de vie d'un appel via webhooks", () => {
  it("status-update in-progress crée la ligne Call rattachée au bon tenant", async () => {
    const event = vapiProvider.parseWebhook({
      message: {
        type: "status-update",
        status: "in-progress",
        call: vapiCallObject(),
      },
    });
    expect(event.type).toBe("call.started");
    await handleVoiceEvent(db, fakeWebhookDeps().deps, event);

    const call = await db.call.findUnique({
      where: { providerCallId: PROVIDER_CALL_ID },
    });
    expect(call).not.toBeNull();
    expect(call!.organizationId).toBe(orgId);
    expect(call!.fromE164).toBe("+33698765432");
    expect(call!.status).toBe("IN_PROGRESS");
  });

  it("tool-calls exécute l'outil et répond au format Vapi", async () => {
    const { deps } = fakeWebhookDeps();
    const event = vapiProvider.parseWebhook({
      message: {
        type: "tool-calls",
        call: vapiCallObject(),
        toolCallList: [
          {
            id: "toolcall-1",
            name: "check_availability",
            parameters: { date: "2030-06-14", time: "20:00", covers: 2 },
          },
        ],
      },
    });
    expect(event.type).toBe("tool.calls");

    const { response } = await handleVoiceEvent(db, deps, event);
    expect(response).toBeDefined();
    expect(response!.results).toHaveLength(1);
    expect(response!.results[0]).toMatchObject({
      toolCallId: "toolcall-1",
      name: "check_availability",
    });
    expect(JSON.parse(response!.results[0].result)).toMatchObject({
      disponible: true,
    });
  });

  it("supporte la variante OpenAI-style (function.arguments en JSON string)", async () => {
    const { deps } = fakeWebhookDeps();
    const event = vapiProvider.parseWebhook({
      message: {
        type: "tool-calls",
        call: vapiCallObject(),
        toolCallList: [
          {
            id: "toolcall-2",
            function: {
              name: "check_availability",
              arguments: JSON.stringify({
                date: "2030-06-14",
                time: "20:00",
                covers: 2,
              }),
            },
          },
        ],
      },
    });
    const { response } = await handleVoiceEvent(db, deps, event);
    expect(JSON.parse(response!.results[0].result)).toMatchObject({
      disponible: true,
    });
  });

  it("end-of-call-report finalise l'appel : durée, coûts, transcript, usage", async () => {
    const { deps, storedRecordings, analyzedCalls } = fakeWebhookDeps();
    const event = vapiProvider.parseWebhook({
      message: {
        type: "end-of-call-report",
        endedReason: "customer-ended-call",
        call: vapiCallObject(),
        startedAt: "2030-06-14T17:58:00.000Z",
        endedAt: "2030-06-14T18:01:30.000Z",
        durationSeconds: 210,
        cost: 0.35,
        costBreakdown: {
          transport: 0.05,
          stt: 0.03,
          llm: 0.04,
          tts: 0.1,
          vapi: 0.13,
          total: 0.35,
        },
        artifact: {
          recording: { url: "https://storage.vapi.ai/rec-123.wav" },
          messages: [
            { role: "assistant", message: "Chez Webhook bonjour !" },
            { role: "user", message: "Une table pour deux ce soir." },
          ],
        },
      },
    });
    expect(event.type).toBe("call.ended");

    const { sideEffects } = await handleVoiceEvent(db, deps, event);
    for (const effect of sideEffects) await effect();

    const call = await db.call.findUnique({
      where: { providerCallId: PROVIDER_CALL_ID },
    });
    expect(call!.status).toBe("COMPLETED");
    expect(call!.durationSec).toBe(210);
    // 0,35 $ × 0,92 = 0,322 € — le ledger de coûts est en euros.
    expect(Number(call!.costTotal)).toBeCloseTo(0.322, 3);
    expect(Number(call!.costPlatform)).toBeCloseTo(0.1196, 4);
    expect(call!.audioUrl).toBe("s3://test/" + call!.id + ".wav"); // stocké S3
    expect(storedRecordings).toEqual(["https://storage.vapi.ai/rec-123.wav"]);
    expect(analyzedCalls).toEqual([call!.id]); // analyse post-appel déclenchée

    const transcript = call!.transcript as { role: string; text: string }[];
    expect(transcript).toHaveLength(2);
    expect(transcript[1]).toEqual({
      role: "user",
      text: "Une table pour deux ce soir.",
    });

    // Décompte des minutes du mois.
    const usage = await db.usageRecord.findFirst({
      where: { organizationId: orgId },
    });
    expect(usage!.usedSeconds).toBe(210);
  });

  it("un end-of-call-report rejoué est ignoré (idempotence)", async () => {
    const { deps } = fakeWebhookDeps();
    const event = vapiProvider.parseWebhook({
      message: {
        type: "end-of-call-report",
        call: vapiCallObject(),
        durationSeconds: 210,
      },
    });
    await handleVoiceEvent(db, deps, event);

    const usage = await db.usageRecord.findFirst({
      where: { organizationId: orgId },
    });
    expect(usage!.usedSeconds).toBe(210); // pas doublé
  });

  it("un événement inconnu est ignoré sans erreur", async () => {
    const event = vapiProvider.parseWebhook({
      message: { type: "speech-update", call: vapiCallObject() },
    });
    expect(event).toEqual({ type: "ignored", rawType: "speech-update" });
    const result = await handleVoiceEvent(db, fakeWebhookDeps().deps, event);
    expect(result.sideEffects).toHaveLength(0);
  });
});
