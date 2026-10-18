# Cursor positions travel in over the Room socket

## Context

The frontend's table layout seats every Player around one table and shows each
Player's mouse cursor live, like Tabletop Simulator. A cursor moves many times a
second, carries no game meaning and is stale the moment the next one arrives.
ADR-0001 made the WebSocket read-only and routed every command through REST.

## Decision

The Room socket (`GET /ws/room/:roomCode`) reads two client messages,
`cursor.move { x, y }` and `cursor.hide`, and nothing else. `CursorInbox` (one
per socket, in `src/http`) parses them, drops moves closer than 30ms apart and
ignores the socket entirely unless its user sits in the Room, checked once on
open. `CursorBroadcaster` (a game module) publishes `room.cursor-move` and
`room.cursor-leave` on the Room channel, so fan-out still goes through Redis
pub/sub and works across instances. Closing the socket sends a leave.

Coordinates are in table space, centre `(0, 0)`, rim at radius 1. Each client
rotates the table so its own seat is at the bottom, so screen pixels would mean
something different on every screen.

`Pubsub` publishes and delivers cursor events without a span or a debug log line.

## Why

- **Not a command.** A cursor changes no state, so it gets none of what REST
  buys commands: validation errors, Swagger, error responses. One POST per move
  at 20Hz per Player would be pure overhead.
- **The socket is already open and authenticated** by the session cookie.
- **Nothing to store.** A dropped or reordered move is fixed by the next one, so
  there is no idempotency or persistence to get right.
- **Traces would drown.** Five Players at 20Hz is 100 spans a second, burying the
  game's own traces in Seq.

## Consequences

- ADR-0001 still holds for game commands. Don't add more inbound message types
  without another decision; anything that changes state goes through REST.
- A Player who leaves keeps relaying cursors until their Room socket closes,
  since membership is checked only on open. The frontend closes the socket when
  it leaves the Room.
- Cursor traffic is invisible in traces; debug it from the client.
