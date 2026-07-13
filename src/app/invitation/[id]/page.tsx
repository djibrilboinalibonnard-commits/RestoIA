"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { authClient, useSession } from "@/lib/auth-client";

/**
 * Acceptation d'une invitation d'équipe.
 * Le lien est envoyé par e-mail (loggé côté serveur en attendant la Phase 4).
 */
export default function InvitationPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function accept() {
    setError(null);
    setLoading(true);
    const { data, error } = await authClient.organization.acceptInvitation({
      invitationId: id,
    });
    setLoading(false);
    if (error || !data) {
      setError(
        error?.message ?? "Invitation invalide, expirée ou déjà utilisée.",
      );
      return;
    }
    await authClient.organization.setActive({
      organizationId: data.invitation.organizationId,
    });
    router.push("/app");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-4 rounded-xl border border-zinc-200 bg-white p-6 text-center shadow-sm">
        <p className="text-sm font-semibold text-emerald-600">VoxEmploy</p>
        <h1 className="text-xl font-bold">Invitation d&apos;équipe</h1>
        {isPending ? (
          <p className="text-sm text-zinc-600">Chargement…</p>
        ) : !session ? (
          <p className="text-sm text-zinc-600">
            Connectez-vous ou créez un compte avec l&apos;adresse e-mail
            invitée, puis revenez sur ce lien.
          </p>
        ) : (
          <button
            onClick={accept}
            disabled={loading}
            className="w-full rounded-lg bg-emerald-600 py-2.5 font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50"
          >
            {loading ? "Un instant…" : "Rejoindre l'équipe"}
          </button>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </main>
  );
}
