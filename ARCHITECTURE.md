# VoxEmploy — Architecture

> **Statut** : Phase 0 — en attente de validation avant tout code.
> **Décisions actées avec le fondateur (13/07/2026)** : couche vocale **Vapi (managé)**, marché **France uniquement**, nom **VoxEmploy**, tarification **premium 79 / 179 / 349 € HT/mois**.

---

## 1. Vision technique en une phrase

Un monolithe Next.js/TypeScript hébergé en UE, multi-tenant strict, qui délègue le temps réel vocal à Vapi derrière une interface `VoiceProvider`, garde tout le métier (réservations, commandes, facturation, RGPD) chez nous, et peut migrer vers un pipeline vocal custom sans réécrire le métier.

---

## 2. Décision n°1 : couche vocale managée vs pipeline custom

### Comparaison

| Critère                             | **Vapi (managé)** ✅ retenu                                          | Retell AI (managé)   | Pipeline custom (Twilio Media Streams + Deepgram + LLM + Cartesia/ElevenLabs) |
| ----------------------------------- | -------------------------------------------------------------------- | -------------------- | ----------------------------------------------------------------------------- |
| Time-to-market MVP vocal            | **~1–2 semaines**                                                    | ~1–2 semaines        | **6–10 semaines** (WebSocket audio, VAD, barge-in, jitter, reconnexions…)     |
| Latence voix-à-voix                 | 500–900 ms, gérée par la plateforme                                  | 500–900 ms           | 600–1200 ms — atteignable mais c'est un travail d'ingénierie permanent        |
| Barge-in, bruit, accents            | Natif (VAD + endpointing configurables)                              | Natif                | À construire et régler soi-même                                               |
| Coût estimé / minute (tout compris) | **~0,09–0,13 €** (plateforme ~0,05 $ + STT + TTS + LLM + téléphonie) | ~0,08–0,12 €         | **~0,04–0,06 €** + coût d'infra + coût d'ingénierie                           |
| Appels simultanés                   | Illimités (scaling géré)                                             | Illimités            | À dimensionner soi-même                                                       |
| Numéros FR                          | Import de numéros Twilio (SIP trunk / BYO)                           | Idem                 | Direct Twilio                                                                 |
| Function calling pendant l'appel    | Webhooks "tools" vers notre serveur                                  | Idem                 | Natif (on contrôle tout)                                                      |
| Risque vendor lock-in               | **Moyen** — mitigé par l'abstraction `VoiceProvider`                 | Moyen                | Nul                                                                           |
| Écosystème / outillage              | Le plus riche (tools, squads, test suites, appels web)               | Bon mais plus étroit | N/A                                                                           |

### Décision et justification

**Vapi**, pour trois raisons :

1. **Le risque du produit n'est pas technique, il est commercial.** Il faut valider que des restaurateurs paient 79–349 €/mois. Chaque semaine passée à régler du barge-in est une semaine sans client.
2. **La qualité perçue au lancement.** Vapi livre dès le jour 1 une latence <1s et une gestion des interruptions au niveau de l'état de l'art. Un pipeline custom v1 serait objectivement moins bon pendant des mois.
3. **La marge reste correcte.** À ~0,11 €/min de coût voix et des plans premium, la marge brute est de 60–75 % (§8). La migration custom (Phase 7+, hors périmètre initial) fera passer le coût voix à ~0,05 €/min quand le volume le justifiera — c'est une optimisation de marge, pas un prérequis.

### Mitigation du lock-in : l'interface `VoiceProvider`

Tout le code métier ne connaît que cette interface. Vapi n'apparaît que dans `src/lib/voice/providers/vapi/`.

```ts
// src/lib/voice/provider.ts — contrat indicatif, affiné en Phase 2
export interface VoiceProvider {
  // Cycle de vie de l'agent
  createAssistant(
    config: AssistantConfig,
  ): Promise<{ providerAssistantId: string }>;
  updateAssistant(id: string, config: AssistantConfig): Promise<void>;
  deleteAssistant(id: string): Promise<void>;

  // Téléphonie
  attachPhoneNumber(assistantId: string, e164: string): Promise<void>;

  // Appel de test navigateur (widget démo + onboarding)
  createWebCallSession(assistantId: string): Promise<{ token: string }>;

  // Webhooks entrants (normalisation des événements provider → événements VoxEmploy)
  parseWebhook(req: Request): Promise<VoiceEvent>; // call.started, call.ended, tool.call, transcript, …
  verifyWebhookSignature(req: Request): Promise<boolean>;
}

// Les "tools" exposés à l'agent vocal (check_availability, create_booking, take_order,
// take_message, transfer_to_human, …) sont définis chez NOUS en JSON Schema et
// enregistrés chez le provider — le schéma est portable vers un pipeline custom.
```

