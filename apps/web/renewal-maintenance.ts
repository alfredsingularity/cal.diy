import process from "node:process";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";

// Preserve Next's original matcher suffixes when the global maintenance matcher is off.
const legacyProxyPath =
  /^(?:\/_next\/data\/[^/]+)?(?:\/(?:auth\/login|login|apps\/installed|auth\/logout|availability|api\/auth\/signup)|(?:\/[^/#?]+)*\/embed)(?:\.json|\.rsc|\.segments\/.+\.segment\.rsc)?[/#?]?$/;

const readPages = new Set(["/auth/login", "/login", "/auth/error"]);
const readAuth = new Set(["/api/auth/providers", "/api/auth/csrf", "/api/auth/session"]);
const staticFiles = new Set(["/favicon.ico", "/fonts/cal.ttf", "/fonts/Inter-roman.var.woff2"]);
const googlePaths = new Set([
  "/api/integrations/google_calendar/add",
  "/api/integrations/googlecalendar/callback",
]);

export function renewalMaintenanceUnavailable() {
  return new NextResponse(
    "Booking is temporarily unavailable. Please try again shortly.\n" +
      "Buchungen sind vorübergehend nicht verfügbar. Bitte versuchen Sie es in Kürze erneut.\n" +
      "Le prenotazioni sono temporaneamente sospese. Riprova tra poco.",
    {
      status: 503,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "Retry-After": "60",
        "X-Cal-Renewal-Maintenance": "1",
      },
    }
  );
}

export async function renewalMaintenanceResponse(req: NextRequest): Promise<NextResponse | null> {
  const mode = process.env.GOOGLE_RENEWAL_MAINTENANCE;
  if (!mode || mode === "0") return null;

  // Next may normalize data/RSC paths first; never trust client-supplied routing headers.
  const pathname = new URL(req.url).pathname;
  const readOnly = req.method === "GET" || req.method === "HEAD";
  // A normalized data GET can still mutate credentials through Google's callback.
  if (
    req.headers.get("x-nextjs-data") === "1" &&
    !((readOnly && readPages.has(pathname)) || (req.method === "GET" && readAuth.has(pathname)))
  ) {
    return renewalMaintenanceUnavailable();
  }
  const staticAsset =
    staticFiles.has(pathname) || (pathname.startsWith("/_next/static/") && !/[\\%]/.test(pathname));
  if (readOnly && (readPages.has(pathname) || staticAsset)) return null;
  if (req.method === "GET" && readAuth.has(pathname)) return null;
  if (req.method === "POST" && pathname === "/api/auth/callback/credentials") return null;

  if (mode === "1" && req.method === "GET" && googlePaths.has(pathname)) {
    const owner = process.env.GOOGLE_RENEWAL_OWNER_USER_ID;
    const secret = process.env.NEXTAUTH_SECRET;
    if (owner && /^[1-9]\d*$/.test(owner) && Number.isSafeInteger(Number(owner)) && secret) {
      try {
        const token = await getToken({ req, secret });
        if (token?.sub === owner && token.impersonatedBy == null) return null;
      } catch {
        // Decoder/configuration failures must never reopen the application or expose the session.
      }
    }
  }
  return renewalMaintenanceUnavailable();
}

export function setRenewalRoutingGuard(headers: Headers) {
  const marker = "x-cal-renewal-route-guard";
  const mode = process.env.GOOGLE_RENEWAL_MAINTENANCE;
  const enabled = Boolean(mode && mode !== "0");
  const changed = enabled || headers.has(marker);
  if (enabled) headers.set(marker, "1");
  else headers.delete(marker);
  return changed;
}

export function isLegacyProxyPath(pathname: string) {
  if (legacyProxyPath.test(pathname)) return true;
  try {
    return legacyProxyPath.test(decodeURIComponent(pathname));
  } catch {
    return false;
  }
}
