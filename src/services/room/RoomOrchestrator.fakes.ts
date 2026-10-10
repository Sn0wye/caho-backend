import type { JoinRoomDTO } from '@/dto/JoinRoom';
import type { LeaveRoomDTO } from '@/dto/LeaveRoom';
import type { Player, Ranking, Room, Round, WhiteCard } from '@/schemas';
import type { IRoomClock } from '@/services/round/IJudgeClock';
import type { GameStart, HostLossOutcome } from './IRoomService';
import type { IRoomOrchestratorService } from './IRoomOrchestratorService';

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

export type RoomOrchestratorState = {
  room: Room;
  ranking: Ranking;
  hostLoss: HostLossOutcome;
  presencePlayer: Player;
  activeRound: Round | null;
  roomCodes: string[];
  gameStart: GameStart;
  dealtHand: WhiteCard[];
};

// Subset-of-IRoomService fake driven by seeded state; records the mutating calls so
// specs can assert the orchestrator drove membership/presence with the right args.
export class FakeRoomOrchestratorService implements IRoomOrchestratorService {
  public readonly joined: JoinRoomDTO[] = [];
  public readonly left: LeaveRoomDTO[] = [];
  public readonly endGameCalls: string[] = [];
  public readonly setActiveCalls: Array<{
    roomCode: string;
    playerId: string;
    isActive: boolean;
  }> = [];

  constructor(private readonly state: Partial<RoomOrchestratorState>) {}

  private require<K extends keyof RoomOrchestratorState>(
    key: K
  ): RoomOrchestratorState[K] {
    const value = this.state[key];
    if (value === undefined) {
      throw new Error(`FakeRoomOrchestratorService: state '${key}' was not seeded`);
    }
    return value as RoomOrchestratorState[K];
  }

  async getRoom(): Promise<Room> {
    return this.require('room');
  }

  async joinRoom(input: JoinRoomDTO): Promise<Room> {
    this.joined.push(input);
    return this.require('room');
  }

  async startGame(): Promise<GameStart> {
    return this.require('gameStart');
  }

  public readonly dealHandCalls: Array<{ roomCode: string; playerId: string; count: number }> = [];

  async dealHand(roomCode: string, playerId: string, count: number): Promise<WhiteCard[]> {
    this.dealHandCalls.push({ roomCode, playerId, count });
    return this.require('dealtHand');
  }

  async leaveRoom(input: LeaveRoomDTO): Promise<void> {
    this.left.push(input);
  }

  async endGame(roomCode: string): Promise<Ranking> {
    this.endGameCalls.push(roomCode);
    return this.require('ranking');
  }

  async handleHostLoss(): Promise<HostLossOutcome> {
    return this.require('hostLoss');
  }

  async setPlayerActive(
    roomCode: string,
    playerId: string,
    isActive: boolean
  ): Promise<Player> {
    this.setActiveCalls.push({ roomCode, playerId, isActive });
    return { ...this.require('presencePlayer'), isActive };
  }

  async getActiveRound(): Promise<Round | null> {
    return this.state.activeRound ?? null;
  }

  async getPlayerRoomCodes(): Promise<string[]> {
    return this.require('roomCodes');
  }
}
