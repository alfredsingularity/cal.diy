import { getCalendarErrorDiagnostic } from "@calcom/lib/getCalendarErrorDiagnostic";

export function getEnrichmentFailureDiagnostic(error: unknown) {
  return { stage: "meet_link_enrichment", ...getCalendarErrorDiagnostic(error) };
}
