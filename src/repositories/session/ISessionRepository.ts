import type { SessionUser } from '@/auth/session-types';

export type StoredSession = {
  id: string;
  userId: string;
  expiresAt: Date;
};

export type ISessionRepository = {
  create(session: StoredSession): Promise<void>;
  findWithUser(
    sessionId: string
  ): Promise<{ session: StoredSession; user: SessionUser } | null>;
  updateExpiry(sessionId: string, expiresAt: Date): Promise<void>;
  delete(sessionId: string): Promise<void>;
  deleteByUser(userId: string): Promise<void>;
};
