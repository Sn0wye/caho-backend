import {
  blackCard,
  rankingSchema,
  roomPlayerSchema,
  roundPlayedCardsSchema,
  sanitizedRoomSchema
} from '@/schemas';
import { z } from 'zod';
import { cursorPosition } from './cursor';

// The room channel (channel name = Room Code) carries every broadcast to all of a
// Room's subscribers. Payloads are self-describing so the frontend patches its
// store from each event without a REST refetch (ADR-0005): room-facing Player
// payloads use RoomPlayer (no private Hand, no derived isJudge), and round-scoped
// events carry the roundNumber + judgeId they describe.
export const roomEvent = z.union([
  // Full IN_PROGRESS snapshot the moment the Host starts the Room: the sanitized
  // Room (no password) plus every Player's public state. Seeds the whole game in
  // one message; `room.round-start` for Round 1 follows.
  z.object({
    event: z.literal('room.started'),
    payload: z.object({
      room: sanitizedRoomSchema,
      players: z.array(roomPlayerSchema)
    })
  }),
  z.object({
    event: z.literal('room.player-joined'),
    payload: roomPlayerSchema
  }),
  z.object({
    event: z.literal('room.player-left'),
    payload: z.object({
      id: z.string()
    })
  }),
  z.object({
    event: z.literal('room.player-update'),
    payload: roomPlayerSchema
  }),
  // A Round begins (first Round, a rotation after a pick, or after an abort).
  // `judgeId` names this Round's Judge — the frontend derives each Player's
  // isJudge from it, since the stored flag is not authoritative. ADR-0005.
  z.object({
    event: z.literal('room.round-start'),
    payload: z.object({
      roundNumber: z.number().int(),
      judgeId: z.string(),
      blackCard: blackCard
    })
  }),
  // The play phase closed (all active Players played, or the deadline lapsed with
  // at least one play): the Judge now picks among these Played Cards.
  z.object({
    event: z.literal('room.time-to-judge'),
    payload: z.object({
      roundNumber: z.number().int(),
      roundPlayedCards: z.array(roundPlayedCardsSchema)
    })
  }),
  // A Round concluded, either way it can end: `reason: 'picked'` carries the
  // winning Played Card and the winner's new score; `reason: 'aborted'` (Judge
  // dropped or the deadline lapsed with no plays) carries no winner. Folding the
  // score in keeps the outcome a single self-contained message. ADR-0005.
  z.object({
    event: z.literal('room.round-end'),
    payload: z.object({
      roundNumber: z.number().int(),
      winner: roundPlayedCardsSchema.nullable(),
      winnerId: z.string().nullable(),
      newScore: z.number().int().nullable(),
      reason: z.enum(['picked', 'aborted'])
    })
  }),
  // Final game-over broadcast carrying the Ranking — published by the maxPoints
  // win-condition, the host's manual /end, and host departure. issue #1, slice 2.
  z.object({
    event: z.literal('room.game-end'),
    payload: rankingSchema
  }),
  // Live cursors on the table layout (ADR-0006). Relayed from one Player's Room
  // socket to everyone in the Room, sender included; clients drop their own.
  // Ephemeral: nothing is stored, and a missed move is replaced by the next.
  z.object({
    event: z.literal('room.cursor-move'),
    payload: cursorPosition.extend({ playerId: z.string() })
  }),
  // The Player's cursor left the table or their Room socket closed.
  z.object({
    event: z.literal('room.cursor-leave'),
    payload: z.object({ playerId: z.string() })
  })
]);

export type RoomEvent = z.infer<typeof roomEvent>;

/**
 * True for the high-frequency cursor relay events, which skip per-message
 * tracing and debug logs so they don't flood Seq.
 *
 * @example
 * if (isCursorEvent(event)) return deliverQuietly(event);
 */
export function isCursorEvent(event: { event: string }): boolean {
  return event.event === 'room.cursor-move' || event.event === 'room.cursor-leave';
}
