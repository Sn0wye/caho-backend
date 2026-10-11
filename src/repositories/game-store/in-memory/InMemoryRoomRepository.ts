import type { IRoomRepository } from '@/repositories/room';
import type { PublicRoomWithPlayerCountAndHost, Room } from '@/schemas';
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
   * Public LOBBY Rooms with a head count. Postgres inner-joins the Host's users
   * row; here the Host's joined profile plays that part.
   *
   * @example
   * const lobbies = await store.rooms.listPublicRooms();
   */
  async listPublicRooms(): Promise<PublicRoomWithPlayerCountAndHost[]> {
    const open = [...this.tables.rooms.values()].filter(
      room => room.isPublic && room.status === 'LOBBY'
    );
    return open.flatMap(room => {
      const host = this.tables.users.get(room.hostId);
      return host ? [this.toPublicRoom(room, host.username)] : [];
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

  private toPublicRoom(
    room: Room,
    hostUsername: string
  ): PublicRoomWithPlayerCountAndHost {
    const playerCount = this.tables.players.filter(
      row => row.roomCode === room.code
    ).length;
    return {
      id: room.id,
      code: room.code,
      maxPlayers: room.maxPlayers,
      maxPoints: room.maxPoints,
      playerCount,
      hostUsername
    };
  }
}
