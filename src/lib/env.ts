import { z } from "zod";

/**
 * Variables d'environnement validées au démarrage.
 * Toute nouvelle intégration (Vapi, Twilio, Stripe, …) ajoute ses clés ici
 * ET dans .env.example.
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
