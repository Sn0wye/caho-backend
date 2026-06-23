import type { WhiteCard } from '@/schemas';
import { CardServiceFactory } from '../CardServiceFactory';
import type { IWhiteCardDealer } from './IWhiteCardDealer';

// Production dealer: draws fresh White Cards from the DB-backed pool for a Room,
// delegating de-dup/picked-card bookkeeping to CardService. See issues #1, #5.
export class WhiteCardDealer implements IWhiteCardDealer {
  async dealWhiteCards(roomCode: string, count: number): Promise<WhiteCard[]> {
    const cardService = CardServiceFactory(roomCode);
    return cardService.getNewWhiteCards(count);
  }
}
