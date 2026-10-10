import { EventEmitter } from 'node:events';

export class FakeRedisPubsub extends EventEmitter {
  readonly published: Array<{ channel: string; message: string }> = [];
  readonly subscribed: string[] = [];
  readonly unsubscribed: string[] = [];
  readonly connections: FakeRedisPubsub[] = [];
  closed = false;

  duplicate(): FakeRedisPubsub {
    const connection = new FakeRedisPubsub();
    this.connections.push(connection);
    return connection;
  }

  async publish(channel: string, message: string): Promise<number> {
    this.published.push({ channel, message });
    return 1;
  }

  async subscribe(channel: string): Promise<number> {
    this.subscribed.push(channel);
    return 1;
  }

  async unsubscribe(channel: string): Promise<number> {
    this.unsubscribed.push(channel);
    return 0;
  }

  async quit(): Promise<'OK'> {
    this.closed = true;
    return 'OK';
  }
}
