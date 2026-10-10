import { BadRequestError } from '@/errors';
import type { Player } from '@/schemas';

// Picks the next Judge at random among active Players, skipping the outgoing
// Judge so the role rotates. Falls back to the outgoing Judge when they are the
// only active Player left, instead of indexing an empty list.
// Example: getRandomJudge(room.judgeId, players)
export const getRandomJudge = (
  excludedJudgeId: string | null,
  players: Player[]
): string => {
  // An Inactive Player is never eligible to judge. See ADR-0002.
  const active = players.filter(p => p.isActive);
  const rotated = active.filter(p => p.id !== excludedJudgeId);
  const eligible = rotated.length > 0 ? rotated : active;

  if (eligible.length === 0) {
    throw new BadRequestError(
      `Nenhum jogador ativo para ser juiz (jogadores: ${players.length}, ativos: 0).`
    );
  }

  const randomIndex = Math.floor(Math.random() * eligible.length);
  return eligible[randomIndex].id;
};
