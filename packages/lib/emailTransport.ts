import { createTransport } from "nodemailer";
import { MailgunTransport, MailgunTransportError } from "./mailgunTransport";
import { serverConfig } from "./serverConfig";

export function createEmailTransport(transport = serverConfig.transport) {
  // Preserve a transport object's prototype methods and SMTP connection strings.
  if (transport instanceof MailgunTransport) return createTransport(transport);
  return createTransport(transport);
}

export function emailFailureDiagnostic(error: unknown) {
  return error instanceof MailgunTransportError
    ? { reason: error.reason, ...(error.status !== undefined && { statusCode: error.status }) }
    : { reason: "EMAIL_DELIVERY_FAILED" };
}
