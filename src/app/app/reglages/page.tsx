import { requireTenant } from "@/server/tenant";
import { prisma } from "@/lib/db";
import { InviteForm } from "./invite-form";

export const dynamic = "force-dynamic";

const ROLE_LABELS: Record<string, string> = {
  owner: "Propriétaire",
  admin: "Administrateur",
  member: "Équipe",
};

export default async function SettingsPage() {
  const tenant = await requireTenant();

  const [organization, members, invitations] = await Promise.all([
    prisma.organization.findUniqueOrThrow({
      where: { id: tenant.organizationId },
      select: { name: true, retentionDays: true, createdAt: true },
    }),
    prisma.member.findMany({
      where: { organizationId: tenant.organizationId },
      include: { user: { select: { name: true, email: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.invitation.findMany({
      where: { organizationId: tenant.organizationId, status: "pending" },
      orderBy: { expiresAt: "desc" },
    }),
  ]);

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <header>
        <h1 className="text-2xl font-bold">Réglages</h1>
        <p className="mt-1 text-sm text-zinc-600">{organization.name}</p>
      </header>

      <section className="rounded-xl border border-zinc-200 bg-white">
        <div className="border-b border-zinc-200 px-5 py-4">
          <h2 className="font-semibold">Équipe</h2>
          <p className="text-sm text-zinc-600">
            Les membres de l&apos;équipe voient les appels, réservations et
            commandes.
          </p>
        </div>
        <ul className="divide-y divide-zinc-200">
          {members.map((m) => (
            <li
              key={m.id}
              className="flex items-center justify-between px-5 py-3"
            >
              <div>
                <p className="font-medium">{m.user.name}</p>
                <p className="text-sm text-zinc-500">{m.user.email}</p>
              </div>
              <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-700">
                {ROLE_LABELS[m.role] ?? m.role}
              </span>
            </li>
          ))}
          {invitations.map((inv) => (
            <li
              key={inv.id}
              className="flex items-center justify-between px-5 py-3"
            >
              <div>
                <p className="font-medium">{inv.email}</p>
                <p className="text-sm text-zinc-500">Invitation en attente</p>
              </div>
              <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-700">
                En attente
              </span>
            </li>
          ))}
        </ul>
        {tenant.role === "owner" && (
          <div className="border-t border-zinc-200 px-5 py-4">
            <InviteForm />
          </div>
        )}
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white px-5 py-4">
        <h2 className="font-semibold">Confidentialité (RGPD)</h2>
        <p className="mt-1 text-sm text-zinc-600">
          Les enregistrements et transcriptions d&apos;appels sont conservés{" "}
          <strong>{organization.retentionDays} jours</strong> puis supprimés
          automatiquement. La durée sera configurable prochainement.
        </p>
      </section>
    </div>
  );
}
