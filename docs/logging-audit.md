# Logging and tracing audit

Audited on 2026-10-10. Scope covers the API bootstrap, HTTP routes and controllers,
auth/session handling, Room and Round services, PostgreSQL repositories, Redis,
Pub/Sub, WebSocket delivery, timer subscriptions, migration/seed entrypoints,
Docker configuration, and existing tests. This is a source audit with local Seq
ingestion verification. Production Seq traffic and retention settings were not
available for inspection.

## Findings and decisions

The original setup shipped Pino logs to Seq but had no traces or trace correlation.
Fastify emitted request-start and request-end events, including raw request URLs.
The app had no lifecycle events for most gameplay operations. Several failures
were swallowed or replaced with errors that discarded their cause.

### Keep

| Location | Decision | Reason |
| --- | --- | --- |
| `src/migrate.ts` | Keep migration and seed success at info; setup failure at error. | Distinguishes database readiness from API startup. Flush before exiting. |
| `src/services/round/ensureExpiryNotifications.ts` | Keep the expiry configuration warning, with `err`, setting, and expected flags. | Missing `Ex` disables Round timers. A managed Redis may require operator setup. |
| `src/services/round/subscribeRoundExpiry.ts` | Keep expiry failures, raise to error and add Round/deadline identifiers. | A failed transition can stall a Room. Each expiry now owns a background trace. |
| `src/http/routes/ws.ts` | Keep per-Room presence broadcast warnings with error stacks and IDs. | A concurrent Leave is isolated to its Room without killing other updates. |
| Server startup | Keep a structured `server.started` event and Fastify's startup announcement. | Both occur only on startup; the app event has a stable searchable name. |
| `scripts/seed.ts` | Keep human-facing console output. | This is an explicit operator CLI, not an API request logger. |

### Remove

| Location | Removed output | Replacement |
| --- | --- | --- |
| `src/server.ts` | Emoji/plain-text `console.log` startup. | Structured startup/fatal/shutdown events. |
| `src/db/index.ts` | Development SQL and parameter dumps from Drizzle. | PostgreSQL duration, outcome and operation spans without query text or parameters. |
| Fastify default request logging | Two events per request and raw URLs. | One completion event with a route template, status, duration and generated request ID. |
| `/ping`, `/readyz` | Successful probe events and spans. | Failure events remain visible. |
| `src/http/routes/checks.ts` | Raw DB `console.log`; silent Redis catch. | Named dependency failures with serialized exceptions. |
| Google callback | Ad hoc `console.log` state diagnostics. | `auth.oauth_state_rejected` with provider only. |
| CSRF plugin | Raw origin/host `console.error`. | Structured `auth.origin_rejected`. The plugin remains disabled as before. |
| Development log transport | Pretty-print worker and `@fastify/one-line-logger`. | JSON in every environment. |
| Telemetry network calls | Spans for Seq shipping itself. | Undici excludes Seq and trace-exporter origins to prevent recursive noise. |

### Improve

| Location | Change | Operational effect |
| --- | --- | --- |
| `src/lib/logger.ts` | Configurable level, service/version/environment, trace fields, both `err`/`error` serializers. | Seq groups related log events with native `@TraceId` and `@SpanId`. |
| Logger fields | Redact known credential fields, bodies, headers, URLs, email and private game payloads. | Console and Seq receive the same redacted event. |
| Exception serialization | Keep type, message, stack and cause stacks; drop driver-specific enumerable fields. | DB detail/query fields cannot silently dump user values. |
| RoomService/AuthService catches | Preserve original exceptions as `cause`. | Boundary errors retain the underlying DB/OAuth failure in logs. |
| Password sign-in | Only invalid credentials become 401. | DB failures now reach the central 500 logger instead of masquerading as wrong passwords. |
| Sign-out | Only missing authentication remains an idempotent 204. | Failed session deletion now produces a 500 and exception event. |
| Pub/Sub | Propagate W3C trace context as internal event metadata; remove it before client delivery. | REST actions and WebSocket delivery share a trace across API instances. Legacy messages without metadata remain accepted. |
| Redis subscriptions | Catch subscription failures and close connections even if unsubscribe fails. | Startup and socket cleanup do not silently leave subscriptions alive. |
| WebSocket lifecycle | End HTTP spans on upgrade; catch setup/send/socket/cleanup failures. | Upgrades no longer leave unfinished server spans; close callbacks cannot hide I/O failures. |
| Server/migration shutdown | Drain clients and export buffers before process exit. | Final deployment/shutdown events are less likely to disappear. |
| Compose | Document container Seq URL as `http://seq:80`. | `5341` is the host-mapped port, not the Seq container's listening port. |

