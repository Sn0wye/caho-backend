# WS event payloads are self-describing; Hand stays private; Judge is derived

## Context

The WebSocket events drifted into a shape the frontend could not consume cleanly:

- **`room.started` broadcast the full `Room` — including `password`** — to every
  subscriber.
- **The private Hand leaked.** `playerSchema` carries `cardIds`, so every
  room-channel Player payload (`room.player-joined`, `room.player-update`, and the
  start-time per-Player loop) shipped a Player's cards to the whole Room. It was
  harmless only by accident: at start the Hand is dealt _after_ the players are
  fetched, so `cardIds` happened to be empty.
- **`isJudge` had two sources of truth and went stale.** `is_judge` is a stored
  column written once in `start-room` for Round 1 and never moved on rotation;
  one read path (`getRoomPlayersByCode`) derived it from `room.judgeId` instead.
  After Round 1 nothing broadcast a Judge change, so a patch-from-events frontend
  could never learn who judges.
- **A Round end was split across messages.** A Judge pick emitted `room.round-end`
  (the winning card, no score) plus a separate `room.player-update` for the score.
  An _abort_ (Judge dropped, or the play deadline lapsed with no plays) emitted
  nothing at all — only the next `room.round-start` — so the frontend could not
  distinguish "nobody scored" from a normal advance.
- **Dead events** lingered: `room.message` (no emitter) and `room.black-card-drawn`
  (superseded by `room.round-start`, marked for removal in code).

The frontend holds a client-side store it patches from event deltas (no REST
refetch per event). That model only works if every payload is self-describing.

## Decision

Make the WS payloads a self-describing contract:

- **`RoomPlayer` view** = `Player` minus `cardIds` and `isJudge`. Every room-channel
  player payload uses it. The Hand travels **only** on the private Player channel
  via `player.cards-drawn`.
- **Judge identity is `room.judgeId`.** `room.round-start` carries `judgeId`; the
  frontend derives `isJudge = player.id === judgeId`. The stored `is_judge` column
  is no longer authoritative for broadcasts.
- **`room.started`** carries `{ room: SanitizedRoom, players: RoomPlayer[] }` — the
  whole IN_PROGRESS snapshot in one message (no `password`). The old per-Player
  update loop and `room.black-card-drawn` are removed.
- **`room.round-end` is unified and self-contained**: `{ roundNumber, winner |
  null, winnerId | null, newScore | null, reason: 'picked' | 'aborted' }`. The
  winner's score folds in (no separate `player-update`), and an abort emits it with
  `reason: 'aborted'` before the next `room.round-start`.
- Round-scoped events (`round-start`, `time-to-judge`, `round-end`) all carry their
  `roundNumber`.
- `room.message` is dropped.

The single zod source of truth lives in `src/contracts/ws/`; the frontend-facing
spec is `docs/ws-events.md`.

## Considered Options

- **Thin events + REST refetch** — events as bare signals, frontend re-fetches the
  room/round over HTTP. Rejected: more round-trips and a notification↔GET race for
  every state change, against a store that already patches from near-full deltas.
- **Keep `Player.isJudge` and fix rotation to broadcast it** — keep the stored flag
  as frontend truth, write+broadcast both the old and new Judge on every rotation.
  Rejected: two events per transition and a second source of truth to keep in sync —
  the exact bug that bit us.
- **Separate `room.round-aborted` event** instead of a nullable `round-end`.
  Rejected: two event types for one concept ("Round concluded"); a unified
  `round-end` keeps the winner/no-winner outcomes symmetric.

## Consequences

- The frontend never receives another Player's Hand, and never receives the Room
  `password`. `Player.isJudge` is not authoritative on the wire — consumers must
  derive it from `judgeId`.
- An aborted Round is now observable (`round-end` with `reason: 'aborted'`).
- `RoundRotation` (the timer engine's rotation result) gains `judgeId`;
  `RoomService.startNextRound` already sets it on the new Round.
- The stored `is_judge` column is **dropped** (migration `0006`). `Player.isJudge`
  is now derived from `room.judgeId` in every repository read path, so the
  server-side rule checks (`processJudgeChooseWinner`, `get-round-played-cards`,
  `allActivePlayersPlayed`) read a value that can no longer go stale after a
  rotation. `Player` keeps `isJudge` as a derived, read-only field; `RoomPlayer`
  omits it.
