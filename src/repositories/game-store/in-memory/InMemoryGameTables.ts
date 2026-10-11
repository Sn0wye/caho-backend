import type { BlackCard } from '@/repositories/cards';
import type { PublicUser, Room, Round, WhiteCard } from '@/schemas';

// The in-memory twin of the game tables. Each repository reads/writes these
// shared rows, so cross-table rules (isJudge from rooms.judge_id, Played Cards
// joined to rounds and users) hold the same way they do in Postgres. Rows are
// cloned on the way in and out: a caller mutating a returned Room must not
// change what is stored, exactly as with a database. See issue #24.

// One room_players row (no profile, no isJudge: both are joined/derived).
export type PlayerRow = {
  roomCode: string;
  playerId: string;
  score: number;
  isReady: boolean;
  isHost: boolean;
  isActive: boolean;
  cardIds: string[];
};

// One round_played_cards row plus its ordered white-card pivot rows.
export type PlayedCardsRow = {
  id: string;
  roundId: string;
  playerId: string;
  whiteCardIds: string[];
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Shared rows behind every in-memory repository; build one per store.
 *
 * @example
 * const tables = new InMemoryGameTables(whiteCards, blackCards);
 */
export class InMemoryGameTables {
  readonly rooms = new Map<string, Room>();
  readonly players: PlayerRow[] = [];
  // Stands in for the users table: the profile a Player last joined with.
  readonly users = new Map<string, PublicUser>();
  readonly rounds = new Map<string, Round>();
  readonly playedCards: PlayedCardsRow[] = [];

  constructor(
    readonly whiteCards: WhiteCard[],
    readonly blackCards: BlackCard[]
  ) {}

  /**
   * FK guard mirroring `references(() => rooms.code)`.
   *
   * @example
   * tables.requireRoom('ABC123', 'rounds(round-1)');
   */
  requireRoom(roomCode: string, writing: string): Room {
    const room = this.rooms.get(roomCode);
    if (!room) {
      throw new Error(
        `FK violation writing ${writing}: no Room with code "${roomCode}" (expected an existing rooms.code)`
      );
    }
    return room;
  }
}

/**
 * Drop `undefined` values, like drizzle's `.set()` does, so a partial update
 * never blanks a column.
 *
 * @example
 * Object.assign(room, definedOnly({ round: 2, judgeId: undefined }));
 */
export function definedOnly<T extends object>(patch: T): Partial<T> {
  const entries = Object.entries(patch).filter(
    ([, value]) => value !== undefined
  );
  return Object.fromEntries(entries) as Partial<T>;
}
