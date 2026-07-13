import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Seed de développement : un restaurant fictif complet.
 * Compte de connexion : mario@exemple.fr / motdepasse123
 */
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  const existing = await prisma.organization.findUnique({
    where: { slug: "chez-mario-demo" },
  });
  if (existing) {
    console.log("Seed déjà présent (chez-mario-demo) — rien à faire.");
    return;
  }

  // Utilisateur via Better Auth (mot de passe correctement hashé).
  const { auth } = await import("../src/lib/auth");
  const { user } = await auth.api.signUpEmail({
    body: {
      name: "Mario Rossi",
      email: "mario@exemple.fr",
      password: "motdepasse123",
    },
  });

  const org = await prisma.organization.create({
    data: {
      name: "Chez Mario",
      slug: "chez-mario-demo",
      members: { create: { userId: user.id, role: "owner" } },
    },
  });

  const business = await prisma.business.create({
    data: {
      organizationId: org.id,
      name: "Chez Mario",
      addressLine1: "12 rue de la République",
      postalCode: "69002",
      city: "Lyon",
      contactPhone: "+33478000000",
      openingHours: {
        tue: [
          { open: "12:00", close: "14:30" },
          { open: "19:00", close: "22:30" },
        ],
        wed: [
          { open: "12:00", close: "14:30" },
          { open: "19:00", close: "22:30" },
        ],
        thu: [
          { open: "12:00", close: "14:30" },
          { open: "19:00", close: "22:30" },
        ],
        fri: [
          { open: "12:00", close: "14:30" },
          { open: "19:00", close: "23:00" },
        ],
        sat: [
          { open: "12:00", close: "14:30" },
          { open: "19:00", close: "23:00" },
        ],
      },
      faq: [
        { q: "Avez-vous un parking ?", a: "Oui, parking gratuit à 50 m." },
        { q: "Acceptez-vous les chiens ?", a: "Oui, en terrasse uniquement." },
      ],
    },
  });

  // Capacité : 40 couverts par créneau de 30 min, midi et soir, mar→sam.
  for (const dayOfWeek of [2, 3, 4, 5, 6]) {
    await prisma.capacityRule.createMany({
      data: [
        {
          businessId: business.id,
          dayOfWeek,
          startTime: "12:00",
          endTime: "14:30",
          slotMinutes: 30,
          maxCovers: 40,
        },
        {
          businessId: business.id,
          dayOfWeek,
          startTime: "19:00",
          endTime: "22:30",
          slotMinutes: 30,
          maxCovers: 40,
        },
      ],
    });
  }

  await prisma.assistant.create({
    data: {
      organizationId: org.id,
      businessId: business.id,
      displayName: "Léa",
      personality: "Chaleureuse et efficace, tutoiement interdit.",
      status: "DRAFT",
    },
  });

  // Menu simple pour les phases 2-3.
  const menu = await prisma.menu.create({
    data: { businessId: business.id, name: "Carte", active: true },
  });
  const pizzas = await prisma.menuCategory.create({
    data: { menuId: menu.id, name: "Pizzas", position: 1 },
  });
  const desserts = await prisma.menuCategory.create({
    data: { menuId: menu.id, name: "Desserts", position: 2 },
  });
  const margherita = await prisma.menuItem.create({
    data: {
      categoryId: pizzas.id,
      name: "Margherita",
      priceCents: 1100,
      position: 1,
    },
  });
  await prisma.menuItemOption.createMany({
    data: [
      {
        menuItemId: margherita.id,
        groupName: "Supplément",
        name: "Fromage",
        priceCentsDelta: 150,
      },
      {
        menuItemId: margherita.id,
        groupName: "Supplément",
        name: "Jambon",
        priceCentsDelta: 200,
      },
    ],
  });
  await prisma.menuItem.createMany({
    data: [
      { categoryId: pizzas.id, name: "Regina", priceCents: 1350, position: 2 },
      {
        categoryId: pizzas.id,
        name: "Quatre fromages",
        priceCents: 1450,
        position: 3,
      },
      {
        categoryId: desserts.id,
        name: "Tiramisu",
        priceCents: 650,
        position: 1,
      },
    ],
  });

  await prisma.subscription.create({
    data: {
      organizationId: org.id,
      plan: "PRO",
      status: "TRIALING",
      includedMinutes: 500,
      trialEndsAt: new Date(Date.now() + 14 * 24 * 3600 * 1000),
    },
  });

  console.log("✅ Seed créé : Chez Mario (mario@exemple.fr / motdepasse123)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
