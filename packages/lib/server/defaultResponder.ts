import process from "node:process";
import { getCalendarErrorDiagnostic } from "@calcom/lib/getCalendarErrorDiagnostic";
import type { TraceContext } from "@calcom/lib/tracing";
import { TracedError } from "@calcom/lib/tracing/error";
import { distributedTracing } from "@calcom/lib/tracing/factory";
import type { NextApiRequest, NextApiResponse } from "next";
import { ZodError } from "zod";
import { HttpError } from "../http-error";
import { safeStringify } from "../safeStringify";
import { getHttpStatusCode, getServerErrorFromUnknown, isPrismaError } from "./getServerErrorFromUnknown";
import { performance } from "./perfObserver";
import { getHTTPStatusCodeFromTRPCErrorLike, isTRPCErrorLike } from "./trpcErrorUtils";

export interface TracedRequest extends NextApiRequest {
  traceContext: TraceContext;
}

type Handle<T> = (req: TracedRequest, res: NextApiResponse) => Promise<T>;

function sensitiveRequestError(error: unknown): HttpError {
  const trpcStatus = isTRPCErrorLike(error) ? getHTTPStatusCodeFromTRPCErrorLike(error) : undefined;
  if (error instanceof TracedError) error = error.originalError;
  let statusCode = 500;
  if (trpcStatus !== undefined) {
    statusCode = trpcStatus;
  } else if (error instanceof HttpError) {
    statusCode = error.statusCode;
  } else if (
    error instanceof ZodError ||
    (error !== null && typeof error === "object" && "name" in error && error.name === "ZodError")
  ) {
    statusCode = 400;
  } else if (error instanceof SyntaxError) {
    statusCode = 500;
  } else if (isPrismaError(error)) {
    statusCode = error.code === "P2025" ? 404 : 400;
  } else if (error instanceof Error) {
    statusCode = getHttpStatusCode(error);
  }
  // Provider errors can retain token bodies in their cause, data, message and stack.
  return new HttpError({ statusCode, message: "Request failed" });
}

/** Allows us to get type inference from API handler responses */
export function defaultResponder<T>(
  f: Handle<T>,
  /** If set we will wrap the handle with sentry tracing */
  endpointRoute?: string,
  { sensitiveRequest = false }: { sensitiveRequest?: boolean } = {}
) {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    let ok = false;
    const operation = endpointRoute ? endpointRoute.replace(/^\//, "").replace(/\//g, "_") : "api_request";
    const diagnosticUrl = sensitiveRequest ? endpointRoute || "[sensitive request]" : req.url || "";
    const traceContext = distributedTracing.createTrace(operation, {
      meta: {
        method: req.method || "",
        url: diagnosticUrl,
      },
    });
    const tracingLogger = distributedTracing.getTracingLogger(traceContext);

    const tracedReq = req as TracedRequest;
    tracedReq.traceContext = traceContext;

    try {
      performance.mark("Start");

      let result: T | undefined;
      if (sensitiveRequest || process.env.NODE_ENV === "development" || !endpointRoute) {
        result = await f(tracedReq, res);
      } else {
        const { wrapApiHandlerWithSentry } = await import("@sentry/nextjs");
        result = await wrapApiHandlerWithSentry(f, endpointRoute)(tracedReq, res);
      }

      ok = true;
      if (result && !res.writableEnded) {
        res.setHeader("X-Trace-Id", traceContext.traceId);
        return res.json(result);
      }
    } catch (err) {
      tracingLogger.error(
        `${operation} request failed`,
        sensitiveRequest ? getCalendarErrorDiagnostic(err) : safeStringify(err)
      );
      const reportedError = sensitiveRequest ? sensitiveRequestError(err) : err;
      const tracedError = TracedError.createFromError(reportedError, traceContext);
      let error: HttpError;
      if (isTRPCErrorLike(reportedError)) {
        const statusCode = getHTTPStatusCodeFromTRPCErrorLike(reportedError);
        error = new HttpError({ statusCode, message: reportedError.message });
      } else {
        error = getServerErrorFromUnknown(tracedError);
      }
      // we don't want to report Bad Request errors to Sentry / console
      if (!(error.statusCode >= 400 && error.statusCode < 500)) {
        console.error(error);
        // Exception capture may attach the active OAuth request's code/state query.
        if (!sensitiveRequest) {
          const { captureException } = await import("@sentry/nextjs");
          captureException(tracedError);
        }
      }
      res.setHeader("X-Trace-Id", tracedError.traceId);
      return res
        .status(error.statusCode)
        .json({ message: error.message, url: error.url, method: error.method, data: error?.data || null });
    } finally {
      performance.mark("End");
      performance.measure(`[${ok ? "OK" : "ERROR"}][$1] ${req.method} '${diagnosticUrl}'`, "Start", "End");
    }
  };
}
