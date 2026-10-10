# Logging audit: decisions and remaining work

Updated 2026-10-10. Source audit complete; local Seq ingestion verified.
Production Seq settings have not been inspected.

## Already fixed

- **Keep:** auth, Room/Round lifecycle changes, dependency failures, timer failures.
- **Remove:** SQL/parameter dumps, raw request URLs, successful probe noise, duplicate request-start events.
- **Improve:** native Seq trace correlation, error causes/stacks, private-field redaction, graceful shutdown.
- **Add:** missing auth/gameplay outcomes, Redis/PostgreSQL connection failures, Pub/Sub and WebSocket failures.
- Use `LOG_LEVEL=info`. Card counts, presence and socket churn stay at debug. Never log private Hands, tokens or request bodies.

## Concerns and actions

1. **Outage log floods. Fixed in code.** Readiness dependency errors, failed health summaries, Redis connection errors/retries and Seq/OTLP export failures log immediately, then at most once per 30 seconds per event/dependency or connection. Later events include `suppressedCount`. Readiness and Redis recovery reset the window and emit a recovery event. API responses and exporter callbacks still run normally.
2. **Trace storage. Keep 100%, as agreed.** Every root trace is sampled. After rollout, check Seq storage growth over a normal day. Reduce only if measured volume warrants it. Sampling can lose the trace for a failed request even when its error log remains.
3. **Production ingestion and retention. Pending rollout.** Deploy with existing `SEQ_URL` / `SEQ_API_KEY`. Check a request's log opens its trace in Seq, then set retention from storage budget and incident needs. No production settings changed.
4. **Redaction limits. Ongoing code review.** Known fields, SQL text and full URLs are removed. Arbitrary secrets inside exception messages cannot be reliably detected. Keep messages free of tokens, private cards and full user objects.

## Find an incident in Seq

- Request: `reqId = '<x-request-id>'`, then open its trace.
- Room/timer: `roomCode = '<room-code>' or roundId = '<round-id>'`.
- Server failures: `event = 'http.request_completed' and statusCode >= 500`.
- Export outage: inspect API stdout for `seq.export_failed` or `telemetry.export_failed`.

## Verification

All 202 tests pass. They cover correlation, redaction, propagation, sampling, outage log limits and shutdown races.
Type checking, production builds and native ARM64 Docker builds passed.
A local production API completed a three-Player game against real PostgreSQL, Redis and Seq: 476 correlated events, including 50 Redis spans. Test credentials and private card content were absent. Live-WebSocket SIGTERM drained cleanly with exit code 0.

[Deployment settings](deployment.md#seq-logs-and-traces) contain the setup and disable controls.
