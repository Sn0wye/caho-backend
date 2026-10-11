import type { CreateRoundPlayedCardDTO } from '@/dto/CreateRoundPlayedCard';
import type { BlackCard } from '@/repositories/cards';
import { InMemoryGameStore } from '@/repositories/game-store/InMemoryGameStore';
import {
  type GameSeed,
  makeBlackCard,
  makeWhiteCard,
  seedGame
} from '@/repositories/game-store/gameStore.fixtures';
import type { Player, WhiteCard } from '@/schemas';
import { BlackCardDeck } from './BlackCardDeck';
import { RoomService } from './RoomService';
import { WhiteCardDealer } from './WhiteCardDealer';

// Shared builders for the RoomService specs: the real RoomService, deck and
// dealer over one InMemoryGameStore, seeded through the store's interface.
// See issue #24 (the per-service fakes this replaced didn't behave like Postgres).

export {
  ROOM_CODE,
  makePlayer,
  makeRoom,
  makeRound
} from '@/repositories/game-store/gameStore.fixtures';

/**
 * A Player's Played Cards for a Round, one card of their own named after them.
 *
 * @example
 * await buildService({ room, players, rounds, playedCards: [makePlayedCards('player-a')] });
 */
export function makePlayedCards(
  playerId: string,
  roundId = 'round-1'
): CreateRoundPlayedCardDTO {
  return { roundId, playerId, whiteCardIds: [`card-${playerId}`] };
}

// Enough undealt White Cards for a full table's Hands, listed first so draws
// (in pool order) never hand back a card a seeded Hand already holds.
const DEALABLE_WHITE_CARDS = Array.from({ length: 60 }, (_, i) =>
  makeWhiteCard(`pool-${i + 1}`)
);

const DEFAULT_BLACK_CARDS = [
  makeBlackCard({ id: 'black-1' }),
  makeBlackCard({ id: 'black-2' })
];

// Every card a seeded Hand or Played Cards entry names must exist in the pool, like the
// white_cards FK requires.
function whiteCardPool(
  players: Player[],
  playedCards: CreateRoundPlayedCardDTO[]
): WhiteCard[] {
  const named = [
    ...players.flatMap(player => player.cardIds),
    ...playedCards.flatMap(answer => answer.whiteCardIds)
  ];
  return [...DEALABLE_WHITE_CARDS, ...[...new Set(named)].map(makeWhiteCard)];
}

/**
 * The real RoomService over a freshly seeded InMemoryGameStore.
 *
 * @example
 * const { service, store } = await buildService({ room: makeRoom(), players: [makePlayer()] });
 */
export async function buildService(
  seed: GameSeed & { blackCards?: BlackCard[] }
): Promise<{ service: RoomService; store: InMemoryGameStore }> {
  const store = new InMemoryGameStore({
    whiteCards: whiteCardPool(seed.players ?? [], seed.playedCards ?? []),
    blackCards: seed.blackCards ?? DEFAULT_BLACK_CARDS
  });
  await seedGame(store, seed);

  const service = new RoomService(
    store,
    new WhiteCardDealer(store),
    new BlackCardDeck(store)
  );
  return { service, store };
}
