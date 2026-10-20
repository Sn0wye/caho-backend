import type { App } from '@/app';
import { CAHO_REDIS_PREFIX } from '@/db/redis-prefix';
import {
  type RateLimitOptions,
  fastifyRateLimit
} from '@fastify/rate-limit';
import type Redis from 'ioredis';
import { clientIpResolver } from './client-ip';

export type RateLimitDeps = {
  // Shared counters across API instances; specs leave it out and count in memory.
  redis?: Redis;
  // Lets the frontend's server forward the player's IP. See client-ip.ts.
  frontendProxySecret?: string;
};

// Default for every route, per client IP.
const DEFAULT_RATE_LIMIT = { max: 300, timeWindow: '1 minute' };

/**
 * Password sign-in/sign-up: 10 tries a minute per client IP.
 *
 * @example
 * app.post('/sign-in', { config: { rateLimit: credentialRateLimit } }, signIn);
 */
export const credentialRateLimit: RateLimitOptions = {
  max: 10,
  timeWindow: '1 minute'
};

/**
 * OAuth redirects and callbacks: 20 a minute per client IP.
 *
 * @example
 * app.get('/github', { config: { rateLimit: oauthRateLimit } }, redirect);
 */
export const oauthRateLimit: RateLimitOptions = {
  max: 20,
  timeWindow: '1 minute'
};

/**
 * Applies DEFAULT_RATE_LIMIT to every route, keyed on the client IP (the one
 * the frontend forwarded, when it proves it is the frontend). Counters live in
 * Redis when given. Fails open: a Redis outage must not take sign-in down too.
 *
 * @example
 * registerRateLimit(app, { redis, frontendProxySecret: env.FRONTEND_PROXY_SECRET });
 */
export function registerRateLimit(app: App, deps: RateLimitDeps): void {
  app.register(fastifyRateLimit, {
    ...DEFAULT_RATE_LIMIT,
    keyGenerator: clientIpResolver(deps.frontendProxySecret),
    redis: deps.redis,
    nameSpace: `${CAHO_REDIS_PREFIX}rate-limit:`,
    skipOnError: true
  });
}
