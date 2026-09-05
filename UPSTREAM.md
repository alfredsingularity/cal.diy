# ba-build

Business Automations' build branch of Cal.diy. Upstream `calcom/cal.diy` `main` at
commit `abffde336e744e15cf69626c10e436d6172bc406` (2026-09-04), plus:

- `.github/workflows/image.yml`: manual build for linux/amd64, pushed to
  `ghcr.io/alfredsingularity/cal.diy:sha-<12>` and, on `promote`, `:stable`.
- `Dockerfile`: four extra build arguments so the brand-neutral instance settings
  (`NEXT_PUBLIC_DISABLE_SIGNUP`, `NEXT_PUBLIC_APP_NAME`, `NEXT_PUBLIC_COMPANY_NAME`,
  `NEXT_PUBLIC_SUPPORT_MAIL_ADDRESS`) are inlined at build time like the others.

No secrets are baked: the build-time database is a throwaway service container and the
auth keys are placeholders; `scripts/start.sh` substitutes `NEXT_PUBLIC_WEBAPP_URL` at
start. Upgrade recipe: rebase this branch onto a newer upstream commit, update the SHA
above, run the workflow, redeploy, then promote.
