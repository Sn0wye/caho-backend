# WebSocket events — frontend contract

How the CAHO backend pushes real-time game state, and how a client should consume
it. The canonical zod source is `src/contracts/ws/`; this document explains it and
the game loop. See [ADR-0005](./adr/0005-ws-event-payload-contract.md) for the why,
and [ADR-0001](./adr/0001-rest-commands-ws-subscribe-pubsub.md) for the
REST-commands / WS-subscribe split.

## Consumption model

The client holds its own store and **patches it from each event** — no REST
refetch per event. Every payload is therefore **self-describing**: it carries
stable IDs plus the `roundNumber` / `judgeId` it refers to. Load the initial
snapshot once over REST when entering a Room, then keep it live from the stream.

A message is always `{ event: string, payload: ... }`, JSON over the socket.

## Channels

Two socket endpoints, two channels:

| Connect to | Channel carries | Purpose |
|---|---|---|
| `GET /room/:roomCode` | `room.*` events | Everything broadcast to the whole Room |
| `GET /:userId` | `player.*` events | Private, per-user (your Hand); also drives presence |

- **Room channel** name = the 6-char Room **Code**. All subscribers get every
  `room.*` event.
- **Player channel** name = your **userId** (which equals your `Player.id`).
  Opening it marks you _active_; closing it marks you an _Inactive Player_ and
  fans a `room.player-update` out to each Room you are in (ADR-0002).

> A Player's Hand is **never** sent on the Room channel. It arrives only on your
> own Player channel via `player.cards-drawn`.

## The `RoomPlayer` view

Every room-channel player payload uses `RoomPlayer` — a `Player` **without**
`cardIds` (private Hand) and **without** `isJudge` (derive it, see below):

```ts
type RoomPlayer = {
  id: string;
  username: string;
  avatarUrl: string | null;
  isHost: boolean;
  isReady: boolean;
  isActive: boolean;   // false = Inactive Player (connection dropped)
  score: number;
};
```

### Deriving the Judge

`isJudge` is **not** on the wire. Each Round, `room.round-start` carries `judgeId`.
Compute it client-side and keep the latest `judgeId`:

```ts
const isJudge = (player: RoomPlayer) => player.id === currentJudgeId;
```

`room.started.room.judgeId` gives you the first Round's Judge; every
`room.round-start` thereafter updates it.

## Event reference (room channel)

| event | payload |
|---|---|
| `room.started` | `{ room: SanitizedRoom, players: RoomPlayer[] }` |
| `room.player-joined` | `RoomPlayer` |
| `room.player-left` | `{ id: string }` |
| `room.player-update` | `RoomPlayer` |
| `room.round-start` | `{ roundNumber: number, judgeId: string, blackCard: BlackCard }` |
| `room.time-to-judge` | `{ roundNumber: number, roundPlayedCards: RoundPlayedCard[] }` |
| `room.round-end` | `{ roundNumber, winner: RoundPlayedCard \| null, winnerId: string \| null, newScore: number \| null, reason: 'picked' \| 'aborted' }` |
| `room.game-end` | `Ranking` |

### Event reference (player channel)

| event | payload |
|---|---|
| `player.cards-drawn` | `WhiteCard[]` — your refilled/dealt Hand |

### Supporting shapes

```ts
type SanitizedRoom = {           // Room without `password`
  id: string; code: string;
  maxPlayers: number; maxPoints: number;
  status: 'LOBBY' | 'IN_PROGRESS' | 'FINISHED';
  hostId: string;
  isPublic: boolean;
  prevJudgeId: string | null; judgeId: string | null;
  round: number;
  pickedWhiteCards: string[]; pickedBlackCards: string[];
  currentBlackCardId: string | null;
  createdAt: string; updatedAt: string;
};

type BlackCard = { text: string; pick: number; packId: string };
type WhiteCard = { id: string; text: string; packId: string };

type RoundPlayedCard = {         // one Player's answer for a Round
  id: string; roundId: string;
  player: { id: string; username: string; avatarUrl: string | null /* bare User */ };
  whiteCards: WhiteCard[];
  createdAt: string; updatedAt: string;
};

type Ranking = Array<{ id: string; username: string; avatarUrl: string | null; score: number }>;
```

## How to apply each event

- **`room.started`** — replace your Room with `payload.room`, seed your player map
  from `payload.players`, set `currentJudgeId = room.judgeId`. The IN_PROGRESS
  state is fully described here; `room.round-start` for Round 1 follows.
- **`room.player-joined` / `room.player-update`** — upsert `store.players[payload.id] = payload`.
  `player-update` covers ready toggles, score changes, presence (`isActive`), and
  Host reassignment — all as a fresh `RoomPlayer`.
- **`room.player-left`** — delete `store.players[payload.id]`.
- **`room.round-start`** — set `currentJudgeId = payload.judgeId`, `currentRound =
  payload.roundNumber`, show `payload.blackCard`, clear last Round's plays, and
  reset every player's local `isReady` to false.
- **`room.time-to-judge`** — enter the judging phase; render `roundPlayedCards`
  for the Judge to pick among.
- **`room.round-end`** — `reason: 'picked'`: highlight `winner`, set
  `store.players[winnerId].score = newScore`. `reason: 'aborted'`: show the Round
  ended with no winner (`winner` is `null`). A `room.round-start` for the next
  Round (or `room.game-end`) follows.
- **`room.game-end`** — the Room is over; render the final `Ranking`.
- **`player.cards-drawn`** — replace your Hand with `payload`.

## Core game loop (message sequence)

```
Host POST /start
  → room.started          { room, players }          (room channel)
  → player.cards-drawn    WhiteCard[]                 (each Player's own channel)
  → room.round-start      { roundNumber:1, judgeId, blackCard }

Each non-Judge Player POST /play-card
  → room.player-update    RoomPlayer{ isReady:true }
  → player.cards-drawn    WhiteCard[]                 (that Player's refilled Hand)

When every active Player has played, OR the play deadline lapses with ≥1 play:
  → room.time-to-judge    { roundNumber, roundPlayedCards }

Judge POST /judge-choose-winner
  → room.round-end        { roundNumber, winner, winnerId, newScore, reason:'picked' }
  → if win-condition (maxPoints) reached:
      → room.game-end     Ranking
    else:
      → room.round-start  { roundNumber+1, judgeId, blackCard }   (Judge rotates)

Abort path — Judge drops (and grace lapses) or the play deadline lapses with no plays:
  → room.round-end        { roundNumber, winner:null, winnerId:null, newScore:null, reason:'aborted' }
  → room.round-start      { roundNumber+1, judgeId, blackCard }   (Judge rotates)

Host POST /end (any time):
  → room.game-end         Ranking
```

Notes:

- **Hands persist across Rounds** and refill in `play-card` — there is no
  per-Round redeal, so `player.cards-drawn` after Round 1 is a top-up, not a new
  Hand.
- An **Inactive Player** is never awaited for a play and is skipped for Judge
  rotation; reconnecting flips `isActive` back via `room.player-update` (ADR-0002).
- Round transitions are **idempotent** server-side — a replayed timer event won't
  double-emit `time-to-judge` or double-rotate (ADR-0003 / ADR-0004).
