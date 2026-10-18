import { z } from 'zod';

// A point on the shared table, in table space: the table's centre is (0, 0) and
// its rim sits at radius 1. Every client draws its own seat at the bottom, so
// it rotates into and out of this space; sending screen pixels would put each
// cursor somewhere else on every screen. The extra margin past the rim lets a
// cursor hover the seats around the table.
export const cursorPosition = z.object({
  x: z.number().finite().min(-2).max(2),
  y: z.number().finite().min(-2).max(2)
});

export type CursorPosition = z.infer<typeof cursorPosition>;

// The only messages the server reads off the Room socket (ADR-0006). Anything
// else, including the client's keepalive 'ping', is ignored.
export const cursorMessage = z.discriminatedUnion('event', [
  z.object({ event: z.literal('cursor.move'), payload: cursorPosition }),
  z.object({ event: z.literal('cursor.hide') })
]);

export type CursorMessage = z.infer<typeof cursorMessage>;
