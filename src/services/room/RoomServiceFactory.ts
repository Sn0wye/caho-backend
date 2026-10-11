import { PostgresGameStoreFactory } from '@/repositories/game-store/PostgresGameStore';
import { BlackCardDeck } from './BlackCardDeck';
import type { IRoomService } from './IRoomService';
import { RoomService } from './RoomService';
import { WhiteCardDealer } from './WhiteCardDealer';

export function RoomServiceFactory(): IRoomService {
  const store = PostgresGameStoreFactory();
  return new RoomService(
    store,
    new WhiteCardDealer(store),
    new BlackCardDeck(store)
  );
}
