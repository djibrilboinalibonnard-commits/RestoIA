import { describe, it, expect } from "vitest";
import { buildFirstMessage, buildSystemPrompt } from "@/server/voice/prompt";

const BASE = {
  assistantName: "Léa",
  businessName: "Chez Mario",
  city: "Lyon",
  timeZone: "Europe/Paris",
  promptVersion: "v1",
  now: new Date("2030-06-12T10:00:00Z"),
};

describe("buildSystemPrompt", () => {
  it("injecte l'identité, la date du jour et les garde-fous", () => {
    const prompt = buildSystemPrompt(BASE);
    expect(prompt).toContain("Léa");
    expect(prompt).toContain("Chez Mario");
    expect(prompt).toContain("à Lyon");
    expect(prompt).toContain("mercredi 12 juin 2030");
    // Garde-fous non négociables, quel que soit le tenant :
    expect(prompt).toContain("n'inventes JAMAIS une disponibilité");
    expect(prompt).toContain("check_availability");
    expect(prompt).toContain("récapitules TOUJOURS");
    expect(prompt).toContain("15, le 17 ou le 112");
    // Aucune variable non substituée ne doit rester.
    expect(prompt).not.toMatch(/\{\{\w+\}\}/);
  });

  it("formate horaires et FAQ quand fournis", () => {
    const prompt = buildSystemPrompt({
      ...BASE,
      openingHours: { tue: [{ open: "12:00", close: "14:30" }] },
      faq: [{ q: "Parking ?", a: "Oui, gratuit." }],
    });
    expect(prompt).toContain("Mardi : 12:00–14:30");
    expect(prompt).toContain("Lundi : fermé");
    expect(prompt).toContain("Parking ? → Oui, gratuit.");
  });

  it("intègre personnalité et consignes du tenant", () => {
    const prompt = buildSystemPrompt({
      ...BASE,
      personality: "- Ton détendu mais précis.",
      customInstructions: "Jamais de réservation en terrasse le soir.",
    });
    expect(prompt).toContain("Ton détendu mais précis.");
    expect(prompt).toContain("Jamais de réservation en terrasse le soir.");
  });

  it("refuse une version de prompt inconnue (rollback maîtrisé)", () => {
    expect(() => buildSystemPrompt({ ...BASE, promptVersion: "v99" })).toThrow(
      /inconnue/,
    );
  });
});

describe("buildFirstMessage", () => {
  it("contient l'annonce d'enregistrement (RGPD)", () => {
    const message = buildFirstMessage({
      assistantName: "Léa",
      businessName: "Chez Mario",
    });
    expect(message).toContain("Chez Mario");
    expect(message).toContain("enregistré");
  });
});
