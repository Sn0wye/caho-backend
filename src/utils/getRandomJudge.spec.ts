import type { Player } from '@/schemas';
import { describe, expect, it } from 'vitest';
import { getRandomJudge } from './getRandomJudge';

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: 'player-1',
    username: 'player-1',
    avatarUrl: null,
    isHost: false,
    isReady: false,
    isJudge: false,
    isActive: true,
    score: 0,
    cardIds: [],
    ...overrides
  };
}

describe('getRandomJudge', () => {
  it('never selects an inactive Player', () => {
    const players = [
      makePlayer({ id: 'active', isActive: true }),
      makePlayer({ id: 'dropped', isActive: false })
    ];

    // Random pick, so sample repeatedly: only the active Player is eligible.
    for (let i = 0; i < 50; i++) {
      expect(getRandomJudge(null, players)).toBe('active');
    }
  });

  it('excludes the previous Judge from being picked again', () => {
    const players = [
      makePlayer({ id: 'prev', isActive: true }),
      makePlayer({ id: 'next', isActive: true })
    ];

    for (let i = 0; i < 50; i++) {
      expect(getRandomJudge('prev', players)).toBe('next');
    }
  });
});