**Règle d'or** : les décisions (disponibilité d'un créneau, prix d'une commande, confirmation) sont **toujours** prises par notre serveur via ces tools, jamais par le LLM seul. C'est à la fois le garde-fou anti-hallucination et ce qui rend la couche vocale interchangeable.

---

## 3. Stack technique

| Couche                                                       | Choix                                                                                              | Justification                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework                                                    | **Next.js 15 (App Router) + TypeScript strict**                                                    | Full-stack typé de bout en bout, un seul déploiement (dashboard + API + webhooks + landing), écosystème mature.                                                                                                                                                                                 |
| Base de données                                              | **PostgreSQL** (Railway EU ou Neon Francfort) + **Prisma**                                         | Relationnel imposé par le domaine (réservations/capacités/commandes = transactions et contraintes). Prisma : types générés, migrations versionnées.                                                                                                                                             |
| Hébergement                                                  | **Railway, région EU (Amsterdam)**                                                                 | Il nous faut un **process Node long-vivant** : SSE temps réel du dashboard, réception fiable des webhooks Vapi/Twilio/Stripe. Vercel (serverless) rend le temps réel pénible ; Fly.io est plus puissant mais plus d'ops. Railway = déploiement Git simple + Postgres managé + région UE (RGPD). |
| Auth                                                         | **Better Auth** (self-hosted) + plugin organizations                                               | Données d'auth chez nous en UE (Clerk/Auth0 = données aux US). Multi-tenant natif (organisations, rôles owner/staff, invitations).                                                                                                                                                              |
| Temps réel dashboard                                         | **SSE** (Server-Sent Events) + bus d'événements in-process                                         | Unidirectionnel serveur→client, exactement notre besoin (appels/commandes live). Zéro infra en plus. Chemin de scale documenté : Redis pub/sub quand >1 instance.                                                                                                                               |
| Voix                                                         | **Vapi** derrière `VoiceProvider`                                                                  | §2.                                                                                                                                                                                                                                                                                             |
| Téléphonie / SMS                                             | **Twilio** (numéros +33 importés dans Vapi ; SMS via API Twilio)                                   | Provisionnement API des numéros FR (justificatif d'adresse requis — géré une fois au niveau du compte Twilio, sous-adresses par client). SMS transactionnels avec sender alphanumérique « VoxEmploy ».                                                                                          |
| LLM temps réel (dans l'appel)                                | **Claude Haiku 4.5** (`claude-haiku-4-5`) via Vapi                                                 | Latence = contrainte n°1 du tour de parole. Haiku 4.5 est le modèle Anthropic le plus rapide ; 1 $/5 $ par MTok → coût LLM ~0,005–0,01 €/min. Excellent en français conversationnel guidé par tools stricts.                                                                                    |
| LLM post-appel (résumé, extraction, classification du motif) | **Claude Opus 4.8** (`claude-opus-4-8`) via SDK Anthropic + structured outputs                     | Hors temps réel → on prend le modèle le plus capable. Extraction structurée (intention, entités, résultat) via `output_config.format` (JSON Schema garanti). ~0,02 €/appel : négligeable.                                                                                                       |
| Paiement                                                     | **Stripe** : Checkout, Customer Portal, webhooks, **Billing Meters** pour les minutes hors forfait | Standard de facto ; les meters gèrent nativement l'usage à la minute. Essai 14 jours via `trial_period_days`.                                                                                                                                                                                   |
| Validation                                                   | **Zod** partout (webhooks entrants, formulaires, tools de l'agent)                                 | Un seul langage de schéma, inférence TS.                                                                                                                                                                                                                                                        |
| Tests                                                        | **Vitest** (unitaires métier) + tests d'intégration webhooks (payloads Vapi/Stripe/Twilio rejoués) | Rapide, natif TS.                                                                                                                                                                                                                                                                               |
| CI                                                           | **GitHub Actions** : lint (ESLint) + typecheck (tsc) + tests                                       | Simple, gratuit.                                                                                                                                                                                                                                                                                |

---

## 4. Architecture système

```
                          ┌───────────────────────────────────────────────┐
   Client final           │                    VAPI (managé)              │
   ☎ appelle le resto ───▶│  Numéro FR (Twilio importé)                   │
                          │  STT ⇄ Claude Haiku 4.5 ⇄ TTS   barge-in, VAD │
                          └──────┬────────────────────────▲───────────────┘
                                 │ webhooks                │ tool results
                                 │ (call.started, tool.call, transcript,
                                 │  call.ended + enregistrement)
                                 ▼                        │
┌────────────────────────────────────────────────────────────────────────────┐
│                VoxEmploy — Next.js sur Railway (EU/Amsterdam)              │
│                                                                            │
│  /api/webhooks/voice   ── VoiceProvider.parseWebhook → handlers métier     │
│  /api/webhooks/stripe  ── abonnements, minutes, factures                   │
│  /api/webhooks/twilio  ── statuts SMS                                      │
│                                                                            │
│  Domaine (TS pur, testé) : bookings/ orders/ calls/ billing/ tenants/      │
│    - checkAvailability(slot)  - createBooking()  - priceOrder()            │
│    - callCostLedger (coût STT/TTS/LLM/télécom par appel)                   │
│                                                                            │
│  Post-appel (job) : Claude Opus 4.8 → résumé + {intent, entities, outcome} │
│                                                                            │
│  Dashboard (App Router, FR, mobile-first) ← SSE (appels & commandes live)  │
│  Landing marketing FR + widget d'appel de démo (web call Vapi)             │
└───────┬───────────────────────────┬────────────────────────────────────────┘
        │ Prisma                    │ API
        ▼                           ▼
   PostgreSQL (EU)             Twilio SMS (confirmations client final,
   + stockage audio S3            notifications commerçant)
     compatible UE (Scaleway)  Google Calendar / iCal (Phase 6)
```

**Flux d'un appel type (réservation)** :

1. Le client appelle le numéro du restaurant → Vapi décroche avec l'assistant du tenant (annonce d'enregistrement RGPD en ouverture).
2. Conversation en français ; quand l'agent a date/heure/couverts, il appelle le tool `check_availability` → notre serveur répond depuis la vraie table de capacité.
3. L'agent confirme oralement, appelle `create_booking` → transaction Postgres, événement SSE vers le dashboard, SMS de confirmation au client, notification au commerçant.
4. Fin d'appel : webhook `call.ended` → on stocke audio + transcription, on calcule le coût réel de l'appel, on décompte les minutes du forfait, et un job Opus 4.8 produit résumé + extraction structurée.
5. Si l'agent est en difficulté à n'importe quel moment : tool `transfer_to_human` (renvoi vers le portable du gérant) ou `take_message` (message transcrit + notification immédiate).

---

## 5. Multi-tenant et modèle de données

**Isolation** : single database, colonne `organizationId` sur toutes les tables tenant, et **aucune requête Prisma brute dans les routes** — tout passe par une couche repository qui exige un `TenantContext`. Test d'intégration dédié qui vérifie l'impossibilité de lire les données d'un autre tenant.

Entités principales (schéma Prisma complet livré en Phase 1) :

- **Organization** (tenant) — plan, statut d'abonnement, réglages RGPD (durée de rétention).
- **User / Membership** — rôles `owner` | `staff` ; auth Better Auth.
- **Business** — le commerce : horaires, adresse, FAQ, règles de réservation (capacité par créneau, durée, taille max de groupe).
- **Assistant** — config de l'agent : nom, personnalité, consignes métier, voix, `providerAssistantId`, version du prompt système.
- **PhoneNumber** — numéro E.164, provider, statut.
- **Call** — audio, transcription, résumé, `intent`, `outcome`, durée, **coût détaillé** (télécom/STT/LLM/TTS), lien vers réservation/commande/message créés.
- **Booking** — date, heure, couverts, nom, téléphone, statut (confirmée/modifiée/annulée/no-show), source (appel/dashboard).
- **CapacityRule / CapacityOverride** — capacité par créneau + exceptions (fermetures, événements).
- **Menu / MenuCategory / MenuItem / MenuItemOption** — versionnés, avec disponibilité.
- **Order / OrderLine** — à emporter/livraison, statut temps réel, total calculé serveur.
- **Message** — messages pris par l'agent (fallback), avec transcription.
- **Subscription / UsageRecord** — miroir Stripe + compteur de minutes.
- **AuditLog** — actions sensibles (suppressions RGPD, changements de plan).

**Prompts système versionnés** : fichiers dans `prompts/` du repo (source de vérité, revue en PR) + champ overrides par tenant en base. Garde-fous inclus dans le prompt de base : ne jamais inventer une disponibilité, toujours confirmer avant d'enregistrer, escalade humaine en cas de doute, jamais de données d'un autre commerce.

---

## 6. Temps réel dashboard

- Endpoint `GET /api/events` en SSE, authentifié, filtré par organisation.
- Bus d'événements in-process (`EventEmitter` typé) : `call.live.*`, `booking.created`, `order.created`, `order.status_changed`.
- **Limite assumée** : valable tant qu'on tourne sur 1 instance (largement suffisant jusqu'à plusieurs centaines de tenants — le vocal temps réel est chez Vapi, notre serveur ne traite que des webhooks). Le jour du scale horizontal : swap du bus vers Redis pub/sub, interface inchangée.

---

## 7. Facturation (Stripe)

- 3 produits / prix mensuels HT : **Starter 79 €** (150 min, 1 numéro), **Pro 179 €** (500 min, 1 numéro, commandes + intégrations), **Business 349 €** (1200 min, 2 numéros, multi-établissements). Essai gratuit 14 jours (carte requise).
- Minutes hors forfait : **Billing Meter** Stripe alimenté à chaque `call.ended` au-delà du quota — 0,40 / 0,35 / 0,30 €/min selon le plan.
- Checkout hébergé Stripe pour la souscription, Customer Portal pour gestion carte/factures/annulation.
- Webhooks traités (idempotents, signés) : `checkout.session.completed`, `customer.subscription.updated/deleted`, `invoice.paid/payment_failed`.
- Dépassement + échec de paiement → statuts `past_due` → coupure de l'agent après période de grâce (configurable), avec message vocal de repli neutre.

## 8. Coûts par minute et marges (à valider en conditions réelles Phase 2)

| Poste (via Vapi)                            | €/min estimé         |
| ------------------------------------------- | -------------------- |
| Frais plateforme Vapi                       | ~0,046               |
| Téléphonie (numéro FR Twilio, entrant)      | ~0,010               |
| STT (Deepgram fr)                           | ~0,010               |
| LLM (Claude Haiku 4.5, contexte cachés)     | ~0,007               |
| TTS (voix FR réaliste, ElevenLabs/Cartesia) | ~0,030–0,050         |
| **Total coût voix**                         | **~0,10–0,12 €/min** |

Post-appel (Opus 4.8, résumé + extraction) : ~0,02 €/appel. Numéro FR : ~5 €/mois. SMS FR : ~0,08 €/SMS.

| Plan     | Prix HT | Minutes incl. | Coût voix max | Marge brute (hors SMS/numéro) |
| -------- | ------- | ------------- | ------------- | ----------------------------- |
| Starter  | 79 €    | 150           | ~17 €         | **~75 %**                     |
| Pro      | 179 €   | 500           | ~57 €         | **~65 %**                     |
| Business | 349 €   | 1200          | ~137 €        | **~58 %**                     |

**Ledger de coûts obligatoire** : chaque `Call` stocke le coût réel décomposé (Vapi le fournit par appel) → dashboard admin interne « coût par tenant » pour piloter les marges. Alerte si un tenant passe sous marge cible.

---

## 9. RGPD / conformité

- **Annonce d'enregistrement** en tout début d'appel (message configurable, activé par défaut, non désactivable si l'enregistrement est actif).
- **Hébergement UE** : app + Postgres (Railway Amsterdam / Neon Francfort), audio sur S3-compatible UE (Scaleway Paris). _Limite documentée honnêtement : le traitement temps réel Vapi/Deepgram/ElevenLabs transite par des infra US — couvert par SCC/DPA des providers ; mentionné dans notre DPA et notre politique de confidentialité. La migration pipeline custom (Phase 7+) permettra un traitement 100 % UE._
- **Rétention configurable** par tenant (audio / transcriptions, défaut 90 jours) — job de purge quotidien.
- **Droit à l'effacement** : suppression par numéro de téléphone du client final (appels, réservations, commandes anonymisées) + suppression complète de tenant.
- Registre des traitements et DPA type fournis dans `docs/` (Phase 6).

## 10. Tests, CI, déploiement

- **Unitaires (Vitest)** : moteur de disponibilité/réservation, calcul de prix des commandes, compteur de minutes/facturation, parsing des arguments de tools de l'agent, purge RGPD.
- **Intégration** : handlers de webhooks Vapi/Stripe/Twilio avec payloads réels rejoués + vérification de signature ; test d'isolation multi-tenant.
- **CI GitHub Actions** : `lint → typecheck → test` sur chaque PR ; déploiement auto Railway sur merge `main` (environnements `staging` + `production`).
- `.env.example` exhaustif, zéro secret en dur, secrets en variables Railway.

## 11. Risques principaux et parades

| Risque                                                     | Parade                                                                                                                               |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Qualité vocale FR insuffisante (accents, bruit de cuisine) | Phase 2 inclut une campagne de test dédiée ; choix de voix/STT ajustables par config sans redéploiement.                             |
| Hallucination de dispo/prix                                | Décisions uniquement via tools serveur ; l'agent n'énonce que ce que le serveur retourne ; confirmation systématique avant écriture. |
| Hausse des prix Vapi / lock-in                             | Abstraction `VoiceProvider` + ledger de coûts → décision de migration custom pilotée par les chiffres.                               |
| Réglementation numéros FR (ARCEP)                          | Justificatif d'adresse au niveau du compte Twilio + adresse du commerce par numéro ; procédure documentée en Phase 2.                |
| Webhooks perdus (réservation fantôme)                      | Idempotence par `event.id`, table d'événements entrants, réconciliation quotidienne avec l'API Vapi.                                 |
