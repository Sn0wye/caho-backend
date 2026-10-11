import { UnauthorizedError } from '@/errors';
import type { UserSchema } from '@/schemas';
import { hash } from '@/utils/password';
import { describe, expect, it } from 'vitest';
import { AuthService } from './AuthService';
import { FakeUserRepository } from './AuthService.fakes';
import { SessionService } from './SessionService';
import { FakeSessionRepository } from './SessionService.fakes';

function makeUser(password: string): UserSchema {
  return {
    id: 'user-1',
    name: null,
    email: null,
    username: 'caveman',
    password,
    avatarUrl: null
  };
}

function buildAuthService(user: UserSchema): AuthService {
  const sessions = new FakeSessionRepository({
    ...user,
    providerId: null,
    providerUserId: null
  });
  return new AuthService(
    new FakeUserRepository([user]),
    new SessionService(sessions, () => new Date('2026-06-23T00:00:00Z'))
  );
}

describe('AuthService.signIn', () => {
  it('issues a session for a matching password', async () => {
    const service = buildAuthService(makeUser(await hash('correct horse')));
    const { cookie, user } = await service.signIn('caveman', 'correct horse');
    expect(user.id).toBe('user-1');
    expect(cookie.value).not.toBe('');
  });

  it('rejects an unknown username', async () => {
    const service = buildAuthService(makeUser(await hash('correct horse')));
    await expect(service.signIn('nobody', 'x')).rejects.toBeInstanceOf(
      UnauthorizedError
    );
  });

  // Regression: OAuth-only Users have an empty hash, which argon2 throws on.
  it('rejects password sign-in for an OAuth-only User', async () => {
    const service = buildAuthService(makeUser(''));
    await expect(service.signIn('caveman', 'guess')).rejects.toBeInstanceOf(
      UnauthorizedError
    );
  });

  it('surfaces a corrupt stored hash as a server failure', async () => {
    const service = buildAuthService(makeUser('not-a-phc-string'));
    const failure = await service.signIn('caveman', 'guess').catch(e => e);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(UnauthorizedError);
  });
});
