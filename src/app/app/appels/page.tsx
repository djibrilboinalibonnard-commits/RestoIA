import { requireTenant } from "@/server/tenant";
import { prisma } from "@/lib/db";
import { callsRepo } from "@/server/repositories/calls";

export const dynamic = "force-dynamic";

export default async function CallsPage() {
  const tenant = await requireTenant();
  const calls = await callsRepo(prisma, tenant).list();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Appels</h1>
        <p className="mt-1 text-sm text-zinc-600">
          Journal des appels : audio, transcription, résumé et résultat.
        </p>
      </header>

      {calls.length === 0 ? (
        <div className="rounded-xl border border-zinc-200 bg-white p-10 text-center">
          <p className="text-4xl" aria-hidden>
            📞
          </p>
          <p className="mt-3 font-medium">Aucun appel pour l&apos;instant</p>
          <p className="mt-1 text-sm text-zinc-600">
            Dès que votre agent vocal sera activé, chaque appel apparaîtra ici
            avec sa transcription et son résumé.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 bg-white">
          {calls.map((call) => (
            <li key={call.id} className="px-5 py-4">
              <div className="flex items-center justify-between">
                <p className="font-medium">
                  {call.fromE164 ?? "Numéro masqué"}
                </p>
                <p className="text-sm text-zinc-500">
                  {call.startedAt.toLocaleString("fr-FR")}
                </p>
              </div>
              {call.summary && (
                <p className="mt-1 text-sm text-zinc-600">{call.summary}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
