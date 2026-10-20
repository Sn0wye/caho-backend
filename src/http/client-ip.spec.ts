import type { FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';
import { FORWARDED_CLIENT_IP_HEADER, FRONTEND_PROXY_SECRET_HEADER, clientIpResolver } from './client-ip';

const SECRET = 'frontend-proxy-secret-0123456789abcdef';

function requestFrom(headers: Record<string, string>): FastifyRequest {
  return { ip: '203.0.113.7', headers } as unknown as FastifyRequest;
}

describe('clientIpResolver', () => {
  it('uses the forwarded IP when the secret matches', () => {
    const req = requestFrom({ [FORWARDED_CLIENT_IP_HEADER]: '2001:db8::1', [FRONTEND_PROXY_SECRET_HEADER]: SECRET });

    expect(clientIpResolver(SECRET)(req)).toBe('2001:db8::1');
  });

  it.each([
    ['a wrong secret', { [FORWARDED_CLIENT_IP_HEADER]: '198.51.100.1', [FRONTEND_PROXY_SECRET_HEADER]: 'nope' }],
    ['no secret', { [FORWARDED_CLIENT_IP_HEADER]: '198.51.100.1' }],
    ['a non-IP value', { [FORWARDED_CLIENT_IP_HEADER]: 'evil, 1.2.3.4', [FRONTEND_PROXY_SECRET_HEADER]: SECRET }]
  ])('falls back to req.ip given %s', (_, headers) => {
    expect(clientIpResolver(SECRET)(requestFrom(headers))).toBe('203.0.113.7');
  });

  it('ignores forwarded IPs when no secret is configured', () => {
    const req = requestFrom({ [FORWARDED_CLIENT_IP_HEADER]: '198.51.100.1', [FRONTEND_PROXY_SECRET_HEADER]: '' });

    expect(clientIpResolver(undefined)(req)).toBe('203.0.113.7');
  });
});
