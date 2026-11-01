// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BaseEmail from "../../../emails/templates/_base-email";
import sendVerificationRequest from "./sendVerificationRequest";

vi.mock("node:fs", () => ({ readFileSync: () => "<p>{{signin_url}}</p>" }));
vi.mock("@calcom/lib/constants", () => ({ APP_NAME: "Synthetic", WEBAPP_URL: "https://book.example.com" }));
vi.mock("@calcom/dayjs", () => ({ default: vi.fn() }));
vi.mock("@calcom/prisma", () => ({ prisma: {} }));
vi.mock("@calcom/features/flags/features.repository", () => ({
  FeaturesRepository: class {
    async checkIfFeatureIsEnabledGlobally() {
      return false;
    }
  },
}));
vi.mock("@calcom/lib/serverConfig", async () => {
  const { MailgunTransport } = await import("@calcom/lib/mailgunTransport");
  return {
    serverConfig: {
      transport: new MailgunTransport({ domain: "mail.example.com", apiKey: "synthetic-key", region: "EU" }),
      from: "from@example.com",
    },
  };
});
class BookingEmail extends BaseEmail {
  protected async getNodeMailerPayload() {
    return {
      from: "from@example.com",
      to: "to@example.com",
      subject: "private booking subject",
      text: "synthetic",
    };
  }
}
beforeEach(() => {
  vi.stubEnv("INTEGRATION_TEST_MODE", "false");
  vi.stubEnv("NEXT_PUBLIC_IS_E2E", "");
  vi.stubEnv("EMAIL_FROM", "from@example.com");
  vi.stubEnv("NEXTAUTH_URL", "https://book.example.com/api/auth");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("email callers", () => {
  it("reports booking delivery failure without rejecting an already-created booking or logging PII", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("private provider data", { status: 401 }))
    );
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(new BookingEmail().sendEmail()).resolves.toEqual({
      status: "failed",
      reason: "MAILGUN_HTTP_REJECTED",
      statusCode: 401,
    });
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/@|private|synthetic-key/);
    expect(log).toHaveBeenCalledTimes(1);
  });
  it("distinguishes provider acceptance from inbox delivery", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ id: "queued-id", message: "Queued" }))
    );
    await expect(new BookingEmail().sendEmail()).resolves.toEqual({ status: "accepted" });
  });
  it("awaits auth delivery and propagates a sanitized failure with the instance transport", async () => {
    let finish: (value: Response) => void = () => {};
    const started = Promise.withResolvers<void>();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
            started.resolve();
          })
      )
    );
    const request = sendVerificationRequest({
      identifier: "signin@example.com",
      url: "https://book.example.com/verify?token=synthetic",
    });
    const failure = expect(request).rejects.toMatchObject({ message: "Unable to send sign-in email" });
    let settled = false;
    void request.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      }
    );
    await started.promise;
    expect(settled).toBe(false);
    finish(new Response("private provider data", { status: 429 }));
    await failure;
  });
});
