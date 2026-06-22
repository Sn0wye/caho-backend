import type { Player } from '@/schemas';

export const getRandomJudge = (
  prevJudgeId: string | null,
  players: Player[]
): string => {
  // An Inactive Player is never eligible to judge, and the previous Judge is
  // skipped so the role rotates. See ADR-0002.
  const eligible = players.filter(p => p.isActive && p.id !== prevJudgeId);

  const randomIndex = Math.floor(Math.random() * eligible.length);

  return eligible[randomIndex].id;
};
