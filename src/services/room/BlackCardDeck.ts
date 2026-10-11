import type { BlackCard } from '@/repositories/cards';
import type { IGameStore } from '@/repositories/game-store/IGameStore';
import { CardService } from '../CardService';
import type { IBlackCardDeck } from './IBlackCardDeck';

// Draws from the store's card pool through CardService, which also sets the
// Room's current Black Card. Taking the store (not CardServiceFactory) lets the
// in-memory store run the same draw as Postgres (issue #24). Mirrors
// WhiteCardDealer.
export class BlackCardDeck implements IBlackCardDeck {
  constructor(private readonly store: Pick<IGameStore, 'cards' | 'rooms'>) {}

  async drawBlackCard(roomCode: string): Promise<BlackCard> {
    return this.cardService(roomCode).getNewBlackCard();
  }

  async findBlackCard(
    roomCode: string,
    id: string
  ): Promise<BlackCard | undefined> {
    return this.cardService(roomCode).getBlackCardById(id);
  }

  private cardService(roomCode: string): CardService {
    return new CardService(roomCode, this.store.cards, this.store.rooms);
  }
}
