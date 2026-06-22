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
