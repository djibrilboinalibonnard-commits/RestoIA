export const dynamic = "force-dynamic";

export default function MenuPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Menu</h1>
        <p className="mt-1 text-sm text-zinc-600">
          Votre carte, telle que votre agent la connaît.
        </p>
      </header>
      <div className="rounded-xl border border-zinc-200 bg-white p-10 text-center">
        <p className="text-4xl" aria-hidden>
          🍽️
        </p>
        <p className="mt-3 font-medium">Aucun menu configuré</p>
        <p className="mt-1 text-sm text-zinc-600">
          L&apos;import de votre carte (CSV, photo ou saisie manuelle) arrive
          dans une prochaine mise à jour.
        </p>
      </div>
    </div>
  );
}
