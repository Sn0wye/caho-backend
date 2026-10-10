# Deployment

## Build and run

Use Docker, PostgreSQL and Redis. Supply runtime variables from
[`.env.example`](../.env.example) through your environment or secret store.
Database and Redis URLs must be reachable from the API container.

```sh
rtk docker build -t caho-api:local .
rtk docker run --rm --env-file .env.production -p 8080:8080 caho-api:local
```

The image runs migrations and seeds the base card pack before starting the API.
A migration failure stops startup. Coordinate migration runners if using multiple
replicas. Rolling back the image does not reverse database migrations.

Redis needs `notify-keyspace-events Ex` for Round timers. The API checks this
setting at startup and attempts to enable it when permitted.

Check `/ping` for API liveness and `/readyz` for database/Redis readiness.

## OAuth and sessions

OAuth values are required by environment validation even when users only sign
in with passwords. Register `https://<api-domain>/auth/github/callback` on the
GitHub OAuth app and `https://<api-domain>/auth/google/callback` on the Google
client. `GOOGLE_REDIRECT_URL` must match the registered URI exactly, including
`https`.

The OAuth callback sets the session cookie on the API's response. Set
`COOKIE_DOMAIN` to the parent domain shared with the frontend so the frontend's
server receives that cookie. Without it, the cookie stays on the API host and
OAuth sign-in returns to `/login`. Production CORS allows one frontend origin,
set in `src/app.ts`; update it before deploying another frontend domain.

## Seq logs and traces

Set `SEQ_URL` to a reachable Seq base URL and `SEQ_API_KEY` to an ingest key
when authentication is required. Logs use Pino; traces use OTLP HTTP/protobuf
at `<SEQ_URL>/ingest/otlp/v1/traces`. Seq must support trace ingestion.

```dotenv
SEQ_URL=https://seq.example.com
SEQ_API_KEY=<ingest-key>
LOG_LEVEL=info
OTEL_SERVICE_NAME=caho-backend
OTEL_TRACES_SAMPLER_ARG=1
OTEL_SDK_DISABLED=false
```

Keep 100% root tracing initially. Incoming W3C context retains its sampling
decision. `OTEL_SDK_DISABLED=true` disables traces while keeping logs.
Omit `SEQ_URL` and any explicit traces endpoint to disable telemetry export.

`OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` optionally overrides the full traces URL.
The override does not receive `SEQ_API_KEY`; use
`OTEL_EXPORTER_OTLP_TRACES_HEADERS` for authentication there.

Successful health probes stay quiet. Repeated outage logs are capped at one per
30 seconds per event/dependency or connection, with repeat counts and recovery
logging. Export failures write to stdout. Shutdown drains connections and export
buffers, with a ten-second deadline.

Verify a request log opens its trace in Seq. Measure daily storage growth before
choosing retention or reducing sampling.
