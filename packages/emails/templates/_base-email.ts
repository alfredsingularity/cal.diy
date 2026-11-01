import process from "node:process";
import dayjs from "@calcom/dayjs";
import { FeaturesRepository } from "@calcom/features/flags/features.repository";
import { createEmailTransport, emailFailureDiagnostic } from "@calcom/lib/emailTransport";
import isSmsCalEmail from "@calcom/lib/isSmsCalEmail";
import { serverConfig } from "@calcom/lib/serverConfig";
import { setTestEmail } from "@calcom/lib/testEmails";
import { prisma } from "@calcom/prisma";
import { decodeHTML } from "entities";
import { z } from "zod";
import { sanitizeDisplayName } from "../lib/sanitizeDisplayName";

export default class BaseEmail {
  name = "";

  protected getTimezone() {
    return "";
  }

  protected getLocale(): string {
    return "";
  }

  protected getFormattedRecipientTime({ time, format }: { time: string; format: string }) {
    return dayjs(time).tz(this.getTimezone()).locale(this.getLocale()).format(format);
  }

  protected async getNodeMailerPayload(): Promise<Record<string, unknown>> {
    return {};
  }
  public async sendEmail() {
    const featuresRepository = new FeaturesRepository(prisma);
    const emailsDisabled = await featuresRepository.checkIfFeatureIsEnabledGlobally("emails");
    /** If email kill switch exists and is active, we prevent emails being sent. */
    if (emailsDisabled) {
      console.warn("Skipped Sending Email due to active Kill Switch");
      return new Promise((r) => r("Skipped Sending Email due to active Kill Switch"));
    }

    if (process.env.INTEGRATION_TEST_MODE === "true") {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      //@ts-expect-error
      setTestEmail(await this.getNodeMailerPayload());
      console.log(
        "Skipped Sending Email as process.env.NEXT_PUBLIC_UNIT_TESTS is set. Emails are available in globalThis.testEmails"
      );
      return new Promise((r) => r("Skipped sendEmail for Unit Tests"));
    }

    const payload = await this.getNodeMailerPayload();

    const from = "from" in payload ? (payload.from as string) : "";
    const to = "to" in payload ? (payload.to as string) : "";

    if (isSmsCalEmail(to)) {
      return { status: "skipped" as const, reason: "SMS_ADDRESS" };
    }

    const sanitizedFrom = sanitizeDisplayName(from);
    const sanitizedTo = sanitizeDisplayName(to);

    const parseSubject = z.string().safeParse(payload?.subject);
    const payloadWithUnEscapedSubject = {
      headers: this.getMailerOptions().headers,
      ...payload,
      ...{
        from: sanitizedFrom,
        to: sanitizedTo,
      },
      ...(parseSubject.success && { subject: decodeHTML(parseSubject.data) }),
    };
    try {
      await createEmailTransport(this.getMailerOptions().transport).sendMail(payloadWithUnEscapedSubject);
      return { status: "accepted" as const };
    } catch (error) {
      this.printNodeMailerError(error);
      // Booking/calendar creation may already have succeeded. Report mail failure
      // without prompting a retry of the booking and possibly creating duplicates.
      return { status: "failed" as const, ...emailFailureDiagnostic(error) };
    }
  }
  protected getMailerOptions() {
    return {
      transport: serverConfig.transport,
      from: serverConfig.from,
      headers: serverConfig.headers,
    };
  }
  protected printNodeMailerError(error: unknown): void {
    /** Don't clog the logs with unsent emails in E2E */
    if (process.env.NEXT_PUBLIC_IS_E2E) return;
    console.error("EMAIL_DELIVERY_FAILED", emailFailureDiagnostic(error));
  }
}
