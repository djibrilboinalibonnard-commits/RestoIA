/**
 * Génère un slug URL-safe à partir d'un nom de commerce.
 * Ex. « Chez Mario — Pizzéria » → "chez-mario-pizzeria"
 */
export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // retire les diacritiques (accents)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}
