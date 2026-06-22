import { basePack } from '@/cards/base-pack';
import type { WhiteCard } from '@/schemas';
import { CardService } from '../CardService';
import type { IWhiteCardDealer } from './IWhiteCardDealer';

// Production dealer: draws fresh White Cards from the base pack for a Room,
// delegating de-dup/picked-card bookkeeping to CardService. See issue #1.
export class WhiteCardDealer implements IWhiteCardDealer {
  async dealWhiteCards(roomCode: string, count: number): Promise<WhiteCard[]> {
    const cardService = new CardService(roomCode, basePack);
    return cardService.getNewWhiteCards(count);
  }
}
