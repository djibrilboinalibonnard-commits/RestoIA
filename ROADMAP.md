# VoxEmploy — Roadmap

> Découpage en phases livrables. Chaque phase se termine par : démo fonctionnelle, tests qui passent, commit propre, résumé de ce qui reste.
> Les durées sont des estimations de travail effectif, pas des promesses calendaires.

## Vue d'ensemble

| Phase | Contenu                                        | Livrable démontrable                                                       | Durée est. |
| ----- | ---------------------------------------------- | -------------------------------------------------------------------------- | ---------- |
| 0     | Architecture + roadmap                         | Ces deux documents validés                                                 | fait       |
| 1     | Fondations : projet, DB multi-tenant, auth     | Login → dashboard vide d'une organisation isolée                           | 3–4 j      |
| 2     | Agent vocal MVP : appel → réservation → SMS    | Un vrai appel téléphonique qui crée une réservation en base + SMS reçu     | 5–7 j      |
| 3     | Commandes + menu                               | Appel de commande complète avec prix juste, allergies, heure de retrait    | 4–5 j      |
| 4     | Dashboard complet + onboarding                 | Un restaurateur s'installe seul en <15 min et voit ses appels en direct    | 6–8 j      |
| 5     | Monétisation Stripe + admin interne            | Souscription réelle (mode test), compteur de minutes, coûts par tenant     | 4–5 j      |
| 6     | Analytics, intégrations, landing, durcissement | Produit commercialisable : landing avec démo, Google Calendar, doc de prod | 5–7 j      |

**Total : ~5–6 semaines de travail effectif jusqu'au produit commercialisable.**

---

## Phase 1 — Fondations (3–4 j)

**Objectif** : socle technique sur lequel tout le reste s'empile sans refactoring.

