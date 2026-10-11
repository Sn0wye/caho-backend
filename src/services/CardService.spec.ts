import type { Room, WhiteCard } from '@/schemas';
import { beforeEach, describe, expect, it } from 'vitest';
import { FakeRoomRepository } from './room/RoomService.fakes';
import { CardService } from './CardService';
import { FakeCardRepository } from './CardService.fakes';
import type { BlackCard } from '@/repositories/cards';

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

describe('CardService.getNewWhiteCards when the pool runs dry', () => {
  it('tops up from a restarted ledger instead of dealing short', async () => {
    const { service, rooms } = buildService({
      room: makeRoom({ pickedWhiteCards: ['w1', 'w2'] }),
      whiteCards: [white('w1'), white('w2'), white('w3')]
    });

    const drawn = await service.getNewWhiteCards(2);

    expect(drawn.map(card => card.id)).toEqual(['w3', 'w1']);
    const room = await rooms.getRoomByCode(ROOM_CODE);
    expect(room?.pickedWhiteCards).toEqual(['w3', 'w1']);
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

  it('reshuffles the discards, skipping the current card, once every card was shown', async () => {
    const { service, rooms } = buildService({
      room: makeRoom({ pickedBlackCards: ['b1', 'b2'], currentBlackCardId: 'b1' }),
      blackCards: [black('b1'), black('b2')]
    });

    const drawn = await service.getNewBlackCard();

    expect(drawn.id).toBe('b2');
    const room = await rooms.getRoomByCode(ROOM_CODE);
    expect(room?.pickedBlackCards).toEqual(['b2']);
  });

  it('throws with the Room code when the pack has no Black Card at all', async () => {
    const { service } = buildService({ blackCards: [] });

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
