import type { App } from '@/app';
import { CAHO_REDIS_PREFIX } from '@/db/redis-prefix';
import {
  type RateLimitOptions,
  fastifyRateLimit
} from '@fastify/rate-limit';
import type { FastifyRequest } from 'fastify';
import type Redis from 'ioredis';

// Default for every route, per client IP. Kept loose because the frontend's
// SSR and server actions reach the API from Vercel egress IPs that many
// players share.
const DEFAULT_RATE_LIMIT = { max: 300, timeWindow: '1 minute' };

/**
 * Password sign-in/sign-up: 10 tries a minute per IP and username. Keyed on
 * both because those calls arrive from shared Vercel IPs, so an IP-only key
 * would lock out every player behind one. Runs in preHandler, after the body
 * is parsed and bounded.
 *
 * @example
 * app.post('/sign-in', { config: { rateLimit: credentialRateLimit } }, signIn);
 */
export const credentialRateLimit: RateLimitOptions = {
  max: 10,
  timeWindow: '1 minute',
  hook: 'preHandler',
  keyGenerator: credentialAttemptKey
};

/**
 * OAuth redirects and callbacks: browser-direct, so a plain per-IP key works.
 *
 * @example
 * app.get('/github', { config: { rateLimit: oauthRateLimit } }, redirect);
 */
export const oauthRateLimit: RateLimitOptions = {
  max: 20,
  timeWindow: '1 minute'
};

/**
 * The client IP plus the username the request names, if any.
 *
 * @example
 * credentialAttemptKey(req); // '203.0.113.7:neo'
 */
export function credentialAttemptKey(req: FastifyRequest): string {
  const body = req.body as { username?: unknown } | undefined;
  const username = typeof body?.username === 'string' ? body.username : '';
  return `${req.ip}:${username.toLowerCase()}`;
}

/**
 * Applies DEFAULT_RATE_LIMIT to every route. Counters live in Redis when
 * given, so every API instance shares them; specs pass none and count in
 * memory. Fails open: a Redis outage must not take sign-in down with it.
 *
 * @example
 * registerRateLimit(app, redis);
 */
export function registerRateLimit(app: App, redis: Redis | undefined): void {
  app.register(fastifyRateLimit, {
    ...DEFAULT_RATE_LIMIT,
    redis,
    nameSpace: `${CAHO_REDIS_PREFIX}rate-limit:`,
    skipOnError: true
  });
}