- Init repo : Next.js 15 + TS strict, ESLint, Prettier, Vitest, GitHub Actions (lint/typecheck/test), `.env.example`.
- Schéma Prisma **complet** (toutes les entités de l'ARCHITECTURE §5, même celles utilisées plus tard) + migrations + seed de dev (1 resto fictif avec menu et capacités).
- Better Auth : email/mot de passe + organisations, rôles owner/staff, invitations.
- Couche repository avec `TenantContext` obligatoire + **test d'isolation multi-tenant**.
- Layout du dashboard (shell FR, mobile-first) avec navigation vide.
- Déploiement Railway staging (app + Postgres EU) branché sur `main`.

**Critères de sortie** : CI verte ; deux comptes de deux organisations ne peuvent pas voir les données l'un de l'autre (prouvé par test) ; app déployée en staging.

---

## Phase 2 — Agent vocal MVP (5–7 j) 🎯 cœur du produit

**Objectif** : le flux magique de bout en bout — un appel réel crée une réservation.

- Interface `VoiceProvider` + implémentation Vapi (création/màj d'assistant, webhooks signés, normalisation des événements).
- Prompt système v1 versionné dans `prompts/` : personnalité, garde-fous (jamais inventer une dispo, confirmer avant d'écrire, escalade si doute), annonce RGPD.
- Tools de l'agent : `check_availability`, `create_booking`, `cancel_booking`, `modify_booking`, `answer_faq`, `take_message`, `transfer_to_human` — tous adossés au moteur de disponibilité (unitairement testé).
- Provisionnement : achat du numéro FR Twilio + import dans Vapi + rattachement à l'assistant du tenant (script/console admin pour l'instant).
- `call.ended` : stockage audio (S3 UE) + transcription + décompte minutes + **ledger de coûts par appel** ; job post-appel Opus 4.8 (résumé + extraction `{intent, entities, outcome}` en structured outputs).
- SMS Twilio : confirmation au client final + notification au commerçant.
- Campagne de test qualité FR : accents, bruit de fond, interruptions, demandes hors périmètre.

**Critères de sortie** : j'appelle le numéro de test, je réserve pour 4 personnes samedi 20h, la réservation est en base avec le bon créneau décompté, je reçois le SMS, le coût de l'appel est loggé ; tests unitaires du moteur de dispo + intégration webhooks verts.

**Prérequis côté toi (comptes à créer avant cette phase)** : Vapi, Twilio (avec justificatif d'adresse FR pour le numéro), clé API Anthropic. _(Git devra aussi être installé sur la machine — il ne l'est pas actuellement.)_

---

## Phase 3 — Commandes + menu (4–5 j)

**Objectif** : deuxième cas d'usage majeur — la commande à emporter/livraison.

- Modèle menu complet (catégories, articles, options, dispo) + ingestion : saisie manuelle, **import CSV**, import photo/PDF (extraction par Opus 4.8 avec relecture/validation humaine avant activation).
- Tools : `get_menu_info`, `add_order_item` (avec options/allergies), `price_order` (total calculé serveur, jamais par le LLM), `confirm_order` (heure de retrait ou adresse de livraison + zone).
- File de commandes côté serveur avec statuts (reçue → en préparation → prête → récupérée/livrée).
- SMS de confirmation de commande avec récapitulatif et total.

**Critères de sortie** : appel réel « une margherita sans basilic et un tiramisu, pour 19h30 » → commande en base avec total exact et note d'allergie ; tests unitaires du pricing (options, cas limites) verts.

---

## Phase 4 — Dashboard + onboarding (6–8 j)

**Objectif** : le restaurateur est autonome, du signup à l'agent en service.

- **Onboarding guidé <15 min** : infos commerce → horaires/FAQ → menu (CSV/photo/saisie) → règles de réservation → personnalité de l'agent → **test de l'agent depuis le navigateur** (web call Vapi) → activation du numéro.
- **Journal des appels** : liste + fiche (lecteur audio, transcription, résumé, statut, objet lié).
- **Réservations** : vue calendrier/jour, capacité par créneau, création/modif/annulation manuelles.
- **Commandes** : file temps réel (SSE), changement de statut en un tap, son de notification.
- Réglages : personnalité de l'agent, horaires, renvoi d'appel depuis ligne existante (instructions opérateur), rétention RGPD, équipe (invitations staff).
- Mobile-first systématique (usage cuisine/comptoir).

**Critères de sortie** : un cobaye non technique s'installe seul en <15 min chrono ; les appels/commandes apparaissent en direct sans rechargement.

---

## Phase 5 — Monétisation + admin interne (4–5 j)

**Objectif** : encaisser, mesurer, piloter.

- Stripe : 3 plans (79/179/349 € HT), essai 14 j, Checkout + Customer Portal, webhooks idempotents, Billing Meter minutes hors forfait (0,40/0,35/0,30 €).
- Gating par plan (nb de numéros, fonctionnalités) + cycle de vie `trialing → active → past_due → canceled` avec coupure gracieuse de l'agent.
- **Admin interne** (`/admin`, réservé) : liste des tenants, MRR, minutes consommées, **coût réel vs revenu par tenant**, health checks (webhooks en retard, jobs en échec, solde Twilio/Vapi).
- Tests d'intégration des webhooks Stripe + unitaires du compteur de minutes.

**Critères de sortie** : souscription en mode test de bout en bout ; un appel au-delà du quota génère une ligne d'usage facturée ; l'admin montre la marge par tenant.

---

## Phase 6 — Analytics, intégrations, landing, durcissement (5–7 j)

**Objectif** : commercialisable et documenté.

- **Analytics tenant** : appels reçus/traités, appels hors horaires (= manqués évités), CA estimé récupéré (paramétrable : panier moyen × réservations/commandes prises), heures de pointe, taux de résolution IA, motifs d'appel (depuis l'extraction post-appel).
- **Intégrations** : Google Calendar (sync réservations) + export iCal ; webhooks sortants + API publique documentée (clé API par tenant, OpenAPI).
- **Landing page FR** orientée conversion : promesse (« Ne ratez plus jamais un appel »), démo par **widget d'appel test dans le navigateur**, tarifs, FAQ, mentions légales/politique de confidentialité/DPA.
- Durcissement : rate limiting, audit log, réconciliation quotidienne Vapi, job de purge RGPD, alerting erreurs (Sentry), sauvegardes DB vérifiées.
- Documentation finale : `README.md` (setup local, comptes tiers, variables d'env), doc de mise en production, runbook incidents.

**Critères de sortie** : un inconnu peut aller sur la landing, tester l'agent dans son navigateur, souscrire, s'onboarder et recevoir de vrais appels — sans intervention manuelle de notre part.

---

## Hors périmètre initial (backlog Phase 7+)

- Migration pipeline vocal custom (Twilio Media Streams + Deepgram + Cartesia) pour passer le coût voix de ~0,11 à ~0,05 €/min — déclenchée par les données du ledger de coûts.
- Intégrations POS, appels sortants (rappels de no-show, confirmations J-1), multi-langue (EN pour touristes), extension Belgique/Suisse, acompte de réservation par lien de paiement.

## Rappel des comptes tiers à créer

| Service                        | Quand   | Notes                                                                                        |
| ------------------------------ | ------- | -------------------------------------------------------------------------------------------- |
| GitHub                         | Phase 1 | Repo + Actions. **Installer Git sur la machine.**                                            |
| Railway                        | Phase 1 | Projet + Postgres, région EU.                                                                |
| Anthropic                      | Phase 2 | Clé API (Haiku 4.5 + Opus 4.8).                                                              |
| Vapi                           | Phase 2 | Compte + clé API.                                                                            |
| Twilio                         | Phase 2 | Compte, justificatif d'adresse FR (exigence réglementaire pour les numéros +33), 1er numéro. |
| Scaleway (ou équivalent S3 UE) | Phase 2 | Bucket audio.                                                                                |
| Stripe                         | Phase 5 | Mode test suffit jusqu'au lancement.                                                         |
| Sentry                         | Phase 6 | Plan gratuit.                                                                                |
