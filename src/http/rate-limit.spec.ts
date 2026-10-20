import { TEST_FRONTEND_PROXY_SECRET, type TestApp, buildTestApp } from '@/app.fakes';
import { makeRoom } from '@/services/room/RoomService.fixtures';
import { afterEach, describe, expect, it } from 'vitest';
import { FORWARDED_CLIENT_IP_HEADER, FRONTEND_PROXY_SECRET_HEADER } from './client-ip';

// Rate limits and credential bounds through the real app, counted in memory.

const PROXY_IP = '203.0.113.7';

let harness: TestApp;
afterEach(async () => {
  await harness.app.close();
});

function signIn(headers: Record<string, string> = {}, body = { username: 'neo', password: 'wrong-password' }) {
  return harness.app.inject({
    method: 'POST',
    url: '/auth/sign-in',
    headers: { 'x-forwarded-for': PROXY_IP, ...headers },
    payload: body
  });
}

// A server-side call from the frontend on behalf of the player at `playerIp`.
function viaFrontend(playerIp: string, secret = TEST_FRONTEND_PROXY_SECRET): Record<string, string> {
  return { [FORWARDED_CLIENT_IP_HEADER]: playerIp, [FRONTEND_PROXY_SECRET_HEADER]: secret };
}

async function exhaustSignIns(headers: Record<string, string> = {}): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    expect((await signIn(headers)).statusCode).toBe(401);
  }
}

describe('POST /auth/sign-in rate limit', () => {
  it('answers 429 after 10 attempts from one IP', async () => {
    harness = await buildTestApp({ room: makeRoom() });
    await exhaustSignIns();

    const reply = await signIn();

    expect(reply.statusCode).toBe(429);
    expect(reply.headers['retry-after']).toBeDefined();
  });

  it('keys on the client IP the proxy forwarded, not the proxy', async () => {
    harness = await buildTestApp({ room: makeRoom() });
    await exhaustSignIns();

    expect((await signIn({ 'x-forwarded-for': '198.51.100.9' })).statusCode).toBe(401);
  });

  it("counts each player behind the frontend's server separately", async () => {
    harness = await buildTestApp({ room: makeRoom() });
    await exhaustSignIns(viaFrontend('198.51.100.1'));

    expect((await signIn(viaFrontend('198.51.100.1'))).statusCode).toBe(429);
    expect((await signIn(viaFrontend('198.51.100.2'))).statusCode).toBe(401);
  });

  it('ignores a forwarded IP sent without the right secret', async () => {
    harness = await buildTestApp({ room: makeRoom() });
    await exhaustSignIns();

    const reply = await signIn(viaFrontend('198.51.100.1', 'not-the-secret'));

    expect(reply.statusCode).toBe(429);
  });
});

describe('credential bounds', () => {
  it('rejects a password over 128 characters', async () => {
    harness = await buildTestApp({ room: makeRoom() });

    const reply = await signIn({}, { username: 'neo', password: 'x'.repeat(129) });

    expect(reply.statusCode).toBe(400);
  });

  it('rejects a username over 64 characters', async () => {
    harness = await buildTestApp({ room: makeRoom() });

    const reply = await signIn({}, { username: 'n'.repeat(65), password: 'wrong-password' });

    expect(reply.statusCode).toBe(400);
  });
});
