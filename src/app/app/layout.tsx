import { requireTenant } from "@/server/tenant";
import { prisma } from "@/lib/db";
import { DashboardNav } from "./nav";

// Le dashboard est toujours dynamique : il dépend de la session.
export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const tenant = await requireTenant();
  const organization = await prisma.organization.findUniqueOrThrow({
    where: { id: tenant.organizationId },
    select: { name: true },
  });

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      {/* Sidebar desktop / barre inférieure mobile */}
      <DashboardNav organizationName={organization.name} />

      {/* Contenu — padding bas sur mobile pour la barre de nav fixe */}
      <main className="flex-1 px-4 pb-24 pt-6 md:px-8 md:pb-8 md:pt-8">
        {children}
      </main>
    </div>
  );
}
