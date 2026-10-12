import { z } from 'zod';

export const blackCard = z.object({
  text: z.string(),
  packId: z.string(),
  pick: z.number()
});
export type BlackCard = z.infer<typeof blackCard>;

// A Black Card as stored and served over REST, with its id. The `blackCard`
// shape above predates DB-backed cards (issue #5) and is kept for the WS contract.
export const drawnBlackCard = blackCard.extend({ id: z.string() });

export const whiteCard = z.object({
  id: z.string(),
  text: z.string(),
  packId: z.string()
});
export type WhiteCard = z.infer<typeof whiteCard>;

export const cardSchema = z.union([blackCard, whiteCard]);
