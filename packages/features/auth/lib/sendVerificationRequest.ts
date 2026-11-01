import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { APP_NAME, WEBAPP_URL } from "@calcom/lib/constants";
import { createEmailTransport } from "@calcom/lib/emailTransport";
import { ErrorWithCode } from "@calcom/lib/errors";
import Handlebars from "handlebars";
import type { SendVerificationRequestParams } from "next-auth/providers/email";

const sendVerificationRequest = async ({
  identifier,
  url,
}: Pick<SendVerificationRequestParams, "identifier" | "url">) => {
  const emailsDir = path.resolve(process.cwd(), "..", "..", "packages/emails", "templates");
  const originalUrl = new URL(url);
  const webappUrl = new URL(process.env.NEXTAUTH_URL || WEBAPP_URL);
  if (originalUrl.origin !== webappUrl.origin) {
    url = url.replace(originalUrl.origin, webappUrl.origin);
  }
  const emailFile = readFileSync(path.join(emailsDir, "confirm-email.html"), {
    encoding: "utf8",
  });
  const emailTemplate = Handlebars.compile(emailFile);
  try {
    await createEmailTransport().sendMail({
      from: process.env.EMAIL_FROM || APP_NAME,
      to: identifier,
      subject: `Your sign-in link for ${APP_NAME}`,
      html: emailTemplate({
        base_url: WEBAPP_URL,
        signin_url: url,
        email: identifier,
      }),
    });
  } catch {
    throw ErrorWithCode.Factory.InternalServerError("Unable to send sign-in email");
  }
};

export default sendVerificationRequest;
