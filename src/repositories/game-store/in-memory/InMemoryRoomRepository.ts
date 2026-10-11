import type { IRoomRepository } from '@/repositories/room';
import type { PublicRoomWithPlayerCountAndHost, Room } from '@/schemas';
import {
  type InMemoryGameTables,
  cloneRow,
  definedOnly
} from './InMemoryGameTables';

// rooms table, keyed by Code like RoomRepository.
export class InMemoryRoomRepository implements IRoomRepository {
  constructor(private readonly tables: InMemoryGameTables) {}

  async getRoomByCode(roomCode: string): Promise<Room | undefined> {
    const room = this.tables.rooms.get(roomCode);
    return room ? cloneRow(room) : undefined;
  }

  async create(data: Room): Promise<Room> {
    if (this.tables.rooms.has(data.code)) {
      throw new Error(
        `Unique violation on rooms.code: "${data.code}" already exists (expected a fresh Code)`
      );
    }
    this.tables.rooms.set(data.code, cloneRow(data));
    return cloneRow(data);
  }

  // Public LOBBY Rooms with a head count. Postgres inner-joins the host's users
  // row; here the host's joined profile plays that part.
  async listPublicRooms(): Promise<PublicRoomWithPlayerCountAndHost[]> {
    const open = [...this.tables.rooms.values()].filter(
      room => room.isPublic && room.status === 'LOBBY'
    );
    return open.flatMap(room => {
      const host = this.tables.users.get(room.hostId);
      return host ? [this.toPublicRoom(room, host.username)] : [];
    });
  }

  // Keyed by Code: any other key matches no row and yields undefined, as the
  // UPDATE ... RETURNING does (the bug that froze round numbers passed room.id).
  async update(roomCode: string, data: Partial<Room>): Promise<Room> {
    const room = this.tables.rooms.get(roomCode);
    if (!room) {
      return undefined as unknown as Room;
    }
    const updated = { ...room, ...definedOnly(data) };
    this.tables.rooms.set(roomCode, cloneRow(updated));
    return cloneRow(updated);
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
