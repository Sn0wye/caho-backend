import type { PlayerEvent, RoomEvent } from '@/contracts';

// Subscribe port for the WS route (ADR-0001): one shared subscriber is built in
// the app composition and handed to the route, so tests can swap in an
// in-memory bus. The app's Pubsub structurally satisfies this. issue #26.
export interface IGameEventSubscriber {
  /**
   * Deliver every event published on `channel` to `receive` until the returned
   * cleanup runs.
   *
   * @example
   * const stop = await subscriber.subscribe(roomCode, event => socket.send(event));
   */
  subscribe(
    channel: string,
    receive: (event: RoomEvent | PlayerEvent) => void
  ): Promise<() => Promise<void>>;
}
