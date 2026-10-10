# Docker and Coolify deployment

The GitHub Actions workflow follows the Splitty and CloudCertify pipeline:
pull requests targeting `main` run tests and type checking in **PR Checks**.
After merge, a native ARM64 Docker build compiles and packages the API,
GitHub Container Registry receives the image, and an authenticated webhook
queues a Coolify deployment. Docker builds do not run tests or type checking.
Pushes to `main` that change build inputs trigger it. You can also run the
workflow manually on `main`.

Make **Tests and types** a required check in the `main` branch rules to prevent
merging a pull request with failing tests. The PR workflow runs on every pull
request targeting `main`, including documentation-only changes, so the required
check is never skipped by path filters. Direct pushes to `main` do not run these
PR checks.

Published images:

- `ghcr.io/sn0wye/caho-backend:latest` for automatic deployments.
- `ghcr.io/sn0wye/caho-backend:<full-commit-sha>` for a specific revision.

The workflow derives the lowercase image name from the repository, so forks
publish under their own owner. It targets `linux/arm64`, matching the reference
projects. For an x86 VPS, change the runner to `ubuntu-24.04` and the platform
to `linux/amd64`.

## Configure Coolify

1. Create PostgreSQL 16 and Redis resources, or use existing instances.
   Put them on a network reachable by the API. Use their internal connection
   URLs and keep their storage persistent.
2. Configure Redis with `notify-keyspace-events Ex`. The API also checks this
   setting at startup and attempts `CONFIG SET` if needed. Its Redis user needs
   access to commands used by ioredis, Pub/Sub, and expired-key subscriptions.
3. Create a **Docker Image** application. Set image name to
   `ghcr.io/sn0wye/caho-backend`, tag to `latest`, and Ports Exposes to `8080`.
   Configure the API's HTTPS domain and route it to port `8080`.
4. Add the runtime environment variables listed below. The image excludes
   `.env` files, so Coolify must supply them.
5. Use `/ping` on port `8080` as the HTTP health check. Allow at least 60 seconds
   for startup migrations. The image also contains a Docker health check.
6. For a private GHCR package, authenticate the deployment server to `ghcr.io`
   with a GitHub token that has `read:packages` and access to this package.
   Alternatively, make the package public after its first publication.
7. Enable Coolify API access. Create a team API token with `deploy` permission.
   Copy this application's **Deploy Webhook (auth required)** from Webhooks.

The container runs `node dist/migrate.js` before starting the API. This applies
pending migrations and idempotently seeds the base card pack. A failure stops
startup. No Coolify pre-deployment command is required. Keep one API replica;
parallel migration runners are not coordinated. Schema changes must remain
compatible with the previous API during replacement. Rolling back an image
does not reverse database migrations.

The local `docker-compose.yml` remains a development stack. Its API command
skips startup migrations because the `caho-migrate` dependency already ran them.

## Runtime environment

Set these values in the Coolify application's environment:

```dotenv
NODE_ENV=production
PORT=8080
COOKIE_SECRET=<random-production-secret>
PASSWORD_SECRET=<random-production-secret>
DATABASE_URL=postgres://<user>:<url-encoded-password>@<postgres-host>:5432/<database>
REDIS_URL=redis://<redis-user>:<url-encoded-password>@<redis-host>:6379/0
GITHUB_CLIENT_ID=<github-oauth-client-id>
GITHUB_CLIENT_SECRET=<github-oauth-client-secret>
GOOGLE_CLIENT_ID=<google-oauth-client-id>
GOOGLE_CLIENT_SECRET=<google-oauth-client-secret>
GOOGLE_REDIRECT_URL=https://<api-domain>/auth/google/callback
FRONTEND_AUTH_REDIRECT_URL=https://caho.com.br/dashboard
COOKIE_DOMAIN=caho.com.br
```

OAuth values are required by environment validation even when users only sign
in with passwords. Configure callback URLs in both OAuth providers:
`https://<api-domain>/auth/github/callback` on the GitHub OAuth app and
`https://<api-domain>/auth/google/callback` on the Google client. Use `https`
in `GOOGLE_REDIRECT_URL`; Google rejects a redirect URI that differs from the
registered one.

