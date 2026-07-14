import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import {
  cancelBookingByPhone,
  createBookingChecked,
  getAvailability,
} from "../booking/service";
import { utcToWallTime } from "../booking/timezone";

/**
 * Exécution des tools appelés par l'agent vocal pendant une conversation.
 *
 * Contrat : chaque tool retourne une chaîne JSON compacte (clés françaises)
 * que le LLM reformule oralement. Les décisions (disponibilité, écriture)
 * sont prises ICI, jamais par le LLM. Les erreurs de validation retournent
 * un message exploitable par l'agent plutôt qu'une exception.
 *
 * Latence : ce code est dans le chemin critique de la conversation
 * (le client attend au téléphone) — pas d'I/O superflue ; les effets de
 * bord lents (SMS, notifications) sont différés via `sideEffects`.
 */

export type VoiceCallContext = {
  organizationId: string;
  businessId: string;
  businessName: string;
  timezone: string;
  callId: string;
  fromE164?: string;
};

export type ToolExecution = {
  /** Résultat renvoyé au LLM (JSON compact en français). */
  result: string;
  /** Effets de bord à exécuter APRÈS la réponse HTTP (SMS, notifications). */
  sideEffects: Array<() => Promise<void>>;
};

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "date attendue au format AAAA-MM-JJ");
const timeSchema = z
  .string()
  .regex(/^\d{2}:\d{2}$/, "heure attendue au format HH:MM");
const phoneSchema = z
  .string()
  .regex(/^\+\d{6,15}$/, "téléphone attendu au format international +33...");

const checkAvailabilityArgs = z.object({
  date: dateSchema,
  time: timeSchema,
  covers: z.coerce.number().int().min(1).max(50),
});

const createBookingArgs = checkAvailabilityArgs.extend({
  customer_name: z.string().min(1).max(120),
  customer_phone: phoneSchema.optional(),
  notes: z.string().max(500).optional(),
});

const cancelBookingArgs = z.object({
  customer_phone: phoneSchema.optional(),
  date: dateSchema.optional(),
});

const takeMessageArgs = z.object({
  content: z.string().min(1).max(2000),
  urgent: z.coerce.boolean().optional(),
});

const REASON_LABELS: Record<string, string> = {
  PAST: "date ou heure déjà passée",
  CLOSED: "établissement fermé ce jour-là",
  NO_SERVICE: "pas de service à cette heure",
  FULL: "complet sur ce créneau",
  PARTY_TOO_LARGE: "groupe trop grand pour une réservation automatique",
};

function json(value: unknown): string {
  return JSON.stringify(value);
}

function invalidArgs(error: z.ZodError): string {
  return json({
    erreur: "paramètres invalides",
    details: error.issues.map((i) => i.message).join(" ; "),
  });
}

export type SmsSender = (args: { to: string; body: string }) => Promise<void>;
export type OwnerNotifier = (args: {
  businessId: string;
  title: string;
  body: string;
}) => Promise<void>;

export type ToolDependencies = {
  sendSms: SmsSender;
  notifyOwner: OwnerNotifier;
};

