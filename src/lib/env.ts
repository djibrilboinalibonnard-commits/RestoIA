import { z } from "zod";

/**
 * Variables d'environnement validées au démarrage.
 * Les intégrations Phase 2+ sont optionnelles : l'app démarre sans elles,
 * chaque module vérifie sa configuration au moment de l'usage (voir
 * isVoiceConfigured / isSmsConfigured / isLlmConfigured ci-dessous).
 */
const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  DATABASE_URL: z
    .string()
    .startsWith("postgres", "DATABASE_URL doit être une URL PostgreSQL"),
  BETTER_AUTH_SECRET: z
    .string()
    .min(32, "BETTER_AUTH_SECRET doit faire au moins 32 caractères"),
  BETTER_AUTH_URL: z.string().url().default("http://localhost:3000"),

  // ── Agent vocal (Vapi) ────────────────────────────────────────────────
  VAPI_API_KEY: z.string().optional(),
  /** Secret partagé, vérifié sur chaque webhook entrant (x-vapi-secret). */
  VAPI_WEBHOOK_SECRET: z.string().min(16).optional(),

  // ── LLM post-appel (Anthropic) ────────────────────────────────────────
  ANTHROPIC_API_KEY: z.string().optional(),

  // ── Téléphonie / SMS (Twilio) ─────────────────────────────────────────
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  /** Expéditeur SMS : sender alphanumérique ("VoxEmploy") ou numéro E.164. */
  TWILIO_SMS_FROM: z.string().default("VoxEmploy"),

  // ── Stockage audio S3 compatible UE (Scaleway) ────────────────────────
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default("fr-par"),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error(
    "❌ Variables d'environnement invalides :",
    parsed.error.flatten().fieldErrors,
  );
  throw new Error(
    "Configuration invalide — voir .env.example pour la liste des variables requises.",
  );
}

export const env = parsed.data;

export const isVoiceConfigured = () =>
  Boolean(env.VAPI_API_KEY && env.VAPI_WEBHOOK_SECRET);

export const isSmsConfigured = () =>
  Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN);

export const isLlmConfigured = () => Boolean(env.ANTHROPIC_API_KEY);

export const isStorageConfigured = () =>
  Boolean(
    env.S3_ENDPOINT &&
    env.S3_BUCKET &&
    env.S3_ACCESS_KEY_ID &&
    env.S3_SECRET_ACCESS_KEY,
  );
