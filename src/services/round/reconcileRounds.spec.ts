import { makeRoom, makeRound } from '@/services/room/RoomService.fixtures';
import { describe, expect, it } from 'vitest';
import { stalledRotationStep } from './reconcileRounds';

describe('stalledRotationStep', () => {
  const ended = makeRound({ roundNumber: 3, status: 'COMPLETE' });

  it('rotates when the Room is still on the ended Round', () => {
    expect(stalledRotationStep(makeRoom({ round: 3 }), ended)).toEqual({
      kind: 'rotate'
    });
  });

  it('opens the next Round with the Judge the Room moved to', () => {
    const room = makeRoom({ round: 4, judgeId: 'player-b' });

    expect(stalledRotationStep(room, ended)).toEqual({
      kind: 'open',
      judgeId: 'player-b'
    });
  });

  it('refuses a Room on any other Round or with no Judge', () => {
    expect(() => stalledRotationStep(makeRoom({ round: 6 }), ended)).toThrow(
      /Room is on Round 6/
    );
    expect(() =>
      stalledRotationStep(makeRoom({ round: 4, judgeId: null }), ended)
    ).toThrow(/with Judge null/);
  });
});
