import type { Round, RoundStatus } from '@/schemas';

export interface IRoundRepository {
  create(input: Round): Promise<Round>;
  find(roomCode: string, number: number): Promise<Round | null>;
  update(id: string, data: Partial<Round>): Promise<Round | null>;
  // Conditional phase move (see IRoundTimerRepository.claimAdvance). The Judge
  // pick and game end use it so they can't race the timers or each other.
  claimAdvance(
    id: string,
    from: RoundStatus | RoundStatus[],
    to: RoundStatus
  ): Promise<Round | null>;
}
