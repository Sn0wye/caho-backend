import { roomPlayerSchema } from '@/schemas';
import { z } from 'zod';

// Declared so Fastify's Zod serializer drops any undeclared field: the Hand
// (`cardIds`) and derived `isJudge` can't leak back in if the query changes.
// See ADR-0005 and issue #27.
export const getRoomPlayersResponse = z.array(roomPlayerSchema);

export type GetRoomPlayersResponse = z.infer<typeof getRoomPlayersResponse>;
