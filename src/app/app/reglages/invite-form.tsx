"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

export function InviteForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    setLoading(true);
    const { error } = await authClient.organization.inviteMember({
      email,
      role: "member",
    });
    setLoading(false);
    if (error) {
      setError(error.message ?? "Impossible d'envoyer l'invitation.");
      return;
    }
    setSuccess(true);
    setEmail("");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2 sm:flex-row">
      <input
        type="email"
        required
        placeholder="email@exemple.fr"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
      />
      <button
        type="submit"
        disabled={loading}
        className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50"
      >
        {loading ? "Envoi…" : "Inviter un membre"}
      </button>
      {error && <p className="text-sm text-red-600 sm:self-center">{error}</p>}
      {success && (
        <p className="text-sm text-emerald-700 sm:self-center">
          Invitation envoyée ✓
        </p>
      )}
    </form>
  );
}
