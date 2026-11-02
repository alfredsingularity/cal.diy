function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

export function getEnrichmentFailureDiagnostic(error: unknown) {
  const failure = record(error);
  const response = record(failure?.response);
  const details = record(record(response?.data)?.error);
  const providerReason = Array.isArray(details?.errors) ? record(details.errors[0])?.reason : undefined;
  let reason = "UNKNOWN";
  if (providerReason === "rateLimitExceeded" || providerReason === "userRateLimitExceeded") {
    reason = providerReason;
  } else if (
    failure?.code === "ETIMEDOUT" ||
    failure?.code === "ESOCKETTIMEDOUT" ||
    failure?.code === "ECONNABORTED" ||
    failure?.name === "TimeoutError" ||
    failure?.name === "AbortError"
  ) {
    reason = "TIMEOUT";
  }

  const status = response?.status;
  return {
    stage: "meet_link_enrichment",
    ...(typeof status === "number" && Number.isInteger(status) && status >= 400 && status <= 599
      ? { status }
      : {}),
    reason,
  };
}
