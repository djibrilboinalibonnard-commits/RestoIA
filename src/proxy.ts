import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

/**
 * Garde rapide (Next 16 : « proxy », ex-middleware) : redirige vers /login
 * si aucun cookie de session n'est présent.
 *
 * La vérification réelle de la session ET du tenant est faite côté serveur
 * dans requireTenant() (src/server/tenant.ts) — ce proxy n'est qu'un
 * raccourci UX, jamais une frontière de sécurité.
 */
export function proxy(request: NextRequest) {
  const sessionCookie = getSessionCookie(request);
  if (!sessionCookie) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/app/:path*", "/onboarding"],
};
