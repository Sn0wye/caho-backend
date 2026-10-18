import { roomListingSchema } from '@/schemas';
import { z } from 'zod';

export const listRoomsResponse = z.array(roomListingSchema);

export type ListRoomsResponse = z.infer<typeof listRoomsResponse>;
