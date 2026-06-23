import type {
  JudgeChooseWinnerDTO,
  JudgePickResult
} from '@/services/room/IRoomService';
import type {
  BlackCard,
  Player,
  Round,
  RoundPlayedCard,
  RoundWithRelations,
  WhiteCard
} from '@/schemas';
import type { IRoundClock } from './IRoundClock';
import type { IRoundFlowService } from './IRoundFlowService';

// Named in-memory fakes for RoundFlow unit tests (AGENTS.md: named fakes, not
// inline stubs), in the style of RoundTimekeeper.fakes — seed via constructor,
// drive the orchestrator, assert on recorded calls / published events. The shared
// event-publisher fake is re-exported so specs import it from one place.
export { FakeGameEventPublisher } from '@/services/IGameEventPublisher.fakes';

// Records the clock calls RoundFlow makes; advanceToJudging reports it won the
// claim by default so the all-played broadcast path is exercised.
export class FakeRoundClock implements IRoundClock {
  public readonly armed: string[] = [];
  public readonly advanced: Array<{ round: Round; plays: RoundPlayedCard[] }> =
    [];
  constructor(private readonly didAdvance = true) {}

  async armPlayDeadline(roundId: string): Promise<void> {
    this.armed.push(roundId);
  }

  async advanceToJudging(
    round: Round,
    plays: RoundPlayedCard[]
  ): Promise<boolean> {
    this.advanced.push({ round, plays });
    return this.didAdvance;
  }
}

export type RoundFlowServiceState = {
  player: Player;
  cardsDrawn: WhiteCard[];
  allPlayed: boolean;
  activeRound: Round | null;
  plays: RoundPlayedCard[];
  judgeResult: JudgePickResult;
  nextRound: RoundWithRelations & { blackCard: BlackCard };
};

// Subset-of-IRoomService fake driven by seeded state; records the mutating calls so
// specs can assert the orchestrator invoked the domain step with the right args.
export class FakeRoundFlowService implements IRoundFlowService {
  public readonly playCardsCalls: Array<{
    roomCode: string;
    playerId: string;
    playedCardIds: string[];
  }> = [];
  public readonly updatePlayerCalls: Array<{
    roomCode: string;
    playerId: string;
    payload: Partial<Player>;
  }> = [];
  public readonly judgeCalls: JudgeChooseWinnerDTO[] = [];

  constructor(private readonly state: Partial<RoundFlowServiceState>) {}

  private require<K extends keyof RoundFlowServiceState>(
    key: K
  ): RoundFlowServiceState[K] {
    const value = this.state[key];
    if (value === undefined) {
      throw new Error(`FakeRoundFlowService: state '${key}' was not seeded`);
    }
    return value as RoundFlowServiceState[K];
  }

  async getPlayerFromRoom(): Promise<Player> {
    return { ...this.require('player') };
  }

  async updatePlayerInRoom(
    roomCode: string,
    playerId: string,
    payload: Partial<Player>
  ): Promise<Player> {
    this.updatePlayerCalls.push({ roomCode, playerId, payload });
    return { ...this.require('player'), ...payload };
  }

  async playCards(
    roomCode: string,
    playerId: string,
    playedCardIds: string[]
  ): Promise<WhiteCard[]> {
    this.playCardsCalls.push({ roomCode, playerId, playedCardIds });
    return this.require('cardsDrawn');
  }

  async allActivePlayersPlayed(): Promise<boolean> {
    return this.require('allPlayed');
  }

  async getActiveRound(): Promise<Round | null> {
    return this.state.activeRound ?? null;
  }

  async getRoundPlayedCards(): Promise<RoundPlayedCard[]> {
    return this.require('plays');
  }

  async processJudgeChooseWinner(
    data: JudgeChooseWinnerDTO
  ): Promise<JudgePickResult> {
    this.judgeCalls.push(data);
    return this.require('judgeResult');
  }

  async startNextRound(): Promise<
    RoundWithRelations & { blackCard: BlackCard }
  > {
    return this.require('nextRound');
  }
}
