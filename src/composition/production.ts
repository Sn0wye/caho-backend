import { type App, buildApp } from '@/app';
import { db } from '@/db';
import { env } from '@/env';
import { redis } from '@/db/redis';
import { logger } from '@/lib/logger';
import { Pubsub } from '@/lib/pub-sub';
import { PostgresGameStoreFactory } from '@/repositories/game-store/PostgresGameStore';
import { UserRepositoryFactory } from '@/repositories/user';
import { AuthService } from '@/services/auth/AuthService';
import { SessionServiceFactory } from '@/services/auth/SessionServiceFactory';
import type { RoundLifecycle } from '@/services/round/RoundLifecycle';
import { RoundReconcileSchedule } from '@/services/round/RoundReconcileSchedule';
import { RoundTimerStore } from '@/services/round/RoundTimerStore';
import { ensureExpiryNotifications } from '@/services/round/ensureExpiryNotifications';
import { subscribeRoundExpiry } from '@/services/round/subscribeRoundExpiry';
import { buildGameModules } from './game-modules';

/**
 * The production app: every module built once over Postgres and Redis. One
 * Pubsub serves both roles (publish for the modules, subscribe for the WS
 * route) instead of one per controller. issue #26.
 *
 * @example
 * const app = buildProductionApp();
 * await app.listen({ port: env.PORT });
 */
export function buildProductionApp(): App {
  const pubsub = new Pubsub(redis, logger);
  const game = buildGameModules({
    store: PostgresGameStoreFactory(),
    timerStore: new RoundTimerStore(redis),
    publisher: pubsub,
    log: logger
  });
  const sessions = SessionServiceFactory();
  const users = UserRepositoryFactory();
  const app = buildApp({
    ...game,
    subscriber: pubsub,
    sessions,
    auth: new AuthService(users, sessions),
    users,
    readiness: { postgres: db, redis },
    logger,
    rateLimit: { redis, frontendProxySecret: env.FRONTEND_PROXY_SECRET }
  });
  app.addHook('onClose', () => pubsub.close());
  installRoundTimers(app, game.rounds);
  return app;
}

// Round timer engine (ADR-0003 / issue #4): on boot, sweep any Round whose
// deadline lapsed while the process was down, then subscribe to Redis expired-key
// events to advance Rounds live. The sweep runs before the subscriber so a missed
// event and a fresh event can't race. Expiry events are fire-and-forget, so the
// sweep then repeats every 30s and after each subscriber reconnect.
function installRoundTimers(app: App, rounds: RoundLifecycle): void {
  const reconcile = new RoundReconcileSchedule(rounds, logger);
  let unsubscribe: (() => Promise<void>) | null = null;
  app.addHook('onReady', async () => {
    await ensureExpiryNotifications(redis, logger);
    await reconcile.runNow('startup');
    unsubscribe = await subscribeRoundExpiry(
      redis,
      rounds,
      logger,
      redis.options.db ?? 0,
      () => reconcile.request('redis_reconnect')
    );
    reconcile.start();
  });
  app.addHook('onClose', async () => {
    await reconcile.stop();
    await unsubscribe?.();
  });
}
