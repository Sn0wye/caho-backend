import { makeWhiteCard } from '@/repositories/game-store/gameStore.fixtures';
import type { RoomPlayer } from '@/schemas';
import { CardService } from '@/services/CardService';
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

export const CALLER_HAND = [makeWhiteCard('caller-1'), makeWhiteCard('caller-2')];
const JUDGE_HAND = [makeWhiteCard('judge-1'), makeWhiteCard('judge-2')];

export const roomReadsFixture = await buildService({
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
  ]
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
 * Stands in for CardServiceFactory: the real CardService over the fixture's
 * in-memory store, whose pool holds every Player's Hand.
 *
 * @example
 * buildRoomReadsCardService(ROOM_CODE);
 */
export function buildRoomReadsCardService(roomCode: string): CardService {
  const { store } = roomReadsFixture;
  return new CardService(roomCode, store.cards, store.rooms);
}
