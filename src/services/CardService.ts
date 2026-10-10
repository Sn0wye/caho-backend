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

  // Draws `count` unseen White Cards. When the pool runs dry the ledger
  // restarts so a long game keeps dealing; recycled cards may repeat ones still
  // held in another Hand, which is harmless (plays are per Player).
  public async getNewWhiteCards(count = 1): Promise<WhiteCard[]> {
    const room = await this.getRoom();
    const fresh = await this.cardRepository.drawWhiteCards({
      count,
      excludeIds: room.pickedWhiteCards
    });
    const recycled = fresh.length < count
      ? await this.cardRepository.drawWhiteCards({
          count: count - fresh.length,
          excludeIds: fresh.map(c => c.id)
        })
      : [];

    const drawnIds = [...fresh, ...recycled].map(c => c.id);
    const ledger = recycled.length > 0 ? drawnIds : [...room.pickedWhiteCards, ...drawnIds];
    await this.roomRepository.update(this.roomCode, { pickedWhiteCards: ledger });

    return [...fresh, ...recycled];
  }

  // Draws an unseen Black Card, reshuffling the discards (all but the current
  // card) once every card has been shown. The base pack has ~117, fewer than a
  // long many-Player game needs; this used to throw and wedge the Room.
  public async getNewBlackCard(): Promise<BlackCard> {
    const room = await this.getRoom();
    const fresh = await this.cardRepository.drawBlackCard({
      excludeIds: room.pickedBlackCards
    });
    const card = fresh ?? (await this.cardRepository.drawBlackCard({
      excludeIds: room.currentBlackCardId ? [room.currentBlackCardId] : []
    }));

    if (!card) {
      throw new Error(`No Black Card left to draw for Room: ${this.roomCode}`);
    }

    await this.roomRepository.update(this.roomCode, {
      pickedBlackCards: fresh ? [...room.pickedBlackCards, card.id] : [card.id],
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
