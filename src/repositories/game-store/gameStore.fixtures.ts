import type { CreateRoundPlayedCardDTO } from '@/dto/CreateRoundPlayedCard';
import type { BlackCard } from '@/repositories/cards';
import type { Player, PublicUser, Room, Round, WhiteCard } from '@/schemas';
import type { IGameStore } from './IGameStore';
import type { CardPool } from './InMemoryGameStore';

// Builders + seeders shared by the game-store contract and the game-loop specs.
// Seeders write only through the IGameStore interface, so a spec never reaches
// into an adapter's internals and can't seed state Postgres would refuse (e.g.
// a stored isJudge flag). See issue #24.

export const ROOM_CODE = 'ABC123';
const CARD_PACK_ID = 'fake-pack';

// Postgres needs a users row behind every hostId/judgeId/playerId (FKs). The
// in-memory store keeps the profile a Player joined with, so it needs none.
export type UserRegistry = {
  // Create a placeholder User if missing; never overwrite a real profile.
  ensureUser(id: string): Promise<void>;
  // Create or update a User with this profile.
  registerUser(user: PublicUser): Promise<void>;
};

// One adapter under gameStore.contract.
export type GameStoreHarness = {
  name: string;
  // Backs the hostId/judgeId/playerId references seeds make; Postgres only.
  users?: UserRegistry;
  // A store with no game data, holding only CONTRACT_POOL as its cards.
  open(): Promise<IGameStore>;
};

/**
 * A Player (active, no score, empty Hand) with overrides. The username
 * defaults to the id so payloads read plainly.
 *
 * @example
 * makePlayer({ id: 'player-a', cardIds: ['w1'] });
 */
export function makePlayer(overrides: Partial<Player> = {}): Player {
  const id = overrides.id ?? 'player-1';
  return {
    id,
    username: id,
    avatarUrl: null,
    isHost: false,
    isReady: false,
    isJudge: false,
    isActive: true,
    score: 0,
    cardIds: [],
    ...overrides
  };
}

/**
 * An IN_PROGRESS Room on Round 1, judged by 'player-judge', with overrides.
 *
 * @example
 * makeRoom({ status: 'LOBBY', round: 0, judgeId: null });
 */
export function makeRoom(overrides: Partial<Room> = {}): Room {
  return {
    id: 'room-1',
    code: ROOM_CODE,
    maxPlayers: 10,
    maxPoints: 5,
    status: 'IN_PROGRESS',
    hostId: 'player-judge',
    password: null,
    isPublic: true,
    prevJudgeId: null,
    judgeId: 'player-judge',
    round: 1,
    pickedWhiteCards: [],
    pickedBlackCards: [],
    currentBlackCardId: 'black-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  };
}

/**
 * Round 1 of ROOM_CODE, PLAYING with no deadlines, with overrides.
 *
 * @example
 * makeRound({ status: 'JUDGING', judgeDeadline: new Date() });
 */
export function makeRound(overrides: Partial<Round> = {}): Round {
  return {
    id: 'round-1',
    roomCode: ROOM_CODE,
    roundNumber: 1,
    blackCardId: 'black-1',
    judgeId: 'player-judge',
    roundWinnerId: null,
    status: 'PLAYING',
    playDeadline: null,
    judgeDeadline: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  };
}

/**
 * A White Card in the fixture pack, its text derived from the id.
 *
 * @example
 * makeWhiteCard('w1'); // { id: 'w1', text: 'white w1', packId: 'fake-pack' }
 */
export function makeWhiteCard(id: string): WhiteCard {
  return { id, text: `white ${id}`, packId: CARD_PACK_ID };
}

/**
 * A pick-1 Black Card in the fixture pack, with overrides.
 *
 * @example
 * makeBlackCard({ id: 'black-2', pick: 2 });
 */
export function makeBlackCard(overrides: Partial<BlackCard> = {}): BlackCard {
  return {
    id: 'black-1',
    text: 'black prompt',
    pick: 1,
    packId: CARD_PACK_ID,
    ...overrides
  };
}

// Create a Room, registering the Users its host/Judge columns point at.
async function seedRoom(
  store: IGameStore,
  room: Room,
  users?: UserRegistry
): Promise<void> {
  const referenced = [room.hostId, room.judgeId, room.prevJudgeId];
  for (const id of referenced) {
    if (id) await users?.ensureUser(id);
  }
  await store.rooms.create(room);
}

// Join a Player, then apply the per-Room state a join can't set (score, Hand,
// presence). `isJudge` is ignored on purpose: it comes from the Room's judgeId.
async function seedPlayer(
  store: IGameStore,
  roomCode: string,
  player: Player,
  users?: UserRegistry
): Promise<void> {
  const { id, username, avatarUrl } = player;
  await users?.registerUser({ id, username, avatarUrl });
  await store.players.addPlayerToRoom({ roomCode, player });
  await store.players.updatePlayerInRoom(roomCode, player.id, {
    score: player.score,
    isReady: player.isReady,
    isHost: player.isHost,
    isActive: player.isActive,
    cardIds: player.cardIds
  });
}

export type GameSeed = {
  room: Room;
  players?: Player[];
  rounds?: Round[];
  playedCards?: CreateRoundPlayedCardDTO[];
};

/**
 * Seed a whole game in FK order: Room, Players, Rounds, then Played Cards.
 *
 * @example
 * await seedGame(store, { room: makeRoom(), players: [makePlayer()], rounds: [makeRound()] });
 */
export async function seedGame(
  store: IGameStore,
  seed: GameSeed,
  users?: UserRegistry
): Promise<void> {
  await seedRoom(store, seed.room, users);
  for (const player of seed.players ?? []) {
    await seedPlayer(store, seed.room.code, player, users);
  }
  for (const round of seed.rounds ?? []) {
    await store.rounds.create(round);
  }
  for (const answer of seed.playedCards ?? []) {
    await store.playedCards.create(answer);
  }
}

// The card catalogue every contract case opens with.
export const CONTRACT_POOL: CardPool = {
  whiteCards: ['w1', 'w2', 'w3', 'w4'].map(makeWhiteCard),
  blackCards: [
    makeBlackCard({ id: 'black-1' }),
    makeBlackCard({ id: 'black-2' })
  ]
};

/**
 * Open a harness store holding one Room with these Rounds.
 *
 * @example
 * const store = await openWithRounds(harness, [makeRound({ status: 'JUDGING' })]);
 */
export async function openWithRounds(
  harness: GameStoreHarness,
  rounds: Round[]
): Promise<IGameStore> {
  const store = await harness.open();
  await seedGame(store, { room: makeRoom(), rounds }, harness.users);
  return store;
}
