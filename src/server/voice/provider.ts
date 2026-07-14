import type { ToolDefinition } from "./tool-definitions";

/**
 * Abstraction de la couche vocale (ARCHITECTURE.md §2).
 * Tout le métier ne connaît que ces types ; Vapi n'apparaît que dans
 * providers/vapi.ts. Migrer vers un pipeline custom = réimplémenter cette
 * interface, sans toucher aux tools, prompts, webhooks métier ni au schéma.
 */

export type AssistantConfig = {
  displayName: string;
  systemPrompt: string;
  firstMessage: string;
  language: "fr";
  /** Format "provider:voiceId" (ex. "azure:fr-FR-DeniseNeural") ou null → défaut. */
  voice?: string | null;
  recordingEnabled: boolean;
  /** Ligne du commerce pour le transfert humain (tool natif du provider). */
  forwardingPhoneNumber?: string | null;
  tools: ToolDefinition[];
  serverUrl: string;
  serverSecret: string;
  maxDurationSeconds?: number;
};

export type TranscriptEntry = { role: "assistant" | "user"; text: string };

export type CallCosts = {
  telephony?: number;
  stt?: number;
  llm?: number;
  tts?: number;
  platform?: number;
  total?: number;
};

/** Événements normalisés — le métier ne voit que ça. */
export type VoiceEvent =
  | {
      type: "call.started";
      providerCallId: string;
      providerAssistantId?: string;
      providerNumberId?: string;
      fromE164?: string;
      startedAt: Date;
    }
  | {
      type: "tool.calls";
      providerCallId: string;
      providerAssistantId?: string;
      providerNumberId?: string;
      fromE164?: string;
      calls: { toolCallId: string; name: string; args: unknown }[];
    }
  | {
      type: "call.ended";
      providerCallId: string;
      providerAssistantId?: string;
      providerNumberId?: string;
      fromE164?: string;
      endedReason?: string;
      startedAt?: Date;
      endedAt?: Date;
      durationSec?: number;
      transcript?: TranscriptEntry[];
      recordingUrl?: string;
      costs?: CallCosts;
    }
  | { type: "ignored"; rawType?: string };

export type ToolCallResponse = {
  results: { toolCallId: string; name: string; result: string }[];
};

export interface VoiceProvider {
  createAssistant(
    config: AssistantConfig,
  ): Promise<{ providerAssistantId: string }>;
  updateAssistant(
    providerAssistantId: string,
    config: AssistantConfig,
  ): Promise<void>;
  deleteAssistant(providerAssistantId: string): Promise<void>;

  /** Importe un numéro Twilio déjà acheté et le rattache à un assistant. */
  importTwilioNumber(args: {
    e164: string;
    twilioAccountSid: string;
    twilioAuthToken: string;
    providerAssistantId: string;
  }): Promise<{ providerNumberId: string }>;

  /** Vérifie l'authenticité d'un webhook entrant. */
  verifyWebhook(request: Request): boolean;

  /** Payload brut du provider → événement normalisé. */
  parseWebhook(body: unknown): VoiceEvent;
}
