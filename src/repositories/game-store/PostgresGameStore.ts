import { CardRepository } from '@/repositories/cards';
import { RankingRepository } from '@/repositories/ranking';
import { RoomRepository } from '@/repositories/room';
import { RoomPlayersRepository } from '@/repositories/room-players';
import { RoundRepository } from '@/repositories/round';
import { RoundPlayedCardsRepository } from '@/repositories/round-played-cards';
import type { IGameStore } from './IGameStore';

/**
 * Production game store: the drizzle repositories behind the IGameStore seam.
 *
 * @example
 * const store = PostgresGameStoreFactory();
 * await store.rooms.getRoomByCode('ABC123');
 */
export function PostgresGameStoreFactory(): IGameStore {
  return {
    rooms: new RoomRepository(),
    players: new RoomPlayersRepository(),
    ranking: new RankingRepository(),
    rounds: new RoundRepository(),
    playedCards: new RoundPlayedCardsRepository(),
    cards: new CardRepository()
  };
}
