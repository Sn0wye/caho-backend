import { db } from '@/db';
import { roomPlayers, rooms } from '@/db/schema';
import type { Player, Room } from '@/schemas';
import { and, eq, sql } from 'drizzle-orm';
import type {
  AdmitPlayer,
  IRoomPlayersRepository
} from './IRoomPlayersRepository';

// The pool or an open transaction: reads and the join insert run on either.
type RoomPlayersExecutor = Pick<typeof db, 'query' | 'insert'>;

export class RoomPlayersRepository implements IRoomPlayersRepository {
  private db: typeof db;

  constructor() {
    this.db = db;
  }

  async getRoomPlayersByCode(roomCode: string): Promise<Player[]> {
    return await this.readRoomPlayers(this.db, roomCode);
  }

  async addPlayerToRoom({
    player,
    roomCode
  }: {
    player: Player;
    roomCode: string;
  }): Promise<void> {
    await this.insertPlayer(this.db, roomCode, player);
  }

  // SELECT ... FOR UPDATE on the Room serialises joins (and a racing start's
  // UPDATE) so two joins can't both count the same free seat past maxPlayers.
  async addPlayerToLockedRoom({
    roomCode,
    admit
  }: {
    roomCode: string;
    admit: AdmitPlayer;
  }): Promise<Room | undefined> {
    return await this.db.transaction(async tx => {
      const [room] = await tx
        .select()
        .from(rooms)
        .where(eq(rooms.code, roomCode))
        .for('update');
      if (!room) return undefined;

      const player = admit(room, await this.readRoomPlayers(tx, roomCode));
      await this.insertPlayer(tx, roomCode, player);
      return room;
    });
  }

  private async readRoomPlayers(
    executor: RoomPlayersExecutor,
    roomCode: string
  ): Promise<Player[]> {
    const players = await executor.query.roomPlayers.findMany({
      where: (roomPlayers, { eq }) => eq(roomPlayers.roomCode, roomCode),
      with: {
        player: true,
        room: true
      }
    });

    const mapped: Player[] = players.map(e => ({
      id: e.player.id,
      avatarUrl: e.player.avatarUrl,
      username: e.player.username,
      score: e.score,
      isHost: e.isHost,
      isReady: e.isReady,
      isJudge: e.room.judgeId === e.player.id,
      isActive: e.isActive,
      cardIds: e.cardIds
    }));

    return mapped;
  }

  private async insertPlayer(
    executor: RoomPlayersExecutor,
    roomCode: string,
    player: Player
  ): Promise<void> {
    await executor.insert(roomPlayers).values({
      score: 0,
      roomCode,
      playerId: player.id,
      isHost: player.isHost,
      isReady: player.isReady,
      cardIds: []
    });
  }

  async getPlayerFromRoom(
    roomCode: string,
    playerId: string
  ): Promise<Player | undefined> {
    const player = await this.db.query.roomPlayers.findFirst({
      where: and(
        eq(roomPlayers.roomCode, roomCode),
        eq(roomPlayers.playerId, playerId)
      ),
      with: {
        player: true,
        room: true
      }
    });

    if (!player) {
      return undefined;
    }

    return {
      id: player.player.id,
      avatarUrl: player.player.avatarUrl,
      username: player.player.username,
      score: player.score,
      isHost: player.isHost,
      // Judge identity lives on the Room (room.judgeId); derive it so every read
      // path agrees and it can't go stale across rotations. ADR-0005.
      isJudge: player.room.judgeId === player.player.id,
      isReady: player.isReady,
      isActive: player.isActive,
      cardIds: player.cardIds
    };
  }

  async getRoomCodesByPlayerId(playerId: string): Promise<string[]> {
    const rows = await this.db.query.roomPlayers.findMany({
      where: eq(roomPlayers.playerId, playerId),
      columns: { roomCode: true }
    });

    return rows.map(row => row.roomCode);
  }

  async updatePlayerInRoom(
    roomCode: string,
    playerId: string,
    payload: Partial<Player>
  ): Promise<void> {
    await this.db
      .update(roomPlayers)
      .set(payload)
      .where(
        and(
          eq(roomPlayers.roomCode, roomCode),
          eq(roomPlayers.playerId, playerId)
        )
      )
      .returning()
      .execute();
  }

  async incrementPlayerScore({
    roomCode,
    playerId,
    by
  }: {
    roomCode: string;
    playerId: string;
    by: number;
  }): Promise<void> {
    await this.db
      .update(roomPlayers)
      .set({
        score: sql`${roomPlayers.score} + ${by}`
      })
      .where(
        and(
          eq(roomPlayers.roomCode, roomCode),
          eq(roomPlayers.playerId, playerId)
        )
      )
      .execute();
  }

  async deletePlayerFromRoom(
    roomCode: string,
    playerId: string
  ): Promise<void> {
    await this.db
      .delete(roomPlayers)
      .where(
        and(
          eq(roomPlayers.roomCode, roomCode),
          eq(roomPlayers.playerId, playerId)
        )
      )
      .execute();
  }

  public async updatePlayers(
    roomCode: string,
    players: Player[]
  ): Promise<Player[]> {
    await db.transaction(async tx => {
      for (const player of players) {
        await tx
          .update(roomPlayers)
          .set({
            score: player.score,
            isReady: player.isReady,
            isHost: player.isHost,
            isActive: player.isActive,
            cardIds: player.cardIds
          })
          .where(
            and(
              eq(roomPlayers.roomCode, roomCode),
              eq(roomPlayers.playerId, player.id)
            )
          );
      }
    });

    return players;
  }

  public async setPlayersAsUnready(roomCode: string): Promise<void> {
    await this.db
      .update(roomPlayers)
      .set({
        isReady: false
      })
      .where(eq(roomPlayers.roomCode, roomCode))
      .returning();
  }
}
