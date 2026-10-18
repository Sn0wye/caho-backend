import type { IRoomRepository } from '@/repositories/room';
import type { Room, RoomListing } from '@/schemas';
import { type InMemoryGameTables, definedOnly } from './InMemoryGameTables';

// rooms table, keyed by Code like RoomRepository.
export class InMemoryRoomRepository implements IRoomRepository {
  constructor(private readonly tables: InMemoryGameTables) {}

  async getRoomByCode(roomCode: string): Promise<Room | undefined> {
    const room = this.tables.rooms.get(roomCode);
    return room ? structuredClone(room) : undefined;
  }

  async create(room: Room): Promise<Room> {
    if (this.tables.rooms.has(room.code)) {
      throw new Error(
        `Unique violation on rooms.code: "${room.code}" already exists (expected a fresh Code)`
      );
    }
    this.tables.rooms.set(room.code, structuredClone(room));
    return structuredClone(room);
  }

  /**
   * Every LOBBY Room with a head count. Postgres inner-joins the Host's users
   * row; here the Host's joined profile plays that part.
   *
   * @example
   * const lobbies = await store.rooms.listLobbyRooms();
   */
  async listLobbyRooms(): Promise<RoomListing[]> {
    const lobbies = [...this.tables.rooms.values()].filter(
      room => room.status === 'LOBBY'
    );
    return lobbies.flatMap(room => {
      const host = this.tables.users.get(room.hostId);
      return host ? [this.toRoomListing(room, host.username)] : [];
    });
  }

  /**
   * Patch a Room by Code. Any other key matches no row and yields undefined,
   * as the UPDATE ... RETURNING does: callers passing room.id froze round
   * numbers and Host reassignment until a425b40.
   *
   * @example
   * await store.rooms.update('ABC123', { round: 2 });
   */
  async update(roomCode: string, roomPatch: Partial<Room>): Promise<Room> {
    const room = this.tables.rooms.get(roomCode);
    if (!room) {
      return undefined as unknown as Room;
    }
    const updated = { ...room, ...definedOnly(roomPatch) };
    this.tables.rooms.set(roomCode, structuredClone(updated));
    return structuredClone(updated);
  }

  private toRoomListing(room: Room, hostUsername: string): RoomListing {
    const playerCount = this.tables.players.filter(
      row => row.roomCode === room.code
    ).length;
    return {
      id: room.id,
      code: room.code,
      maxPlayers: room.maxPlayers,
      maxPoints: room.maxPoints,
      playerCount,
      hostUsername,
      hasPassword: room.password !== null
    };
  }
}