### Add

| Boundary | Events | Level and fields |
| --- | --- | --- |
| HTTP completion/exception/abort | `http.request_completed`, `http.exception`, `http.request_aborted` | Completion info; rejected requests warn; failed requests error. Method, route template, status, duration, request ID, trace IDs; exception stack on unexpected failures. |
| Auth | `auth.signed_up`, `auth.signed_in`, `auth.signed_out`, `auth.sign_in_rejected`, `auth.oauth_state_rejected` | Successful changes info; rejection warn. Provider and user ID where available. No username, token, state or verifier. |
| Room membership/lifecycle | `room.created`, `room.player_joined`, `room.player_left`, `room.started`, `room.ended`, `room.host_reassigned` | Info. Room Code, Player ID, Round ID/number, counts and end reason as applicable. |
| Round lifecycle | `round.started`, `round.judging_started`, `round.winner_picked`, `round.aborted`, `round.judge_grace_armed`, `round.judge_returned` | Info; abort warn. Phase, Round identifiers, played count, winner ID, score or grace TTL. |
| Startup recovery | `round.reconciliation_started`, `round.reconciliation_completed` | Info with expired-Round count and a recovery trace. |
| PostgreSQL/Redis connections | `postgres.connection_failed`, `redis.connection_failed`, `redis.reconnecting`, `redis.ready`, `redis.closed` | Failures error, reconnect warn, ready/closed info for shared connections, debug for per-socket subscribers. Redis connection role and retry delay; no connection URL. |
| Redis subscriptions | `redis.subscription_failed` | Error with channel and connection role. |
| Pub/Sub delivery | `pubsub.publish_failed`, `pubsub.delivery_failed`, `pubsub.invalid_message` | Error with event type/channel. Malformed JSON logs only byte count, since parser messages can quote private payloads. |
| WebSocket failures | `ws.auth_rejected`, `ws.setup_failed`, `ws.socket_failed`, `ws.send_failed`, `ws.unsubscribe_failed`, `ws.presence_failed`, `ws.presence_broadcast_failed`, `ws.cleanup_failed` | Auth/presence broadcast warn; I/O/setup/cleanup error. Channel or Room/User IDs and close metadata, never message payloads. |
| Export/startup/shutdown | `seq.export_failed`, `telemetry.export_failed`, `server.startup_failed`, `server.bootstrap_failed`, `server.stopping`, `server.shutdown_failed` | Failures error/fatal, stopping info. Export failures bypass Seq and write only to console. |

Detailed card-count, presence, socket connect/disconnect, timer-arm, duplicate-claim,
and Pub/Sub publish events use debug. Keep `LOG_LEVEL=info` for normal traffic;
enable debug temporarily when diagnosing those paths.

## Boundaries that should stay quiet

Repository reads and routine session validation do not need entry/exit logs.
HTTP completion and dependency spans already describe their timing and outcome.
Logging at every repository method would multiply events without adding a useful
decision. Session renewal, successful CSRF checks, ordinary card draws, heartbeat
ping/pong, unchanged timer claims and polling do not need info events.

No logs or span attributes should contain passwords or hashes, bearer/session
tokens, OAuth authorization codes/state/verifiers, API keys, raw cookies/headers,
request/response bodies, SQL parameters, private Hands, Played Card contents, or
entire User/Room objects. Use identifiers, counts and named outcomes instead.
Known-field redaction is defense in depth. It cannot remove arbitrary secrets
embedded into a future free-text message or exception. Review those call sites.

## Tracing design

The SDK starts before dynamically importing the app. The build preserves that
import boundary. PostgreSQL, Redis and outbound fetches receive dependency spans;
HTTP spans are explicit Fastify hooks so ESM bundling does not depend on patching
Fastify itself. ioredis loads through CommonJS `createRequire` so its constructor
is patched before clients exist.

Seq receives batched OTLP HTTP/protobuf traces at
`<SEQ_URL>/ingest/otlp/v1/traces`, authenticated with the existing Seq ingest key.
Pino keeps the existing log transport; its `trace_id`/`span_id` fields become Seq's
native trace fields. There is no duplicate OTEL log pipeline or metrics exporter.
An optional explicit traces endpoint supports a collector without forwarding the
Seq API key to another destination.

