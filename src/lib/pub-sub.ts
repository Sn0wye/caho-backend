import type { PlayerEvent, RoomEvent } from '@/contracts';
import { CAHO_REDIS_PREFIX } from '@/db/redis-prefix';
import { traceOperation } from '@/lib/tracing';
import { ROOT_CONTEXT, context, propagation } from '@opentelemetry/api';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { observeRedis } from './redis-events';

type Event = RoomEvent | PlayerEvent;
type TracedEvent = Event & { __cahoTrace?: Record<string, string> };
type ChannelSubscription = {
  receivers: Set<(event: Event) => void>;
  ready: Promise<void>;
};

export class Pubsub {
  private subscriber?: Redis;
  private readonly channels = new Map<string, ChannelSubscription>();

  constructor(
    private readonly redis: Redis,
    private readonly log?: Logger
  ) {}

  /** Send event metadata and trace context within CAHO's namespace. Example: publish(roomCode, event). */
  public async publish(channel: string, event: Event): Promise<void> {
    await traceOperation(
      'pubsub.publish',
      { channel, eventType: event.event },
      () => this.publishEvent(channel, event)
    );
  }

  private async publishEvent(channel: string, event: Event): Promise<void> {
    const wireEvent = encodePubsubEvent(event);
    const fields = { channel, eventType: event.event };
    try {
      await this.redis.publish(
        `${CAHO_REDIS_PREFIX}${channel}`,
        JSON.stringify(wireEvent)
      );
      this.log?.debug(
        { event: 'pubsub.published', ...fields },
        'Event published'
      );
    } catch (err) {
      this.log?.error(
        { event: 'pubsub.publish_failed', ...fields, err },
        'Event publish failed'
      );
      throw err;
    }
  }

  /** Subscribe by logical channel and return cleanup. Example: subscribe(roomCode, onEvent). */
  public async subscribe(
    channel: string,
    cb: (event: Event) => void
  ): Promise<() => Promise<void>> {
    const redisChannel = `${CAHO_REDIS_PREFIX}${channel}`;
    const subscription =
      this.channels.get(redisChannel) ?? this.openChannel(redisChannel);
    await subscription.ready;
    subscription.receivers.add(cb);
    return () => this.release(redisChannel, subscription, cb);
  }

  /** Quit the shared subscriber connection. Example: app.addHook('onClose', () => pubsub.close()). */
  public async close(): Promise<void> {
    this.channels.clear();
    await this.subscriber?.quit();
  }

  // Every socket used to duplicate its own Redis connection; now one shared
  // subscriber carries every channel and fans messages out here. issue #26.
  private sharedSubscriber(): Redis {
    if (this.subscriber) return this.subscriber;
    const sub = this.redis.duplicate();
    if (this.log) observeRedis(sub, this.log, 'pubsub');
    sub.on('message', (redisChannel: string, message: string) => {
      const subscription = this.channels.get(redisChannel);
      const channel = redisChannel.slice(CAHO_REDIS_PREFIX.length);
      for (const cb of subscription?.receivers ?? []) {
        void this.deliver(channel, message, cb);
      }
    });
    this.subscriber = sub;
    return sub;
  }

  // Concurrent subscribers to a new channel share one SUBSCRIBE round trip.
  private openChannel(redisChannel: string): ChannelSubscription {
    const subscription: ChannelSubscription = {
      receivers: new Set(),
      ready: this.sharedSubscriber()
        .subscribe(redisChannel)
        .then(() => undefined)
        .catch(err => {
          this.channels.delete(redisChannel);
          this.log?.error(
            { event: 'redis.subscription_failed', channel: redisChannel, connectionRole: 'pubsub', err },
            'Redis subscription failed'
          );
          throw err;
        })
    };
    this.channels.set(redisChannel, subscription);
    return subscription;
  }

  private async release(
    redisChannel: string,
    subscription: ChannelSubscription,
    cb: (event: Event) => void
  ): Promise<void> {
    subscription.receivers.delete(cb);
    if (subscription.receivers.size > 0) return;
    if (this.channels.get(redisChannel) !== subscription) return;
    this.channels.delete(redisChannel);
    await this.subscriber?.unsubscribe(redisChannel);
  }

  private async deliver(
    channel: string,
    message: string,
    cb: (event: Event) => void
  ): Promise<void> {
    const wireEvent = this.decodeMessage(channel, message);
    if (!wireEvent) return;
    try {
      const { __cahoTrace, ...event } = wireEvent;
      const parent = propagation.extract(ROOT_CONTEXT, __cahoTrace ?? {});
      await traceOperation(
        'pubsub.deliver',
        { channel, eventType: event.event },
        () => this.invokeCallback(channel, event as Event, cb),
        parent
      );
    } catch {
      /* Callback failure already logged within its trace context. */
    }
  }

  private async invokeCallback(
    channel: string,
    event: Event,
    cb: (event: Event) => void
  ): Promise<void> {
    try {
      cb(event);
    } catch (err) {
      this.log?.error(
        {
          event: 'pubsub.delivery_failed',
          channel,
          eventType: event.event,
          err
        },
        'Event delivery failed'
      );
      throw err;
    }
  }

  private decodeMessage(channel: string, message: string): TracedEvent | null {
    try {
      return parsePubsubMessage(message);
    } catch {
      // SyntaxError messages can quote private payloads; keep only message size.
      this.log?.error(
        {
          event: 'pubsub.invalid_message',
          channel,
          messageBytes: Buffer.byteLength(message)
        },
        'Invalid Pub/Sub event shape'
      );
      return null;
    }
  }
}

function parsePubsubMessage(message: string): TracedEvent {
  const parsed: unknown = JSON.parse(message);
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('event' in parsed) ||
    typeof parsed.event !== 'string' ||
    !('payload' in parsed)
  ) {
    throw new Error(
      `Invalid Pub/Sub value type ${typeof parsed}; expected object with event string and payload`
    );
  }
  return parsed as TracedEvent;
}

function encodePubsubEvent(event: Event): TracedEvent {
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  return Object.keys(carrier).length
    ? { ...event, __cahoTrace: carrier }
    : event;
}
