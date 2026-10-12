import type { CreateRoomDTO } from '@/dto/CreateRoom';
import type { JoinRoomDTO } from '@/dto/JoinRoom';
import type { LeaveRoomDTO } from '@/dto/LeaveRoom';
import type { Player, Ranking, Room, WhiteCard } from '@/schemas';
import type { GameStart, HostLossOutcome } from './IRoomService';

// The slice of IRoomService that RoomOrchestrator needs (ISP): membership
// (create/join/leave/ready), the end-game projection, presence toggling, and the
// status-dependent Host departure reads. Carved off the god IRoomService so
// the orchestrator depends only on what it uses. RoomService implements the
// full interface, so it satisfies this; specs drive it over InMemoryGameStore
// (issue #24). ADR-0004.
export interface IRoomOrchestratorService {
  getRoom(roomCode: string): Promise<Room>;
  createRoom(room: CreateRoomDTO): Promise<Room>;
  addPlayerToRoom(input: { roomCode: string; player: Player }): Promise<void>;
  joinRoom(input: JoinRoomDTO): Promise<Room>;
  startGame(roomCode: string, requesterId: string): Promise<GameStart>;
  dealHand(roomCode: string, playerId: string, count: number): Promise<WhiteCard[]>;
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
  togglePlayerReady(roomCode: string, playerId: string): Promise<Player>;
  getPlayerRoomCodes(playerId: string): Promise<string[]>;
}
