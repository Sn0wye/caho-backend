import type { RoomEvent } from '@/contracts';

// Thin publish port so the timer engine can broadcast a timer-driven Round
// advance to a Room's subscribers without depending on the concrete Pubsub /
// ioredis. The app's Pubsub structurally satisfies this. See issue #4.
export interface IRoundEventPublisher {
  publish(channel: string, event: RoomEvent): Promise<void>;
}
