import { drawnBlackCard, whiteCard } from './card';
import { playerSchema } from './player';
import { roomSchema } from './room';
import { publicUserSchema } from './user';
import { z } from 'zod';

// A Round walks a phase machine so a stalled Player or a vanished Judge can't
// freeze the game. PLAYING accepts plays until the play deadline; JUDGING awaits
// the Judge's pick; COMPLETE/ABORTED are terminal. The deadlines back the
// Redis-key-expiry timer engine and let a startup sweep advance any Round whose
// timer fired while no subscriber was up. See ADR-0003 / issue #4.
export const roundStatusSchema = z.enum([
  'PLAYING',
  'JUDGING',
  'COMPLETE',
  'ABORTED'
]);

export const roundSchema = z.object({
  id: z.string(),
  roomCode: z.string().length(6),
  roundNumber: z.number().int(),
  blackCardId: z.string(),
  judgeId: z.string(),
  roundWinnerId: z.string().nullable(),
  status: roundStatusSchema.default('PLAYING'),
  playDeadline: z.coerce.date().nullable().default(null),
  judgeDeadline: z.coerce.date().nullable().default(null),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date()
});

export const roundPlayedCardsSchema = z.object({
  id: z.string(),
  roundId: z.string(),
  player: publicUserSchema,
  whiteCards: z.array(whiteCard),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date()
});

export const roundWithRelations = roundSchema.extend({
  room: roomSchema,
  judge: playerSchema,
  roundWinner: roundPlayedCardsSchema.nullable(),
  roundPlayedCards: z.array(roundPlayedCardsSchema)
});

// REST view of the current Round for a (re)connecting client, since the WS
// stream only carries live deltas. Played Cards stay empty until the Round
// reaches judging; RoomView owns that rule. issue #26.
export const roundSnapshotSchema = z.object({
  roundNumber: z.number().int(),
  status: roundStatusSchema,
  judgeId: z.string(),
  playDeadline: z.date().nullable(),
  judgeDeadline: z.date().nullable(),
  blackCard: drawnBlackCard.nullable(),
  roundPlayedCards: z.array(roundPlayedCardsSchema)
});

export type RoundSnapshot = z.infer<typeof roundSnapshotSchema>;
export type Round = z.infer<typeof roundSchema>;
export type RoundStatus = z.infer<typeof roundStatusSchema>;
export type RoundWithRelations = z.infer<typeof roundWithRelations>;
export type RoundPlayedCard = z.infer<typeof roundPlayedCardsSchema>;
