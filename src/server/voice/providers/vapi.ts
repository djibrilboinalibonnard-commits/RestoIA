import { z } from "zod";
import { env } from "@/lib/env";
import type {
  AssistantConfig,
  CallCosts,
  TranscriptEntry,
  VoiceEvent,
  VoiceProvider,
} from "../provider";

/**
 * Implémentation Vapi de VoiceProvider.
 * Documentation : https://docs.vapi.ai — formats vérifiés le 14/07/2026.
 * Le stack voix par défaut : Deepgram (STT fr) + Claude Haiku 4.5 (LLM,
 * latence minimale) + Azure Neural fr (TTS) — ajustable par assistant.
 */

const VAPI_BASE_URL = "https://api.vapi.ai";

/** Taux de conversion fixe USD→EUR pour le ledger de coûts (les coûts Vapi
 *  sont facturés en USD). Affiné en Phase 5 (admin) si besoin. */
const USD_TO_EUR = 0.92;

const DEFAULT_VOICE = { provider: "azure", voiceId: "fr-FR-DeniseNeural" };

function parseVoice(voice?: string | null) {
  if (!voice) return DEFAULT_VOICE;
  const [provider, ...rest] = voice.split(":");
  const voiceId = rest.join(":");
  if (!provider || !voiceId) return DEFAULT_VOICE;
  return { provider, voiceId };
}

async function vapiFetch<T>(
  path: string,
  init: { method: string; body?: unknown },
): Promise<T> {
  if (!env.VAPI_API_KEY) {
    throw new Error(
      "VAPI_API_KEY manquante — configurer .env avant d'utiliser la voix.",
    );
  }
  const response = await fetch(`${VAPI_BASE_URL}${path}`, {
    method: init.method,
    headers: {
      Authorization: `Bearer ${env.VAPI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Vapi ${init.method} ${path} → ${response.status} : ${detail}`,
    );
  }
  return (await response.json()) as T;
}

function assistantBody(config: AssistantConfig) {
  const voice = parseVoice(config.voice);
  return {
    name: config.displayName,
    model: {
      provider: "anthropic",
      model: "claude-haiku-4-5",
      messages: [{ role: "system", content: config.systemPrompt }],
      tools: [
        ...config.tools.map((tool) => ({
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          },
        })),
        ...(config.forwardingPhoneNumber
          ? [
              {
                type: "transferCall",
                destinations: [
                  {
                    type: "number",
                    number: config.forwardingPhoneNumber,
                    message:
                      "Je vous mets en relation avec l'équipe, un instant.",
                    description:
                      "Transférer quand le client insiste pour parler à un humain ou en cas de situation délicate.",
                  },
                ],
              },
            ]
          : []),
      ],
    },
    transcriber: { provider: "deepgram", model: "nova-2", language: "fr" },
    voice,
    firstMessage: config.firstMessage,
    server: {
      url: config.serverUrl,
      secret: config.serverSecret, // envoyé en x-vapi-secret sur chaque webhook
      timeoutSeconds: 20,
    },
    serverMessages: ["tool-calls", "status-update", "end-of-call-report"],
    artifactPlan: { recordingEnabled: config.recordingEnabled },
    maxDurationSeconds: config.maxDurationSeconds ?? 900,
    silenceTimeoutSeconds: 30,
  };
}

// ── Schémas de webhooks (défensifs : passthrough + champs optionnels) ──────

const callSchema = z
  .object({
    id: z.string(),
    assistantId: z.string().optional(),
    phoneNumberId: z.string().optional(),
    customer: z.object({ number: z.string().optional() }).partial().optional(),
    startedAt: z.string().optional(),
  })
  .loose();

const toolCallSchema = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    parameters: z.unknown().optional(),
    // Variante OpenAI-style également observée chez Vapi.
    function: z
      .object({ name: z.string(), arguments: z.unknown() })
      .loose()
      .optional(),
  })
  .loose();

const webhookSchema = z.object({
  message: z
    .object({
      type: z.string(),
      call: callSchema.optional(),
      status: z.string().optional(),
      endedReason: z.string().optional(),
      startedAt: z.string().optional(),
      endedAt: z.string().optional(),
      durationSeconds: z.number().optional(),
      recordingUrl: z.string().optional(),
      cost: z.number().optional(),
      costBreakdown: z
        .object({
          transport: z.number().optional(),
          stt: z.number().optional(),
          llm: z.number().optional(),
          tts: z.number().optional(),
          vapi: z.number().optional(),
          total: z.number().optional(),
        })
        .loose()
        .optional(),
      toolCallList: z.array(toolCallSchema).optional(),
      artifact: z
        .object({
          recordingUrl: z.string().optional(),
          recording: z
            .object({ url: z.string().optional() })
            .loose()
            .optional(),
          transcript: z.string().optional(),
          messages: z
            .array(
              z
                .object({
                  role: z.string().optional(),
                  message: z.string().optional(),
                  content: z.string().optional(),
                })
                .loose(),
            )
            .optional(),
        })
        .loose()
        .optional(),
    })
    .loose(),
});

