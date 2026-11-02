import "next/dist/server/node-environment";

import { get as edgeConfigGet } from "@vercel/edge-config";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { encode, type JWT } from "next-auth/jwt";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import proxy, { config } from "./proxy";

vi.mock("@vercel/edge-config", () => ({ get: vi.fn() }));

const origin = "https://book.example.test";
const secret = "synthetic-maintenance-test-secret-only";
const googlePaths = ["/api/integrations/google_calendar/add", "/api/integrations/googlecalendar/callback"];
const legacyMatchers = [
  "/auth/login",
  "/login",
  "/apps/installed",
  "/auth/logout",
  "/:path*/embed",
  "/availability",
  "/api/auth/signup",
];
const blockedPaths = [
  "/",
  "/business-automations/free-audit",
  "/business-automations/free-audit-de/embed",
  "/api/book/event",
  "/api/book/recurring-event",
  "/api/cancel",
  "/api/link",
  "/api/trpc/public.slots.getSchedule,viewer.bookings.cancel",
  "/availability",
  "/api/cron/calendar-subscriptions",
  "/api/tasks/cron",
  "/api/integrations/googlecalendar/webhook",
  "/de/api/book/event",
  "/cancel/test",
  "/booking/direct/cancel/test/test/test",
  "/success/test",
  "/api/auth/signup",
  "/api/auth/signin/google",
  "/api/auth/callback/google",
  "/api/auth/session/extra",
  "/_next/data/build/business-automations/free-audit.json",
  "/_next/image",
  "/api/logo",
  "/example.js",
];
const request = (path: string, method = "GET", headers: Record<string, string> = {}) =>
  new NextRequest(`${origin}${path}`, { method, headers });
