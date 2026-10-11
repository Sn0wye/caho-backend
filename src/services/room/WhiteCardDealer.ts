import type { IGameStore } from '@/repositories/game-store/IGameStore';
import type { WhiteCard } from '@/schemas';
import { CardService } from '../CardService';
import type { IWhiteCardDealer } from './IWhiteCardDealer';

// Draws fresh White Cards from the store's card pool for a Room, delegating
// de-dup/picked-card bookkeeping to CardService. See issues #1, #5, #24.
export class WhiteCardDealer implements IWhiteCardDealer {
  constructor(private readonly store: Pick<IGameStore, 'cards' | 'rooms'>) {}

  async dealWhiteCards(roomCode: string, count: number): Promise<WhiteCard[]> {
    const cardService = new CardService(
      roomCode,
      this.store.cards,
      this.store.rooms
    );
    return cardService.getNewWhiteCards(count);
  }
}
