import { FakeGameEventPublisher } from '@/services/IGameEventPublisher.fakes';
import { describe, expect, it } from 'vitest';
import { CursorBroadcaster } from './CursorBroadcaster';
import { FakeCursorSeats } from './CursorBroadcaster.fakes';

function buildBroadcaster() {
  const publisher = new FakeGameEventPublisher();
  const seats = new FakeCursorSeats({ 'player-a': ['ABC123'] });
  return { cursors: new CursorBroadcaster(seats, publisher), publisher };
}

describe('CursorBroadcaster', () => {
  it('seats only Players who are in the Room', async () => {
    const { cursors } = buildBroadcaster();
    expect(await cursors.isSeated('ABC123', 'player-a')).toBe(true);
    expect(await cursors.isSeated('XYZ789', 'player-a')).toBe(false);
    expect(await cursors.isSeated('ABC123', 'stranger')).toBe(false);
  });

  it('broadcasts moves and leaves on the Room channel', async () => {
    const { cursors, publisher } = buildBroadcaster();
    await cursors.move('ABC123', 'player-a', { x: 0.25, y: -1 });
    await cursors.hide('ABC123', 'player-a');
    expect(publisher.published).toEqual([
      {
        channel: 'ABC123',
        event: {
          event: 'room.cursor-move',
          payload: { playerId: 'player-a', x: 0.25, y: -1 }
        }
      },
      {
        channel: 'ABC123',
        event: { event: 'room.cursor-leave', payload: { playerId: 'player-a' } }
      }
    ]);
  });
});
