import type { Room, WhiteCard } from '@/schemas';
import { beforeEach, describe, expect, it } from 'vitest';
import { FakeRoomRepository } from './room/RoomService.fakes';
import { CardService } from './CardService';
import type { BlackCard, ICardRepository } from '@/repositories/cards';

const ROOM_CODE = 'ABC123';

function makeRoom(overrides: Partial<Room> = {}): Room {
  return {
    id: 'room-1',
    code: ROOM_CODE,
    maxPlayers: 8,
    maxPoints: 10,
    status: 'IN_PROGRESS',
    hostId: 'host-1',
    password: null,
    isPublic: true,
    prevJudgeId: null,
    judgeId: 'judge-1',
    round: 1,
    pickedWhiteCards: [],
    pickedBlackCards: [],
    currentBlackCardId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  };
}

// Deterministic, exclusion-respecting pool so draw assertions are stable. The
// production repo selects at random in SQL; here we hand cards out in order,
// honouring excludeIds exactly as the SQL NOT IN clause would.
class FakeCardRepository implements ICardRepository {
  constructor(
    private readonly whiteCards: WhiteCard[],
    private readonly blackCards: BlackCard[]
  ) {}

  async drawWhiteCards(input: { count: number; excludeIds: string[] }) {
    return this.whiteCards
      .filter(card => !input.excludeIds.includes(card.id))
      .slice(0, input.count);
  }

  async drawBlackCard(input: { excludeIds: string[] }) {
    return this.blackCards.find(card => !input.excludeIds.includes(card.id));
  }

  async findWhiteCardById(id: string) {
    return this.whiteCards.find(card => card.id === id);
  }

  async findBlackCardById(id: string) {
    return this.blackCards.find(card => card.id === id);
  }
}

function white(id: string): WhiteCard {
  return { id, text: `white ${id}`, packId: 'base-pack' };
}

function black(id: string): BlackCard {
  return { id, text: `black ${id}`, pick: 1, packId: 'base-pack' };
}

function buildService(args: {
  room?: Room;
  whiteCards?: WhiteCard[];
  blackCards?: BlackCard[];
}) {
  const rooms = new FakeRoomRepository(args.room ?? makeRoom());
  const cards = new FakeCardRepository(
    args.whiteCards ?? [],
    args.blackCards ?? []
  );
  const service = new CardService(ROOM_CODE, cards, rooms);
  return { service, rooms };
}

describe('CardService.getNewWhiteCards', () => {
  it('draws from the card repository, excluding the Room picked cards', async () => {
    const { service } = buildService({
      room: makeRoom({ pickedWhiteCards: ['w1'] }),
      whiteCards: [white('w1'), white('w2'), white('w3')]
    });

    const drawn = await service.getNewWhiteCards(2);

    expect(drawn.map(card => card.id)).toEqual(['w2', 'w3']);
  });

  it('records drawn ids so the same card never repeats within a Room', async () => {
    const { service, rooms } = buildService({
      whiteCards: [white('w1'), white('w2'), white('w3'), white('w4')]
    });

    const first = await service.getNewWhiteCards(2);
    const second = await service.getNewWhiteCards(2);

    const ids = [...first, ...second].map(card => card.id);
    expect(new Set(ids).size).toBe(4);
    const room = await rooms.getRoomByCode(ROOM_CODE);
    expect(room?.pickedWhiteCards).toEqual(['w1', 'w2', 'w3', 'w4']);
  });
});

describe('CardService.getNewBlackCard', () => {
  it('draws a Black Card excluding picked ones and sets it as current', async () => {
    const { service, rooms } = buildService({
      room: makeRoom({ pickedBlackCards: ['b1'] }),
      blackCards: [black('b1'), black('b2')]
    });

    const drawn = await service.getNewBlackCard();

    expect(drawn.id).toBe('b2');
    const room = await rooms.getRoomByCode(ROOM_CODE);
    expect(room?.pickedBlackCards).toEqual(['b1', 'b2']);
    expect(room?.currentBlackCardId).toBe('b2');
  });

  it('throws with the Room code when no Black Card is left to draw', async () => {
    const { service } = buildService({
      room: makeRoom({ pickedBlackCards: ['b1'] }),
      blackCards: [black('b1')]
    });

    await expect(service.getNewBlackCard()).rejects.toThrow(ROOM_CODE);
  });
});

describe('CardService lookups and reset', () => {
  it('finds cards by id through the repository', async () => {
    const { service } = buildService({
      whiteCards: [white('w1')],
      blackCards: [black('b1')]
    });

    expect((await service.getWhiteCardById('w1'))?.id).toBe('w1');
    expect((await service.getBlackCardById('b1'))?.id).toBe('b1');
    expect(await service.getWhiteCardById('missing')).toBeUndefined();
  });

  it('resetDeck clears both picked-card ledgers on the Room', async () => {
    const { service, rooms } = buildService({
      room: makeRoom({ pickedWhiteCards: ['w1'], pickedBlackCards: ['b1'] })
    });

    await service.resetDeck();

    const room = await rooms.getRoomByCode(ROOM_CODE);
    expect(room?.pickedWhiteCards).toEqual([]);
    expect(room?.pickedBlackCards).toEqual([]);
  });
});
