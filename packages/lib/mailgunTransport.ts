import type { Transport } from "nodemailer";
import type MailMessage from "nodemailer/lib/mailer/mail-message";
import type MimeNode from "nodemailer/lib/mime-node";
import { ErrorCode } from "./errorCodes";
import { ErrorWithCode } from "./errors";

const MAILGUN_TIMEOUT_MS = 15_000;
// Leave multipart/envelope overhead below Mailgun's 25 MB limit.
const MAX_MIME_BYTES = 24_000_000;
const MAX_RESPONSE_BYTES = 16_384;
type Failure =
  | "MAILGUN_CONFIG_INVALID"
  | "MAILGUN_RAW_INPUT_UNSUPPORTED"
  | "MAILGUN_INVALID_ENVELOPE"
  | "MAILGUN_MESSAGE_TOO_LARGE"
  | "MAILGUN_TIMEOUT"
  | "MAILGUN_HTTP_REJECTED"
  | "MAILGUN_INVALID_RESPONSE"
  | "MAILGUN_REQUEST_FAILED";

class MailgunTransportError extends ErrorWithCode {
  constructor(
    public readonly reason: Failure,
    public readonly status?: number
  ) {
    super(ErrorCode.InternalServerError, "Email transport failed");
  }
}

type SentInfo = {
  envelope: MimeNode.Envelope;
  accepted: string[];
  rejected: string[];
  messageId: string;
  response: string;
};

class MailgunTransport implements Transport<SentInfo | undefined> {
  name = "Mailgun HTTPS";
  version = "1.0.0";
  private readonly endpoint: string;
  private readonly authorization: string;

  constructor({ domain, apiKey, region }: { domain?: string; apiKey?: string; region?: string }) {
    if (
      !domain ||
      domain.length > 253 ||
      !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(domain) ||
      !apiKey ||
      !/^[\x21-\x7e]{1,512}$/.test(apiKey) ||
      (region !== "US" && region !== "EU")
    ) {
      throw new MailgunTransportError("MAILGUN_CONFIG_INVALID");
    }
    const host = region === "EU" ? "api.eu.mailgun.net" : "api.mailgun.net";
    this.endpoint = `https://${host}/v3/${domain.toLowerCase()}/messages.mime`;
    this.authorization = `Basic ${Buffer.from(`api:${apiKey}`).toString("base64")}`;
  }

  send(
    mail: MailMessage<SentInfo | undefined>,
    callback: (error: Error | null, info: SentInfo | undefined) => void
  ) {
    this.deliver(mail).then(
      (info) => callback(null, info),
      (error) => callback(error, undefined)
    );
  }

  private async deliver(mail: MailMessage<SentInfo | undefined>): Promise<SentInfo> {
    // These callers use Nodemailer's MIME composer. Caller-supplied raw bytes
    // bypass its Bcc stripping and cannot safely share this transport contract.
    if (mail.data.raw) throw new MailgunTransportError("MAILGUN_RAW_INPUT_UNSUPPORTED");
    const envelope = mail.message.getEnvelope();
    if (
      !envelope.to.length ||
      envelope.to.length > 1000 ||
      envelope.to.some((to) => !to || Buffer.byteLength(to) > 320 || /[\r\n]/.test(to))
    ) {
      throw new MailgunTransportError("MAILGUN_INVALID_ENVELOPE");
    }
    mail.message.setHeader("Bcc", "");
    const controller = new AbortController();
    const stream = mail.message.createReadStream();
    const abortStream = () => stream.destroy(new MailgunTransportError("MAILGUN_TIMEOUT"));
    controller.signal.addEventListener("abort", abortStream, { once: true });
    const timeout = setTimeout(() => controller.abort(), MAILGUN_TIMEOUT_MS);
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of stream) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += bytes.length;
        if (size > MAX_MIME_BYTES) throw new MailgunTransportError("MAILGUN_MESSAGE_TOO_LARGE");
        chunks.push(bytes);
      }
      const form = new FormData();
      for (const recipient of envelope.to) form.append("to", recipient);
      form.append(
        "message",
        new Blob([new Uint8Array(Buffer.concat(chunks))], { type: "message/rfc822" }),
        "message.eml"
      );
      for (const option of ["o:tracking", "o:tracking-clicks", "o:tracking-opens"]) form.append(option, "no");
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: { Authorization: this.authorization },
        body: form,
        signal: controller.signal,
        redirect: "error",
      });
      if (response.status !== 200) {
        void response.body?.cancel().catch(() => {});
        throw new MailgunTransportError("MAILGUN_HTTP_REJECTED", response.status);
      }
      const reader = response.body?.getReader();
      if (!reader) throw new MailgunTransportError("MAILGUN_INVALID_RESPONSE");
      controller.signal.addEventListener(
        "abort",
        () => {
          void reader.cancel().catch(() => {});
        },
        { once: true }
      );
      const parts: Uint8Array[] = [];
      let responseSize = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        responseSize += value.length;
        if (responseSize > MAX_RESPONSE_BYTES) {
          void reader.cancel().catch(() => {});
          throw new MailgunTransportError("MAILGUN_INVALID_RESPONSE");
        }
        parts.push(value);
      }
      if (controller.signal.aborted) throw new MailgunTransportError("MAILGUN_TIMEOUT");
      let result: unknown;
      try {
        result = JSON.parse(Buffer.concat(parts).toString("utf8"));
      } catch {
        throw new MailgunTransportError("MAILGUN_INVALID_RESPONSE");
      }
      if (
        !result ||
        typeof result !== "object" ||
        !("id" in result) ||
        typeof result.id !== "string" ||
        !result.id.trim() ||
        result.id.length > 512 ||
        /[\r\n]/.test(result.id) ||
        !("message" in result) ||
        typeof result.message !== "string" ||
        !result.message.trim()
      ) {
        throw new MailgunTransportError("MAILGUN_INVALID_RESPONSE");
      }
      return {
        envelope,
        accepted: envelope.to,
        rejected: [],
        messageId: result.id,
        response: "Mailgun accepted message for delivery",
      };
    } catch (error) {
      if (controller.signal.aborted) throw new MailgunTransportError("MAILGUN_TIMEOUT");
      if (error instanceof MailgunTransportError) throw error;
      throw new MailgunTransportError("MAILGUN_REQUEST_FAILED");
    } finally {
      clearTimeout(timeout);
      controller.signal.removeEventListener("abort", abortStream);
      stream.destroy();
    }
  }
}

export { MAILGUN_TIMEOUT_MS, MAX_MIME_BYTES, MailgunTransport, MailgunTransportError };
