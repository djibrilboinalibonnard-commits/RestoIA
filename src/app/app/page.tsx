import { requireTenant } from "@/server/tenant";
import { prisma } from "@/lib/db";
import { callsRepo } from "@/server/repositories/calls";
import { bookingsRepo } from "@/server/repositories/bookings";

export const dynamic = "force-dynamic";

export default async function DashboardHomePage() {
  const tenant = await requireTenant();

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [callsToday, upcomingBookings] = await Promise.all([
    callsRepo(prisma, tenant).countSince(startOfDay),
    bookingsRepo(prisma, tenant).countUpcoming(),
  ]);

  const stats = [
    { label: "Appels aujourd'hui", value: callsToday },
    { label: "Réservations à venir", value: upcomingBookings },
    { label: "Commandes en cours", value: 0 },
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <header>
        <h1 className="text-2xl font-bold">Accueil</h1>
        <p className="mt-1 text-sm text-zinc-600">
          Vue d&apos;ensemble de votre activité.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {stats.map((s) => (
          <div
            key={s.label}
            className="rounded-xl border border-zinc-200 bg-white p-5"
          >
            <p className="text-3xl font-bold">{s.value}</p>
            <p className="mt-1 text-sm text-zinc-600">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-dashed border-emerald-300 bg-emerald-50 p-6">
        <h2 className="font-semibold text-emerald-900">
          🚀 Prochaine étape : votre agent vocal
        </h2>
        <p className="mt-1 text-sm text-emerald-800">
          La configuration de votre standardiste IA (numéro de téléphone,
          personnalité, horaires) arrive avec la prochaine mise à jour. Vous
          verrez ici vos appels en direct.
        </p>
      </div>
    </div>
  );
}
