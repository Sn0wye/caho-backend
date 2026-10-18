import { buildLogger } from '@/lib/logger';
import { FakeConsoleOutput } from '@/lib/logger.fakes';
import { describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';
import { SocketSession, SocketSessions } from './socket-session';
import {
  FakeGameSocket,
  FakeSocketInbound,
  FakeSocketPresence,
  FakeSocketSubscription
} from './socket-session.fakes';

function buildSocketHarness() {
  const output = new FakeConsoleOutput();
  const { logger } = buildLogger({ consoleOutput: output });
  const socket = new FakeGameSocket();
  const subscription = new FakeSocketSubscription();
  const presence = new FakeSocketPresence();
  const session = new SocketSession(
    socket as unknown as WebSocket,
    logger,
    'player-a',
    (channel, receive) => subscription.subscribe(channel, receive),
    presence
  );
  return { session, socket, subscription, presence, output };
}

describe('WebSocket observability and cleanup', () => {
  it('drains async presence cleanup before allowing server dependencies to close', async () => {
    const { session, presence, socket, subscription } = buildSocketHarness();
    const sessions = new SocketSessions();
    let releasePresence: () => void = () => {};
    presence.disconnectDelay = new Promise<void>(resolve => {
      releasePresence = resolve;
    });
    sessions.open(session);
    await vi.waitFor(() => expect(presence.changes).toEqual([true]));
    let drained = false;
    const draining = sessions.close().then(() => {
      drained = true;
    });
    await vi.waitFor(() => expect(subscription.unsubscribed).toBe(1));
    expect(drained).toBe(false);
    releasePresence();
    await draining;
    expect(presence.changes).toEqual([true, false]);
    expect(socket.closed[0].code).toBe(1001);
    await sessions.close();
  });
  it('delivers events and heartbeat while open, then releases presence and subscription', async () => {
    const { session, socket, subscription, presence } = buildSocketHarness();
    session.start();
    await vi.waitFor(() => expect(presence.changes).toEqual([true]));
    subscription.receive?.({
      event: 'room.player-left',
      payload: { id: 'player-a' }
    });
    socket.emit('ping');
    expect(socket.sent).toHaveLength(1);
    expect(socket.pongCount).toBe(1);
    socket.close(1000);
    await vi.waitFor(() => expect(presence.changes).toEqual([true, false]));
    expect(subscription.unsubscribed).toBe(1);
    subscription.receive?.({
      event: 'room.player-left',
      payload: { id: 'player-a' }
    });
    expect(socket.sent).toHaveLength(1);
  });

  it('records send/socket errors and still clears presence when unsubscribe fails', async () => {
    const { session, socket, subscription, presence, output } =
      buildSocketHarness();
    subscription.unsubscribeError = new Error('unsubscribe failed');
    socket.sendError = new Error('send failed');
    session.start();
    await vi.waitFor(() => expect(presence.changes).toEqual([true]));
    socket.emit('error', new Error('socket failed'));
    subscription.receive?.({
      event: 'room.player-left',
      payload: { id: 'player-a' }
    });
    socket.close(1006);
    await vi.waitFor(() => expect(presence.changes).toEqual([true, false]));
    expect(output.lines.map(line => JSON.parse(line).event)).toEqual([
      'ws.socket_failed',
      'ws.send_failed',
      'ws.unsubscribe_failed'
    ]);
  });

  it('closes failed subscriptions with 1011 and catches failed presence cleanup', async () => {
    const { session, socket, subscription, output } = buildSocketHarness();
    subscription.subscribeError = new Error('Redis unavailable');
    session.start();
    await vi.waitFor(() => expect(socket.closed[0]?.code).toBe(1011));
    expect(JSON.parse(output.lines[0]).event).toBe('ws.setup_failed');
    const other = buildSocketHarness();
    other.presence.disconnectError = new Error('DB unavailable');
    other.session.start();
    await vi.waitFor(() => expect(other.presence.changes).toEqual([true]));
    other.socket.close(1006);
    await vi.waitFor(() =>
      expect(
        other.output.lines.some(
          line => JSON.parse(line).event === 'ws.presence_failed'
        )
      ).toBe(true)
    );
  });

  it('hands text frames to the inbound reader and skips binary ones', () => {
    const output = new FakeConsoleOutput();
    const { logger } = buildLogger({ consoleOutput: output });
    const socket = new FakeGameSocket();
    const subscription = new FakeSocketSubscription();
    const inbound = new FakeSocketInbound();
    const session = new SocketSession(
      socket as unknown as WebSocket,
      logger,
      'ABC123',
      (channel, receive) => subscription.subscribe(channel, receive),
      undefined,
      inbound
    );
    session.start();
    socket.emit('message', Buffer.from('{"event":"cursor.hide"}'), false);
    socket.emit('message', Buffer.from([1, 2, 3]), true);
    expect(inbound.messages).toEqual(['{"event":"cursor.hide"}']);
  });

  it('cleans a subscription even if the socket closes before subscribe resolves', async () => {
    const { session, socket, subscription, presence } = buildSocketHarness();
    let connect: () => void = () => {};
    subscription.connectDelay = new Promise<void>(resolve => {
      connect = resolve;
    });
    session.start();
    socket.close(1006);
    connect();
    await vi.waitFor(() => expect(subscription.unsubscribed).toBe(1));
    expect(presence.changes).toEqual([]);
  });
});
