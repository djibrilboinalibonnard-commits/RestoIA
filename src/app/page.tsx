import Link from "next/link";

/**
 * Landing minimale (Phase 1). La vraie landing marketing arrive en Phase 6.
 */
export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 px-6 text-center">
      <div className="space-y-4">
        <p className="text-sm font-semibold uppercase tracking-widest text-emerald-600">
          VoxEmploy
        </p>
        <h1 className="max-w-2xl text-4xl font-bold tracking-tight sm:text-5xl">
          Ne ratez plus jamais un appel.
        </h1>
        <p className="mx-auto max-w-xl text-lg text-zinc-600">
          L&apos;employé digital vocal qui répond au téléphone de votre
          commerce&nbsp;: réservations, commandes et questions, en français
          naturel, 24h/24 et 7j/7.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/signup"
          className="rounded-lg bg-emerald-600 px-5 py-3 font-medium text-white transition hover:bg-emerald-700"
        >
          Essayer gratuitement
        </Link>
        <Link
          href="/login"
          className="rounded-lg border border-zinc-300 bg-white px-5 py-3 font-medium transition hover:bg-zinc-100"
        >
          Se connecter
        </Link>
      </div>
      <p className="text-sm text-zinc-500">
        Essai gratuit 14 jours · Sans engagement
      </p>
    </main>
  );
}
