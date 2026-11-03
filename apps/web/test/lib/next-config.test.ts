import { IncomingMessage } from "node:http";
import { Socket } from "node:net";
import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER } from "next/constants";
import { matchHas } from "next/dist/shared/lib/router/utils/prepare-destination";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("dotenv", () => ({ config: vi.fn() }));
vi.mock("next-axiom", () => ({ withAxiom: (config: NextConfig) => config }));
vi.mock("botid/next/config", () => ({ withBotId: (config: NextConfig) => config }));

import process from "node:process";
import { getRegExpThatMatchesAllOrgDomains } from "../../getNextjsOrgRewriteConfig";

/* eslint-disable @typescript-eslint/no-require-imports */
const { match, pathToRegexp } = require("next/dist/compiled/path-to-regexp");
type MatcherRes = (path: string) => { params: Record<string, string> };
let orgUserTypeRouteMatch: MatcherRes;
let orgUserRouteMatch: MatcherRes;

beforeAll(async () => {
  (process.env as Record<string, string | undefined>).NEXT_PUBLIC_WEBAPP_URL = "http://example.com";
  const { orgUserRoutePath, orgUserTypeRoutePath } = await import("../../pagesAndRewritePaths");

  orgUserTypeRouteMatch = match(orgUserTypeRoutePath);

  orgUserRouteMatch = match(orgUserRoutePath);
  console.log({
    regExps: {
      orgUserTypeRouteMatch: pathToRegexp(orgUserTypeRoutePath),
      orgUserRouteMatch: pathToRegexp(orgUserRoutePath),
    },
  });
});

