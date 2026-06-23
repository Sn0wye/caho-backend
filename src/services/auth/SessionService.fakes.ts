import type { SessionUser } from '@/auth/session-types';
import type {
  ISessionRepository,
  StoredSession
} from '@/repositories/session/ISessionRepository';

// In-memory session store for SessionService unit tests. Seed a user via the
// constructor; createSession/validate then mutate the `sessions` map so specs
// can assert persistence and renewal without a live Postgres.
export class FakeSessionRepository implements ISessionRepository {
  public sessions = new Map<string, StoredSession>();

  constructor(private readonly user: SessionUser) {}

  async create(session: StoredSession): Promise<void> {
    this.sessions.set(session.id, session);
  }

  async findWithUser(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session || session.userId !== this.user.id) {
      return null;
    }
    return { session, user: this.user };
  }

  async updateExpiry(sessionId: string, expiresAt: Date): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      this.sessions.set(sessionId, { ...session, expiresAt });
    }
  }

  async delete(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }

  async deleteByUser(userId: string): Promise<void> {
    for (const [id, session] of this.sessions) {
      if (session.userId === userId) {
        this.sessions.delete(id);
      }
    }
  }
}
