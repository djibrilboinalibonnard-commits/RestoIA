export const dynamic = "force-dynamic";

export default function OrdersPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Commandes</h1>
        <p className="mt-1 text-sm text-zinc-600">
          File des commandes à emporter et en livraison, en temps réel.
        </p>
      </header>
      <div className="rounded-xl border border-zinc-200 bg-white p-10 text-center">
        <p className="text-4xl" aria-hidden>
          🧾
        </p>
        <p className="mt-3 font-medium">Aucune commande</p>
        <p className="mt-1 text-sm text-zinc-600">
          La prise de commande par téléphone arrive dans une prochaine mise à
          jour (import de votre menu, options, allergies).
        </p>
      </div>
    </div>
  );
}
