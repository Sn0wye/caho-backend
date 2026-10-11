import type { WhiteCard } from '@/schemas';
import { CardService } from '@/services/CardService';
import { FakeCardRepository } from '@/services/CardService.fakes';
import {
  buildService,
  makePlayer,
  makeRoom
} from '@/services/room/RoomService.fixtures';

// One in-memory Room behind the real RoomService, so the Room read routes can be
// exercised over HTTP without Postgres. Each Player holds a distinct Hand, and
// the Judge carries the stored `isJudge` flag, so a leak of either is visible.
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

// Stands in for CardServiceFactory: the real CardService over an in-memory pool
// holding every Player's Hand.
export function fakeRoomReadsCardService(roomCode: string): CardService {
  return new CardService(
    roomCode,
    new FakeCardRepository([...CALLER_HAND, ...JUDGE_HAND], []),
    roomReadsFixture.fakes.room
  );
}