function toEur(usd: number | undefined): number | undefined {
  return usd === undefined
    ? undefined
    : Math.round(usd * USD_TO_EUR * 10000) / 10000;
}

function parseTranscript(
  artifact: z.infer<typeof webhookSchema>["message"]["artifact"],
): TranscriptEntry[] | undefined {
  const messages = artifact?.messages;
  if (!messages) return undefined;
  const entries: TranscriptEntry[] = [];
  for (const m of messages) {
    const text = m.message ?? m.content;
    if (!text) continue;
    if (m.role === "user") entries.push({ role: "user", text });
    else if (m.role === "assistant" || m.role === "bot")
      entries.push({ role: "assistant", text });
  }
  return entries.length > 0 ? entries : undefined;
}

export class VapiProvider implements VoiceProvider {
  async createAssistant(config: AssistantConfig) {
    const created = await vapiFetch<{ id: string }>("/assistant", {
      method: "POST",
      body: assistantBody(config),
    });
    return { providerAssistantId: created.id };
  }

  async updateAssistant(providerAssistantId: string, config: AssistantConfig) {
    await vapiFetch(`/assistant/${providerAssistantId}`, {
      method: "PATCH",
      body: assistantBody(config),
    });
  }

  async deleteAssistant(providerAssistantId: string) {
    await vapiFetch(`/assistant/${providerAssistantId}`, { method: "DELETE" });
  }

  async importTwilioNumber(args: {
    e164: string;
    twilioAccountSid: string;
    twilioAuthToken: string;
    providerAssistantId: string;
  }) {
    const imported = await vapiFetch<{ id: string }>("/phone-number", {
      method: "POST",
      body: {
        provider: "twilio",
        number: args.e164,
        twilioAccountSid: args.twilioAccountSid,
        twilioAuthToken: args.twilioAuthToken,
        assistantId: args.providerAssistantId,
      },
    });
    return { providerNumberId: imported.id };
  }

  verifyWebhook(request: Request): boolean {
    if (!env.VAPI_WEBHOOK_SECRET) return false;
    const secret = request.headers.get("x-vapi-secret");
    return secret === env.VAPI_WEBHOOK_SECRET;
  }

  parseWebhook(body: unknown): VoiceEvent {
    const parsed = webhookSchema.safeParse(body);
    if (!parsed.success) return { type: "ignored", rawType: "unparseable" };
    const message = parsed.data.message;
    const call = message.call;

    const base = {
      providerCallId: call?.id ?? "unknown",
      providerAssistantId: call?.assistantId,
      providerNumberId: call?.phoneNumberId,
      fromE164: call?.customer?.number,
    };

    switch (message.type) {
      case "status-update": {
        if (message.status !== "in-progress" || !call?.id) {
          return { type: "ignored", rawType: `status:${message.status}` };
        }
        return {
          type: "call.started",
          ...base,
          providerCallId: call.id,
          startedAt: call.startedAt ? new Date(call.startedAt) : new Date(),
        };
      }

      case "tool-calls": {
        const calls = (message.toolCallList ?? []).flatMap((tc) => {
          const name = tc.name ?? tc.function?.name;
          if (!name) return [];
          let args: unknown = tc.parameters ?? tc.function?.arguments ?? {};
          if (typeof args === "string") {
            try {
              args = JSON.parse(args);
            } catch {
              args = {};
            }
          }
          return [{ toolCallId: tc.id, name, args }];
        });
        return { type: "tool.calls", ...base, calls };
      }

      case "end-of-call-report": {
        const breakdown = message.costBreakdown;
        const costs: CallCosts | undefined =
          breakdown || message.cost !== undefined
            ? {
                telephony: toEur(breakdown?.transport),
                stt: toEur(breakdown?.stt),
                llm: toEur(breakdown?.llm),
                tts: toEur(breakdown?.tts),
                platform: toEur(breakdown?.vapi),
                total: toEur(breakdown?.total ?? message.cost),
              }
            : undefined;

        const startedAt = message.startedAt
          ? new Date(message.startedAt)
          : call?.startedAt
            ? new Date(call.startedAt)
            : undefined;
        const endedAt = message.endedAt ? new Date(message.endedAt) : undefined;
        const durationSec =
          message.durationSeconds ??
          (startedAt && endedAt
            ? Math.round((endedAt.getTime() - startedAt.getTime()) / 1000)
            : undefined);

        return {
          type: "call.ended",
          ...base,
          endedReason: message.endedReason,
          startedAt,
          endedAt,
          durationSec,
          transcript: parseTranscript(message.artifact),
          recordingUrl:
            message.artifact?.recording?.url ??
            message.artifact?.recordingUrl ??
            message.recordingUrl,
          costs,
        };
      }

      default:
        return { type: "ignored", rawType: message.type };
    }
  }
}

export const vapiProvider = new VapiProvider();
