import { hashToken } from '@/auth/session-token';
import type { SessionUser } from '@/auth/session-types';
import { beforeEach, describe, expect, it } from 'vitest';
import { FakeSessionRepository } from './SessionService.fakes';
import { SessionService } from './SessionService';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-06-23T00:00:00Z');

function makeUser(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    id: 'user-1',
    name: null,
    username: 'caveman',
    email: null,
    avatarUrl: null,
    providerId: null,
    providerUserId: null,
    ...overrides
  };
}

describe('SessionService', () => {
  let repo: FakeSessionRepository;
  let service: SessionService;

  beforeEach(() => {
    repo = new FakeSessionRepository(makeUser());
    service = new SessionService(repo, () => NOW);
  });

  it('persists a new session under the hashed token', async () => {
    const session = await service.createSession('rawtoken', 'user-1');

    expect(session.userId).toBe('user-1');
    expect(session.fresh).toBe(false);
    expect(session.expiresAt.getTime()).toBeGreaterThan(NOW.getTime());
    expect(repo.sessions.has(hashToken('rawtoken'))).toBe(true);
    expect(repo.sessions.has('rawtoken')).toBe(false);
  });

  it('validates a live token and returns the bound user', async () => {
    await service.createSession('rawtoken', 'user-1');

    const { session, user } = await service.validateSessionToken('rawtoken');

    expect(user?.username).toBe('caveman');
    expect(session?.fresh).toBe(false);
  });

  it('returns nulls for an unknown token', async () => {
    expect(await service.validateSessionToken('ghost')).toEqual({
      session: null,
      user: null
    });
  });

  it('deletes and rejects an expired session', async () => {
    repo.sessions.set(hashToken('rawtoken'), {
      id: hashToken('rawtoken'),
      userId: 'user-1',
      expiresAt: new Date(NOW.getTime() - 1)
    });

    const result = await service.validateSessionToken('rawtoken');

    expect(result).toEqual({ session: null, user: null });
    expect(repo.sessions.size).toBe(0);
  });

  it('renews a session past the halfway mark and persists the new expiry', async () => {
    const id = hashToken('rawtoken');
    repo.sessions.set(id, {
      id,
      userId: 'user-1',
      expiresAt: new Date(NOW.getTime() + 10 * DAY)
    });

    const { session } = await service.validateSessionToken('rawtoken');

    expect(session?.fresh).toBe(true);
    expect(repo.sessions.get(id)?.expiresAt.getTime()).toBe(
      session?.expiresAt.getTime()
    );
    expect(session?.expiresAt.getTime()).toBeGreaterThan(NOW.getTime() + 10 * DAY);
  });

  it('invalidates every session for a user on sign-out-all', async () => {
    await service.createSession('t1', 'user-1');
    await service.createSession('t2', 'user-1');

    await service.invalidateAllSessions('user-1');

    expect(repo.sessions.size).toBe(0);
  });
});
