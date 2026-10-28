// @vitest-environment node

import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { NextRequest } from "next/server";
import { encode, getToken } from "next-auth/jwt";
import EmailProvider from "next-auth/providers/email";
import { describe, expect, it, vi } from "vitest";

function createEmailOptions() {
  const sendVerificationRequest = vi.fn(async () => {});
  const emailProvider = EmailProvider({ sendVerificationRequest });
  return {
    url: "https://auth.example.invalid/api/auth",
    provider: { ...emailProvider, ...emailProvider.options },
    adapter: {
      getUserByEmail: vi.fn(async () => null),
      createVerificationToken: vi.fn(async () => null),
    },
    // Stop accepted identifiers before token creation or delivery; only normalization is under test.
    callbacks: { signIn: vi.fn(async () => false) },
    logger: { error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  };
}

const require = createRequire(import.meta.url);
// NextAuth v4 keeps the provider's default normalizer inside the sign-in handler, not its public factory.
const { default: signIn } = require(join(dirname(require.resolve("next-auth")), "core/routes/signin.js")) as {
  default: (params: {
    options: ReturnType<typeof createEmailOptions>;
    query: Record<string, string>;
    body: { email: string };
  }) => Promise<{ redirect?: string }>;
};

describe("installed NextAuth email normalizer", () => {
  it.each([
    "victim\uFF20example.com@attacker.example",
    "victim\uFE6Bexample.com@attacker.example",
    "victim@example.com\uFF20attacker.example",
    "\uFF02victim\uFF02@example.com",
    "victim@example.com@attacker.example",
    '"victim"@example.com',
    "missing-at.example.com",
  ])("rejects an ambiguous or invalid identifier before any account or email work: %j", async (email) => {
    const options = createEmailOptions();
    expect(options.provider.normalizeIdentifier).toBeUndefined();

    const response = await signIn({ options, query: {}, body: { email } });

    expect(response.redirect).toBe(`${options.url}/error?error=EmailSignin`);
    expect(options.adapter.getUserByEmail).not.toHaveBeenCalled();
    expect(options.adapter.createVerificationToken).not.toHaveBeenCalled();
    expect(options.callbacks.signIn).not.toHaveBeenCalled();
    expect(options.provider.sendVerificationRequest).not.toHaveBeenCalled();
  });

  it.each([
    ["  USER@EXAMPLE.COM  ", "user@example.com"],
    [
      "\uFF35\uFF33\uFF25\uFF32\uFF20\uFF25\uFF38\uFF21\uFF2D\uFF30\uFF2C\uFF25\uFF0E\uFF23\uFF2F\uFF2D",
      "user@example.com",
    ],
    ["user+booking@example.com", "user+booking@example.com"],
    ["müller@example.com", "müller@example.com"],
  ])("normalizes a valid identifier for lookup without sending email: %j", async (email, normalized) => {
    const options = createEmailOptions();

    const response = await signIn({ options, query: {}, body: { email } });

    expect(options.adapter.getUserByEmail).toHaveBeenCalledExactlyOnceWith(normalized);
    expect(options.callbacks.signIn).toHaveBeenCalledOnce();
    expect(response.redirect).toBe(`${options.url}/error?error=AccessDenied`);
    expect(options.adapter.createVerificationToken).not.toHaveBeenCalled();
    expect(options.provider.sendVerificationRequest).not.toHaveBeenCalled();
  });
});

describe("installed NextAuth bearer and cookie token handling", () => {
  const secret = "synthetic-test-only-nextauth-secret";
  const identity = { sub: "123", email: "synthetic@example.invalid" };
  const requestWithBearer = (token: string) =>
    new NextRequest("https://auth.example.invalid/api/auth/session", {
      headers: { authorization: `Bearer ${token}` },
    });

  it.each([
    "%",
    "%ZZ",
    "%E0%A4%A",
    "%C0%AF",
  ])("returns null instead of throwing for malformed bearer percent-encoding: %j", async (value) => {
    const req = requestWithBearer(value);
    const decode = vi.fn();

    await expect(getToken({ req, secret, decode, secureCookie: false })).resolves.toBeNull();
    await expect(getToken({ req, secret, decode, secureCookie: false, raw: true })).resolves.toBeNull();
    expect(decode).not.toHaveBeenCalled();
  });

  it("decodes a valid synthetic encrypted bearer token", async () => {
    const token = await encode({ token: identity, secret, maxAge: 60 });

    await expect(
      getToken({ req: requestWithBearer(token), secret, secureCookie: false })
    ).resolves.toMatchObject(identity);
  });

  it("decodes a valid synthetic cookie token", async () => {
    const token = await encode({ token: identity, secret, maxAge: 60 });
    const req = new NextRequest("https://auth.example.invalid/api/auth/session");
    req.cookies.set("next-auth.session-token", token);

    await expect(getToken({ req, secret, secureCookie: false })).resolves.toMatchObject(identity);
  });

  it("refuses a token encrypted with a different secret", async () => {
    const token = await encode({ token: identity, secret: "different-synthetic-secret", maxAge: 60 });

    await expect(
      getToken({ req: requestWithBearer(token), secret, secureCookie: false })
    ).resolves.toBeNull();
  });

  it("refuses a tampered encrypted token", async () => {
    const token = await encode({ token: identity, secret, maxAge: 60 });
    const parts = token.split(".");
    const tag = parts[4];
    parts[4] = `${tag[0] === "A" ? "B" : "A"}${tag.slice(1)}`;

    await expect(
      getToken({ req: requestWithBearer(parts.join(".")), secret, secureCookie: false })
    ).resolves.toBeNull();
  });
});
