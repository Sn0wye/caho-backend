import type { ICardRepository } from '@/repositories/cards';
import type { IRankingRepository } from '@/repositories/ranking';
import type { IRoomRepository } from '@/repositories/room';
import type { IRoomPlayersRepository } from '@/repositories/room-players';
import type { IRoundRepository } from '@/repositories/round';
import type { IRoundPlayedCardsRepository } from '@/repositories/round-played-cards';
import type { IRoundTimerRepository } from '@/services/round/IRoundTimerRepository';

// Everything the game loop reads/writes about a Round: the RoomService surface
// plus the timer engine's lookup and expired-active sweep (ADR-0003).
export type IGameRoundRepository = IRoundRepository & IRoundTimerRepository;

/**
 * The persistence the game loop needs, as one seam with two adapters: Postgres
 * (the drizzle repositories) and InMemoryGameStore. Both must honour the same
 * rules, which gameStore.contract checks against each (issue #24):
 * - `isJudge` is derived from the Room's `judgeId` on read, never stored (ADR-0005);
 * - one Played Cards entry per (Round, Player), readable straight after a write;
 * - `rounds.claimAdvance` only moves a Round out of the allowed phases (ADR-0003);
 * - drawing a Black Card through `cards` + `rooms` sets the Room's current card.
 *
 * @example
 * const store: IGameStore = new InMemoryGameStore({ whiteCards, blackCards });
 * await store.rounds.claimAdvance(roundId, 'PLAYING', 'JUDGING');
 */
export interface IGameStore {
  readonly rooms: IRoomRepository;
  readonly players: IRoomPlayersRepository;
  readonly ranking: IRankingRepository;
  readonly rounds: IGameRoundRepository;
  readonly playedCards: IRoundPlayedCardsRepository;
  readonly cards: ICardRepository;
}
