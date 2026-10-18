import { z } from 'zod';

export const createRoom = z.object({
  // Bounds mirror roomSchema; a Room needs MIN_PLAYERS_TO_START (3) to start.
  maxPlayers: z.number().int().min(3).max(10),
  maxPoints: z.number().int().min(1).max(30),
  // Any non-empty password locks the Room; empty means open to anyone. Capped at
  // the rooms.password column width so an oversized one is a 400, not a 500.
  password: z
    .string()
    .max(255)
    .nullable()
    .transform(value => value || null)
});

export type CreateRoom = z.infer<typeof createRoom>;