describe("next.config.js - Org Rewrite", () => {
  describe("getRegExpThatMatchesAllOrgDomains", () => {
    it("WEBAPP_URL=app.cal.com", () => {
      const regExp = new RegExp(getRegExpThatMatchesAllOrgDomains({ webAppUrl: "app.cal.com" }));
      expect(regExp.exec("acme.cal.com")?.groups?.orgSlug).toEqual("acme");
      expect(regExp.exec("app.cal.com")).toEqual(null);
      // Even though it matches abc. We shouldn't match it as it isn't a subdomain of cal.com(derived from WEBAPP_URL)
      // We could fix the RegExp, but that might break some unexpected self-hosted scenarios. So, we can fix it separately.
      expect(regExp.exec("abc.sdafasdf.com")?.groups?.orgSlug).toEqual("abc");
    });

    it("WEBAPP_URL=https://app.cal.com", () => {
      const regExp = new RegExp(getRegExpThatMatchesAllOrgDomains({ webAppUrl: "https://app.cal.com" }));
      expect(regExp.exec("acme.cal.com")?.groups?.orgSlug).toEqual("acme");
      expect(regExp.exec("app.cal.com")).toEqual(null);

      // This approach though not used by managed cal.com, but might be in use by self-hosted users.
      expect(regExp.exec("acme.app.cal.com")?.groups?.orgSlug).toEqual("acme");

      // TODO: Even though it gives abc orgSlug. We shouldn't match it as it isn't a subdomain of cal.com(derived from WEBAPP_URL)
      // We could fix the RegExp, but that might break some unexpected self-hosted scenarios. So, we can fix it separately.
      expect(regExp.exec("abc.sdafasdf.com")?.groups?.orgSlug).toEqual("abc");
    });

    it("WEBAPP_URL=https://booker.dashboard.company.com", () => {
      const regExp = new RegExp(
        getRegExpThatMatchesAllOrgDomains({ webAppUrl: "https://booker.dashboard.company.com" })
      );

      // This approach though not used by managed cal.com, but might be in use by self-hosted users.
      expect(regExp.exec("acme.booker.dashboard.company.com")?.groups?.orgSlug).toEqual("acme");
      expect(regExp.exec("booker.dashboard.company.com")).toEqual(null);
    });

    it("WEBAPP_URL=http://app.cal.local:3000", () => {
      const regExp = new RegExp(
        getRegExpThatMatchesAllOrgDomains({ webAppUrl: "http://app.cal.local:3000" })
      );
      expect(regExp.exec("acme.cal.local:3000")?.groups?.orgSlug).toEqual("acme");
      expect(regExp.exec("acme.app.cal.local:3000")?.groups?.orgSlug).toEqual("acme");
      expect(regExp.exec("app.cal.local:3000")).toEqual(null);
    });

    it("Vercel Preview special handling - vercel.app. Cal.diy deployed on vercel apps have different subdomains, so we can't consider them org domains", () => {
      const regExp = new RegExp(getRegExpThatMatchesAllOrgDomains({ webAppUrl: "http://app.vercel.app" }));
      // It is not matching on vercel.app but would have matched in any other case
      expect(regExp.exec("acme.vercel.app")).toEqual(null);
      expect(regExp.exec("app.vercel.app")).toEqual(null);
    });

    describe("NEXT_PUBLIC_SINGLE_ORG_MODE_ENABLED=1", () => {
      process.env.NEXT_PUBLIC_SINGLE_ORG_MODE_ENABLED = "1";
      it("WEBAPP_URL=http://app.cal.local:3000", () => {
        const regExp = new RegExp(
          getRegExpThatMatchesAllOrgDomains({ webAppUrl: "http://app.cal.local:3000" })
        );
        expect(regExp.exec("acme.cal.local:3000")?.groups?.orgSlug).toEqual("acme");
        expect(regExp.exec("app.cal.local:3000")).toEqual(null);
      });
    });
  });

  describe("Rewrite", () => {
    it("Booking pages", () => {
      expect(orgUserTypeRouteMatch("/user/type")?.params).toEqual({
        user: "user",
        type: "type",
      });

      // User slug starting with 404(which is a page route) will work
      expect(orgUserTypeRouteMatch("/404a/def")?.params).toEqual({
        user: "404a",
        type: "def",
      });

      // With teams removed, /team/abc is treated as a normal /:user/:type booking page
      expect(orgUserTypeRouteMatch("/team/abc")?.params).toEqual({
        user: "team",
        type: "abc",
      });

      expect(orgUserTypeRouteMatch("/abc")).toEqual(false);

      expect(orgUserRouteMatch("/abc")?.params).toEqual({
        user: "abc",
      });

      // Tests that something that starts with 'd' which could accidentally match /d route is correctly identified as a booking page
      expect(orgUserRouteMatch("/designer")?.params).toEqual({
        user: "designer",
      });

      // Tests that something that starts with 'apps' which could accidentally match /apps route is correctly identified as a booking page
      expect(orgUserRouteMatch("/apps-conflict-possibility")?.params).toEqual({
        user: "apps-conflict-possibility",
      });

      // Tests that something that starts with '_next' which could accidentally match /_next route is correctly identified as a booking page
      expect(orgUserRouteMatch("/_next-candidate")?.params).toEqual({
        user: "_next-candidate",
      });

      // Tests that something that starts with 'public' which could accidentally match /public route is correctly identified as a booking page
      expect(orgUserRouteMatch("/public-person")?.params).toEqual({
        user: "public-person",
      });
    });

    it("Non booking pages", () => {
      expect(orgUserTypeRouteMatch("/_next/def")).toEqual(false);
      expect(orgUserTypeRouteMatch("/public/def")).toEqual(false);
      expect(orgUserRouteMatch("/embed.js")).toEqual(false);
      expect(orgUserTypeRouteMatch("/embed/embed.js")).toEqual(false);
      expect(orgUserTypeRouteMatch("/embed/preview.html")).toEqual(false);

      expect(orgUserRouteMatch("/_next/")).toEqual(false);
      expect(orgUserRouteMatch("/public/")).toEqual(false);

      expect(orgUserRouteMatch("/event-types/")).toEqual(false);
      expect(orgUserTypeRouteMatch("/event-types/")).toEqual(false);

      expect(orgUserRouteMatch("/event-types/?abc=1")).toEqual(false);
      expect(orgUserTypeRouteMatch("/event-types/?abc=1")).toEqual(false);

      expect(orgUserRouteMatch("/event-types")).toEqual(false);
      expect(orgUserTypeRouteMatch("/event-types")).toEqual(false);

      expect(orgUserRouteMatch("/event-types?abc=1")).toEqual(false);
      expect(orgUserTypeRouteMatch("/event-types?abc=1")).toEqual(false);

      expect(orgUserTypeRouteMatch("/john/avatar.png")).toEqual(false);
      expect(orgUserTypeRouteMatch("/cancel/abcd")).toEqual(false);
      expect(orgUserTypeRouteMatch("/success/abcd")).toEqual(false);
      expect(orgUserRouteMatch("/forms/xdsdf-sd")).toEqual(false);
      expect(orgUserRouteMatch("/router?form=")).toEqual(false);
    });

    it("Whitelisted routes should match on org domains", () => {
      expect(orgUserRouteMatch("/onboarding")?.params).toEqual({
        user: "onboarding",
      });
      expect(orgUserTypeRouteMatch("/onboarding/30min")?.params).toEqual({
        user: "onboarding",
        type: "30min",
      });
    });

    describe("Character validation in org slugs", () => {
      it("should allow valid characters: alphanumeric, hyphens, and underscores", () => {
        // Valid usernames with allowed characters
        expect(orgUserRouteMatch("/john-doe")?.params).toEqual({
          user: "john-doe",
        });
        expect(orgUserRouteMatch("/john_doe")?.params).toEqual({
          user: "john_doe",
        });
        expect(orgUserRouteMatch("/user123")?.params).toEqual({
          user: "user123",
        });
        expect(orgUserRouteMatch("/ABC-123_xyz")?.params).toEqual({
          user: "ABC-123_xyz",
        });
      });

      it("should reject invalid punctuation characters in org slugs", () => {
        // These should NOT match because they contain invalid characters
        // The character class [a-zA-Z0-9-_] when hyphen is unescaped between 9 and _
        // creates a range from - (ASCII 45) to _ (ASCII 95), which includes : ; < = > ? @ [ \ ] ^

        // Colon (:) - ASCII 58
        expect(orgUserRouteMatch("/user:name")).toEqual(false);

        // Semicolon (;) - ASCII 59
        expect(orgUserRouteMatch("/user;name")).toEqual(false);

        // Less than (<) - ASCII 60
        expect(orgUserRouteMatch("/user<name")).toEqual(false);

        // Equals (=) - ASCII 61
        expect(orgUserRouteMatch("/user=name")).toEqual(false);

        // Greater than (>) - ASCII 62
        expect(orgUserRouteMatch("/user>name")).toEqual(false);

        // Question mark (?) - ASCII 63
        expect(orgUserRouteMatch("/user?name")).toEqual(false);

        // At symbol (@) - ASCII 64
        expect(orgUserRouteMatch("/user@name")).toEqual(false);

        // Square brackets ([, ]) - ASCII 91, 93
        expect(orgUserRouteMatch("/user[name")).toEqual(false);
        expect(orgUserRouteMatch("/user]name")).toEqual(false);

        // Backslash (\) - ASCII 92
        expect(orgUserRouteMatch("/user\\name")).toEqual(false);

        // Caret (^) - ASCII 94
        expect(orgUserRouteMatch("/user^name")).toEqual(false);

        // Other common punctuation that should also be rejected
        expect(orgUserRouteMatch("/user.name")).toEqual(false);
        expect(orgUserRouteMatch("/user!name")).toEqual(false);
        expect(orgUserRouteMatch("/user#name")).toEqual(false);
        expect(orgUserRouteMatch("/user$name")).toEqual(false);
        expect(orgUserRouteMatch("/user%name")).toEqual(false);
        expect(orgUserRouteMatch("/user&name")).toEqual(false);
        expect(orgUserRouteMatch("/user*name")).toEqual(false);
        expect(orgUserRouteMatch("/user+name")).toEqual(false);
      });
    });
  });
});

