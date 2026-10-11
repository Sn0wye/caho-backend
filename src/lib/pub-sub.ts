import type { PlayerEvent, RoomEvent } from '@/contracts';
import { CAHO_REDIS_PREFIX } from '@/db/redis-prefix';
import { traceOperation } from '@/lib/tracing';
import { ROOT_CONTEXT, context, propagation } from '@opentelemetry/api';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { openRedisSubscription } from './redis-events';

type Event = RoomEvent | PlayerEvent;
type TracedEvent = Event & { __cahoTrace?: Record<string, string> };

export class Pubsub {
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
    const sub = this.redis.duplicate();
    const redisChannel = `${CAHO_REDIS_PREFIX}${channel}`;
    sub.on('message', (receivedChannel: string, message: string) => {
      if (receivedChannel !== redisChannel) return;
      void this.deliver(channel, message, cb);
    });
    return openRedisSubscription(sub, redisChannel, this.log);
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
