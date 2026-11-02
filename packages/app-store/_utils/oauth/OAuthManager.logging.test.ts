import { inspect } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const logs = vi.hoisted(() => vi.fn());
vi.mock("@calcom/lib/logger", () => {
  const logger = { debug: logs, info: logs, error: logs, getSubLogger: () => logger };
  return { default: logger };
});

import { AxiosLikeResponseToFetchResponse } from "./AxiosLikeResponseToFetchResponse";
import { getTokenObjectFromCredential } from "./getTokenObjectFromCredential";
import { OAuthManager } from "./OAuthManager";

const secrets = ["synthetic-access-secret", "synthetic-refresh-secret", "synthetic-provider-secret"];
function manager(overrides: Partial<ConstructorParameters<typeof OAuthManager>[0]> = {}) {
  return new OAuthManager({
    appSlug: "google-calendar",
    resourceOwner: { id: 1, type: "user" },
    currentTokenObject: { access_token: secrets[0], refresh_token: secrets[1] },
    credentialSyncVariables: {
      APP_CREDENTIAL_SHARING_ENABLED: false,
      CREDENTIAL_SYNC_SECRET: secrets[2],
      CREDENTIAL_SYNC_SECRET_HEADER_NAME: "x-sync-key",
      CREDENTIAL_SYNC_ENDPOINT: "https://example.test/sync",
    },
    fetchNewTokenObject: async () => Response.json({ access_token: secrets[0] }),
    updateTokenObject: async () => {},
    isTokenObjectUnusable: async () => null,
    isAccessTokenUnusable: async () => null,
    invalidateTokenObject: async () => {},
    expireAccessToken: async () => {},
    autoCheckTokenExpiryOnRequest: false,
    ...overrides,
  });
}
function safeLogs() {
  expect(logs).toHaveBeenCalled();
  for (const secret of secrets) expect(inspect(logs.mock.calls, { depth: null })).not.toContain(secret);
}
beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllEnvs());

describe.each(["production", "development"])("OAuth diagnostics in %s", (environment) => {
  beforeEach(() => vi.stubEnv("NODE_ENV", environment));

  it.each([
    false,
    true,
  ])("redacts refresh errors (Error-derived: %s) without changing them", async (asError) => {
    const error = Object.assign(asError ? new Error(secrets[2]) : { message: secrets[2] }, {
      code: 403,
      config: { headers: { Authorization: `Bearer ${secrets[0]}` }, body: secrets[1] },
    });
    const before = inspect(error);
    await expect(
      manager({
        fetchNewTokenObject: async () => {
          throw error;
        },
      }).getTokenObjectOrFetch()
    ).rejects.toThrow(asError ? secrets[2] : "UNKNOWN_ERROR");
    expect(inspect(error)).toBe(before);
    safeLogs();
  });

  it("rejects malformed token responses without logging their still-valid secrets", async () => {
    const update = vi.fn();
    await expect(
      manager({
        fetchNewTokenObject: async () =>
          Response.json({ access_token: secrets[0], refresh_token: secrets[1], expires_in: secrets[2] }),
        updateTokenObject: update,
      }).getTokenObjectOrFetch()
    ).rejects.toThrow("Invalid token response");
    expect(update).not.toHaveBeenCalled();
    safeLogs();
  });

  it("persists refreshed tokens and retains the original refresh token", async () => {
    const update = vi.fn();
    await manager({ updateTokenObject: update }).getTokenObjectOrFetch();
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ access_token: secrets[0], refresh_token: secrets[1] })
    );
    safeLogs();
  });

  it("does not log the Google custom-fetch response or its error text", async () => {
    const auth = manager();
    const result = await auth.request(
      async () =>
        new AxiosLikeResponseToFetchResponse({
          status: 200,
          statusText: "OK",
          data: { privateData: secrets[2] },
        })
    );
    expect(result.json).toEqual({ privateData: secrets[2] });
    await expect(
      auth.request(async () => {
        throw new Error(secrets[2]);
      })
    ).rejects.toThrow(secrets[2]);
    safeLogs();
  });

  it.each([
    "request",
    "requestRaw",
  ] as const)("keeps %s transport headers while omitting request and response payloads", async (method) => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ privateData: secrets[2] }));
    try {
      await manager()[method]({
        url: `https://example.test/?private=${secrets[1]}`,
        options: { headers: { "x-private": secrets[2] } },
      });
      expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Bearer ${secrets[0]}`,
            "x-private": secrets[2],
          }),
        })
      );
      safeLogs();
    } finally {
      fetch.mockRestore();
    }
  });
});

it("keeps valid stored credentials intact and rejects malformed keys with a bounded diagnostic", () => {
  const key = { access_token: secrets[0], refresh_token: secrets[1] };
  expect(getTokenObjectFromCredential({ id: 1, key })).toEqual(key);
  expect(() => getTokenObjectFromCredential({ id: 1, key: { ...key, expires_in: secrets[2] } })).toThrow(
    /^Could not parse credential\.key$/
  );
  safeLogs();
});
