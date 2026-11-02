import { createHmac } from "node:crypto";
import { inspect } from "node:util";
import type { NextApiRequest, NextApiResponse } from "next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const mocks = vi.hoisted(() => ({
  log: vi.fn(),
  token: vi.fn(),
  primary: vi.fn(),
  profile: vi.fn(),
  create: vi.fn(),
  upsert: vi.fn(),
  capture: vi.fn(),
  wrap: vi.fn(),
}));
vi.mock("@calcom/lib/logger", () => {
  const logger = {
    debug: mocks.log,
    info: mocks.log,
    error: mocks.log,
    warn: mocks.log,
    getSubLogger: (options: unknown) => {
      mocks.log(options);
      return logger;
    },
  };
  return { default: logger };
});
vi.mock("@calcom/lib/server/perfObserver", () => ({ performance: { mark: vi.fn(), measure: mocks.log } }));
vi.mock("@sentry/nextjs", () => ({ captureException: mocks.capture, wrapApiHandlerWithSentry: mocks.wrap }));
vi.mock("googleapis-common", () => ({
  OAuth2Client: class {
    getToken = mocks.token;
    setCredentials() {}
  },
}));
vi.mock("@googleapis/calendar", () => ({ calendar_v3: { Calendar: class {} } }));
vi.mock("@googleapis/oauth2", () => ({
  oauth2_v2: {
    Oauth2: class {
      userinfo = { get: mocks.profile };
    },
  },
}));
vi.mock("../lib/getGoogleAppKeys", () => ({
  getGoogleAppKeys: async () => ({ client_id: "test", client_secret: "synthetic-client-secret" }),
}));
vi.mock("../lib/CalendarService", () => ({
  createGoogleCalendarServiceWithGoogleType: () => ({
    getPrimaryCalendar: mocks.primary,
    upsertSelectedCalendar: mocks.upsert,
  }),
}));
vi.mock("@calcom/features/credentials/repositories/CredentialRepository", () => ({
  CredentialRepository: { create: mocks.create },
}));
vi.mock("@calcom/features/credentials/services/CredentialDataService", () => ({
  buildCredentialCreateData: (input: unknown) => input,
}));
vi.mock("@calcom/lib/connectedCalendar", () => ({ renewSelectedCalendarCredentialId: vi.fn() }));
vi.mock("@calcom/features/users/repositories/UserRepository", () => ({ UserRepository: class {} }));
vi.mock("@calcom/lib/server/avatar", () => ({ uploadAvatar: vi.fn() }));
vi.mock("@calcom/lib/server/resizeBase64Image", () => ({ resizeBase64Image: vi.fn() }));
vi.mock("@calcom/prisma", () => ({ default: {} }));

import { GOOGLE_CALENDAR_SCOPES, SCOPE_USERINFO_PROFILE, WEBAPP_URL } from "@calcom/lib/constants";
import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import { HttpError } from "@calcom/lib/http-error";
import { defaultResponder } from "@calcom/lib/server/defaultResponder";
import { TracedError } from "@calcom/lib/tracing/error";
import callback from "./callback";

