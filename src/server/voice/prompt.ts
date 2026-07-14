import { SYSTEM_PROMPT_V1, FIRST_MESSAGE_V1 } from "../../../prompts/system-v1";

/**
 * Construction du prompt système par tenant, à partir du template versionné
 * (prompts/) et de la configuration du commerce.
 */

const DAY_LABELS: Record<string, string> = {
  mon: "Lundi",
  tue: "Mardi",
  wed: "Mercredi",
  thu: "Jeudi",
  fri: "Vendredi",
  sat: "Samedi",
  sun: "Dimanche",
};

type OpeningHours = Record<string, { open: string; close: string }[]>;
type FaqEntry = { q: string; a: string };

export type PromptInput = {
  assistantName: string;
  businessName: string;
  city?: string | null;
  timeZone: string;
  openingHours?: unknown;
  faq?: unknown;
  personality?: string | null;
  customInstructions?: string | null;
  promptVersion: string;
  /** Injectable pour les tests. */
  now?: Date;
};

function formatOpeningHours(openingHours: unknown): string {
  if (!openingHours || typeof openingHours !== "object") {
    return "Horaires : non renseignés — si on te les demande, propose de prendre un message.";
  }
  const hours = openingHours as OpeningHours;
  const lines: string[] = ["Horaires d'ouverture :"];
  for (const key of ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]) {
    const ranges = hours[key];
    if (!ranges || ranges.length === 0) {
      lines.push(`- ${DAY_LABELS[key]} : fermé`);
    } else {
      lines.push(
        `- ${DAY_LABELS[key]} : ${ranges.map((r) => `${r.open}–${r.close}`).join(" et ")}`,
      );
    }
  }
  return lines.join("\n");
}

function formatFaq(faq: unknown): string {
  if (!Array.isArray(faq) || faq.length === 0) return "";
  const entries = faq as FaqEntry[];
  return [
    "Informations pratiques (réponds UNIQUEMENT à partir de ces éléments ; sinon, propose de prendre un message) :",
    ...entries.map((e) => `- ${e.q} → ${e.a}`),
  ].join("\n");
}

function formatToday(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(now);
}

function render(template: string, vars: Record<string, string>): string {
  return template.replace(
    /\{\{(\w+)\}\}/g,
    (_, key: string) => vars[key] ?? "",
  );
}

export function buildSystemPrompt(input: PromptInput): string {
  if (input.promptVersion !== "v1") {
    throw new Error(`Version de prompt inconnue : ${input.promptVersion}`);
  }
  return render(SYSTEM_PROMPT_V1, {
    assistantName: input.assistantName,
    businessName: input.businessName,
    cityPart: input.city ? ` à ${input.city}` : "",
    today: formatToday(input.now ?? new Date(), input.timeZone),
    openingHours: formatOpeningHours(input.openingHours),
    faqSection: formatFaq(input.faq),
    personality:
      input.personality?.trim() ||
      "- Ton chaleureux, professionnel et souriant.",
    customInstructions: input.customInstructions?.trim()
      ? `\n# Consignes du restaurant\n${input.customInstructions.trim()}`
      : "",
  });
}

export function buildFirstMessage(input: {
  assistantName: string;
  businessName: string;
}): string {
  return render(FIRST_MESSAGE_V1, {
    assistantName: input.assistantName,
    businessName: input.businessName,
  });
}