Span export removes SQL text/parameters, full URLs/query strings, captured headers
and credential attributes, including attributes on span events and links. Resource
auto-detection is disabled to avoid collecting process arguments/environment.
Exception events retain message and stack. Successful health probes are excluded.

Redis expiry notifications carry only a key, so each timer expiry starts a new root
trace linked operationally by Round ID. Startup reconciliation and socket close
also own root traces. Room/Player event delivery continues the producer's trace
through internal Redis metadata; it is never sent to WebSocket clients.

Default root sampling is 100%. `OTEL_TRACES_SAMPLER_ARG=0.1` records 10% of new root
traces; incoming W3C trace context preserves its parent's sampling decision.
Logs remain independent of trace sampling. Unsampled logs can reference a trace
that is absent from Seq. Set `OTEL_SDK_DISABLED=true` to stop traces while keeping
Pino logs. Without Seq or an explicit endpoint, no telemetry SDK starts.

## Useful Seq filters

Use the application property for logs and the resource property for spans:

```sql
service = 'caho-backend' or @Resource.service.name = 'caho-backend'
```

```sql
@TraceId = '<trace-id>'
```

```sql
reqId = '<x-request-id>'
```

```sql
roomCode = '<room-code>' or roundId = '<round-id>'
```

```sql
event = 'http.request_completed' and statusCode >= 500
```

```sql
event in ['round.aborted', 'round.expiry_failed', 'redis.connection_failed', 'redis.subscription_failed']
```

```sql
event = 'http.request_completed' and durationMs > 1000
```

For an error, open its trace to locate the slow/failing dependency. For a timer
issue, search by Round ID because Redis key expiry cannot carry the original
request trace. For missing telemetry, inspect container stdout for export failures.

## Follow-up operations

Deploy the changes with the existing `SEQ_URL` and `SEQ_API_KEY`. Confirm your Seq
version supports traces, the key has ingest permission, and the API can reach its
HTTP endpoint. This audit does not change your production Seq server.

After observing real traffic, set retention separately for ordinary request logs,
debug logs and traces. A useful starting policy is shorter retention for debug and
successful traces, longer retention for errors and lifecycle changes. Choose actual
durations from incident needs and measured storage; no production volume was
available to size them. Consider sampled success traces or a collector with tail
sampling if full tracing becomes expensive. Parent-based head sampling cannot
guarantee retaining every failed trace.

Readiness failures and connection retries can repeat during an outage. If their
volume dominates production Seq, add state-change logging or rate limits while
keeping failure counters. Full trace export is bounded by a 2048-span queue and
five-second export timeout; prolonged exporter outages can lose spans. This is
best-effort telemetry, not a durable security audit ledger.

References: [Seq Node.js tracing](https://datalust.co/docs/tracing-from-nodejs),
[Pino Seq transport](https://github.com/datalust/pino-seq),
[OpenTelemetry JS instrumentation](https://opentelemetry.io/docs/languages/js/instrumentation/),
[OTLP exporter configuration](https://opentelemetry.io/docs/languages/sdk-configuration/otlp-exporter/).


## Verification

All 194 tests pass, along with type checking, scoped Biome checks, the production
build and the native ARM64 Docker build.

The automated suite covers request correlation under concurrency, W3C propagation,
redaction in both log outputs, native Seq field names, error cause/stack retention,
exporter failure isolation, sampling configuration, Pub/Sub backward compatibility,
malformed payloads, WebSocket upgrade completion and cleanup races, Redis expiry
logging, and dependency shutdown order.

A built production API completed a three-Player Room against an isolated PostgreSQL
schema, Redis, and a disposable Seq instance. Seq received 476 correlated log/span
events, including 50 Redis spans, through account creation, Room creation/join/start,
private Hand delivery, playing, judging and game end. Test credentials, session
tokens and private card text were absent from exported telemetry; internal trace
metadata was absent from WebSocket messages. Telemetry shipping produced no spans.
The trace sample was measured before final shutdown-drain changes.

A live-socket SIGTERM check exposed a pool-close race in async presence cleanup.
Socket sessions and in-flight expiry work now drain before PostgreSQL/Redis close;
regression tests cover both waits. The API's original error-masking handlers and
unended WebSocket HTTP spans also have regression coverage.
A production ARM64 container subsequently passed readiness, native Argon2 signup,
and SIGTERM with a live WebSocket: cleanup drained, no error events were emitted,
and the process exited with code 0.
