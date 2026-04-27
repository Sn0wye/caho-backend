import type { Ranking } from '@/schemas';

export interface IRankingRepository {
  getRankingByRoomCode(roomCode: string): Promise<Ranking>;
}
