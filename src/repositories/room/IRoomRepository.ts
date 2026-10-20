import type { Room, RoomListing } from '@/schemas';

export interface IRoomRepository {
  getRoomByCode(roomCode: string): Promise<Room | undefined>;
  create(data: Room): Promise<Room>;
  listLobbyRooms(): Promise<RoomListing[]>;
  update(roomCode: string, data: Partial<Room>): Promise<Room>;

  // Start claim: applies `startPatch` only while the Room is still LOBBY and
  // returns the started Room, or null when another start already won.
  claimStart(roomCode: string, startPatch: Partial<Room>): Promise<Room | null>;
}
