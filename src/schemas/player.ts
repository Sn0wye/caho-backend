import { z } from 'zod';

export const playerSchema = z.object({
  id: z.string().min(1),
  username: z.string().min(1),
  avatarUrl: z.string().url().or(z.null()),
  isHost: z.coerce.boolean(),
  isReady: z.coerce.boolean().default(false),
  isJudge: z.coerce.boolean().default(false),
  // Presence: an active Player is connected; a connection drop flips this to
  // false (an Inactive Player) without removing them from the Room. See ADR-0002.
  isActive: z.coerce.boolean().default(true),
  score: z.number().int().default(0),
  cardIds: z.array(z.string()).default([])
});

export type Player = z.infer<typeof playerSchema>;

// Room-channel view of a Player: the public, broadcastable subset. Omits the
// private Hand (`cardIds` would leak every Player's cards to the whole Room) and
// the derived `isJudge` flag — the frontend computes `isJudge = id === judgeId`
// from `room.round-start`, so `isJudge` carries no authoritative truth here.
// Every room.* player payload uses this view; the Hand travels only on the
// private Player channel via `player.cards-drawn`. See ADR-0005.
export const roomPlayerSchema = playerSchema.omit({
  cardIds: true,
  isJudge: true
});

export type RoomPlayer = z.infer<typeof roomPlayerSchema>;

// Strip the private/derived fields off a Player for a room-channel broadcast.
export const toRoomPlayer = ({ cardIds, isJudge, ...rest }: Player): RoomPlayer =>
  rest;
