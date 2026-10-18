import { EventEmitter } from 'node:events';
import type { PlayerEvent, RoomEvent } from '@/contracts';
import type { SocketInbound, SocketPresence } from './socket-session';

export class FakeGameSocket extends EventEmitter {
  readyState = 1;
  readonly sent: string[] = [];
  readonly closed: Array<{ code: number; reason?: string }> = [];
  pongCount = 0;
  sendError?: Error;

  send(message: string, callback: (err?: Error) => void): void {
    this.sent.push(message);
    callback(this.sendError);
  }

  close(code: number, reason?: string): void {
    this.readyState = 3;
    this.closed.push({ code, reason });
    this.emit('close', code);
  }

  pong(): void {
    this.pongCount++;
  }
}

export class FakeSocketSubscription {
  receive?: (event: RoomEvent | PlayerEvent) => void;
  subscribeError?: Error;
  unsubscribeError?: Error;
  unsubscribed = 0;
  connectDelay: Promise<void> = Promise.resolve();

  async subscribe(
    _channel: string,
    receive: (event: RoomEvent | PlayerEvent) => void
  ): Promise<() => Promise<void>> {
    await this.connectDelay;
    if (this.subscribeError) throw this.subscribeError;
    this.receive = receive;
    return async () => {
      this.unsubscribed++;
      if (this.unsubscribeError) throw this.unsubscribeError;
    };
  }
}

export class FakeSocketPresence implements SocketPresence {
  readonly changes: boolean[] = [];
  connectError?: Error;
  disconnectError?: Error;
  disconnectDelay: Promise<void> = Promise.resolve();

  async connected(): Promise<void> {
    this.changes.push(true);
    if (this.connectError) throw this.connectError;
  }

  async disconnected(): Promise<void> {
    await this.disconnectDelay;
    this.changes.push(false);
    if (this.disconnectError) throw this.disconnectError;
  }
}

export class FakeSocketInbound implements SocketInbound {
  readonly messages: string[] = [];

  receive(message: string): void {
    this.messages.push(message);
  }
}
