import type { PlayerEvent, RoomEvent } from '@/contracts';
import { traceBackground } from '@/lib/tracing';
import type { FastifyBaseLogger } from 'fastify';
import { WebSocket } from 'ws';

type SubscribeToEvents = (
  channel: string,
  receive: (event: RoomEvent | PlayerEvent) => void
) => Promise<() => Promise<void>>;

export interface SocketPresence {
  connected(): Promise<void>;
  disconnected(): Promise<void>;
}

/** Own socket errors and async cleanup. Example: new SocketSession(socket, log, channel, subscribe).start(). */
export class SocketSession {
  private unsubscribe?: () => Promise<void>;
  private opening: Promise<void> = Promise.resolve();
  private presenceStarted = false;
  private resolveCompleted: () => void = () => {};
  readonly completed = new Promise<void>(resolve => {
    this.resolveCompleted = resolve;
  });

  constructor(
    private readonly socket: WebSocket,
    private readonly log: FastifyBaseLogger,
    private readonly channel: string,
    private readonly subscribe: SubscribeToEvents,
    private readonly presence?: SocketPresence
  ) {}

  public start(): void {
    this.listenSocketFailures();
    this.socket.on('ping', () => this.socket.pong());
    this.socket.once('close', (closeCode: number) => {
      void traceBackground(
        'ws.close',
        { channel: this.channel, closeCode },
        () => this.close(closeCode)
      )
        .catch(err => {
          this.log.error(
            { event: 'ws.cleanup_failed', channel: this.channel, err },
            'WebSocket cleanup failed'
          );
        })
        .finally(() => this.resolveCompleted());
    });
    this.opening = this.open();
  }

  /** Wait for subscription and presence cleanup. Example: await session.shutdown(). */
  public async shutdown(): Promise<void> {
    if (this.socket.readyState !== WebSocket.CLOSED)
      this.socket.close(1001, 'server stopping');
    await this.completed;
  }

  private listenSocketFailures(): void {
    this.socket.on('error', err => {
      this.log.error(
        { event: 'ws.socket_failed', channel: this.channel, err },
        'WebSocket failed'
      );
    });
  }

  private async open(): Promise<void> {
    try {
      this.unsubscribe = await this.subscribe(this.channel, event =>
        this.send(event)
      );
      if (this.socket.readyState !== WebSocket.OPEN) return;
      this.presenceStarted = Boolean(this.presence);
      await this.presence?.connected();
      this.log.debug(
        { event: 'ws.connected', channel: this.channel },
        'WebSocket connected'
      );
    } catch (err) {
      this.log.error(
        { event: 'ws.setup_failed', channel: this.channel, err },
        'WebSocket setup failed'
      );
      this.socket.close(1011, 'subscription failed');
    }
  }

  private send(event: RoomEvent | PlayerEvent): void {
    if (this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(event), err => {
      if (err)
        this.log.error(
          { event: 'ws.send_failed', channel: this.channel, err },
          'WebSocket send failed'
        );
    });
  }

  private async releaseSubscription(): Promise<void> {
    try {
      await this.unsubscribe?.();
    } catch (err) {
      this.log.error(
        { event: 'ws.unsubscribe_failed', channel: this.channel, err },
        'WebSocket unsubscribe failed'
      );
    }
  }

  private async close(closeCode: number): Promise<void> {
    await this.opening;
    await this.releaseSubscription();
    try {
      if (this.presenceStarted) await this.presence?.disconnected();
    } catch (err) {
      this.log.error(
        { event: 'ws.presence_failed', channel: this.channel, err },
        'WebSocket presence cleanup failed'
      );
    }
    this.log.debug(
      { event: 'ws.disconnected', channel: this.channel, closeCode },
      'WebSocket disconnected'
    );
  }
}

/** Retain live socket sessions until async cleanup completes. Example: sessions.open(session). */
export class SocketSessions {
  private readonly sessions = new Set<SocketSession>();

  public open(session: SocketSession): void {
    this.sessions.add(session);
    void session.completed.then(() => this.sessions.delete(session));
    session.start();
  }

  /** Drain socket work before the DB pool ends. Example: await sessions.close(). */
  public async close(): Promise<void> {
    await Promise.all([...this.sessions].map(session => session.shutdown()));
  }
}
