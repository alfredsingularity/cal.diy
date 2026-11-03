# Temporary Google grant-renewal isolation

This gate pauses public booking, cancellation, rescheduling, calendar reads and background HTTP tasks during an operator-controlled Google grant renewal. It does not revoke tokens, migrate credentials or establish that previous requests have drained.

Runtime configuration (no build arguments):

- `GOOGLE_RENEWAL_MAINTENANCE=1` enables isolation. Absent, empty or `0` leaves it off. Other nonempty values keep the application closed and deny Google consent.
- `GOOGLE_RENEWAL_OWNER_USER_ID` must be the expected positive numeric user ID. While enabled, missing/invalid configuration denies consent. Google entry/callback additionally require that user's valid NextAuth session, without impersonation, and the existing `NEXTAUTH_SECRET`.

Both variables pass through the web start task. Never store session cookies, authorization codes or provider tokens in these settings or logs.

Denied requests receive a fixed English/German/Italian 503 message, `Cache-Control: no-store`, `Retry-After: 60`, and `X-Cal-Renewal-Maintenance: 1`. The only exceptions are password login/error pages; GET providers, CSRF and session; POST credentials callback; the exact Google GET add/callback routes; immutable Next assets and specific login font/favicon files. Google SSO, signup, dashboard, RPC and dynamic images remain unavailable. Existing config redirects can run before proxy; their application targets remain gated. Normal-off proxy behavior is preserved for its former route set.

Next normalizes some alternate URLs before proxy runs. Requests marked by Next as data requests are allowed only for GET/HEAD login/error pages and GET providers/CSRF/session. All other data aliases are denied before the allowlist, including the password POST endpoint and Google add/callback even for the valid owner. For `.rsc` and `.segments` paths, proxy sets an internal routing marker while isolation is enabled; the first `beforeFiles` rewrites still see those suffixes and route to `/api/renewal-maintenance-unavailable`. That endpoint always returns the same fixed 503 without database or provider work, including when requested directly. Client marker values are overwritten while enabled and removed via request-header overrides while off. No global Next URL-normalization setting changes. Canonical browser RSC requests using headers on normal paths are unaffected.

The signed-in owner can open `/api/integrations/google_calendar/add` with the existing signed-state input, follow the visible JSON consent URL in their browser, and return to `/api/integrations/googlecalendar/callback`. Do not save or print that URL. The usual installed-app landing remains closed: seeing maintenance after consent does not establish callback success or failure. Verify the new credential through the separately reviewed renewal procedure before retrying.

Before revoking any grant, qualify the built image with the flag absent/on/off, exact method/owner checks, password login, health-check Host, signed-state consent and both ingress hosts. Verify the old deployment is stopped, inspect pending work and reconcile requests crossing the transition. A new healthy replica or a fixed wait alone does not prove drain. Root-level external workers and provider requests already sent are outside this request gate.

Keep isolation enabled until fresh consent, guarded credential migration and identity/reference checks succeed. Reopen using the same qualified image with the flag off, verify the paused replica stopped, and perform the planned old-reference cancellation check. Revoked Google grants cannot be recovered by restoring database tokens. Restore only recorded prior operational settings; do not automatically restart disabled cron jobs.