export async function executeToolCall(
  db: PrismaClient,
  deps: ToolDependencies,
  ctx: VoiceCallContext,
  name: string,
  rawArgs: unknown,
): Promise<ToolExecution> {
  const none: ToolExecution["sideEffects"] = [];

  switch (name) {
    case "check_availability": {
      const parsed = checkAvailabilityArgs.safeParse(rawArgs);
      if (!parsed.success)
        return { result: invalidArgs(parsed.error), sideEffects: none };

      const availability = await getAvailability(
        db,
        { id: ctx.businessId, timezone: ctx.timezone },
        parsed.data,
      );

      if (availability.available) {
        return {
          result: json({ disponible: true, heure: parsed.data.time }),
          sideEffects: none,
        };
      }
      return {
        result: json({
          disponible: false,
          raison: REASON_LABELS[availability.reason] ?? availability.reason,
          ...(availability.reason === "PARTY_TOO_LARGE"
            ? {
                consigne:
                  "propose de prendre un message pour que l'équipe rappelle",
              }
            : {}),
          alternatives: availability.alternatives.map((a) => a.time),
        }),
        sideEffects: none,
      };
    }

    case "create_booking": {
      const parsed = createBookingArgs.safeParse(rawArgs);
      if (!parsed.success)
        return { result: invalidArgs(parsed.error), sideEffects: none };

      const customerPhone = parsed.data.customer_phone ?? ctx.fromE164;

      // Idempotence : si Vapi rejoue le tool call (timeout, retry), ne pas
      // créer de doublon pour le même appel + créneau + nom.
      const existing = await db.booking.findFirst({
        where: {
          callId: ctx.callId,
          customerName: parsed.data.customer_name,
          status: "CONFIRMED",
        },
      });
      if (existing) {
        const wall = utcToWallTime(existing.startsAt, ctx.timezone);
        return {
          result: json({
            enregistree: true,
            deja_existante: true,
            date: wall.date,
            heure: wall.time,
          }),
          sideEffects: none,
        };
      }

      const created = await createBookingChecked(
        db,
        {
          id: ctx.businessId,
          organizationId: ctx.organizationId,
          timezone: ctx.timezone,
        },
        {
          ...parsed.data,
          customerName: parsed.data.customer_name,
          customerPhone,
          notes: parsed.data.notes,
          callId: ctx.callId,
        },
      );

      if (!created.ok) {
        return {
          result: json({
            enregistree: false,
            raison:
              REASON_LABELS[created.refusal.reason] ?? created.refusal.reason,
            alternatives: created.refusal.alternatives.map((a) => a.time),
          }),
          sideEffects: none,
        };
      }

      await db.call.update({
        where: { id: ctx.callId },
        data: { outcome: "BOOKING_CREATED" },
      });

      const wall = utcToWallTime(created.booking.startsAt, ctx.timezone);
      const dateFr = new Intl.DateTimeFormat("fr-FR", {
        timeZone: ctx.timezone,
        weekday: "long",
        day: "numeric",
        month: "long",
      }).format(created.booking.startsAt);

      const sideEffects: ToolExecution["sideEffects"] = [];
      if (customerPhone) {
        sideEffects.push(() =>
          deps.sendSms({
            to: customerPhone,
            body: `${ctx.businessName} : réservation confirmée pour ${parsed.data.covers} personne(s) le ${dateFr} à ${wall.time}. Pour annuler, rappelez-nous.`,
          }),
        );
      }
      sideEffects.push(() =>
        deps.notifyOwner({
          businessId: ctx.businessId,
          title: "Nouvelle réservation",
          body: `${parsed.data.customer_name} — ${parsed.data.covers} pers. le ${dateFr} à ${wall.time} (prise par l'agent)`,
        }),
      );

      return {
        result: json({
          enregistree: true,
          date: wall.date,
          heure: wall.time,
          sms_envoye: Boolean(customerPhone),
        }),
        sideEffects,
      };
    }

    case "cancel_booking": {
      const parsed = cancelBookingArgs.safeParse(rawArgs);
      if (!parsed.success)
        return { result: invalidArgs(parsed.error), sideEffects: none };

      const phone = parsed.data.customer_phone ?? ctx.fromE164;
      if (!phone) {
        return {
          result: json({
            annulee: false,
            raison:
              "numéro de téléphone requis pour retrouver la réservation — demande-le au client",
          }),
          sideEffects: none,
        };
      }

      const cancelled = await cancelBookingByPhone(
        db,
        { id: ctx.businessId, organizationId: ctx.organizationId },
        phone,
        parsed.data.date,
        ctx.timezone,
      );

      if (!cancelled.cancelled) {
        return {
          result: json({
            annulee: false,
            raison: "aucune réservation à venir trouvée pour ce numéro",
          }),
          sideEffects: none,
        };
      }

      await db.call.update({
        where: { id: ctx.callId },
        data: { outcome: "BOOKING_CANCELLED" },
      });

      const wall = utcToWallTime(cancelled.startsAt!, ctx.timezone);
      const sideEffects: ToolExecution["sideEffects"] = [
        () =>
          deps.notifyOwner({
            businessId: ctx.businessId,
            title: "Réservation annulée",
            body: `Annulation par téléphone : ${cancelled.covers} pers. le ${wall.date} à ${wall.time}`,
          }),
      ];

      return {
        result: json({ annulee: true, date: wall.date, heure: wall.time }),
        sideEffects,
      };
    }

    case "take_message": {
      const parsed = takeMessageArgs.safeParse(rawArgs);
      if (!parsed.success)
        return { result: invalidArgs(parsed.error), sideEffects: none };

      await db.message.create({
        data: {
          organizationId: ctx.organizationId,
          businessId: ctx.businessId,
          callId: ctx.callId,
          fromE164: ctx.fromE164,
          content: parsed.data.content,
          urgent: parsed.data.urgent ?? false,
        },
      });
      await db.call.update({
        where: { id: ctx.callId },
        data: { outcome: "MESSAGE_TAKEN" },
      });

      const sideEffects: ToolExecution["sideEffects"] = [
        () =>
          deps.notifyOwner({
            businessId: ctx.businessId,
            title: parsed.data.urgent ? "⚠️ Message urgent" : "Nouveau message",
            body: parsed.data.content,
          }),
      ];

      return {
        result: json({ message_transmis: true }),
        sideEffects,
      };
    }

    default:
      return {
        result: json({
          erreur: `outil inconnu : ${name}`,
          consigne: "continue la conversation sans cet outil",
        }),
        sideEffects: none,
      };
  }
}
