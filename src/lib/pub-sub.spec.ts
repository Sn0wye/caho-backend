import type { RoomEvent } from '@/contracts';
import type { Redis } from 'ioredis';
import { describe, expect, it, vi } from 'vitest';
import { Pubsub } from './pub-sub';
import { FakeRedisPubsub } from './pub-sub.fakes';

const event: RoomEvent = {
  event: 'room.player-left',
  payload: { id: 'player-a' }
};

describe('CAHO Pub/Sub namespace', () => {
  it('prefixes room and player channels before publishing', async () => {
    const redis = new FakeRedisPubsub();
    const pubsub = new Pubsub(redis as unknown as Redis);
    await pubsub.publish('ABC123', event);
    await pubsub.publish('player-a', event);
    expect(redis.published).toEqual([
      { channel: 'caho:ABC123', message: JSON.stringify(event) },
      { channel: 'caho:player-a', message: JSON.stringify(event) }
    ]);
  });

  it('receives only its prefixed channel and releases that subscription', async () => {
    const redis = new FakeRedisPubsub();
    const pubsub = new Pubsub(redis as unknown as Redis);
    const received = vi.fn();
    const unsubscribe = await pubsub.subscribe('ABC123', received);
    const connection = redis.connections[0];
    expect(connection.subscribed).toEqual(['caho:ABC123']);
    connection.emit('message', 'other:ABC123', JSON.stringify(event));
    connection.emit('message', 'caho:ABC123', JSON.stringify(event));
    expect(received).toHaveBeenCalledTimes(1);
    expect(received).toHaveBeenCalledWith(event);
    await unsubscribe();
    expect(connection.unsubscribed).toEqual(['caho:ABC123']);
    expect(connection.closed).toBe(true);
  });
});
