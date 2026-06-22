# Presence model: drop yields an inactive Player, explicit leave removes

## Context

Originally a Player who left a Room was hard-deleted, and a dropped WebSocket
connection was silent and unattributable (the room socket is keyed by Room Code,
not user). A Player who crashed or lost network stayed in the database mid-game and
could stall a Round forever — especially as Judge or as someone owed a play.

## Decision

We distinguish two ways a Player exits, by intent:

- **Explicit leave** (the leave action) → the Player is **removed** from the Room
  entirely; score and membership gone.
- **Connection drop** (network loss / closed tab, detected on the per-user
  WebSocket) → the Player becomes an **Inactive Player**: kept in the Room and
  Ranking with their score, skipped for Judge rotation, and never awaited for a
  play. Reconnecting makes them active again.

Role loss is handled by Room status, not a single rule:

- **Host, in `LOBBY`** — leave or drop → the Room ends and everyone is
  disconnected (an unstarted game has no reason to continue without its Host).
- **Host, in `IN_PROGRESS`** — leave or drop → the Host role is reassigned to the
  earliest-joined active Player; if no active Players remain, the Room ends. A
  dropped ex-Host returns as an ordinary active Player, not Host.
- **Judge, mid-Round** — drop → the Round is **held** awaiting reconnect so the
  Judge can still pick (with a deadline fallback, see ADR-0003); explicit leave →
  the Round is aborted with no winner, its plays discarded, and the Judge rotates.

## Why

A casual party game must survive flaky connections and one person rage-quitting
without ending everyone's fun. Treating an intentional leave (removal) differently
from an accidental drop (recoverable inactivity) preserves scores and reconnects
cleanly, while the status-dependent Host rules avoid both orphaned lobbies and
killed in-progress games.

## Consequences

- `room_players` needs an active/inactive flag, and game logic must everywhere
  filter to active Players for "all played?" and Judge-eligibility checks.
- A dropped Judge can hold a Round; ADR-0003's deadline is the backstop that
  prevents an indefinite stall. **Do not reintroduce "delete on disconnect"** — it
  is the behavior this decision deliberately replaced.
