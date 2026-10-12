import { type TestApp, buildTestApp, signedInAs } from '@/app.fakes';
import { makeRoom } from '@/services/room/RoomService.fixtures';
import { afterEach, describe, expect, it } from 'vitest';

// POST /auth/profile through the app and the user store. issue #26.

let harness: TestApp;
afterEach(async () => {
  await harness.app.close();
});

function updateProfile(userId: string, username: string) {
  return harness.app.inject({
    method: 'POST',
    url: '/auth/profile',
    headers: signedInAs(userId),
    payload: { username, email: null, avatarUrl: null }
  });
}

describe('POST /auth/profile', () => {
  it('persists the new profile through the user store', async () => {
    harness = await buildTestApp({ room: makeRoom() }, ['neo']);

    const reply = await updateProfile('neo', 'the-one');

    expect(reply.statusCode).toBe(200);
    expect(reply.json()).toEqual({ id: 'neo', name: null, username: 'the-one', email: null, avatarUrl: null });
    expect((await harness.users.findByUsername('the-one'))?.id).toBe('neo');
  });

  it('refuses a username another User holds', async () => {
    harness = await buildTestApp({ room: makeRoom() }, ['neo', 'trinity']);

    const reply = await updateProfile('neo', 'trinity');

    expect(reply.statusCode).toBe(400);
    expect(reply.json().message).toBe('Esse nome de usuário já está em uso.');
  });
});
