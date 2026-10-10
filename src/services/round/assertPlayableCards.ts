import { BadRequestError, ForbiddenError } from '@/errors';
import { ROOM_ERRORS } from '@/errors/room';
import type { Player, Round } from '@/schemas';

export type PlayAttempt = {
  round: Round;
  player: Player;
  playedCardIds: string[];
  // How many White Cards the Round's Black Card asks for.
  pick: number;
};

// Rules for a Player's answer. Before this, a Judge could play, a Player could
// play cards they didn't hold, play into a judging Round, or send any count.
// Example: assertPlayableCards({ round, player, playedCardIds: ['w1'], pick: 1 })
export function assertPlayableCards(attempt: PlayAttempt): void {
  assertPlayingPhase(attempt.round);
  assertEligiblePlayer(attempt.round, attempt.player);
  assertCardsMatchPick(attempt.playedCardIds, attempt.pick);
  assertCardsInHand(attempt.playedCardIds, attempt.player.cardIds);
}

function assertPlayingPhase(round: Round): void {
  if (round.status !== 'PLAYING') {
    throw new BadRequestError(
      `A rodada ${round.roundNumber} não aceita jogadas (fase: ${round.status}, esperado: PLAYING).`
    );
  }
}

function assertEligiblePlayer(round: Round, player: Player): void {
  if (player.id === round.judgeId) {
    throw new ForbiddenError(ROOM_ERRORS.JUDGE_CANNOT_PLAY);
  }
  if (player.isReady) {
    throw new BadRequestError('Você já jogou nessa rodada :L');
  }
}

function assertCardsMatchPick(playedCardIds: string[], pick: number): void {
  if (new Set(playedCardIds).size !== playedCardIds.length) {
    throw new BadRequestError(
      `Cartas repetidas na jogada: [${playedCardIds.join(', ')}].`
    );
  }
  if (playedCardIds.length !== pick) {
    throw new BadRequestError(
      `Esta carta preta pede ${pick} carta(s); recebidas ${playedCardIds.length}.`
    );
  }
}

function assertCardsInHand(playedCardIds: string[], hand: string[]): void {
  const missing = playedCardIds.filter(id => !hand.includes(id));
  if (missing.length > 0) {
    throw new BadRequestError(
      `Cartas que não estão na sua mão: [${missing.join(', ')}].`
    );
  }
}