const secrets = [
  "synthetic-code-secret",
  "synthetic-state-secret",
  "synthetic-access-secret",
  "synthetic-refresh-secret",
  "synthetic-client-secret",
  "synthetic-provider-secret",
  "synthetic-signing-secret",
];
const token = {
  access_token: secrets[2],
  refresh_token: secrets[3],
  scope: [...GOOGLE_CALENDAR_SCOPES, SCOPE_USERINFO_PROFILE].join(" "),
};
const returnTo = `${WEBAPP_URL}/apps/installed?rotation=1`;
function request() {
  vi.stubEnv("NEXTAUTH_SECRET", secrets[6]);
  const state = JSON.stringify({
    nonce: secrets[1],
    nonceHash: createHmac("sha256", secrets[6]).update(`${secrets[1]}:1`).digest("hex"),
    returnTo,
  });
  return {
    method: "GET",
    url: `/api/integrations/googlecalendar/callback?code=${secrets[0]}&state=${encodeURIComponent(state)}`,
    query: { code: secrets[0], state },
    session: { user: { id: 1 } },
  } as unknown as NextApiRequest;
}
function response() {
  const res = { writableEnded: false, status: vi.fn(), json: vi.fn(), redirect: vi.fn(), setHeader: vi.fn() };
  res.status.mockReturnValue(res);
  res.redirect.mockImplementation(() => {
    res.writableEnded = true;
  });
  return res;
}
function failure() {
  return Object.assign(new Error(secrets[5]), {
    config: {
      headers: { Authorization: `Bearer ${secrets[2]}` },
      body: { refresh_token: secrets[3], client_secret: secrets[4] },
    },
    response: { status: 403, data: { private: secrets[5] } },
  });
}
function safeOutput(res: ReturnType<typeof response>) {
  const output = inspect([mocks.log.mock.calls, mocks.capture.mock.calls, res.json.mock.calls], {
    depth: null,
  });
  for (const secret of secrets) expect(output).not.toContain(secret);
  expect(mocks.capture).not.toHaveBeenCalled();
  expect(mocks.wrap).not.toHaveBeenCalled();
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(mocks.log);
  mocks.token.mockResolvedValue({ tokens: token });
  mocks.create.mockResolvedValue({ id: 1, key: token });
  mocks.primary.mockResolvedValue({ id: "primary" });
  mocks.profile.mockResolvedValue({ data: {} });
});
afterEach(() => {
  vi.mocked(console.error).mockRestore();
  vi.unstubAllEnvs();
});

describe.each(["production", "development"])("Google callback diagnostics in %s", (environment) => {
  beforeEach(() => vi.stubEnv("NODE_ENV", environment));
  it("keeps code exchange, credential persistence and redirect while hiding successful callback URLs", async () => {
    const req = request();
    const res = response();
    await callback(req, res as unknown as NextApiResponse);
    expect(mocks.token).toHaveBeenCalledWith(secrets[0]);
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ key: token }));
    expect(mocks.upsert).toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith(returnTo);
    expect(JSON.parse(String(req.query.state))).toMatchObject({ nonce: secrets[1], returnTo });
    expect(req.url).toContain(secrets[0]);
    safeOutput(res);
  });
  it.each([
    "token",
    "primary",
  ] as const)("keeps %s failure status without retaining provider secrets", async (stage) => {
    const error = failure();
    const before = inspect(error);
    const res = response();
    mocks[stage].mockRejectedValueOnce(error);
    await callback(request(), res as unknown as NextApiResponse);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.redirect).not.toHaveBeenCalled();
    expect(inspect(error)).toBe(before);
    safeOutput(res);
  });
  it("keeps optional profile-photo failure nonfatal and safe", async () => {
    mocks.profile.mockRejectedValueOnce(failure());
    const res = response();
    await callback(request(), res as unknown as NextApiResponse);
    expect(res.redirect).toHaveBeenCalledOnce();
    safeOutput(res);
  });
});

it.each([
  [new HttpError({ statusCode: 401, message: secrets[5], data: { private: secrets[2] } }), 401],
  [Object.assign(new Error(secrets[5]), { name: "TRPCError", code: "TOO_MANY_REQUESTS" }), 429],
  [new Error(ErrorCode.NoAvailableUsersFound), 409],
  [new SyntaxError(ErrorCode.NoAvailableUsersFound), 500],
  [
    new TracedError(Object.assign(new Error(secrets[5]), { name: "TRPCError", code: "TOO_MANY_REQUESTS" }), {
      traceId: "test",
      spanId: "test",
      operation: "test",
    }),
    500,
  ],
  [
    new TracedError(new HttpError({ statusCode: 401, message: secrets[5] }), {
      traceId: "test",
      spanId: "test",
      operation: "test",
    }),
    401,
  ],
  [new ErrorWithCode(ErrorCode.NoAvailableUsersFound, secrets[5], { private: secrets[2] }), 409],
  [{ name: "ZodError", issues: [{ message: secrets[5] }] }, 400],
  [Object.assign(new Error(secrets[5]), { code: "P2025" }), 404],
  [z.object({ code: z.string() }).safeParse({ code: {} }).error, 400],
] as const)("retains safe-mode status mapping for %s", async (error, status) => {
  const res = response();
  await defaultResponder(
    async () => {
      throw error;
    },
    "/test/callback",
    { sensitiveRequest: true }
  )(request(), res as unknown as NextApiResponse);
  expect(res.status).toHaveBeenCalledWith(status);
  safeOutput(res);
});
