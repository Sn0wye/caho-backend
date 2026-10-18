import type { CursorPosition } from '@/contracts';
import type { IGameEventPublisher } from '@/services/IGameEventPublisher';

// The membership read the broadcaster needs; RoomService satisfies it.
export interface ICursorSeats {
  getPlayerRoomCodes(playerId: string): Promise<string[]>;
}

// Owns the cursor broadcasts on the Room channel, like the other orchestrators
// own theirs (ADR-0004). Per-socket parsing and rate limiting live in
// http/cursor-inbox; this only decides who may broadcast and what goes out.
// ADR-0006.
export class CursorBroadcaster {
  constructor(
    private readonly seats: ICursorSeats,
    private readonly publisher: IGameEventPublisher
  ) {}

  /**
   * Whether the Player sits in the Room, so a signed-in stranger watching the
   * Room socket can't draw on the table.
   *
   * @example
   * if (await cursors.isSeated('ABC123', userId)) inbox.enable();
   */
  public async isSeated(roomCode: string, playerId: string): Promise<boolean> {
    const roomCodes = await this.seats.getPlayerRoomCodes(playerId);
    return roomCodes.includes(roomCode);
  }

  /** Broadcast where the Player's cursor is. Example: move('ABC123', 'player-a', { x: 0, y: 0.5 }). */
  public move(
    roomCode: string,
    playerId: string,
    position: CursorPosition
  ): Promise<void> {
    return this.publisher.publish(roomCode, {
      event: 'room.cursor-move',
      payload: { playerId, x: position.x, y: position.y }
    });
  }

  /** Tell the Room the Player's cursor is gone. Example: hide('ABC123', 'player-a'). */
  public hide(roomCode: string, playerId: string): Promise<void> {
    return this.publisher.publish(roomCode, {
      event: 'room.cursor-leave',
      payload: { playerId }
    });
  }
}
