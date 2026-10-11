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
grouped by lifecycle: `RoomOrchestrator` (membership: join/ready/leave/start/end,
Host departure, presence) and `RoundLifecycle` (everything about a Round once it
exists: creation, the PLAYING → JUDGING → COMPLETE/ABORTED phases, Judge
rotation, the play / judging / Judge-grace deadlines, and the `room.round-start`,
`room.time-to-judge` and `room.round-end` broadcasts). Orchestrators inject a
publisher **port** (`IGameEventPublisher`) plus `RoomService`, own the "this
happened → broadcast X" mapping, and are the only place pub/sub is emitted.
`RoundLifecycle` is the only place Round events are published. Controllers
shrink to: parse request → call one orchestrator method → send status.

`RoomService` keeps its role — domain rules returning outcome structs (e.g.
`JudgePick`, `RoundScore`); the orchestrator translates the outcome into events.
`RoomOrchestrator` passes presence changes (Player dropped / returned / left) to
`RoundLifecycle`, which decides what they mean for the Round. Every Round
transition is one guarded claim (ADR-0003) and only the caller that wins it
broadcasts, so the all-Players-played and deadline-expired paths can't
double-prompt the Judge.

### Revision (#25): one Round module

The first cut split the Round across `RoundFlow` (in-round actions),
`RoundTimekeeper` (deadlines) and `RoomService` (Round creation, rotation, phase
writes), joined by five one-adapter interfaces. Two bugs lived in the gaps: the
dropped-Judge grace and the judging window shared one Redis key, so opening
judging replaced a 30s grace with the 90s window; and "has everyone played?" ran
only on a play, so losing the last Player owed a play stalled the Round until the
deadline. Both merged into `RoundLifecycle`; the one-adapter seams were deleted.
Seams that remain have two adapters each: the game store (Postgres / in-memory),
the deadline store (`IRoundTimerStore`: Redis / fake) and the event publisher
(Pubsub / recording fake).

Deadline storage: three Redis keys (`round:{id}:play`, `:judge` for the judging
window, `:grace` for a dropped Judge), but still two Postgres columns.
`judge_deadline` mirrors whichever Judge deadline fires first; the grace takes
precedence. A Round reaching judging while its Judge is on grace (non-null
`judge_deadline` during play) is not given a judging window; it stays held on the
grace, and a Judge who returns during judging gets a full window. Either Judge key
expiring aborts and rotates, so the startup sweep only needs the earliest
deadline. No third column.

## Considered Options

- **Fat service emits** — inject the publisher into `RoomService` itself. Rejected:
  it already does too much; bundling pub/sub deepens the god class.
- **Events-out return value** — services return a list of intended events, a thin
  dispatcher emits them. Cleanest domain purity, but it would require rewriting the
  working Round emit paths. Deferred as a possible future step.

## Consequences

- Two service-shaped layers now coexist (`RoomService` for rules, orchestrators for
  workflow + events). A reader must know the split: rules and persistence in the
  service, broadcasts in the orchestrator.
- Orchestrators are unit-testable with a `FakeGameEventPublisher` that records
  emitted events. `RoundLifecycle.spec` drives a Round's whole lifecycle through
  its interface over the in-memory game store and a fake deadline store the test
  expires on demand, so multi-step bugs (like the two above) fail a test.
- `http/broadcastHostLoss.ts` and `http/handleJudgeLoss.ts` (shared REST + WS
  helpers) fold into `RoomOrchestrator`; the WS drop path calls the same method.
