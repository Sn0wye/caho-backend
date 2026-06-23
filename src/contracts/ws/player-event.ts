import { whiteCard } from '@/schemas';
import { z } from 'zod';

// The private, per-Player channel (channel name = Player id = userId). Carries
// only the freshly dealt/refilled Hand today. Widen to a z.union when a second
// player event is added. See docs/ws-events.md / ADR-0005.
const playerEvent = z.object({
  event: z.literal('player.cards-drawn'),
  payload: z.array(whiteCard)
});

export type PlayerEvent = z.infer<typeof playerEvent>;
