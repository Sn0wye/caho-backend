import type { SocketSession } from './socket-session';

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
