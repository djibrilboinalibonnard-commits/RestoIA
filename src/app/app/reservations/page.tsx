import { requireTenant } from "@/server/tenant";
import { prisma } from "@/lib/db";
import { bookingsRepo } from "@/server/repositories/bookings";

export const dynamic = "force-dynamic";

export default async function BookingsPage() {
  const tenant = await requireTenant();
  const bookings = await bookingsRepo(prisma, tenant).list({
    from: new Date(),
  });

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Réservations</h1>
        <p className="mt-1 text-sm text-zinc-600">
          Les réservations prises par votre agent et par votre équipe.
        </p>
      </header>

      {bookings.length === 0 ? (
        <div className="rounded-xl border border-zinc-200 bg-white p-10 text-center">
          <p className="text-4xl" aria-hidden>
            📅
          </p>
          <p className="mt-3 font-medium">Aucune réservation à venir</p>
          <p className="mt-1 text-sm text-zinc-600">
            La vue calendrier et la gestion des capacités arrivent avec
            l&apos;agent vocal.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 bg-white">
          {bookings.map((b) => (
            <li
              key={b.id}
              className="flex items-center justify-between px-5 py-4"
            >
              <div>
                <p className="font-medium">{b.customerName}</p>
                <p className="text-sm text-zinc-600">
                  {b.covers} couvert{b.covers > 1 ? "s" : ""}
                </p>
              </div>
              <p className="text-sm text-zinc-500">
                {b.startsAt.toLocaleString("fr-FR", {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
