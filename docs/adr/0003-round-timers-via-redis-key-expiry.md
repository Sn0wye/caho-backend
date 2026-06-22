# Round timers via Redis key-expiry events, not a scheduler or setTimeout

## Context

A Round needs a play-phase deadline (so one AFK Player can't stall everyone) and a
fallback for a dropped Judge who never reconnects (ADR-0002). But the backend is
stateless Fastify REST + Redis pub/sub (ADR-0001), with no background game-loop
process to fire a timer.

## Decision

Timers are driven by **Redis key expiry**. When a Round starts, the server sets a
key with a TTL (e.g. `round:{id}:play` `EX 60`); a dropped Judge sets
`round:{id}:judge` with a grace TTL. With `notify-keyspace-events Ex` enabled, the
self-hosted Redis emits an `expired` event the backend subscribes to (the same
pub/sub channel idiom already in use); the handler advances the Round —
play-expiry skips non-players and moves to judging (or aborts+rotates if nobody
played), judge-expiry aborts+rotates.

Two safeguards make it correct:

- **Postgres deadline backstop**: the deadline is also stored on the Round, and a
  startup reconciliation sweep advances any Round whose deadline passed while no
  subscriber was listening (covers missed expiry events).
- **Idempotent claim**: the handler advances via a conditional update
  (`WHERE` the Round is still in that phase), so a duplicate/replayed event — or a
  second instance — cannot double-advance.

## Why

- `setTimeout` in-process pins the timer to one node and loses it on
  restart/deploy, breaking the multi-instance model of ADR-0001.
- A dedicated job queue (e.g. BullMQ) or worker would fire reliably but adds a new
  component and runtime we don't otherwise need.
- Redis is already present and the pub/sub idiom is already in use; self-hosting it
  on the same VPS means keyspace notifications are fully available (no managed-Redis
  restriction). The Postgres backstop closes the one reliability gap (missed events)
  without standing up infrastructure.

## Consequences

- Requires `notify-keyspace-events Ex` in the Redis configuration — a deployment
  prerequisite, not just app code.
- Expiry events are best-effort, not exactly-timed; the reconciliation sweep and
  idempotent claim are mandatory, not optional. If reliability needs outgrow this,
  the documented upgrade path is a Redis-backed job queue.
