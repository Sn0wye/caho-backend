# Orchestrators own event emission; controllers stay thin

## Context

REST controllers had drifted into doing three jobs: HTTP parsing, game-rule
enforcement, and hand-emitting Redis pub/sub events (ADR-0001). The same
`room.time-to-judge` event was published from both `play-card.ts` (all Players
played) and `RoundTimekeeper.onPlayExpired` (deadline lapsed), and only the timer
path guarded the broadcast behind the idempotent phase claim — so a Round where
everyone played before the deadline could broadcast the judge prompt twice. The
emission logic was also untestable: it lived in a Fastify handler closure over
`app.pubsub`.

## Decision

Introduce an **orchestration layer** between controllers and `RoomService`,
grouped by lifecycle: `RoomOrchestrator` (membership: join/leave/start/end +
host/judge departure) and `RoundFlow` (in-round: play, judge-pick, ready),
reusing the existing `RoundTimekeeper`. Orchestrators inject a publisher **port**
(`IRoundEventPublisher`) plus `RoomService`, own the "this happened → broadcast X"
mapping, and are the only place pub/sub is emitted. Controllers shrink to: parse
request → call one orchestrator method → send status. This is the pattern
`RoundTimekeeper` already shipped (issue #4); we extend it to the HTTP-triggered
flows for consistency.

`RoomService` keeps its role — domain rules returning outcome structs (e.g.
`JudgePickResult`); the orchestrator translates the outcome into events. The
JUDGING transition is consolidated into one guarded `RoundTimekeeper.advanceToJudging`
shared by the all-Players-played and deadline-expired paths, closing the
double-broadcast race.

## Considered Options

- **Fat service emits** — inject the publisher into `RoomService` itself. Rejected:
  it already does too much; bundling pub/sub deepens the god class.
- **Events-out return value** — services return a list of intended events, a thin
  dispatcher emits them. Cleanest domain purity, but it would require rewriting the
  working `RoundTimekeeper` emit paths. Deferred as a possible future step.

## Consequences

- Two service-shaped layers now coexist (`RoomService` for rules, orchestrators for
  workflow + events). A reader must know the split: rules and persistence in the
  service, broadcasts in the orchestrator.
- Orchestrators are unit-testable with a `FakeEventPublisher` that records emitted
  events — the regression guard for the double-broadcast bug lives here.
- `http/broadcastHostLoss.ts` and `http/handleJudgeLoss.ts` (shared REST + WS
  helpers) fold into `RoomOrchestrator`; the WS drop path calls the same method.