The OAuth callback sets the session cookie on the API's response.
`COOKIE_DOMAIN` must be the parent domain shared with the frontend, so the
frontend's server receives that cookie and sees the user as signed in. Without
it, the cookie stays on the API host and OAuth sign-in returns to `/login`. Production
CORS currently permits `https://caho.com.br`; another frontend domain requires
updating `src/app.ts` before deployment.

`SEQ_URL` is optional. Omit it or leave it empty to disable Seq; development
needs no Seq server or credentials. Set `SEQ_API_KEY` only when the chosen
server requires authentication. PostgreSQL, Redis, and Seq are separate
resources, not part of the CAHO image.

Redis deadline keys use `caho:round:<round-id>:play` and
`caho:round:<round-id>:judge`. Room and player Pub/Sub channels also start
with `caho:`; WebSocket clients still use the same room codes and player IDs.
An ACL can restrict key access to `~caho:*` and application channels to
`&caho:*`. Also permit the Redis-owned `&__keyevent@0__:expired` channel:
Redis broadcasts expiry events for the database, and CAHO ignores foreign keys.
Configure `notify-keyspace-events Ex` on the server to avoid granting the
application `CONFIG SET`.

Deploy this prefix change with all API instances together, because the prior
version uses different keys and channels. Persisted PostgreSQL deadlines
remain the startup reconciliation backstop; legacy unprefixed timer keys
expire naturally and are ignored by the new version.

## GitHub secrets and first deployment

Add these repository secrets under **Settings > Secrets and variables > Actions**:

- `COOLIFY_WEBHOOK`: the application's authenticated deploy webhook URL.
- `COOLIFY_TOKEN`: the Coolify deploy token.

`GITHUB_TOKEN` is supplied by Actions with `packages: write`; no registry push
secret is needed. If package publication is blocked, check the repository's
Actions policy and the package's repository access.

After merging to `main`, run **Build and Push Docker Image**. Configure private
registry access after the first image exists, then deploy from Coolify or rerun
the workflow. Inspect Coolify deployment logs and confirm `/ping` returns HTTP 200. A successful webhook response only confirms the deployment was queued.

To roll back, set the Coolify image tag to an earlier full commit SHA and
redeploy. Restore `latest` to resume automatic image updates.

## Local verification

The default Compose stack starts without Seq. To opt into local Seq logging:

```sh
rtk proxy env SEQ_URL=http://seq:80 docker compose --profile observability up -d
```

```sh
rtk pnpm install --frozen-lockfile
rtk pnpm exec dotenv -e .env.test -- vitest run
rtk pnpm typecheck
rtk docker build --platform linux/arm64 -t caho-api:local .
rtk docker compose up -d
rtk proxy curl --fail http://localhost:8080/ping
```

## Ampere A1 runtime and CI efficiency

The deployment targets one API instance on an Ampere A1 ARM64 server with
24 GB RAM. The image starts one Node process. Logging writes structured JSON directly to stdout in every environment.
Production SQL query logging is disabled to avoid serializing every query and
its parameters. Seq shipping remains available when `SEQ_URL` is configured.

The runtime contains production dependencies and compiled JavaScript. Unused
Faker, Upstash Redis, ioredis-mock, MySQL, and direct dotenv dependencies were
removed. Tests, tsup, Vitest, Drizzle Kit, the package store, and test environment
files are excluded from the final image. TypeScript remains a declared peer of
the environment library. The health check uses Alpine's existing BusyBox
`wget`, so curl and its extra packages are unnecessary.

CI uses `ubuntu-24.04-arm` and builds only `linux/arm64`, with no QEMU. PR checks
cache the pnpm store and run tests and `tsc --noEmit` before merge. The separate
publication workflow builds the image without repeating these checks.
`pnpm fetch` is a normal
cached layer keyed by the lockfile and workspace settings; both installs run
offline afterward. This survives GitHub's ephemeral runners, where BuildKit
cache mounts are not exported by the standard GitHub Actions cache. The cache
has an explicit ARM64 scope. Source changes rerun compilation;
migration-only changes reuse the compiled application. Declaration generation
is disabled for this private server, with PR CI checking types instead.
Test files and `.env.test` are excluded from the Docker build context. Changes
only to test specs, Vitest configuration, or `.env.test` do not trigger image
publication.

Local ARM64 verification on 2026-10-10 found:

