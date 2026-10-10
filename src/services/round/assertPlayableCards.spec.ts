import type { Player, Round } from '@/schemas';
import { describe, expect, it } from 'vitest';
import { assertPlayableCards } from './assertPlayableCards';

const round: Round = {
  id: 'round-1',
  roomCode: 'ABC123',
  roundNumber: 1,
  blackCardId: 'black-1',
  judgeId: 'judge',
  roundWinnerId: null,
  status: 'PLAYING',
  playDeadline: null,
  judgeDeadline: null,
  createdAt: new Date(),
  updatedAt: new Date()
};

const player: Player = {
  id: 'player-a',
  username: 'player-a',
  avatarUrl: null,
  isHost: false,
  isReady: false,
  isJudge: false,
  isActive: true,
  score: 0,
  cardIds: ['w1', 'w2']
};

const attempt = (overrides = {}) => ({
  round,
  player,
  playedCardIds: ['w1'],
  pick: 1,
  ...overrides
});

describe('assertPlayableCards', () => {
  it('accepts cards from the Hand matching the pick', () => {
    expect(() => assertPlayableCards(attempt())).not.toThrow();
  });

  it('rejects a card the Player does not hold, naming it', () => {
    expect(() => assertPlayableCards(attempt({ playedCardIds: ['w9'] }))).toThrow('w9');
  });

  it('rejects the same card twice', () => {
    expect(() =>
      assertPlayableCards(attempt({ playedCardIds: ['w1', 'w1'], pick: 2 }))
    ).toThrow('repetidas');
  });

  it('rejects a second play in the same Round', () => {
    expect(() =>
      assertPlayableCards(attempt({ player: { ...player, isReady: true } }))
    ).toThrow('já jogou');
  });

  it('rejects a play outside the playing phase', () => {
    expect(() =>
      assertPlayableCards(attempt({ round: { ...round, status: 'JUDGING' } }))
    ).toThrow('JUDGING');
  });
});
