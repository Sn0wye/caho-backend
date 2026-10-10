import type {
  JudgeChooseWinnerDTO,
  JudgePickResult,
  NextRound,
  PlayResult
} from '@/services/room/IRoomService';
import type { Player, Round, RoundPlayedCard } from '@/schemas';

// The slice of IRoomService that RoundFlow needs (ISP): play submission, the
// all-active-played check, the active Round + its plays for the judging hand-off,
// the Judge-pick domain step, and the next-Round rotation. Carved off the god
// IRoomService so the orchestrator depends only on what it uses and its fake stays
// small. RoomService implements the full interface, so it satisfies this. ADR-0004.
export interface IRoundFlowService {
  togglePlayerReady(roomCode: string, playerId: string): Promise<Player>;
  playCards(
    roomCode: string,
    playerId: string,
    playedCardIds: string[]
  ): Promise<PlayResult>;
  allActivePlayersPlayed(roomCode: string): Promise<boolean>;
  getActiveRound(roomCode: string): Promise<Round | null>;
  getRoundPlayedCards(
    roomCode: string,
    roundNumber: number
  ): Promise<RoundPlayedCard[]>;
  processJudgeChooseWinner(data: JudgeChooseWinnerDTO): Promise<JudgePickResult>;
  startNextRound(roomCode: string, currentRound: number): Promise<NextRound>;
}
