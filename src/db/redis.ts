import { createRequire } from 'node:module';
import { env } from '@/env';
import { logger } from '@/lib/logger';
import { observeRedis } from '@/observability/dependency-events';
import type Redis from 'ioredis';

declare global {
  var redis: Redis;
}

// ioredis is CommonJS. Load through require so OTEL can patch its exported class
// before the ESM app constructs clients; dynamic ESM imports alone bypass that hook.
const RedisConstructor = createRequire(import.meta.url)(
  'ioredis'
) as typeof Redis;
// biome-ignore lint/suspicious/noRedeclare: singleton
export const redis = global.redis || new RedisConstructor(env.REDIS_URL);
if (!global.redis) observeRedis(redis, logger, 'primary');

if (process.env.NODE_ENV !== 'production') {
  global.redis = redis;
}
