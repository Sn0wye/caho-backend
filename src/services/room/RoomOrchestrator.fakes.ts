import type { IRoomClock } from '@/services/round/IJudgeClock';

// Records the Judge-clock calls RoomOrchestrator makes on a departure, so specs can
// assert a drop armed grace and a Leave expired it now.
export class FakeJudgeClock implements IRoomClock {
  public readonly gracedRoundIds: string[] = [];
  public readonly expiredRoundIds: string[] = [];
  public readonly returnedRoundIds: string[] = [];
  public readonly armedPlayRoundIds: string[] = [];

  async onJudgeReturned(roundId: string): Promise<void> {
    this.returnedRoundIds.push(roundId);
  }

  async armPlayDeadline(roundId: string): Promise<void> {
    this.armedPlayRoundIds.push(roundId);
  }

  async armJudgeGrace(roundId: string): Promise<void> {
    this.gracedRoundIds.push(roundId);
  }

  async onJudgeExpired(roundId: string): Promise<void> {
    this.expiredRoundIds.push(roundId);
  }
}
