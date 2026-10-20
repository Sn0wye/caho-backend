import type { SessionUser, SessionValidationResult } from '@/auth/session-types';
import type { PlayerEvent, RoomEvent } from '@/contracts';
import { FakeReadinessPostgres, FakeReadinessRedis } from '@/http/routes/checks.fakes';
import { buildLogger } from '@/lib/logger';
import { FakeConsoleOutput } from '@/lib/logger.fakes';
import type { InMemoryGameStore } from '@/repositories/game-store/InMemoryGameStore';
import type { GameSeed } from '@/repositories/game-store/gameStore.fixtures';
import type { IGameEventPublisher } from '@/services/IGameEventPublisher';
import type { IGameEventSubscriber } from '@/services/IGameEventSubscriber';
import { AuthService } from '@/services/auth/AuthService';
import { FakeUserRepository } from '@/services/auth/AuthService.fakes';
import { SessionService } from '@/services/auth/SessionService';
import { FakeSessionRepository } from '@/services/auth/SessionService.fakes';
import { buildStore } from '@/services/room/RoomService.fixtures';
import { FakeRoundTimerStore } from '@/services/round/RoundTimerStore.fakes';
import { type App, buildApp } from './app';
import { buildGameModules } from './composition/game-modules';

type GameEvent = RoomEvent | PlayerEvent;

// In-memory Redis pub/sub: records every publish and delivers it to the
// channel's live subscribers, like Pubsub does across processes.
export class FakeEventBus implements IGameEventPublisher, IGameEventSubscriber {
  readonly published: Array<{ channel: string; event: GameEvent }> = [];
  private readonly receivers = new Map<string, Set<(event: GameEvent) => void>>();

  async publish(channel: string, event: GameEvent): Promise<void> {
    this.published.push({ channel, event });
    for (const receive of this.receivers.get(channel) ?? []) receive(event);
  }

  async subscribe(
    channel: string,
    receive: (event: GameEvent) => void
  ): Promise<() => Promise<void>> {
    const receivers = this.receivers.get(channel) ?? new Set();
    receivers.add(receive);
    this.receivers.set(channel, receivers);
    return async () => {
      receivers.delete(receive);
    };
  }

  subscriberCount(channel: string): number {
    return this.receivers.get(channel)?.size ?? 0;
  }
}

// Signs in the User whose token is `token-<userId>`; anything else is anonymous.
export class FakeSessionValidator {
  constructor(private readonly users: SessionUser[]) {}

  async validateSessionToken(token: string): Promise<SessionValidationResult> {
    const user = this.users.find(candidate => `token-${candidate.id}` === token);
    if (!user) return { session: null, user: null };
    const session = { id: `session-${user.id}`, userId: user.id, expiresAt: new Date(), fresh: false };
    return { session, user };
  }
}

/**
 * Request headers that sign in as `userId` through FakeSessionValidator.
 *
 * @example
 * await app.inject({ url: '/rooms/ABC123/white-cards', headers: signedInAs('player-a') });
 */
export function signedInAs(userId: string): { authorization: string } {
  return { authorization: `Bearer token-${userId}` };
}

/**
 * A signed-in User whose username matches the id, as makePlayer does.
 *
 * @example
 * makeSessionUser('player-a');
 */
export function makeSessionUser(id: string): SessionUser {
  return { id, name: null, username: id, email: null, avatarUrl: null, providerId: null, providerUserId: null };
}

// What the frontend's server sends to prove a forwarded client IP is genuine.
export const TEST_FRONTEND_PROXY_SECRET = 'test-frontend-proxy-secret-0123456789';

export type TestApp = {
  app: App;
  store: InMemoryGameStore;
  bus: FakeEventBus;
  users: FakeUserRepository;
};

/**
 * The real app over in-memory adapters: the seeded game store, a recording
 * event bus, fake round timers and a session lookup that knows `userIds`.
 * Every seeded Player can sign in too. issue #26.
 *
 * @example
 * const { app } = await buildTestApp({ room: makeRoom(), players: [makePlayer()] });
 * await app.inject({ url: '/rooms/ABC123/players', headers: signedInAs('player-1') });
 */
export async function buildTestApp(seed: GameSeed, userIds: string[] = []): Promise<TestApp> {
  const store = await buildStore(seed);
  const bus = new FakeEventBus();
  const ids = [...(seed.players ?? []).map(player => player.id), ...userIds];
  const sessionUsers = ids.map(makeSessionUser);
  const users = new FakeUserRepository(sessionUsers.map(user => ({ ...user, password: '' })));
  const game = buildGameModules({ store, timerStore: new FakeRoundTimerStore(), publisher: bus });
  const app = buildApp({
    ...game,
    subscriber: bus,
    sessions: new FakeSessionValidator(sessionUsers),
    auth: new AuthService(users, new SessionService(new FakeSessionRepository(sessionUsers[0]))),
    users,
    readiness: { postgres: new FakeReadinessPostgres(), redis: new FakeReadinessRedis() },
    logger: buildLogger({ consoleOutput: new FakeConsoleOutput() }).logger,
    rateLimit: { frontendProxySecret: TEST_FRONTEND_PROXY_SECRET }
  });
  return { app, store, bus, users };
}