const ownerHeaders = async (token: JWT = { sub: "1" }, maxAge = 60) => ({
  cookie: `__Secure-next-auth.session-token=${await encode({ secret, token, maxAge })}`,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("GOOGLE_RENEWAL_MAINTENANCE", "1");
  vi.stubEnv("GOOGLE_RENEWAL_OWNER_USER_ID", "1");
  vi.stubEnv("NEXTAUTH_SECRET", secret);
  vi.stubEnv("NEXTAUTH_URL", origin);
  vi.stubEnv("CSP_POLICY", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("Google renewal isolation", () => {
  it.each(blockedPaths)("matches and rejects %s before legacy proxy work", async (path) => {
    expect(unstable_doesMiddlewareMatch({ config, url: `${origin}${path}` })).toBe(true);
    const response = await proxy(request(path));
    expect(response.status).toBe(503);
    expect(response.headers.get("x-middleware-next")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("retry-after")).toBe("60");
    expect(response.headers.get("x-cal-renewal-maintenance")).toBe("1");
    expect(edgeConfigGet).not.toHaveBeenCalled();
  });

  it.each([
    "GET",
    "HEAD",
    "POST",
    "PUT",
    "PATCH",
    "DELETE",
    "OPTIONS",
  ])("blocks booking method %s", async (method) => {
    expect((await proxy(request("/api/book/event", method))).status).toBe(503);
  });

  it.each([
    ["GET", "/auth/login"],
    ["HEAD", "/login"],
    ["GET", "/auth/error"],
    ["GET", "/api/auth/providers"],
    ["GET", "/api/auth/csrf"],
    ["GET", "/api/auth/session"],
    ["POST", "/api/auth/callback/credentials"],
    ["GET", "/_next/static/chunks/login.js"],
    ["HEAD", "/favicon.ico"],
    ["GET", "/fonts/cal.ttf"],
    ["GET", "/fonts/Inter-roman.var.woff2"],
  ])("permits only the required %s %s", async (method, path) => {
    expect((await proxy(request(path, method))).headers.get("x-middleware-next")).toBe("1");
  });

  it.each([
    ["POST", "/auth/login"],
    ["POST", "/api/auth/session"],
    ["DELETE", "/api/auth/csrf"],
    ["GET", "/api/auth/callback/credentials"],
    ["POST", "/_next/static/chunks/login.js"],
    ["GET", "/_next/static/%2fapi/book/event"],
    ["GET", "/auth/login/extra"],
  ])("rejects wrong method or alias %s %s", async (method, path) => {
    expect((await proxy(request(path, method))).status).toBe(503);
  });

  it.each(googlePaths)("permits %s for the actual decoded owner session only", async (path) => {
    const headers = await ownerHeaders();
    expect(
      (await proxy(request(`${path}?code=synthetic-code&state=synthetic-state`, "GET", headers))).status
    ).toBe(200);
    expect((await proxy(request(path))).status).toBe(503);
    expect((await proxy(request(path, "HEAD", headers))).status).toBe(503);
    expect((await proxy(request(path, "POST", headers))).status).toBe(503);
    for (const token of [
      { sub: "2" },
      { sub: "1", impersonatedBy: { id: 2, uuid: "synthetic-impersonator", role: "USER" as const } },
      { sub: "01" },
    ]) {
      expect((await proxy(request(path, "GET", await ownerHeaders(token)))).status).toBe(503);
    }
    expect((await proxy(request(path, "GET", await ownerHeaders({ sub: "1" }, -60)))).status).toBe(503);
    expect(
      (await proxy(request(path, "GET", { cookie: "__Secure-next-auth.session-token=malformed" }))).status
    ).toBe(503);
  });

  it.each([
    undefined,
    "",
    "0",
    "01",
    "-1",
    "not-an-id",
  ])("fails closed with invalid owner %s", async (owner) => {
    vi.stubEnv("GOOGLE_RENEWAL_OWNER_USER_ID", owner);
    expect((await proxy(request(googlePaths[0], "GET", await ownerHeaders()))).status).toBe(503);
  });

  it("fails closed without the session secret and for an invalid enabled flag", async () => {
    const headers = await ownerHeaders();
    vi.stubEnv("NEXTAUTH_SECRET", "");
    expect((await proxy(request(googlePaths[0], "GET", headers))).status).toBe(503);
    vi.stubEnv("GOOGLE_RENEWAL_MAINTENANCE", "typo");
    expect((await proxy(request("/api/book/event"))).status).toBe(503);
  });

  it("ignores forged routing/host/owner headers and never reflects request data", async () => {
    const headers = {
      "x-middleware-subrequest": "proxy:proxy:proxy:proxy:proxy",
      "x-invoke-path": "/auth/login",
      "x-middleware-rewrite": `${origin}/auth/login`,
      "x-cal-renewal-owner": "1",
      host: "healthcheck.railway.app",
    };
    const response = await proxy(request("/api/cancel?token=synthetic-private-query", "POST", headers));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toMatch(/synthetic-private|proxy:|healthcheck/);
    expect((await proxy(request(googlePaths[0], "GET", headers))).status).toBe(503);
  });

  it("gates every host and keeps the health-check route available", async () => {
    for (const host of ["book.example.test", "service.up.railway.app", "localhost:3000"]) {
      expect((await proxy(new NextRequest(`http://${host}/api/book/event`))).status).toBe(503);
    }
    expect((await proxy(request("/api/auth/csrf", "GET", { host: "healthcheck.railway.app" }))).status).toBe(
      200
    );
  });
});

describe("disabled gate preserves original proxy scope", () => {
  it.each([undefined, "", "0"])("does not gate when mode is %s", async (mode) => {
    vi.stubEnv("GOOGLE_RENEWAL_MAINTENANCE", mode);
    const response = await proxy(request("/api/book/event", "POST"));
    expect(Array.from(response.headers.entries())).toEqual([["x-middleware-next", "1"]]);
  });

  it("applies legacy processing exactly where the original Next matcher applied", async () => {
    vi.stubEnv("GOOGLE_RENEWAL_MAINTENANCE", undefined);
    const paths = [
      ...blockedPaths,
      ...legacyMatchers.filter((path) => !path.includes(":")),
      "/embed",
      "/a/b/embed",
      "/_next/data/build/auth/login.json",
      "/_next/data/build/apps/installed.json",
      "/_next/data/build/embed.json",
      "/auth/log%69n",
    ];
    for (const path of paths) {
      for (const suffix of ["", "/", ".json", ".rsc", ".segments/a.segment.rsc", "/extra"]) {
        const url = `${origin}${path}${suffix}`;
        const req = new NextRequest(url);
        // Next's resolver normalizes current-build data paths before evaluating its matcher.
        const matchUrl =
          url.startsWith(`${origin}/_next/data/build/`) && url.endsWith(".json")
            ? `${origin}${req.nextUrl.pathname}`
            : url;
        const matched = [matchUrl, decodeURIComponent(matchUrl)].some((candidate) =>
          unstable_doesMiddlewareMatch({ config: { matcher: legacyMatchers }, url: candidate })
        );
        const response = await proxy(req);
        expect(response.headers.get("x-csp-status"), url).toBe(matched ? "not-opted-in" : null);
      }
    }
  });
});