describe("next.config.ts - explicit production HSTS", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CALCOM_ENV", undefined);
    vi.stubEnv("HSTS_PUBLIC_ORIGIN", "https://book.businessautomations.group");
    vi.stubEnv("NEXT_PUBLIC_WEBAPP_URL", "http://NEXT_PUBLIC_WEBAPP_URL_PLACEHOLDER");
    vi.stubEnv("NEXTAUTH_SECRET", "unit-test-only-auth-secret");
    vi.stubEnv("CALENDSO_ENCRYPTION_KEY", "unit-test-only-encryption-key");
    vi.stubEnv("NEXTAUTH_URL", "http://NEXT_PUBLIC_WEBAPP_URL_PLACEHOLDER/api/auth");
    vi.stubEnv("EMAIL_FROM", "test@example.invalid");
    vi.stubEnv("ANALYZE", "false");
    vi.stubEnv("CSP_POLICY", "");
    vi.stubEnv("ORGANIZATIONS_ENABLED", "0");
    vi.stubEnv("NEXT_PUBLIC_SINGLE_ORG_SLUG", undefined);
    vi.stubEnv("VERCEL_URL", undefined);
  });

  afterEach(() => vi.unstubAllEnvs());

  async function headers(phase = PHASE_PRODUCTION_BUILD) {
    const { default: config } = await import("../../next.config");
    return (await config(phase).headers?.()) ?? [];
  }

  it("guards alternate RSC paths before existing rewrites only with the proxy marker", async () => {
    const { default: createConfig } = await import("../../next.config");
    const rewrites = await createConfig(PHASE_PRODUCTION_BUILD).rewrites?.();
    if (!rewrites || Array.isArray(rewrites)) throw new Error("Expected phased rewrites");
    const beforeFiles = rewrites.beforeFiles ?? [];
    const guards = beforeFiles.slice(0, 2);
    expect(guards.map((rule) => rule.source)).toEqual(["/:path*.rsc", "/:path*.segments/:segment*"]);
    expect(beforeFiles[2].destination).toBe("/:path*");
    for (const path of [
      "/auth/login.rsc",
      "/auth/login.rsc/",
      "/auth/login.segments/a.segment.rsc",
      "/auth/login.segments/",
      "/api/auth/callback/credentials.rsc",
      "/api/integrations/googlecalendar/callback.rsc",
    ]) {
      for (const marker of [undefined, "0", "1"]) {
        const req = new IncomingMessage(new Socket());
        if (marker) req.headers["x-cal-renewal-route-guard"] = marker;
        try {
          const selected = guards.find((rule) => match(rule.source)(path) && matchHas(req, {}, rule.has));
          expect(selected?.destination, `${path}:${marker}`).toBe(
            marker === "1" ? "/api/renewal-maintenance-unavailable" : undefined
          );
        } finally {
          req.destroy();
        }
      }
    }
    for (const path of [
      "/auth/login",
      "/api/auth/callback/credentials",
      "/api/auth/csrf",
      "/api/integrations/googlecalendar/callback",
    ]) {
      expect(
        guards.some((rule) => match(rule.source)(path)),
        path
      ).toBe(false);
    }
  });

  it.each([
    PHASE_PRODUCTION_BUILD,
    PHASE_PRODUCTION_SERVER,
  ])("adds HSTS in %s despite the Docker HTTP app placeholder", async (phase) => {
    const rules = await headers(phase);
    const hsts = rules.filter((rule) =>
      rule.headers.some((header) => header.key === "Strict-Transport-Security")
    );
    expect(hsts).toHaveLength(1);
    expect(hsts[0]).toEqual({
      source: "/:path*",
      has: [{ type: "host", value: "book\\.businessautomations\\.group" }],
      headers: [{ key: "Strict-Transport-Security", value: "max-age=604800" }],
    });
    for (const [host, matches] of [
      ["book.businessautomations.group", true],
      ["BOOK.BUSINESSAUTOMATIONS.GROUP", true],
      ["book.businessautomations.group:443", true],
      ["book.businessautomations.group:8443", true],
      ["localhost:3000", false],
      ["127.0.0.1:3000", false],
      ["businessautomations.group", false],
      ["other.businessautomations.group", false],
      ["bookXbusinessautomationsXgroup", false],
      ["book.businessautomations.group.attacker.test", false],
    ] as const) {
      const request = new IncomingMessage(new Socket());
      request.headers.host = host;
      try {
        expect(matchHas(request, {}, hsts[0].has) !== false).toBe(matches);
      } finally {
        request.destroy();
      }
    }
  });

  it("normalizes the configured HTTPS origin", async () => {
    vi.stubEnv("HSTS_PUBLIC_ORIGIN", "https://BOOK.BusinessAutomations.Group:443/");
    const rules = await headers();
    expect(
      rules.find((rule) => rule.headers.some((header) => header.key === "Strict-Transport-Security"))?.has
    ).toEqual([{ type: "host", value: "book\\.businessautomations\\.group" }]);
  });

  it.each([undefined, ""])("omits HSTS when no public origin was opted in: %s", async (origin) => {
    vi.stubEnv("HSTS_PUBLIC_ORIGIN", origin);
    const rules = await headers();
    expect(
      rules.flatMap((rule) => rule.headers).some((header) => header.key === "Strict-Transport-Security")
    ).toBe(false);
  });

  it.each([
    "not a URL",
    " ",
    "http://book.businessautomations.group",
    "https://localhost:3000",
    "https://app.localhost:3000",
    "https://app.cal.local:3000",
    "https://booking.test",
    "https://booking.internal",
    "https://booking.home.arpa",
    "https://127.0.0.1:3000",
    "https://[::1]:3000",
    "https://192.168.1.20:3000",
    "https://booking",
    "https://bad_name.example.com",
    "https://book.businessautomations.group.",
    "https://test-user:test-password@book.businessautomations.group",
    "https://book.businessautomations.group/path",
    "https://book.businessautomations.group/?query=1",
    "https://book.businessautomations.group/#fragment",
    " https://book.businessautomations.group",
  ])("rejects invalid nonempty production HSTS input: %s", async (origin) => {
    vi.stubEnv("HSTS_PUBLIC_ORIGIN", origin);
    await expect(headers()).rejects.toThrow(
      "HSTS_PUBLIC_ORIGIN must be a public HTTPS origin without credentials, a path, a query, or a fragment"
    );
  });

  it.each([
    ["NODE_ENV", "development"],
    ["NODE_ENV", "test"],
    ["CALCOM_ENV", "development"],
    ["CALCOM_ENV", "preview"],
  ])("omits HSTS for %s=%s", async (key, value) => {
    vi.stubEnv(key, value);
    vi.stubEnv("HSTS_PUBLIC_ORIGIN", "https://localhost:3000");
    const rules = await headers();
    expect(
      rules.flatMap((rule) => rule.headers).some((header) => header.key === "Strict-Transport-Security")
    ).toBe(false);
  });

  it("omits HSTS during the development phase even with production environment values", async () => {
    const rules = await headers(PHASE_DEVELOPMENT_SERVER);
    expect(
      rules.flatMap((rule) => rule.headers).some((header) => header.key === "Strict-Transport-Security")
    ).toBe(false);
  });

  it("preserves every other security, embed and asset header", async () => {
    const enabled = await headers();
    vi.stubEnv("HSTS_PUBLIC_ORIGIN", "");
    const disabled = await headers();
    expect(
      enabled.filter((rule) => !rule.headers.some((header) => header.key === "Strict-Transport-Security"))
    ).toEqual(disabled);
    expect(enabled.find((rule) => rule.source === "/auth/:path*")?.headers).toContainEqual({
      key: "X-Frame-Options",
      value: "DENY",
    });
    expect(enabled.find((rule) => rule.source === "/:path*" && !rule.has)?.headers).toEqual([
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    ]);
    expect(enabled.find((rule) => rule.source === "/embed/embed.js")?.headers).toContainEqual({
      key: "Cross-Origin-Resource-Policy",
      value: "cross-origin",
    });
  });
});
