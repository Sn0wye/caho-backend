import { assessSession, freshExpiry } from '@/auth/session-lifetime';
import { hashToken } from '@/auth/session-token';
import type {
  Session,
  SessionValidationResult
} from '@/auth/session-types';
import type { ISessionRepository } from '@/repositories/session/ISessionRepository';

// Token-based session management, replacing lucia. The cookie holds the raw
// token; only its hash is stored (see session-token.ts). Validation follows the
// Lucia v3 migration guide: expire-and-delete past the deadline, renew past the
// halfway mark. `now` is injectable so renewal logic is unit-testable.
export class SessionService {
  constructor(
    private readonly sessions: ISessionRepository,
    private readonly now: () => Date = () => new Date()
  ) {}

  public async createSession(token: string, userId: string): Promise<Session> {
    const id = hashToken(token);
    const expiresAt = freshExpiry(this.now());

    await this.sessions.create({ id, userId, expiresAt });

    return { id, userId, expiresAt, fresh: false };
  }

  public async validateSessionToken(
    token: string
  ): Promise<SessionValidationResult> {
    const id = hashToken(token);
    const stored = await this.sessions.findWithUser(id);

    if (!stored) {
      return { session: null, user: null };
    }

    const verdict = assessSession(stored.session.expiresAt, this.now());

    if (verdict.expired) {
      await this.sessions.delete(id);
      return { session: null, user: null };
    }

    if (verdict.fresh) {
      await this.sessions.updateExpiry(id, verdict.expiresAt);
    }

    return {
      session: {
        id,
        userId: stored.session.userId,
        expiresAt: verdict.expiresAt,
        fresh: verdict.fresh
      },
      user: stored.user
    };
  }

  public async invalidateSession(sessionId: string): Promise<void> {
    await this.sessions.delete(sessionId);
  }

  public async invalidateAllSessions(userId: string): Promise<void> {
    await this.sessions.deleteByUser(userId);
  }
}
