import type { JoinRoomDTO } from '@/dto/JoinRoom';
import type { LeaveRoomDTO } from '@/dto/LeaveRoom';
import type { Player, Ranking, Room, Round } from '@/schemas';
import type { HostLossOutcome } from './IRoomService';

// The slice of IRoomService that RoomOrchestrator needs (ISP): membership
// (join/leave), the end-game projection, presence toggling, and the
// status-dependent Host/Judge departure reads. Carved off the god IRoomService so
// the orchestrator depends only on what it uses and its fake stays small.
// RoomService implements the full interface, so it satisfies this. ADR-0004.
export interface IRoomOrchestratorService {
  getRoom(roomCode: string): Promise<Room>;
  joinRoom(input: JoinRoomDTO): Promise<Room>;
  leaveRoom(input: LeaveRoomDTO): Promise<void>;
  endGame(roomCode: string): Promise<Ranking>;
  handleHostLoss(
    roomCode: string,
    departingPlayerId: string
  ): Promise<HostLossOutcome>;
  setPlayerActive(
    roomCode: string,
    playerId: string,
    isActive: boolean
  ): Promise<Player>;
  getActiveRound(roomCode: string): Promise<Round | null>;
  getPlayerRoomCodes(playerId: string): Promise<string[]>;
}
