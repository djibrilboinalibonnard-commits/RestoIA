"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { slugify } from "@/lib/slug";

/**
 * Première étape après l'inscription : créer l'organisation (le tenant).
 * L'onboarding complet (horaires, menu, agent…) arrive en Phase 4.
 */
export default function OnboardingPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const slug = `${slugify(name)}-${Math.random().toString(36).slice(2, 6)}`;
    const { data, error } = await authClient.organization.create({
      name,
      slug,
    });
    if (error || !data) {
      setLoading(false);
      setError(error?.message ?? "Impossible de créer l'établissement.");
      return;
    }
    await authClient.organization.setActive({ organizationId: data.id });
    router.push("/app");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <p className="text-sm font-semibold text-emerald-600">VoxEmploy</p>
          <h1 className="mt-2 text-2xl font-bold">Votre établissement</h1>
          <p className="mt-1 text-sm text-zinc-600">
            Comment s&apos;appelle votre commerce&nbsp;?
          </p>
        </div>
        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm"
        >
          <div>
            <label htmlFor="name" className="mb-1 block text-sm font-medium">
              Nom de l&apos;établissement
            </label>
            <input
              id="name"
              type="text"
              required
              placeholder="Ex. Chez Mario"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={loading || name.trim().length < 2}
            className="w-full rounded-lg bg-emerald-600 py-2.5 font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50"
          >
            {loading ? "Création…" : "Continuer"}
          </button>
        </form>
      </div>
    </main>
  );
}