- Image size decreased from 233 to 208 MiB, about 11%.
- Runtime `node_modules` decreased from 116 to 76 MiB, about 34%.
- A fully cached Docker build took 0.35 seconds, excluding CI cache transfer,
  checkout, image upload, and the deployment request.
- With each API limited to one CPU and 256 MiB for the comparison, 100,000
  `/ping` requests at concurrency 16 completed without errors. Container CPU
  time decreased from 3.66 to 2.55 seconds. Throughput was roughly 27,300 versus
  28,500 requests/second. Afterward, Docker reported about 96 versus 56 MiB of
  memory use. These are local synthetic measurements, not Ampere A1 gameplay
  capacity estimates or peak memory guarantees.
- All 139 tests, type checking, migrations, repeat startup, the BusyBox health
  check, and native ARM64 Argon2 password hashing passed.

Keep Node's default heap and libuv thread pool initially. A smaller heap can
increase garbage collection CPU cost; a smaller thread pool can delay concurrent
password hashes. A container memory limit is a ceiling, not a reservation or
an optimization. Set any Coolify limit from observed peak memory with real game
traffic and concurrent sign-ins, leaving room for native Argon2 allocations,
buffers, and database connections. PostgreSQL and Redis need separate budgets.
Do not derive production player capacity from the `/ping` benchmark.

Coolify references:
[Docker Image](https://coolify.io/docs/applications/deployments/docker-image),
[deploy webhooks](https://coolify.io/docs/core/automation/deploy-webhooks).

Build references:
[pnpm Docker caching](https://pnpm.io/docker),
[GitHub Actions BuildKit cache behavior](https://docs.docker.com/build/ci/github-actions/cache/).


## Seq logs and traces

Set `SEQ_URL` to your existing Seq instance's base URL and `SEQ_API_KEY` to an
API key with ingest permission. The API sends logs through Pino and traces through
OTLP HTTP/protobuf to `<SEQ_URL>/ingest/otlp/v1/traces`. Seq must support trace
ingestion, available since Seq 2024.1. No collector is required. `trace_id` and
`span_id` on Pino events map to Seq's native trace and span fields.

```dotenv
SEQ_URL=https://seq.example.com
SEQ_API_KEY=<ingest-key>
LOG_LEVEL=info
OTEL_SERVICE_NAME=caho-backend
OTEL_TRACES_SAMPLER_ARG=1
OTEL_SDK_DISABLED=false
```

In Compose the Seq service listens on port 80; use `http://seq:80` from the API
container. From a host-run API use `http://localhost:5341`. The browser UI also
uses `http://localhost:5341`. Keep your existing production Seq resource and URL.

Traces cover HTTP routes, PostgreSQL, Redis, outbound OAuth fetches, Pub/Sub
publication and delivery, and Round expiry/reconciliation. Successful health
probes produce no request events or spans. Failures remain logged. Request events
include route templates, status and duration without query strings or bodies.
`x-request-id` on traced HTTP responses identifies the request in logs.

`OTEL_TRACES_SAMPLER_ARG` is the root trace sample ratio, 0 through 1. Default 1
records every root trace; valid incoming W3C trace context preserves its sampling
decision. Sampling does not suppress application logs. `OTEL_SDK_DISABLED=true`
disables tracing while keeping logs. Omit both Seq URL and an explicit traces
endpoint to run without telemetry export. `LOG_LEVEL=debug` enables detailed
presence, card-count, timer and Pub/Sub metadata logs. Keep `info` for normal use.

`OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` optionally overrides the full traces URL.
The override does not receive `SEQ_API_KEY`; use standard
`OTEL_EXPORTER_OTLP_TRACES_HEADERS` for collector authentication. Metrics and
OTEL log export are disabled to avoid duplicate ingestion.

During shutdown, the API closes HTTP/WS, PostgreSQL and Redis, flushes traces, then
flushes Seq logs. It allows ten seconds before forcing exit. Export failure events
write directly to stdout, so check container logs when Seq is unavailable.

See [logging audit](logging-audit.md) for keep/remove/add decisions and Seq queries.
Protocol references: [Seq tracing from Node.js](https://datalust.co/docs/tracing-from-nodejs),
[OpenTelemetry OTLP configuration](https://opentelemetry.io/docs/languages/sdk-configuration/otlp-exporter/).
