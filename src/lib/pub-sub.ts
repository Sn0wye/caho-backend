import type { PlayerEvent, RoomEvent } from '@/contracts';
import { CAHO_REDIS_PREFIX } from '@/db/redis-prefix';
import type { Redis } from 'ioredis';

type Event = RoomEvent | PlayerEvent;

export class Pubsub {
  private redis: Redis;

  constructor(redis: Redis) {
    this.redis = redis;
  }

  /** Send an event within CAHO's namespace. Example: publish(roomCode, event). */
  public async publish(channel: string, event: Event): Promise<void> {
    await this.redis.publish(
      `${CAHO_REDIS_PREFIX}${channel}`,
      JSON.stringify(event)
    );
  }

  /** Subscribe by logical channel and return cleanup. Example: subscribe(roomCode, onEvent). */
  public async subscribe(
    channel: string,
    cb: (event: Event) => void
  ): Promise<() => Promise<void>> {
    const sub = this.redis.duplicate();
    const redisChannel = `${CAHO_REDIS_PREFIX}${channel}`;

    sub.on('message', (receivedChannel, message) => {
      if (receivedChannel !== redisChannel) return;
      cb(JSON.parse(message));
    });

    await sub.subscribe(redisChannel);

    return async () => {
      await sub.unsubscribe(redisChannel);
      sub.quit();
    };
  }
}
