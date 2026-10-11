import type { IRoomPlayersRepository } from '@/repositories/room-players';
import type { Player } from '@/schemas';
import {
  type InMemoryGameTables,
  type PlayerRow,
  definedOnly
} from './InMemoryGameTables';

type PlayerColumns = Pick<
  PlayerRow,
  'score' | 'isReady' | 'isHost' | 'isActive' | 'cardIds'
>;

// Only the room_players columns are writable. drizzle drops the rest of a
// Partial<Player> (id, username, isJudge...), so an update can't fake a Judge.
function toColumns(payload: Partial<Player>): Partial<PlayerColumns> {
  const { score, isReady, isHost, isActive, cardIds } = payload;
  return definedOnly({ score, isReady, isHost, isActive, cardIds });
}

// room_players table. Reads join the profile (users) and derive isJudge from
// the Room's judgeId, like RoomPlayersRepository (ADR-0005).
export class InMemoryRoomPlayersRepository implements IRoomPlayersRepository {
  constructor(private readonly tables: InMemoryGameTables) {}

  async getRoomPlayersByCode(roomCode: string): Promise<Player[]> {
    return this.tables.players
      .filter(row => row.roomCode === roomCode)
      .map(row => this.toPlayer(row));
  }

  /**
   * Join a Player. Mirrors the INSERT: score 0, empty Hand, active; only the
   * Host and ready flags come from `player`.
   *
   * @example
   * await store.players.addPlayerToRoom({ roomCode: 'ABC123', player });
   */
  async addPlayerToRoom(input: {
    roomCode: string;
    player: Player;
  }): Promise<void> {
    const { roomCode, player } = input;
    this.tables.requireRoom(roomCode, `room_players(${player.id})`);
    this.assertNotJoined(roomCode, player.id);
    const { id, username, avatarUrl } = player;
    this.tables.users.set(id, { id, username, avatarUrl });
    this.tables.players.push({
      roomCode,
      playerId: id,
      score: 0,
      isReady: player.isReady,
      isHost: player.isHost,
      isActive: true,
      cardIds: []
    });
  }

  async getPlayerFromRoom(
    roomCode: string,
    playerId: string
  ): Promise<Player | undefined> {
    const row = this.findRow(roomCode, playerId);
    return row ? this.toPlayer(row) : undefined;
  }

  async getRoomCodesByPlayerId(playerId: string): Promise<string[]> {
    return this.tables.players
      .filter(row => row.playerId === playerId)
      .map(row => row.roomCode);
  }

  /**
   * Patch a Player's room_players columns. Matching no row is silent, as an
   * UPDATE is.
   *
   * @example
   * await store.players.updatePlayerInRoom('ABC123', 'player-a', { isReady: true });
   */
  async updatePlayerInRoom(
    roomCode: string,
    playerId: string,
    payload: Partial<Player>
  ): Promise<void> {
    const row = this.findRow(roomCode, playerId);
    if (row) Object.assign(row, structuredClone(toColumns(payload)));
  }

  async updatePlayers(roomCode: string, players: Player[]): Promise<Player[]> {
    for (const player of players) {
      await this.updatePlayerInRoom(roomCode, player.id, player);
    }
    return players;
  }

  async setPlayersAsUnready(roomCode: string): Promise<void> {
    for (const row of this.tables.players) {
      if (row.roomCode === roomCode) row.isReady = false;
    }
  }

  async incrementPlayerScore(input: {
    roomCode: string;
    playerId: string;
    by: number;
  }): Promise<void> {
    const row = this.findRow(input.roomCode, input.playerId);
    if (row) row.score += input.by;
  }

  /**
   * Remove a Player who Leaves. Their profile stays, as the users row does.
   *
   * @example
   * await store.players.deletePlayerFromRoom('ABC123', 'player-a');
   */
  async deletePlayerFromRoom(
    roomCode: string,
    playerId: string
  ): Promise<void> {
    const index = this.tables.players.findIndex(
      row => row.roomCode === roomCode && row.playerId === playerId
    );
    if (index !== -1) this.tables.players.splice(index, 1);
  }

  private assertNotJoined(roomCode: string, playerId: string): void {
    if (this.findRow(roomCode, playerId)) {
      throw new Error(
        `Unique violation on room_players: Player "${playerId}" already in Room "${roomCode}" (expected one row per Room and Player)`
      );
    }
  }

  private findRow(roomCode: string, playerId: string): PlayerRow | undefined {
    return this.tables.players.find(
      row => row.roomCode === roomCode && row.playerId === playerId
    );
  }

  private toPlayer(row: PlayerRow): Player {
    const profile = this.tables.users.get(row.playerId);
    const room = this.tables.rooms.get(row.roomCode);
    return {
      id: row.playerId,
      username: profile?.username ?? row.playerId,
      avatarUrl: profile?.avatarUrl ?? null,
      score: row.score,
      isHost: row.isHost,
      isReady: row.isReady,
      isJudge: room?.judgeId === row.playerId,
      isActive: row.isActive,
      cardIds: [...row.cardIds]
    };
  }
}
