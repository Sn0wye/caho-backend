import type { BlackCard } from '@/repositories/cards';
import type { WhiteCard } from '@/schemas';
import type { IGameStore } from './IGameStore';
import { InMemoryCardRepository } from './in-memory/InMemoryCardRepository';
import { InMemoryGameTables } from './in-memory/InMemoryGameTables';
import { InMemoryRankingRepository } from './in-memory/InMemoryRankingRepository';
import { InMemoryRoomPlayersRepository } from './in-memory/InMemoryRoomPlayersRepository';
import { InMemoryRoomRepository } from './in-memory/InMemoryRoomRepository';
import { InMemoryRoundPlayedCardsRepository } from './in-memory/InMemoryRoundPlayedCardsRepository';
import { InMemoryRoundRepository } from './in-memory/InMemoryRoundRepository';

/**
 * The one in-memory game store, held to the same contract as Postgres
 * (gameStore.contract). Replaces the per-service store fakes so game-loop
 * specs run against production rules. Seed it through its own interface (see
 * gameStore.fixtures), never through its tables. issue #24.
 *
 * @example
 * const store = new InMemoryGameStore({ whiteCards: [], blackCards: [card] });
 * await seedGame(store, { room: makeRoom(), players: [makePlayer()] });
 */
export class InMemoryGameStore implements IGameStore {
  readonly rooms: InMemoryRoomRepository;
  readonly players: InMemoryRoomPlayersRepository;
  readonly ranking: InMemoryRankingRepository;
  readonly rounds: InMemoryRoundRepository;
  readonly playedCards: InMemoryRoundPlayedCardsRepository;
  readonly cards: InMemoryCardRepository;

  constructor(pool: { whiteCards: WhiteCard[]; blackCards: BlackCard[] }) {
    const tables = new InMemoryGameTables(pool.whiteCards, pool.blackCards);
    this.rooms = new InMemoryRoomRepository(tables);
    this.players = new InMemoryRoomPlayersRepository(tables);
    this.ranking = new InMemoryRankingRepository(this.players);
    this.rounds = new InMemoryRoundRepository(tables);
    this.playedCards = new InMemoryRoundPlayedCardsRepository(tables);
    this.cards = new InMemoryCardRepository(tables);
  }
}
