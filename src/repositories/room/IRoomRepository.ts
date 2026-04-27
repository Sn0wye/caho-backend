import type { PublicRoomWithPlayerCountAndHost, Room } from '@/schemas';

export interface IRoomRepository {
  getRoomByCode(roomCode: string): Promise<Room | undefined>;
  create(data: Room): Promise<Room>;
  listPublicRooms(): Promise<PublicRoomWithPlayerCountAndHost[]>;
  update(roomCode: string, data: Partial<Room>): Promise<Room>;
}
