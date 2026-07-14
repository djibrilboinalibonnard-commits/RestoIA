# VoxEmploy

**L'employé digital vocal des commerces francophones.** Répond au téléphone 24h/24 en français naturel : réservations, commandes, questions fréquentes — avec SMS de confirmation et dashboard temps réel.

📐 Architecture : [ARCHITECTURE.md](./ARCHITECTURE.md) · 🗺️ Roadmap : [ROADMAP.md](./ROADMAP.md)

## Stack

Next.js 16 (App Router, Turbopack) · TypeScript strict · PostgreSQL + Prisma 7 · Better Auth (multi-tenant) · Tailwind CSS 4 · Vitest · Vapi (voix, Phase 2) · Stripe (Phase 5)

## Setup local

Prérequis : **Node.js ≥ 20.9** (24 recommandé) et **Git**. Ni Docker ni Postgres ne sont nécessaires pour les tests (Postgres embarqué automatique).

```bash
npm ci                 # dépendances
cp .env.example .env   # puis remplir (au minimum BETTER_AUTH_SECRET)
npx prisma generate    # client Prisma
npm test               # démarre un Postgres jetable + migrations + tests
```

Pour le serveur de dev avec une vraie base persistante : renseigner `DATABASE_URL` (Postgres local, Railway ou Neon) puis :

```bash
npx prisma migrate deploy
npm run db:seed        # resto de démo : mario@exemple.fr / motdepasse123
npm run dev            # http://localhost:3000
```

## Scripts

| Commande                     | Rôle                                                       |
| ---------------------------- | ---------------------------------------------------------- |
| `npm run dev`                | Serveur de développement                                   |
| `npm run build` / `start`    | Build et serveur de production                             |
| `npm run lint` / `typecheck` | ESLint / `tsc --noEmit`                                    |
| `npm test`                   | Tests unitaires + intégration (Postgres embarqué en local) |
| `npm run db:migrate`         | Applique les migrations (`prisma migrate deploy`)          |
| `npm run db:seed`            | Données de démo                                            |

## Structure

```
prisma/               schéma complet + migrations + seed
prompts/              prompts système de l'agent vocal, versionnés (Phase 2)
src/lib/              env (zod), db (Prisma), auth (Better Auth)
src/server/tenant.ts  TenantContext — obligatoire pour toute donnée métier
src/server/repositories/  accès données scellés par organizationId
src/app/              landing, auth, onboarding, dashboard /app
tests/                unit + integration (dont test d'isolation multi-tenant)
```

**Règle multi-tenant** : aucun accès Prisma direct aux tables métier depuis les pages/routes — toujours via un repository qui exige un `TenantContext`. Le test `tests/integration/tenant-isolation.test.ts` le prouve et casse la CI en cas de régression.

## Mise en service de l'agent vocal (Phase 2)

L'architecture voix est décrite dans [ARCHITECTURE.md](./ARCHITECTURE.md) §2 : Vapi (Deepgram fr + Claude Haiku 4.5 + voix Azure fr) derrière l'interface `VoiceProvider`, décisions prises exclusivement par nos tools serveur.

1. **Clés** : renseigner `VAPI_API_KEY`, `VAPI_WEBHOOK_SECRET` (chaîne aléatoire ≥ 16 car., le webhook la vérifie), `ANTHROPIC_API_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` — en local **et** dans Railway. `BETTER_AUTH_URL` doit être l'URL publique (les webhooks Vapi pointent dessus).
2. **Numéro français** : dans la console Twilio, créer un _Regulatory Bundle_ FR (justificatif d'adresse) puis acheter un numéro +33 — étape réglementaire non automatisable proprement.
3. **Provisionner** :
   ```bash
   npx tsx scripts/provision-number.ts --business <businessId> --number <+33XXXXXXXXX>
   ```
   Le script synchronise l'assistant chez Vapi (prompt versionné `prompts/system-v1.ts` + config du commerce), importe le numéro et active l'agent.
4. **Tester** : appeler le numéro — réservation de bout en bout, SMS de confirmation, appel visible dans le dashboard avec transcription, résumé (Claude Opus 4.8) et coûts.

Webhooks entrants : `POST /api/webhooks/voice`, authentifiés par l'en-tête `x-vapi-secret`. Événements : `status-update` (création de l'appel), `tool-calls` (chemin critique de latence — SMS et notifications sont différés via `after()`), `end-of-call-report` (durée, coûts €, transcription, décompte minutes, analyse post-appel).

## Déploiement (Railway, région EU)

1. Créer un projet Railway (région **Amsterdam**) + un service PostgreSQL.
2. Connecter le repo GitHub ; build command par défaut (`npm run build`), start `npm run start`.
3. Variables : `DATABASE_URL` (fournie par Railway), `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` (URL publique).
4. Commande de release : `npx prisma migrate deploy`.

## Comptes tiers (par phase)

| Phase | Service                              | Notes                                                          |
| ----- | ------------------------------------ | -------------------------------------------------------------- |
| 2     | Vapi, Twilio, Anthropic, Scaleway S3 | Twilio : justificatif d'adresse FR requis pour les numéros +33 |
| 5     | Stripe                               | Mode test jusqu'au lancement                                   |
| 6     | Sentry                               | Observabilité                                                  |
