import type { BlackCard } from '@/repositories/cards';
import { CardServiceFactory } from '../CardServiceFactory';
import type { IBlackCardDeck } from './IBlackCardDeck';

// Production deck: draws from the DB-backed pool through CardService, which also
// sets the Room's current Black Card. Mirrors WhiteCardDealer.
export class BlackCardDeck implements IBlackCardDeck {
  async drawBlackCard(roomCode: string): Promise<BlackCard> {
    return CardServiceFactory(roomCode).getNewBlackCard();
  }

  async findBlackCard(
    roomCode: string,
    id: string
  ): Promise<BlackCard | undefined> {
    return CardServiceFactory(roomCode).getBlackCardById(id);
  }
}
