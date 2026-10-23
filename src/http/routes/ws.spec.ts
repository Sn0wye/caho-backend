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

let address: string | null = null;
afterEach(() => {
  address = null;
});

async function connect(path: string, userId = PLAYER_ID): Promise<{ socket: WebSocket; received: string[] }> {
  address ??= await harness.app.listen({ host: '127.0.0.1', port: 0 });
  const socket = new WebSocket(`${address.replace('http', 'ws')}/ws${path}`, { headers: signedInAs(userId) });
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

// ADR-0006: the Room socket carries cursor positions in and fans them out.
describe('WS /ws/room/:roomCode cursors', () => {
  const OTHER_ID = 'player-b';
  const cursorEvents = (received: string[]) =>
    received.map(message => JSON.parse(message)).filter(event => event.event.startsWith('room.cursor'));

  it("relays a seated Player's cursor to the Room and hides it when they disconnect", async () => {
    harness = await buildTestApp({
      room: makeRoom(),
      players: [makePlayer({ id: PLAYER_ID }), makePlayer({ id: OTHER_ID })]
    });
    const sender = await connect(`/room/${ROOM_CODE}`, PLAYER_ID);
    const watcher = await connect(`/room/${ROOM_CODE}`, OTHER_ID);
    await vi.waitFor(() => expect(harness.bus.subscriberCount(ROOM_CODE)).toBe(2));

    await vi.waitFor(() => {
      sender.socket.send(JSON.stringify({ event: 'cursor.move', payload: { x: 0.5, y: -0.5, card: 2 } }));
      expect(cursorEvents(watcher.received)[0]).toEqual({
        event: 'room.cursor-move',
        payload: { playerId: PLAYER_ID, x: 0.5, y: -0.5, card: 2 }
      });
    });
    sender.socket.close();

    await vi.waitFor(() =>
      expect(cursorEvents(watcher.received).at(-1)).toEqual({
        event: 'room.cursor-leave',
        payload: { playerId: PLAYER_ID }
      })
    );
    watcher.socket.close();
  });

  it('ignores cursors from a signed-in User outside the Room', async () => {
    harness = await buildTestApp({ room: makeRoom(), players: [makePlayer({ id: PLAYER_ID })] }, [OTHER_ID]);
    const stranger = await connect(`/room/${ROOM_CODE}`, OTHER_ID);
    await vi.waitFor(() => expect(harness.bus.subscriberCount(ROOM_CODE)).toBe(1));

    stranger.socket.send(JSON.stringify({ event: 'cursor.move', payload: { x: 0, y: 0 } }));
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(harness.bus.published).toEqual([]);
    stranger.socket.close();
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

describe('WS frame size', () => {
  it('closes the socket with 1009 when a frame exceeds 1024 bytes', async () => {
    harness = await buildTestApp({ room: makeRoom(), players: [makePlayer({ id: PLAYER_ID })] });
    const { socket } = await connect(`/room/${ROOM_CODE}`);
    const closed = new Promise<number>(resolve => socket.once('close', resolve));

    socket.send('x'.repeat(1025));

    expect(await closed).toBe(1009);
  });
});
