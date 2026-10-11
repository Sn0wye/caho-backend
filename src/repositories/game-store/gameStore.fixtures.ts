import type { BlackCard } from '@/repositories/cards';
import type { Player, PublicUser, Room, Round, WhiteCard } from '@/schemas';
import type { IGameStore } from './IGameStore';

// Builders + seeders shared by the game-store contract and the game-loop specs.
// Seeders write only through the IGameStore interface, so a spec never reaches
// into an adapter's internals and can't seed state Postgres would refuse (e.g.
// a stored isJudge flag). See issue #24.

export const ROOM_CODE = 'ABC123';
export const CARD_PACK_ID = 'fake-pack';

// Postgres needs a users row behind every hostId/judgeId/playerId (FKs); the
// in-memory adapter keeps the profile a Player joined with instead.
export type UserRegistry = {
  // Create a placeholder User if missing; never overwrite a real profile.
  ensureUser(id: string): Promise<void>;
  // Create or update a User with this profile.
  registerUser(user: PublicUser): Promise<void>;
};

export const IN_MEMORY_USERS: UserRegistry = {
  async ensureUser(): Promise<void> {},
  async registerUser(): Promise<void> {}
};

export type CardPool = { whiteCards: WhiteCard[]; blackCards: BlackCard[] };

// One adapter under gameStore.contract.
export type GameStoreHarness = UserRegistry & {
  name: string;
  // A store with no game data, holding only `pool` as its card catalogue.
  open(pool: CardPool): Promise<IGameStore>;
};

export function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: 'player-1',
    username: 'player-1',
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

export function makeWhiteCard(id: string): WhiteCard {
  return { id, text: `white ${id}`, packId: CARD_PACK_ID };
}

export function makeBlackCard(overrides: Partial<BlackCard> = {}): BlackCard {
  return {
    id: 'black-1',
    text: 'black prompt',
    pick: 1,
    packId: CARD_PACK_ID,
    ...overrides
  };
}

/**
 * Create a Room, registering the Users its host/Judge columns point at.
 *
 * @example
 * await seedRoom(store, makeRoom({ judgeId: 'player-a' }));
 */
export async function seedRoom(
  store: IGameStore,
  room: Room,
  users: UserRegistry = IN_MEMORY_USERS
): Promise<Room> {
  const referenced = [room.hostId, room.judgeId, room.prevJudgeId];
  for (const id of referenced) {
    if (id) await users.ensureUser(id);
  }
  return await store.rooms.create(room);
}

/**
 * Join a Player, then apply the per-Room state a join can't set (score, Hand,
 * presence). `isJudge` is ignored on purpose: it comes from the Room's judgeId.
 *
 * @example
 * await seedPlayer(store, ROOM_CODE, makePlayer({ id: 'player-a', score: 2 }));
 */
export async function seedPlayer(
  store: IGameStore,
  roomCode: string,
  player: Player,
  users: UserRegistry = IN_MEMORY_USERS
): Promise<void> {
  const { id, username, avatarUrl } = player;
  await users.registerUser({ id, username, avatarUrl });
  await store.players.addPlayerToRoom({ roomCode, player });
  await store.players.updatePlayerInRoom(roomCode, player.id, {
    score: player.score,
    isReady: player.isReady,
    isHost: player.isHost,
    isActive: player.isActive,
    cardIds: player.cardIds
  });
}

/**
 * Record a Player's Played Cards for a Round through the store.
 *
 * @example
 * await seedPlay(store, { roundId: 'round-1', playerId: 'player-a', whiteCardIds: ['w1'] });
 */
export async function seedPlay(
  store: IGameStore,
  play: { roundId: string; playerId: string; whiteCardIds: string[] }
): Promise<void> {
  await store.playedCards.create(play);
}

export type GameSeed = {
  room: Room;
  players?: Player[];
  rounds?: Round[];
  plays?: Array<{ roundId: string; playerId: string; whiteCardIds: string[] }>;
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
  users: UserRegistry = IN_MEMORY_USERS
): Promise<void> {
  await seedRoom(store, seed.room, users);
  for (const player of seed.players ?? []) {
    await seedPlayer(store, seed.room.code, player, users);
  }
  for (const round of seed.rounds ?? []) {
    await store.rounds.create(round);
  }
  for (const play of seed.plays ?? []) {
    await seedPlay(store, play);
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
  const store = await harness.open(CONTRACT_POOL);
  await seedGame(store, { room: makeRoom(), rounds }, harness);
  return store;
}
