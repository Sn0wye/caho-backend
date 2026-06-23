import { db } from '@/db';
import { oauthAccounts, userSessions, users } from '@/db/schema';
import { eq } from 'drizzle-orm';
import type { ISessionRepository, StoredSession } from './ISessionRepository';

export class SessionRepository implements ISessionRepository {
  private db: typeof db;

  constructor() {
    this.db = db;
  }

  async create(session: StoredSession): Promise<void> {
    await this.db.insert(userSessions).values(session);
  }

  async findWithUser(sessionId: string) {
    // leftJoin oauthAccounts to populate providerId/providerUserId; a user may
    // hold several oauth accounts, so a single row is enough (best-effort, same
    // fields the old lucia getUserAttributes exposed).
    const row = (
      await this.db
        .select({
          sessionId: userSessions.id,
          userId: userSessions.userId,
          expiresAt: userSessions.expiresAt,
          name: users.name,
          username: users.username,
          email: users.email,
          avatarUrl: users.avatarUrl,
          providerId: oauthAccounts.providerId,
          providerUserId: oauthAccounts.providerUserId
        })
        .from(userSessions)
        .innerJoin(users, eq(users.id, userSessions.userId))
        .leftJoin(oauthAccounts, eq(oauthAccounts.userId, users.id))
        .where(eq(userSessions.id, sessionId))
        .limit(1)
    )[0];

    if (!row) {
      return null;
    }

    return {
      session: {
        id: row.sessionId,
        userId: row.userId,
        expiresAt: row.expiresAt
      },
      user: {
        id: row.userId,
        name: row.name,
        username: row.username,
        email: row.email,
        avatarUrl: row.avatarUrl,
        providerId: row.providerId,
        providerUserId: row.providerUserId
      }
    };
  }

  async updateExpiry(sessionId: string, expiresAt: Date): Promise<void> {
    await this.db
      .update(userSessions)
      .set({ expiresAt })
      .where(eq(userSessions.id, sessionId));
  }

  async delete(sessionId: string): Promise<void> {
    await this.db.delete(userSessions).where(eq(userSessions.id, sessionId));
  }

  async deleteByUser(userId: string): Promise<void> {
    await this.db.delete(userSessions).where(eq(userSessions.userId, userId));
  }
}
