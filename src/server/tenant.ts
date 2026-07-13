import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * Contexte tenant — OBLIGATOIRE pour tout accès aux données métier.
 * Les repositories (src/server/repositories) refusent de fonctionner sans.
 */
export type TenantContext = {
  organizationId: string;
  userId: string;
  role: "owner" | "member";
};

/** Retourne le contexte tenant de la requête courante, ou null. */
export async function getTenant(): Promise<TenantContext | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;

  const organizationId = session.session.activeOrganizationId;
  if (!organizationId) return null;

  const membership = await prisma.member.findFirst({
    where: { userId: session.user.id, organizationId },
    select: { role: true },
  });
  if (!membership) return null;

  return {
    organizationId,
    userId: session.user.id,
    role: membership.role === "owner" ? "owner" : "member",
  };
}

/**
 * Variante stricte pour les pages du dashboard :
 * - non connecté → /login
 * - connecté sans organisation → /onboarding
 */
export async function requireTenant(): Promise<TenantContext> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const tenant = await getTenant();
  if (!tenant) redirect("/onboarding");

  return tenant;
}

/** Réservé aux actions d'administration du tenant (réglages, équipe, RGPD). */
export async function requireOwner(): Promise<TenantContext> {
  const tenant = await requireTenant();
  if (tenant.role !== "owner") redirect("/app");
  return tenant;
}
