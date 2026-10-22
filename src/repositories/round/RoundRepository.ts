import { db } from '@/db';
import type { IRoundRepository } from './IRoundRepository';
import type { Round, RoundStatus } from '@/schemas';
import { rooms, rounds } from '@/db/schema';
import { and, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

const nextRounds = alias(rounds, 'next_rounds');

export class RoundRepository implements IRoundRepository {
  private db: typeof db;

  constructor() {
    this.db = db;
  }

  public async create(data: Round): Promise<Round> {
    const round = (await this.db.insert(rounds).values(data).returning())[0];
    return round;
  }

  public async find(roomCode: string, number: number): Promise<Round | null> {
    const round = await this.db.query.rounds.findFirst({
      where: (rounds, { and, eq }) =>
        and(eq(rounds.roomCode, roomCode), eq(rounds.roundNumber, number))
    });

    return round ?? null;
  }

  public async findById(id: string): Promise<Round | null> {
    const round = await this.db.query.rounds.findFirst({
      where: (rounds, { eq }) => eq(rounds.id, id)
    });

    return round ?? null;
  }

  public async update(id: string, data: Partial<Round>): Promise<Round | null> {
    const round = await this.db
      .update(rounds)
      .set(data)
      .where(eq(rounds.id, id))
      .returning();

    return round[0] ?? null;
  }

  // Idempotent phase claim (ADR-0003): the `status` predicate is the guard — a
  // replayed expired-key event re-runs this with the Round no longer in `from`,
  // matches zero rows, and returns null instead of advancing a second time.
  public async claimAdvance(
    id: string,
    from: RoundStatus | RoundStatus[],
    to: RoundStatus
  ): Promise<Round | null> {
    const allowed = Array.isArray(from) ? from : [from];
    const claimed = await this.db
      .update(rounds)
      .set({ status: to, updatedAt: new Date() })
      .where(and(eq(rounds.id, id), inArray(rounds.status, allowed)))
      .returning();

    return claimed[0] ?? null;
  }

  // Backstop source for the startup sweep: active Rounds whose play- or
  // judge-deadline already elapsed at `now`.
  public async findExpiredActive(now: Date): Promise<Round[]> {
    return await this.db
      .select()
      .from(rounds)
      .where(
        and(
          inArray(rounds.status, ['PLAYING', 'JUDGING']),
          or(lte(rounds.playDeadline, now), lte(rounds.judgeDeadline, now))
        )
      );
  }

  // Ended Rounds whose successor never opened: anti-join on round_number + 1.
  public async findStalledEnded(endedBefore: Date): Promise<Round[]> {
    const rows = await this.db
      .select({ round: rounds })
      .from(rounds)
      .innerJoin(rooms, eq(rooms.code, rounds.roomCode))
      .leftJoin(
        nextRounds,
        and(
          eq(nextRounds.roomCode, rounds.roomCode),
          eq(nextRounds.roundNumber, sql`${rounds.roundNumber} + 1`)
        )
      )
      .where(
        and(
          inArray(rounds.status, ['COMPLETE', 'ABORTED']),
          eq(rooms.status, 'IN_PROGRESS'),
          lte(rounds.updatedAt, endedBefore),
          isNull(nextRounds.id)
        )
      );
    return rows.map(row => row.round);
  }
}
