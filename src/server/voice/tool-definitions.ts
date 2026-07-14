/**
 * Définitions des tools exposés à l'agent vocal — JSON Schema standard,
 * portables vers n'importe quel provider (Vapi aujourd'hui, pipeline custom
 * demain). La logique d'exécution vit dans tools.ts, côté serveur VoxEmploy.
 *
 * Décisions Phase 2 :
 * - pas de tool answer_faq : la FAQ et les horaires sont injectés dans le
 *   prompt système (réponse instantanée, zéro aller-retour réseau) ;
 * - pas de tool modify_booking : une modification = cancel_booking puis
 *   create_booking, orchestrés par l'agent (déroulé décrit dans le prompt) ;
 * - le transfert d'appel utilise le tool natif du provider (transferCall
 *   chez Vapi), configuré avec la ligne du commerce à la création de
 *   l'assistant.
 */

export type ToolDefinition = {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
};

export const AGENT_TOOLS: ToolDefinition[] = [
  {
    name: "check_availability",
    description:
      "Vérifie si une table est disponible à une date et heure données. À appeler AVANT toute promesse de disponibilité. Retourne soit disponible=true, soit un refus motivé avec des créneaux alternatifs à proposer au client.",
    parameters: {
      type: "object",
      properties: {
        date: {
          type: "string",
          description: "Date souhaitée au format AAAA-MM-JJ",
        },
        time: {
          type: "string",
          description: "Heure souhaitée au format HH:MM (24h)",
        },
        covers: {
          type: "integer",
          description: "Nombre de personnes",
        },
      },
      required: ["date", "time", "covers"],
    },
  },
  {
    name: "create_booking",
    description:
      "Enregistre définitivement une réservation. À appeler UNIQUEMENT après que le client a confirmé explicitement le récapitulatif (date, heure, personnes, nom). Déclenche le SMS de confirmation.",
    parameters: {
      type: "object",
      properties: {
        date: { type: "string", description: "Date au format AAAA-MM-JJ" },
        time: { type: "string", description: "Heure au format HH:MM (24h)" },
        covers: { type: "integer", description: "Nombre de personnes" },
        customer_name: {
          type: "string",
          description: "Nom du client (prénom et/ou nom)",
        },
        customer_phone: {
          type: "string",
          description:
            "Téléphone du client au format international (+33...). Omettre pour utiliser le numéro de l'appel en cours.",
        },
        notes: {
          type: "string",
          description:
            "Demandes particulières (terrasse, chaise bébé, allergie...)",
        },
      },
      required: ["date", "time", "covers", "customer_name"],
    },
  },
  {
    name: "cancel_booking",
    description:
      "Annule la réservation du client (retrouvée par son numéro de téléphone). Demander confirmation avant d'appeler. Pour une MODIFICATION : annuler puis recréer avec create_booking.",
    parameters: {
      type: "object",
      properties: {
        customer_phone: {
          type: "string",
          description:
            "Téléphone du client (+33...). Omettre pour utiliser le numéro de l'appel en cours.",
        },
        date: {
          type: "string",
          description:
            "Date de la réservation à annuler (AAAA-MM-JJ) si le client l'a précisée",
        },
      },
      required: [],
    },
  },
  {
    name: "take_message",
    description:
      "Prend un message pour l'équipe du restaurant quand la demande dépasse tes capacités (groupe trop grand, privatisation, réclamation, question sans réponse dans tes informations, demande de rappel). L'équipe est notifiée immédiatement.",
    parameters: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description:
            "Le message : qui appelle, ce qu'il demande, à quel numéro le rappeler",
        },
        urgent: {
          type: "boolean",
          description: "true si la demande semble urgente",
        },
      },
      required: ["content"],
    },
  },
];
