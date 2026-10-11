import type { IRoomRepository } from '@/repositories/room';
import type { RoomPlayer, WhiteCard } from '@/schemas';
import { CardService } from '@/services/CardService';
import { FakeCardRepository } from '@/services/CardService.fakes';
import {
  buildService,
  makePlayer,
  makeRoom
} from '@/services/room/RoomService.fixtures';

// One in-memory Room behind the real RoomService, so the Room read routes can be
// exercised over HTTP without Postgres. Each Player holds a distinct Hand, and
// the Judge carries the derived `isJudge` flag, so a leak of either is visible.
// See issue #27.

export const CALLER_ID = 'player-caller';
export const JUDGE_ID = 'player-judge';

const whiteCard = (id: string): WhiteCard => ({
  id,
  text: `white ${id}`,
  packId: 'base-pack'
});

export const CALLER_HAND = [whiteCard('caller-1'), whiteCard('caller-2')];
const JUDGE_HAND = [whiteCard('judge-1'), whiteCard('judge-2')];

export const roomReadsFixture = buildService({
  room: makeRoom({ hostId: JUDGE_ID, judgeId: JUDGE_ID }),
  players: [
    makePlayer({
      id: CALLER_ID,
      username: 'caller',
      cardIds: CALLER_HAND.map(card => card.id)
    }),
    makePlayer({
      id: JUDGE_ID,
      username: 'judge',
      isHost: true,
      isJudge: true,
      score: 2,
      cardIds: JUDGE_HAND.map(card => card.id)
    })
  ],
  rounds: [],
  playedCards: []
});

// What GET /:roomCode/players must return for the fixture: the public RoomPlayer
// view of each Player, written out by hand so it can't mirror toRoomPlayer.
export const EXPECTED_ROOM_PLAYERS: RoomPlayer[] = [
  {
    id: CALLER_ID,
    username: 'caller',
    avatarUrl: null,
    isHost: false,
    isReady: false,
    isActive: true,
    score: 0
  },
  {
    id: JUDGE_ID,
    username: 'judge',
    avatarUrl: null,
    isHost: true,
    isReady: false,
    isActive: true,
    score: 2
  }
];

/**
 * Stands in for CardServiceFactory: the real CardService over an in-memory pool
 * holding every Player's Hand.
 *
 * @example
 * buildRoomReadsCardService(ROOM_CODE, roomReadsFixture.fakes.room);
 */
export function buildRoomReadsCardService(
  roomCode: string,
  rooms: IRoomRepository
): CardService {
  return new CardService(
    roomCode,
    new FakeCardRepository([...CALLER_HAND, ...JUDGE_HAND], []),
    rooms
  );
}
