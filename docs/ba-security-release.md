# Booking security release checks

The security patch retains public booking behavior while checking the signed-in user before cached account reads and cache invalidation. Cron jobs require nonblank configured credentials and retain their existing raw-key or bearer credential formats.

## Candidate build

Run the manual `image` workflow on the reviewed commit with `promote=false`. It publishes a candidate `sha-<commit>` tag; the tag is not evidence of verification. The subsequent no-network gate resolves the exact build digest and checks Node/Next/Sharp/librsvg versions, native SVG conversion, every installed Next/Sharp package copy and every JSON Server Action manifest. Missing or unknown metadata fails the gate without printing action IDs or generated keys. Only a successful gate permits optional stable promotion by digest. The workflow does not deploy Railway.

Build with `--platform linux/amd64` for the Railway candidate. Every stage uses that target platform so native dependencies and the runtime agree; an arm64 workstation must emulate amd64 for the build. Record the image architecture and test the native dependencies inside the resulting image.

## Release evidence

1. Record the active provider deployment and image digest for rollback. Public BUILD_ID and JavaScript matches corroborate an image but do not prove the backend digest or configuration.
2. Confirm the exact candidate's image gate and isolated HTTP refusal checks pass. Use disposable configuration and no external network. Never exercise cron jobs against customer data as a security test.
3. Verify runtime cron secrets are configured and are not public example values. Do not print secret values. Inventory real schedulers before rotation.
4. Set a fresh Server Action encryption key only at runtime, shared across replicas; rebuild-time injection embeds it in the public image. Restart replicas to apply the cached runtime key. This key does not replace action authentication and does not rotate Next preview keys.
5. Verify custom and provider-generated ingress after release, including anonymous private-page redirects and invalid-credential refusals. Confirm the active provider image and retain the prior digest.

No schema migrations are added. The inherited startup script still runs existing migrations and app-store seeding, so test that script only against a disposable database before release. Repository tests and a successful image build do not establish production completion.
