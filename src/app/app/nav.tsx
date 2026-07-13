"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

const NAV_ITEMS = [
  { href: "/app", label: "Accueil", icon: "🏠" },
  { href: "/app/appels", label: "Appels", icon: "📞" },
  { href: "/app/reservations", label: "Réservations", icon: "📅" },
  { href: "/app/commandes", label: "Commandes", icon: "🧾" },
  { href: "/app/menu", label: "Menu", icon: "🍽️" },
  { href: "/app/reglages", label: "Réglages", icon: "⚙️" },
] as const;

export function DashboardNav({
  organizationName,
}: {
  organizationName: string;
}) {
  const pathname = usePathname();
  const router = useRouter();

  const isActive = (href: string) =>
    href === "/app" ? pathname === "/app" : pathname.startsWith(href);

  async function handleSignOut() {
    await authClient.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <>
      {/* Sidebar — desktop */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-zinc-200 bg-white md:flex">
        <div className="border-b border-zinc-200 px-5 py-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-emerald-600">
            VoxEmploy
          </p>
          <p className="mt-1 truncate font-semibold" title={organizationName}>
            {organizationName}
          </p>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                isActive(item.href)
                  ? "bg-emerald-50 text-emerald-700"
                  : "text-zinc-600 hover:bg-zinc-100"
              }`}
            >
              <span aria-hidden>{item.icon}</span>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="border-t border-zinc-200 p-3">
          <button
            onClick={handleSignOut}
            className="w-full rounded-lg px-3 py-2 text-left text-sm text-zinc-600 transition hover:bg-zinc-100"
          >
            Se déconnecter
          </button>
        </div>
      </aside>

      {/* Barre inférieure — mobile (le restaurateur consulte depuis son téléphone) */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-zinc-200 bg-white md:hidden">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${
              isActive(item.href) ? "text-emerald-700" : "text-zinc-500"
            }`}
          >
            <span className="text-lg" aria-hidden>
              {item.icon}
            </span>
            {item.label}
          </Link>
        ))}
      </nav>
    </>
  );
}
