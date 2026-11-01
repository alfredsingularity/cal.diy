// @vitest-environment node
import { Readable } from "node:stream";
import nodemailer, { type SendMailOptions } from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAILGUN_TIMEOUT_MS, MAX_MIME_BYTES, MailgunTransport } from "./mailgunTransport";

const config = { domain: "mail.example.com", apiKey: "synthetic-domain-sending-key", region: "EU" as const };
const accepted = () => Response.json({ id: "<synthetic@provider.example>", message: "Queued. Thank you." });
const send = (payload: SendMailOptions = {}) =>
  nodemailer.createTransport(new MailgunTransport(config)).sendMail({
    from: "sender@example.com",
    to: "recipient@example.com",
    text: "Synthetic test",
    ...payload,
  });
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Mailgun MIME transport", () => {
  it.each([
    "EN confirmation",
    "DE Bestätigung für Größe",
    "IT conferma perché",
  ])("preserves %s REQUEST/CANCEL MIME and hidden envelope recipients", async (text) => {
    const fetchMock = vi.fn(async () => accepted());
    vi.stubGlobal("fetch", fetchMock);
    for (const method of ["REQUEST", "CANCEL"]) {
      const payload: SendMailOptions & { baseBoundary: string } = {
        from: '"Organizátor" <sender@example.com>',
        to: "recipient@example.com",
        cc: "cc@example.com",
        bcc: "hidden@example.com",
        replyTo: "reply@example.com",
        subject: text,
        text,
        html: `<p>${text}</p>`,
        date: new Date("2026-11-01T12:00:00Z"),
        messageId: "<fixed@example.com>",
        baseBoundary: "fixed-mime-boundary",
        icalEvent: {
          method,
          content: `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nMETHOD:${method}\r\nBEGIN:VEVENT\r\nUID:synthetic\r\nSUMMARY:${text}\r\nEND:VEVENT\r\nEND:VCALENDAR`,
        },
        attachments: [{ filename: "details.txt", content: "synthetic attachment" }],
      };
      const reference = await new MailComposer(payload).compile().build();
      await send(payload);
      const [url, request] = fetchMock.mock.calls.at(-1) as unknown as [string, RequestInit];
      expect(url).toBe("https://api.eu.mailgun.net/v3/mail.example.com/messages.mime");
      expect(request.redirect).toBe("error");
      const form = request.body as FormData;
      expect(form.getAll("to")).toEqual(["recipient@example.com", "cc@example.com", "hidden@example.com"]);
      for (const field of ["o:tracking", "o:tracking-clicks", "o:tracking-opens"])
        expect(form.get(field)).toBe("no");
      const mime = Buffer.from(await (form.get("message") as Blob).arrayBuffer());
      expect(mime).toEqual(reference);
      expect(mime.toString()).not.toMatch(/^Bcc:/im);
      expect(mime.toString()).toContain("Reply-To: reply@example.com");
      expect(mime.toString()).toMatch(new RegExp(`text/calendar;[^\\r\\n]*method=${method}`, "i"));
    }
  });
  it("uses the explicit recipient envelope, including Bcc, rather than reconstructing To headers", async () => {
    const mock = vi.fn(async () => accepted());
    vi.stubGlobal("fetch", mock);
    await send({
      envelope: { from: "sender@example.com", to: ["envelope@example.com", "hidden@example.com"] },
    });
    const request = mock.mock.calls[0] as unknown as [string, RequestInit];
    expect((request[1].body as FormData).getAll("to")).toEqual([
      "envelope@example.com",
      "hidden@example.com",
    ]);
  });
  it.each([401, 429, 500, 302])("rejects provider %s once without leaking its response", async (status) => {
    const mock = vi.fn(async () => new Response("private provider recipient data", { status }));
    vi.stubGlobal("fetch", mock);
    await expect(send()).rejects.toMatchObject({
      message: "Email transport failed",
      reason: "MAILGUN_HTTP_REJECTED",
      status,
    });
    expect(mock).toHaveBeenCalledTimes(1);
  });
  it.each([
    "not json",
    "{}",
    '{"id":"","message":"Queued"}',
  ])("rejects malformed acceptance %s", async (body) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(body, { headers: { "content-type": "application/json" } }))
    );
    await expect(send()).rejects.toMatchObject({ reason: "MAILGUN_INVALID_RESPONSE" });
  });
  it("bounds response size and sanitizes network failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("x".repeat(20_000)))
    );
    await expect(send()).rejects.toMatchObject({ reason: "MAILGUN_INVALID_RESPONSE" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("private-token-and-address");
      })
    );
    await expect(send()).rejects.toMatchObject({
      message: "Email transport failed",
      reason: "MAILGUN_REQUEST_FAILED",
    });
  });
  it("aborts an ambiguous request timeout without retry", async () => {
    vi.useFakeTimers();
    const mock = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new Error("private failure")), { once: true });
        })
    );
    vi.stubGlobal("fetch", mock);
    const result = expect(send()).rejects.toMatchObject({ reason: "MAILGUN_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(MAILGUN_TIMEOUT_MS + 1);
    await result;
    expect(mock).toHaveBeenCalledTimes(1);
  });
  it("rejects oversized MIME and raw input without contacting the provider", async () => {
    const mock = vi.fn();
    vi.stubGlobal("fetch", mock);
    await expect(
      send({ attachments: [{ content: Readable.from(Buffer.alloc(MAX_MIME_BYTES)) }] })
    ).rejects.toMatchObject({ reason: "MAILGUN_MESSAGE_TOO_LARGE" });
    await expect(send({ raw: "Bcc: hidden@example.com\r\n\r\nraw" })).rejects.toMatchObject({
      reason: "MAILGUN_RAW_INPUT_UNSUPPORTED",
    });
    expect(mock).not.toHaveBeenCalled();
  });
  it("bounds stalled MIME composition before any provider request", async () => {
    vi.useFakeTimers();
    const mock = vi.fn();
    vi.stubGlobal("fetch", mock);
    const input = new Readable({ read() {} });
    const result = expect(send({ attachments: [{ content: input }] })).rejects.toMatchObject({
      reason: "MAILGUN_TIMEOUT",
    });
    await vi.advanceTimersByTimeAsync(MAILGUN_TIMEOUT_MS + 1);
    await result;
    expect(mock).not.toHaveBeenCalled();
    input.destroy();
  });
  it("aborts a stalled successful response body within the same deadline", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const mock = vi.fn(async () => new Response(new ReadableStream({ start() {}, cancel })));
    vi.stubGlobal("fetch", mock);
    const result = expect(send()).rejects.toMatchObject({ reason: "MAILGUN_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(MAILGUN_TIMEOUT_MS + 1);
    await result;
    expect(mock).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
  });
  it("bounds envelope size before a provider request", async () => {
    const mock = vi.fn();
    vi.stubGlobal("fetch", mock);
    for (const to of [
      [`${"a".repeat(321)}@example.com`],
      Array.from({ length: 1001 }, (_, i) => `r${i}@example.com`),
    ]) {
      await expect(send({ envelope: { from: "sender@example.com", to } })).rejects.toMatchObject({
        reason: "MAILGUN_INVALID_ENVELOPE",
      });
    }
    expect(mock).not.toHaveBeenCalled();
  });
});
