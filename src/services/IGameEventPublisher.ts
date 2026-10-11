import type { PlayerEvent, RoomEvent } from '@/contracts';

// Publish port for the orchestration layer (ADR-0004). RoomOrchestrator and
// RoundLifecycle emit both Room broadcasts (channel = Room Code) and per-Player
// events (channel = Player id, e.g. the freshly drawn Hand), so the surface
// mirrors the concrete Pubsub.publish. The app's Pubsub structurally satisfies this; orchestrators depend on the port.
export interface IGameEventPublisher {
  publish(channel: string, event: RoomEvent | PlayerEvent): Promise<void>;
}
