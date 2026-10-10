import { EventEmitter } from 'node:events';

export class FakeRedisPubsub extends EventEmitter {
  readonly published: Array<{ channel: string; message: string }> = [];
  readonly subscribed: string[] = [];
  readonly unsubscribed: string[] = [];
  readonly connections: FakeRedisPubsub[] = [];
  closed = false;
  publishError?: Error;
  subscribeError?: Error;
  unsubscribeError?: Error;

  duplicate(): FakeRedisPubsub {
    const connection = new FakeRedisPubsub();
    connection.subscribeError = this.subscribeError;
    connection.unsubscribeError = this.unsubscribeError;
    this.connections.push(connection);
    return connection;
  }

  async publish(channel: string, message: string): Promise<number> {
    if (this.publishError) throw this.publishError;
    this.published.push({ channel, message });
    return 1;
  }

  async subscribe(channel: string): Promise<number> {
    if (this.subscribeError) throw this.subscribeError;
    this.subscribed.push(channel);
    return 1;
  }

  async unsubscribe(channel: string): Promise<number> {
    if (this.unsubscribeError) throw this.unsubscribeError;
    this.unsubscribed.push(channel);
    return 0;
  }

  async quit(): Promise<'OK'> {
    this.closed = true;
    return 'OK';
  }

  disconnect(): void {
    this.closed = true;
  }
}
