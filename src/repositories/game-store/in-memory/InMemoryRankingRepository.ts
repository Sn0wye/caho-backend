import type { IRankingRepository } from '@/repositories/ranking';
import type { IRoomPlayersRepository } from '@/repositories/room-players';
import type { Ranking } from '@/schemas';

// The Ranking is a read over room_players, highest score first.
export class InMemoryRankingRepository implements IRankingRepository {
  constructor(private readonly players: IRoomPlayersRepository) {}

  /**
   * The Room's Players, highest score first.
   *
   * @example
   * const ranking = await store.ranking.getRankingByRoomCode('ABC123');
   */
  async getRankingByRoomCode(roomCode: string): Promise<Ranking> {
    const players = await this.players.getRoomPlayersByCode(roomCode);
    return players
      .sort((a, b) => b.score - a.score)
      .map(({ id, username, avatarUrl, score }) => ({
        id,
        username,
        avatarUrl,
        score
      }));
  }
}
