import type { ICursorSeats } from './CursorBroadcaster';

// Seats Players by a fixed playerId → Room Codes map.
export class FakeCursorSeats implements ICursorSeats {
  constructor(private readonly roomCodesByPlayer: Record<string, string[]>) {}

  async getPlayerRoomCodes(playerId: string): Promise<string[]> {
    return this.roomCodesByPlayer[playerId] ?? [];
  }
}
