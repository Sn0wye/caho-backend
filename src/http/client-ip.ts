import { timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import type { FastifyRequest } from 'fastify';

// Headers the frontend's server (Vercel) sets when it calls the API on a
// player's behalf. Without them those calls carry Vercel's egress IP, which
// many players share, so per-IP limits would lump them together.
export const FORWARDED_CLIENT_IP_HEADER = 'x-caho-client-ip';
export const FRONTEND_PROXY_SECRET_HEADER = 'x-caho-proxy-secret';

/**
 * The address to rate-limit by: the IP the frontend forwarded when the request
 * proves it came from the frontend's server, else `req.ip`. Anyone can send
 * the IP header, so it is ignored unless the secret header matches.
 *
 * @example
 * const clientIpOf = clientIpResolver(env.FRONTEND_PROXY_SECRET);
 * clientIpOf(req); // '203.0.113.7'
 */
export function clientIpResolver(
  frontendProxySecret: string | undefined
): (req: FastifyRequest) => string {
  const expected = frontendProxySecret ? Buffer.from(frontendProxySecret) : null;
  return req => {
    if (!expected || !hasSecret(req, expected)) return req.ip;
    const forwarded = req.headers[FORWARDED_CLIENT_IP_HEADER];
    if (typeof forwarded !== 'string' || !isIP(forwarded)) return req.ip;
    return forwarded;
  };
}

function hasSecret(req: FastifyRequest, expected: Buffer): boolean {
  const sent = req.headers[FRONTEND_PROXY_SECRET_HEADER];
  if (typeof sent !== 'string') return false;
  const actual = Buffer.from(sent);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
