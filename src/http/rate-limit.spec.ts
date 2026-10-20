import { type TestApp, buildTestApp } from '@/app.fakes';
import { makeRoom } from '@/services/room/RoomService.fixtures';
import { afterEach, describe, expect, it } from 'vitest';

// Rate limits and credential bounds through the real app, counted in memory.

let harness: TestApp;
afterEach(async () => {
  await harness.app.close();
});

function signIn(username: string, clientIp = '203.0.113.7', password = 'wrong-password') {
  return harness.app.inject({
    method: 'POST',
    url: '/auth/sign-in',
    headers: { 'x-forwarded-for': clientIp },
    payload: { username, password }
  });
}

async function exhaustSignIns(username: string, clientIp?: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    expect((await signIn(username, clientIp)).statusCode).toBe(401);
  }
}

describe('POST /auth/sign-in rate limit', () => {
  it('answers 429 after 10 attempts on one username from one IP', async () => {
    harness = await buildTestApp({ room: makeRoom() });
    await exhaustSignIns('neo');

    const reply = await signIn('neo');

    expect(reply.statusCode).toBe(429);
    expect(reply.headers['retry-after']).toBeDefined();
  });

  it('counts other usernames on the same IP separately', async () => {
    harness = await buildTestApp({ room: makeRoom() });
    await exhaustSignIns('neo');

    expect((await signIn('trinity')).statusCode).toBe(401);
  });

  it('keys on the client IP the proxy forwarded, not the proxy', async () => {
    harness = await buildTestApp({ room: makeRoom() });
    await exhaustSignIns('neo', '203.0.113.7');

    expect((await signIn('neo', '198.51.100.9')).statusCode).toBe(401);
  });
});

describe('credential bounds', () => {
  it('rejects a password over 128 characters', async () => {
    harness = await buildTestApp({ room: makeRoom() });

    const reply = await signIn('neo', undefined, 'x'.repeat(129));

    expect(reply.statusCode).toBe(400);
  });

  it('rejects a username over 64 characters', async () => {
    harness = await buildTestApp({ room: makeRoom() });

    const reply = await signIn('n'.repeat(65));

    expect(reply.statusCode).toBe(400);
  });
});
