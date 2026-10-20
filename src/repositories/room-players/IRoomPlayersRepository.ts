import type { Player, Room } from '@/schemas';

// Decides a join against the locked Room and its current Players: throw to
// refuse, or return the Player row to insert.
export type AdmitPlayer = (room: Room, players: Player[]) => Player;

export interface IRoomPlayersRepository {
  getRoomPlayersByCode(roomCode: string): Promise<Player[]>;
  addPlayerToRoom(input: { roomCode: string; player: Player }): Promise<void>;
  // Locks the Room row, runs `admit`, then inserts, all in one transaction.
  // Resolves to the locked Room, or undefined (nothing inserted) when absent.
  addPlayerToLockedRoom(input: {
    roomCode: string;
    admit: AdmitPlayer;
  }): Promise<Room | undefined>;
  getPlayerFromRoom(
    roomCode: string,
    playerId: string
  ): Promise<Player | undefined>;
  getRoomCodesByPlayerId(playerId: string): Promise<string[]>;
  updatePlayerInRoom(
    roomCode: string,
    playerId: string,
    payload: Partial<Player>
  ): Promise<void>;
  updatePlayers(roomCode: string, players: Player[]): Promise<Player[]>;
  setPlayersAsUnready(roomCode: string): Promise<void>;
  incrementPlayerScore(input: {
    roomCode: string;
    playerId: string;
    by: number;
  }): Promise<void>;
  deletePlayerFromRoom: (roomCode: string, playerId: string) => Promise<void>;
}
