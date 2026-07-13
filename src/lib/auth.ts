import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { organization } from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";
import { prisma } from "./db";
import { env } from "./env";

/**
 * Configuration Better Auth (serveur).
 * - email / mot de passe
 * - organisations multi-tenant : rôles `owner` et `member` (= staff)
 * - l'organisation active est attachée à la session à sa création
 */
export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
  },
  databaseHooks: {
    session: {
      create: {
        // À la connexion, active automatiquement la première organisation
        // de l'utilisateur (la plupart des clients n'en ont qu'une).
        before: async (session) => {
          const membership = await prisma.member.findFirst({
            where: { userId: session.userId },
            orderBy: { createdAt: "asc" },
          });
          return {
            data: {
              ...session,
              activeOrganizationId: membership?.organizationId ?? null,
            },
          };
        },
      },
    },
  },
  plugins: [
    organization({
      // Un utilisateur peut créer son organisation à l'onboarding.
      allowUserToCreateOrganization: true,
      // TODO(phase 4) : brancher un vrai fournisseur d'e-mails (Resend).
      // En attendant, le lien d'invitation est loggé côté serveur.
      sendInvitationEmail: async (data) => {
        console.log(
          `[invitation] ${data.email} invité(e) dans « ${data.organization.name} » → ${env.BETTER_AUTH_URL}/invitation/${data.id}`,
        );
      },
    }),
    // Doit rester le DERNIER plugin (gestion des cookies Next.js).
    nextCookies(),
  ],
});

export type Session = typeof auth.$Infer.Session;
