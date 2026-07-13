import { describe, it, expect } from "vitest";
import { slugify } from "@/lib/slug";

describe("slugify", () => {
  it("gère les accents et caractères spéciaux français", () => {
    expect(slugify("Chez Mario — Pizzéria")).toBe("chez-mario-pizzeria");
    expect(slugify("L'Assiette Gourmande")).toBe("l-assiette-gourmande");
    expect(slugify("Café de la Gare")).toBe("cafe-de-la-gare");
  });

  it("supprime les tirets en début et fin", () => {
    expect(slugify("  ---Le Bistrot--  ")).toBe("le-bistrot");
  });

  it("tronque à 48 caractères", () => {
    expect(slugify("a".repeat(100)).length).toBeLessThanOrEqual(48);
  });
});
