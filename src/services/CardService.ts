import type { IRoomRepository } from '@/repositories/room';
import type { BlackCard, ICardRepository } from '@/repositories/cards';
import type { Room, WhiteCard } from '@/schemas';

// Draws White/Black Cards for a Room from the DB-backed card pool, recording
// each pick on the Room so a card never repeats within that Room. The picked
// ledgers double as the draw record. Cards moved from the in-memory base pack
// to the database in issue #5 (a 1:1 swap).
export class CardService {
  constructor(
    private readonly roomCode: string,
    private readonly cardRepository: ICardRepository,
    private readonly roomRepository: IRoomRepository
  ) {}

  private async getRoom(): Promise<Room> {
    const room = await this.roomRepository.getRoomByCode(this.roomCode);
    if (!room) {
      throw new Error(`No Room found for code: ${this.roomCode}`);
    }
    return room;
  }

  public async getNewWhiteCards(count = 1): Promise<WhiteCard[]> {
    const room = await this.getRoom();
    const cards = await this.cardRepository.drawWhiteCards({
      count,
      excludeIds: room.pickedWhiteCards
    });

    await this.roomRepository.update(this.roomCode, {
      pickedWhiteCards: [...room.pickedWhiteCards, ...cards.map(c => c.id)]
    });

    return cards;
  }

  public async getNewBlackCard(): Promise<BlackCard> {
    const room = await this.getRoom();
    const card = await this.cardRepository.drawBlackCard({
      excludeIds: room.pickedBlackCards
    });

    if (!card) {
      throw new Error(`No Black Card left to draw for Room: ${this.roomCode}`);
    }

    await this.roomRepository.update(this.roomCode, {
      pickedBlackCards: [...room.pickedBlackCards, card.id],
      currentBlackCardId: card.id
    });

    return card;
  }

  public async getWhiteCardById(id: string): Promise<WhiteCard | undefined> {
    return this.cardRepository.findWhiteCardById(id);
  }

  public async getBlackCardById(id: string): Promise<BlackCard | undefined> {
    return this.cardRepository.findBlackCardById(id);
  }

  public async resetDeck(): Promise<void> {
    await this.roomRepository.update(this.roomCode, {
      pickedWhiteCards: [],
      pickedBlackCards: []
    });
  }
}
