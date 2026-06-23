import { db } from '@/db';
import { roomPlayers } from '@/db/schema';
import type { Player } from '@/schemas';
import { and, eq, sql } from 'drizzle-orm';
import type { IRoomPlayersRepository } from './IRoomPlayersRepository';

export class RoomPlayersRepository implements IRoomPlayersRepository {
  private db: typeof db;

  constructor() {
    this.db = db;
  }

  async getRoomPlayersByCode(roomCode: string): Promise<Player[]> {
    const players = await this.db.query.roomPlayers.findMany({
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

  async addPlayerToRoom({
    player,
    roomCode
  }: {
    player: Player;
    roomCode: string;
  }): Promise<void> {
    await this.db.insert(roomPlayers).values({
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
