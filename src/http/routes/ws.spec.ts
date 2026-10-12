import { type TestApp, buildTestApp, signedInAs } from '@/app.fakes';
import { ROOM_CODE, findPlayer, makePlayer, makeRoom } from '@/services/room/RoomService.fixtures';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';

// The WS route over a real socket: @fastify/websocket 9 has no inject helper.
// The event bus stands in for Redis pub/sub. issue #26.

const PLAYER_ID = 'player-a';

let harness: TestApp;
afterEach(async () => {
  await harness.app.close();
});

async function connect(path: string): Promise<{ socket: WebSocket; received: string[] }> {
  const address = await harness.app.listen({ host: '127.0.0.1', port: 0 });
  const socket = new WebSocket(`${address.replace('http', 'ws')}/ws${path}`, { headers: signedInAs(PLAYER_ID) });
  const received: string[] = [];
  socket.on('message', message => received.push(message.toString()));
  await new Promise(resolve => socket.once('open', resolve));
  return { socket, received };
}

describe('WS /ws/room/:roomCode', () => {
  it('forwards events published on the Room channel', async () => {
    harness = await buildTestApp({ room: makeRoom(), players: [makePlayer({ id: PLAYER_ID })] });
    const { socket, received } = await connect(`/room/${ROOM_CODE}`);
    await vi.waitFor(() => expect(harness.bus.subscriberCount(ROOM_CODE)).toBe(1));

    await harness.bus.publish(ROOM_CODE, { event: 'room.player-left', payload: { id: 'someone' } });

    await vi.waitFor(() =>
      expect(received.map(message => JSON.parse(message))).toEqual([
        { event: 'room.player-left', payload: { id: 'someone' } }
      ])
    );
    socket.close();
  });
});

describe('WS /ws/:userId', () => {
  it('marks the Player active on connect and Inactive on disconnect', async () => {
    harness = await buildTestApp({ room: makeRoom(), players: [makePlayer({ id: PLAYER_ID, isActive: false })] });
    const { socket } = await connect(`/${PLAYER_ID}`);
    await vi.waitFor(async () => expect((await findPlayer(harness.store, PLAYER_ID))?.isActive).toBe(true));

    socket.close();

    await vi.waitFor(async () => expect((await findPlayer(harness.store, PLAYER_ID))?.isActive).toBe(false));
    expect(harness.bus.published.at(-1)).toMatchObject({
      channel: ROOM_CODE,
      event: { event: 'room.player-update', payload: { id: PLAYER_ID, isActive: false } }
    });
  });
});
