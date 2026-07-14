import Anthropic from "@anthropic-ai/sdk";
import type { PrismaClient } from "@/generated/prisma/client";
import { env, isLlmConfigured } from "@/lib/env";
import type { TranscriptEntry } from "./provider";

/**
 * Traitement post-appel (hors temps réel) : résumé + extraction structurée
 * de la transcription avec Claude Opus 4.8 (structured outputs → JSON
 * garanti conforme au schéma). Coût ~0,02 €/appel.
 */

export type CallAnalysis = {
  intent:
    | "reservation"
    | "annulation"
    | "modification"
    | "commande"
    | "question"
    | "message"
    | "autre";
  summary: string;
  entities: {
    date?: string;
    heure?: string;
    couverts?: number;
    nom?: string;
    telephone?: string;
  };
};

const ANALYSIS_SCHEMA = {
  type: "object",
  properties: {
    intent: {
      type: "string",
      enum: [
        "reservation",
        "annulation",
        "modification",
        "commande",
        "question",
        "message",
        "autre",
      ],
      description: "Intention principale de l'appelant",
    },
    summary: {
      type: "string",
      description:
        "Résumé de l'appel en français, 1 à 2 phrases, orienté restaurateur (qui, quoi, résultat)",
    },
    entities: {
      type: "object",
      properties: {
        date: { type: "string", description: "AAAA-MM-JJ si mentionnée" },
        heure: { type: "string", description: "HH:MM si mentionnée" },
        couverts: { type: "integer" },
        nom: { type: "string" },
        telephone: { type: "string" },
      },
      required: [],
      additionalProperties: false,
    },
  },
  required: ["intent", "summary", "entities"],
  additionalProperties: false,
} as const;

export async function analyzeTranscript(
  transcript: TranscriptEntry[],
): Promise<CallAnalysis | null> {
  if (!isLlmConfigured() || transcript.length === 0) return null;

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const text = transcript
    .map((t) => `${t.role === "user" ? "Client" : "Agent"} : ${t.text}`)
    .join("\n");

  const response = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 2048,
    system:
      "Tu analyses la transcription d'un appel téléphonique reçu par le standardiste IA d'un restaurant français. Réponds uniquement dans le schéma JSON demandé, en français.",
    messages: [{ role: "user", content: text }],
    output_config: {
      format: { type: "json_schema", schema: ANALYSIS_SCHEMA },
    },
  });

  if (response.stop_reason === "refusal") return null;
  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") return null;

  try {
    return JSON.parse(block.text) as CallAnalysis;
  } catch {
    console.error("[post-call] JSON d'analyse illisible");
    return null;
  }
}

/** Applique l'analyse au Call (résumé, intention, entités). */
export async function runPostCallAnalysis(
  db: PrismaClient,
  callId: string,
): Promise<void> {
  const call = await db.call.findUnique({
    where: { id: callId },
    select: { transcript: true },
  });
  const transcript = (call?.transcript ?? null) as TranscriptEntry[] | null;
  if (!transcript || transcript.length === 0) return;

  try {
    const analysis = await analyzeTranscript(transcript);
    if (!analysis) return;
    await db.call.update({
      where: { id: callId },
      data: {
        summary: analysis.summary,
        intent: analysis.intent,
        entities: analysis.entities,
      },
    });
  } catch (error) {
    // L'analyse est un enrichissement : son échec ne doit rien casser.
    console.error(`[post-call] analyse échouée pour ${callId}`, error);
  }
}
