# Commands over REST, real-time over read-only WebSocket + Redis pub/sub

## Context

CAHO is real-time: every Player in a Room must see joins, plays, round
transitions and results as they happen. The obvious shape for this is a
bidirectional WebSocket where clients both send game commands and receive
updates — and an early version did exactly that with socket.io (now the
fully-commented `src/plugins/socketio.ts`).

## Decision

All state-changing actions are **HTTP REST** endpoints (create/join/start room,
play cards, ready, judge picks winner, end room). The WebSocket is **read-only**:
a client opens `GET /room/:code` or `GET /:userId` purely to *subscribe*, and the
server never reads commands off the socket. Controllers mutate the database, then
publish a typed event to **Redis pub/sub** on a channel keyed by Room Code (room
events) or user id (private events such as a Player's own drawn cards). The WS
route is a thin bridge that forwards channel messages to the socket.

## Why

- **Commands get auth, validation, error handling and Swagger for free** through
  the existing Fastify + Zod + Lucia HTTP stack, instead of reimplementing all of
  it inside socket handlers.
- **Redis pub/sub decouples fan-out from connections**, so the app can run
  multiple instances behind a load balancer — a subscriber on any node receives
  events published by any other node. A single in-process socket server could not.
- **Per-channel privacy**: room-wide events go to the Code channel; a Player's
  private hand goes to their user-id channel.

## Consequences

- A request and its resulting broadcast are two hops (REST handler → publish →
  subscriber), not one socket round-trip. Accepted for the scaling and reuse wins.
- `socketio.ts` is dead and retained only as historical reference. **Do not
  reintroduce command handling over the socket** — that is the path this decision
  deliberately rejected.
