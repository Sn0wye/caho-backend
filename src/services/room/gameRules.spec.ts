import type { Player, Room } from '@/schemas';
import { describe, expect, it } from 'vitest';
import { assertCanRotate, assertRoomCanStart } from './gameRules';

const room = { code: 'ABC123', hostId: 'host', status: 'LOBBY' } as Room;

const player = (id: string, overrides: Partial<Player> = {}): Player => ({
  id,
  username: id,
  avatarUrl: null,
  isHost: id === 'host',
  isReady: true,
  isJudge: false,
  isActive: true,
  score: 0,
  cardIds: [],
  ...overrides
});

describe('assertRoomCanStart', () => {
  const trio = [player('host'), player('a'), player('b')];

  it('lets the Host start with three ready Players', () => {
    expect(() => assertRoomCanStart(room, trio, 'host')).not.toThrow();
  });

  it('requires the Host to be ready too', () => {
    const players = [player('host', { isReady: false }), player('a'), player('b')];
    expect(() => assertRoomCanStart(room, players, 'host')).toThrow('prontos');
  });

  it('rejects fewer than three active Players', () => {
    const players = [player('host'), player('a'), player('b', { isActive: false })];
    expect(() => assertRoomCanStart(room, players, 'host')).toThrow('3');
  });

  it('rejects a Room that already started', () => {
    expect(() =>
      assertRoomCanStart({ ...room, status: 'IN_PROGRESS' }, trio, 'host')
    ).toThrow('IN_PROGRESS');
  });
});

describe('assertCanRotate', () => {
  const inProgress = { ...room, status: 'IN_PROGRESS', round: 2 } as Room;

  it('lets the current Round rotate', () => {
    expect(() => assertCanRotate(inProgress, 2)).not.toThrow();
  });

  it('rejects a stale Round the Room already left', () => {
    expect(() => assertCanRotate(inProgress, 1)).toThrow('rodada 2');
  });

  it('rejects a Room that is no longer in progress', () => {
    expect(() => assertCanRotate({ ...inProgress, status: 'FINISHED' }, 2)).toThrow('FINISHED');
  });
});
