import { type CursorMessage, cursorMessage } from '@/contracts';
import type { CursorBroadcaster } from '@/services/cursor/CursorBroadcaster';
import type { FastifyBaseLogger } from 'fastify';
import type { SocketInbound, SocketPresence } from './socket-session';

// Clients send at most every 50ms; this floor leaves room for network jitter
// while capping what one socket can push through Redis.
export const CURSOR_MIN_INTERVAL_MS = 30;

type Clock = () => number;

/**
 * Reads cursor messages off one Player's Room socket and relays them to the
 * Room (ADR-0006). Stays silent until `connected()` confirms the Player sits in
 * the Room, drops moves that arrive faster than CURSOR_MIN_INTERVAL_MS, and
 * hides the cursor when the socket closes.
 *
 * @example
 * const inbox = new CursorInbox(cursors, log, 'ABC123', userId);
 * sessions.open(new SocketSession(socket, log, 'ABC123', subscribe, inbox, inbox));
 */
export class CursorInbox implements SocketPresence, SocketInbound {
  private isSeated = false;
  private isShown = false;
  private lastMoveAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly cursors: CursorBroadcaster,
    private readonly log: FastifyBaseLogger,
    private readonly roomCode: string,
    private readonly playerId: string,
    private readonly now: Clock = Date.now
  ) {}

  public async connected(): Promise<void> {
    this.isSeated = await this.cursors.isSeated(this.roomCode, this.playerId);
  }

  public async disconnected(): Promise<void> {
    if (!this.isShown) return;
    this.isShown = false;
    await this.cursors.hide(this.roomCode, this.playerId);
  }

  public receive(raw: string): void {
    if (!this.isSeated) return;
    const message = parseCursorMessage(raw);
    if (!message) return;
    const relayed = this.relay(message);
    if (!relayed) return;
    relayed.catch(err => {
      this.log.warn(
        { event: 'ws.cursor_relay_failed', roomCode: this.roomCode, err },
        'Cursor relay failed'
      );
    });
  }

  private relay(message: CursorMessage): Promise<void> | null {
    if (message.event === 'cursor.hide') {
      if (!this.isShown) return null;
      this.isShown = false;
      return this.cursors.hide(this.roomCode, this.playerId);
    }
    const at = this.now();
    if (at - this.lastMoveAt < CURSOR_MIN_INTERVAL_MS) return null;
    this.lastMoveAt = at;
    this.isShown = true;
    return this.cursors.move(this.roomCode, this.playerId, message.payload);
  }
}

function parseCursorMessage(raw: string): CursorMessage | null {
  try {
    const parsed = cursorMessage.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    // Not JSON, e.g. the client's keepalive 'ping'.
    return null;
  }
}
