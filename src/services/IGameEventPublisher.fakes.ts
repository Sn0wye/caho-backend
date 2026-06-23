import type { PlayerEvent, RoomEvent } from '@/contracts';
import type { IGameEventPublisher } from './IGameEventPublisher';

// Records every published event so orchestrator specs can assert the right events
// went to the right channels, in order. Shared by RoundFlow and RoomOrchestrator
// tests (AGENTS.md: named fakes, one publisher fake, no duplication).
export class FakeGameEventPublisher implements IGameEventPublisher {
  public readonly published: Array<{
    channel: string;
    event: RoomEvent | PlayerEvent;
  }> = [];

  async publish(channel: string, event: RoomEvent | PlayerEvent): Promise<void> {
    this.published.push({ channel, event });
  }
}
