import { describe, it, expect, afterAll } from "vitest";
import { createTestClient } from "../helpers/db";

/**
 * Vérifie que le câblage Better Auth ⇄ schéma Prisma fonctionne réellement :
 * une inscription crée bien les lignes user + account (mot de passe hashé).
 */

const db = createTestClient();
const email = `test-${Date.now()}@voxemploy.test`;

afterAll(async () => {
  await db.user.deleteMany({ where: { email } });
  await db.$disconnect();
});

describe("Better Auth ⇄ Prisma", () => {
  it("signUpEmail crée l'utilisateur et son compte credential", async () => {
    // Import dynamique : l'instance auth lit process.env au chargement.
    const { auth } = await import("@/lib/auth");

    const result = await auth.api.signUpEmail({
      body: { name: "Test Restaurateur", email, password: "motdepasse123" },
    });

    expect(result.user.email).toBe(email);

    const dbUser = await db.user.findUnique({
      where: { email },
      include: { accounts: true },
    });
    expect(dbUser).not.toBeNull();
    expect(dbUser!.accounts).toHaveLength(1);
    expect(dbUser!.accounts[0].providerId).toBe("credential");
    // Le mot de passe est stocké hashé, jamais en clair.
    expect(dbUser!.accounts[0].password).not.toContain("motdepasse123");
  });
});
