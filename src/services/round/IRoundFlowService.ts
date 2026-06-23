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

// The slice of IRoomService that RoundFlow needs (ISP): play submission, the
// all-active-played check, the active Round + its plays for the judging hand-off,
// the Judge-pick domain step, and the next-Round rotation. Carved off the god
// IRoomService so the orchestrator depends only on what it uses and its fake stays
// small. RoomService implements the full interface, so it satisfies this. ADR-0004.
export interface IRoundFlowService {
  getPlayerFromRoom(roomCode: string, playerId: string): Promise<Player>;
  updatePlayerInRoom(
    roomCode: string,
    playerId: string,
    payload: Partial<Player>
  ): Promise<Player>;
  playCards(
    roomCode: string,
    playerId: string,
    playedCardIds: string[]
  ): Promise<WhiteCard[]>;
  allActivePlayersPlayed(roomCode: string): Promise<boolean>;
  getActiveRound(roomCode: string): Promise<Round | null>;
  getRoundPlayedCards(
    roomCode: string,
    roundNumber: number
  ): Promise<RoundPlayedCard[]>;
  processJudgeChooseWinner(data: JudgeChooseWinnerDTO): Promise<JudgePickResult>;
  startNextRound(
    roomCode: string,
    currentRound: number
  ): Promise<RoundWithRelations & { blackCard: BlackCard }>;
}
