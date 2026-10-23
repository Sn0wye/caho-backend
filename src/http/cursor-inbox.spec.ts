import { buildLogger } from '@/lib/logger';
import { FakeConsoleOutput } from '@/lib/logger.fakes';
import { FakeGameEventPublisher } from '@/services/IGameEventPublisher.fakes';
import { CursorBroadcaster } from '@/services/cursor/CursorBroadcaster';
import { FakeCursorSeats } from '@/services/cursor/CursorBroadcaster.fakes';
import { describe, expect, it } from 'vitest';
import { CURSOR_MIN_INTERVAL_MS, CursorInbox } from './cursor-inbox';

// A clock the spec advances by hand, so throttling needs no real waiting.
class FakeClock {
  at = 1_000;
  now = (): number => this.at;
}

function buildInbox(playerId = 'player-a') {
  const publisher = new FakeGameEventPublisher();
  const seats = new FakeCursorSeats({ 'player-a': ['ABC123'] });
  const clock = new FakeClock();
  const { logger } = buildLogger({ consoleOutput: new FakeConsoleOutput() });
  const inbox = new CursorInbox(
    new CursorBroadcaster(seats, publisher),
    logger,
    'ABC123',
    playerId,
    clock.now
  );
  const events = () => publisher.published.map(({ event }) => event);
  return { inbox, clock, events };
}

const move = (x: number, y: number) =>
  JSON.stringify({ event: 'cursor.move', payload: { x, y } });

describe('CursorInbox', () => {
  it('relays moves from a seated Player and hides the cursor on close', async () => {
    const { inbox, events } = buildInbox();
    await inbox.connected();
    inbox.receive(move(0.5, -0.5));
    await inbox.disconnected();
    expect(events()).toEqual([
      {
        event: 'room.cursor-move',
        payload: { playerId: 'player-a', x: 0.5, y: -0.5, card: null }
      },
      { event: 'room.cursor-leave', payload: { playerId: 'player-a' } }
    ]);
  });

  it('ignores a signed-in User who is not in the Room', async () => {
    const { inbox, events } = buildInbox('stranger');
    await inbox.connected();
    inbox.receive(move(0, 0));
    await inbox.disconnected();
    expect(events()).toEqual([]);
  });

  it('ignores moves before membership is confirmed', () => {
    const { inbox, events } = buildInbox();
    inbox.receive(move(0, 0));
    expect(events()).toEqual([]);
  });

  it('drops moves faster than the minimum interval', async () => {
    const { inbox, clock, events } = buildInbox();
    await inbox.connected();
    inbox.receive(move(0, 0));
    clock.at += CURSOR_MIN_INTERVAL_MS - 1;
    inbox.receive(move(0.1, 0));
    clock.at += 1;
    inbox.receive(move(0.2, 0));
    expect(events().map(event => event.payload)).toEqual([
      { playerId: 'player-a', x: 0, y: 0, card: null },
      { playerId: 'player-a', x: 0.2, y: 0, card: null }
    ]);
  });

  it('ignores keepalives, malformed and out-of-range messages', async () => {
    const { inbox, events } = buildInbox();
    await inbox.connected();
    inbox.receive('ping');
    inbox.receive(JSON.stringify({ event: 'room.started', payload: {} }));
    inbox.receive(move(5, 0));
    inbox.receive(JSON.stringify({ event: 'cursor.move', payload: { x: 'a' } }));
    for (const card of [-1, 20, 1.5]) {
      inbox.receive(JSON.stringify({ event: 'cursor.move', payload: { x: 0, y: 0, card } }));
    }
    expect(events()).toEqual([]);
  });

  it('hides only a shown cursor, once', async () => {
    const { inbox, events } = buildInbox();
    await inbox.connected();
    const hide = JSON.stringify({ event: 'cursor.hide' });
    inbox.receive(hide);
    inbox.receive(move(0, 0));
    inbox.receive(hide);
    inbox.receive(hide);
    await inbox.disconnected();
    expect(events().map(event => event.event)).toEqual([
      'room.cursor-move',
      'room.cursor-leave'
    ]);
  });
});
