// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});
function configure() {
  vi.stubEnv("MAILGUN_DOMAIN", "mail.example.com");
  vi.stubEnv("MAILGUN_API_KEY", "synthetic-key");
  vi.stubEnv("MAILGUN_REGION", "US");
  vi.stubEnv("EMAIL_SERVER_HOST", "smtp.sendgrid.net");
}
describe("email transport selection", () => {
  it("passes the Mailgun transport instance intact and suppresses SMTP-specific headers", async () => {
    configure();
    vi.stubEnv("RESEND_API_KEY", "synthetic-older-provider");
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      Response.json({ id: "queued-id", message: "Queued" })
    );
    vi.stubGlobal("fetch", fetchMock);
    const { serverConfig } = await import("./serverConfig");
    const { createEmailTransport } = await import("./emailTransport");
    expect(serverConfig.headers).toBeUndefined();
    await createEmailTransport().sendMail({ from: "from@example.com", to: "to@example.com", text: "test" });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.mailgun.net/v3/mail.example.com/messages.mime");
  });
  it.each([
    ["MAILGUN_DOMAIN", "https://evil.example/path"],
    ["MAILGUN_API_KEY", ""],
    ["MAILGUN_REGION", "other"],
    ["MAILGUN_DOMAIN", ""],
  ])("fails closed for invalid %s", async (name, value) => {
    configure();
    vi.stubEnv(name, value);
    await expect(import("./serverConfig")).rejects.toMatchObject({ reason: "MAILGUN_CONFIG_INVALID" });
  });
  it("fails closed for incomplete Mailgun configuration despite an SMTP URL", async () => {
    vi.stubEnv("MAILGUN_DOMAIN", "mail.example.com");
    vi.stubEnv("MAILGUN_API_KEY", undefined);
    vi.stubEnv("MAILGUN_REGION", undefined);
    vi.stubEnv("EMAIL_SERVER", "smtp://localhost:1025");
    await expect(import("./serverConfig")).rejects.toMatchObject({ reason: "MAILGUN_CONFIG_INVALID" });
  });
  it("keeps existing SMTP URL configuration when Mailgun is absent", async () => {
    for (const name of ["MAILGUN_DOMAIN", "MAILGUN_API_KEY", "MAILGUN_REGION", "RESEND_API_KEY"])
      vi.stubEnv(name, undefined);
    vi.stubEnv("EMAIL_SERVER", "smtp://localhost:1025");
    const { serverConfig } = await import("./serverConfig");
    expect(serverConfig.transport).toBe("smtp://localhost:1025");
  });
});
