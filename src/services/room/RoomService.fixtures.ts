import type { CreateRoundPlayedCardDTO } from '@/dto/CreateRoundPlayedCard';
import type { BlackCard } from '@/repositories/cards';
import { InMemoryGameStore } from '@/repositories/game-store/InMemoryGameStore';
import {
  type GameSeed,
  makeBlackCard,
  makeWhiteCard,
  seedGame
} from '@/repositories/game-store/gameStore.fixtures';
import type { Player, RoomPlayer, WhiteCard } from '@/schemas';
import { BlackCardDeck } from './BlackCardDeck';
import { RoomService } from './RoomService';
import { WhiteCardDealer } from './WhiteCardDealer';

// Shared builders for the RoomService specs: the real RoomService, deck and
// dealer over one InMemoryGameStore, seeded through the store's interface.
// See issue #24 (the per-service fakes this replaced didn't behave like Postgres).

import { ROOM_CODE } from '@/repositories/game-store/gameStore.fixtures';

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
 * A freshly seeded InMemoryGameStore whose card pool covers every seeded card.
 *
 * @example
 * const store = await buildStore({ room: makeRoom(), players: [makePlayer()] });
 */
export async function buildStore(
  seed: GameSeed & { blackCards?: BlackCard[] }
): Promise<InMemoryGameStore> {
  const store = new InMemoryGameStore({
    whiteCards: whiteCardPool(seed.players ?? [], seed.playedCards ?? []),
    blackCards: seed.blackCards ?? DEFAULT_BLACK_CARDS
  });
  await seedGame(store, seed);
  return store;
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
  const store = await buildStore(seed);
  const service = new RoomService(
    store,
    new WhiteCardDealer(store),
    new BlackCardDeck(store)
  );
  return { service, store };
}

/**
 * What a room.* payload carries for makePlayer({ id }): no Hand, no isJudge
 * (ADR-0005). Written out so it can't mirror toRoomPlayer.
 *
 * @example
 * makeRoomPlayer('player-a', { isReady: true });
 */
export function makeRoomPlayer(
  id: string,
  overrides: Partial<RoomPlayer> = {}
): RoomPlayer {
  return {
    id,
    username: id,
    avatarUrl: null,
    isHost: false,
    isReady: false,
    isActive: true,
    score: 0,
    ...overrides
  };
}

/**
 * A Player of the fixture Room as stored, or undefined once they Leave.
 *
 * @example
 * expect((await findPlayer(store, 'player-a'))?.score).toBe(1);
 */
export async function findPlayer(
  store: InMemoryGameStore,
  id: string
): Promise<Player | undefined> {
  return await store.players.getPlayerFromRoom(ROOM_CODE, id);
}
