import { db } from '@/db';
import { roomPlayers, rooms, users } from '@/db/schema';
import type { Room, RoomListing } from '@/schemas';
import { and, count, eq, isNotNull } from 'drizzle-orm';
import type { IRoomRepository } from './IRoomRepository';

export class RoomRepository implements IRoomRepository {
  private db: typeof db;

  constructor() {
    this.db = db;
  }

  async getRoomByCode(roomCode: string): Promise<Room | undefined> {
    const room = await this.db.query.rooms.findFirst({
      where: (rooms, { eq }) => eq(rooms.code, roomCode)
    });

    return room;
  }

  async create(data: Room): Promise<Room> {
    const room = (await this.db.insert(rooms).values(data).returning())[0];

    return room;
  }

  async listLobbyRooms(): Promise<RoomListing[]> {
    const lobbyRooms = await this.db
      .select({
        id: rooms.id,
        code: rooms.code,
        maxPlayers: rooms.maxPlayers,
        maxPoints: rooms.maxPoints,
        playerCount: count(roomPlayers.playerId).mapWith(Number),
        hostUsername: users.username,
        hasPassword: isNotNull(rooms.password).mapWith(Boolean)
      })
      .from(rooms)
      .innerJoin(users, eq(rooms.hostId, users.id))
      .leftJoin(roomPlayers, eq(rooms.code, roomPlayers.roomCode))
      .where(eq(rooms.status, 'LOBBY'))
      .groupBy(
        rooms.id,
        rooms.code,
        rooms.maxPlayers,
        rooms.maxPoints,
        users.username
      )
      .execute();

    // TODO: auto expire rooms

    return lobbyRooms;
  }

  async update(roomCode: string, data: Partial<Room>): Promise<Room> {
    const room = (
      await this.db
        .update(rooms)
        .set(data)
        .where(eq(rooms.code, roomCode))
        .returning()
    )[0];

    return room;
  }

  // The `status = 'LOBBY'` predicate is the guard: two racing starts both pass
  // the service's checks, but only one UPDATE matches a row, so the loser gets
  // null instead of redrawing the Black Card and re-dealing every Hand.
  async claimStart(
    roomCode: string,
    startPatch: Partial<Room>
  ): Promise<Room | null> {
    const [room] = await this.db
      .update(rooms)
      .set(startPatch)
      .where(and(eq(rooms.code, roomCode), eq(rooms.status, 'LOBBY')))
      .returning();

    return room ?? null;
  }
}
