import type { Room, RoomListing } from '@/schemas';

export interface IRoomRepository {
  getRoomByCode(roomCode: string): Promise<Room | undefined>;
  create(data: Room): Promise<Room>;
  listLobbyRooms(): Promise<RoomListing[]>;
  update(roomCode: string, data: Partial<Room>): Promise<Room>;
}
