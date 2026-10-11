import { BadRequestError } from '@/errors';
import { ROOM_ERRORS } from '@/errors/room';
import type { Player, Room } from '@/schemas';

// Every Player holds this many White Cards; plays refill back up to it.
export const HAND_SIZE = 10;

// One Judge plus at least two answers, otherwise the Judge has nothing to pick.
export const MIN_PLAYERS_TO_START = 3;

// Guards the Host's start: only the Host, only from LOBBY, enough active
// Players, and every active Player has marked ready — the Host included; the
// Host readies up like anyone else. Throws BadRequestError naming the failed rule.
// Example: assertRoomCanStart(room, players, req.getUser().id)
export function assertRoomCanStart(
  room: Room,
  players: Player[],
  requesterId: string
): void {
  if (requesterId !== room.hostId) {
    throw new BadRequestError(ROOM_ERRORS.IS_NOT_ROOM_HOST);
  }
  if (room.status !== 'LOBBY') {
    throw new BadRequestError(
      `A sala ${room.code} já foi iniciada (status: ${room.status}, esperado: LOBBY).`
    );
  }
  const active = players.filter(player => player.isActive);
  if (active.length < MIN_PLAYERS_TO_START) {
    throw new BadRequestError(
      `São necessários pelo menos ${MIN_PLAYERS_TO_START} jogadores ativos; a sala tem ${active.length}.`
    );
  }
  if (active.some(player => !player.isReady)) {
    throw new BadRequestError(ROOM_ERRORS.NOT_ALL_PLAYERS_READY);
  }
}

// Guards a Judge rotation out of `currentRound`: a stale number (another path
// already rotated) or a finished Room is rejected so two paths can't open two
// Rounds. Example: assertCanRotate(room, round.roundNumber)
export function assertCanRotate(room: Room, currentRound: number): void {
  if (room.status !== 'IN_PROGRESS') {
    throw new BadRequestError(
      `Não há próxima rodada: a sala ${room.code} está ${room.status}, esperado IN_PROGRESS.`
    );
  }
  if (room.round !== currentRound) {
    throw new BadRequestError(
      `Rodada ${currentRound} já encerrada; a sala ${room.code} está na rodada ${room.round}.`
    );
  }
}
