import {
  ROOM_CODE,
  makePlayedCards,
  makeRoom,
  makeRound
} from '@/services/room/RoomService.fixtures';
import { describe, expect, it } from 'vitest';
import {
  JUDGE_ID,
  buildTable,
  eventsNamed,
  phaseOf,
  tableSeed
} from './RoundLifecycle.fixtures';

// The backstop sweep through RoundLifecycle.reconcile: missed deadlines and
// rotations that died after their Round ended. ADR-0003.

const LONG_AGO = new Date(0);

describe('the startup sweep', () => {
  it('advances a Round whose deadline passed while unsubscribed and leaves the rest', async () => {
    const past = new Date(Date.now() - 60_000);
    const future = new Date(Date.now() + 60_000);
    const table = await buildTable(tableSeed({
      room: makeRoom({ judgeId: JUDGE_ID, round: 2 }),
      rounds: [makeRound({ status: 'ABORTED' }), makeRound({ id: 'round-2', roundNumber: 2, playDeadline: past })]
    }));
    const untouched = await buildTable(tableSeed({ rounds: [makeRound({ playDeadline: future })] }));

    await table.rounds.reconcile();
    await untouched.rounds.reconcile();

    expect(await phaseOf(table, 2)).toBe('ABORTED');
    expect(await phaseOf(table, 3)).toBe('PLAYING');
    expect(await phaseOf(untouched)).toBe('PLAYING');
  });

  it('aborts a Round held past a lapsed Judge grace even if play time remains', async () => {
    const table = await buildTable(tableSeed({
      rounds: [makeRound({ playDeadline: new Date(Date.now() + 60_000), judgeDeadline: new Date(0) })],
      playedCards: [makePlayedCards('player-a')]
    }));

    await table.rounds.reconcile();

    expect(await phaseOf(table)).toBe('ABORTED');
  });
});

describe('the stalled rotation sweep', () => {
  it('rotates into the next Round when an ended Round never rotated', async () => {
    const table = await buildTable(tableSeed({
      rounds: [makeRound({ status: 'COMPLETE', updatedAt: LONG_AGO })]
    }));

    await table.rounds.reconcile();

    const next = await table.store.rounds.find(ROOM_CODE, 2);
    expect(next).toEqual(expect.objectContaining({ status: 'PLAYING' }));
    expect(next?.judgeId).not.toBe(JUDGE_ID);
    expect((await table.store.rooms.getRoomByCode(ROOM_CODE))?.round).toBe(2);
    expect(eventsNamed(table, 'room.round-start')).toHaveLength(1);
  });

  it('opens the Round the Room already moved to, keeping its new Judge', async () => {
    const table = await buildTable(tableSeed({
      room: makeRoom({ judgeId: 'player-a', prevJudgeId: JUDGE_ID, round: 2, pickedBlackCards: ['black-1'] }),
      rounds: [makeRound({ status: 'ABORTED', updatedAt: LONG_AGO })]
    }));

    await table.rounds.reconcile();

    expect(await table.store.rounds.find(ROOM_CODE, 2)).toEqual(
      expect.objectContaining({ status: 'PLAYING', judgeId: 'player-a' })
    );
    expect(eventsNamed(table, 'room.round-start')).toEqual([
      expect.objectContaining({ payload: expect.objectContaining({ roundNumber: 2, judgeId: 'player-a' }) })
    ]);
  });

  it('leaves a just-ended Round to its own rotation', async () => {
    const table = await buildTable(tableSeed({
      rounds: [makeRound({ status: 'COMPLETE', updatedAt: new Date() })]
    }));

    await table.rounds.reconcile();

    expect(await phaseOf(table, 2)).toBeUndefined();
  });

  it('still advances expired Rounds when a stalled Round cannot resume', async () => {
    const table = await buildTable(tableSeed({
      room: makeRoom({ judgeId: JUDGE_ID, round: 5 }),
      rounds: [
        makeRound({ status: 'ABORTED', updatedAt: LONG_AGO }),
        makeRound({ id: 'round-5', roundNumber: 5, playDeadline: LONG_AGO })
      ],
      playedCards: [makePlayedCards('player-a', 'round-5')]
    }));

    await table.rounds.reconcile();

    expect(await phaseOf(table, 5)).toBe('JUDGING');
    const failures = table.output.lines.map(line => JSON.parse(line)).filter(line => line.event === 'round.reconciliation_failed');
    expect(failures).toEqual([expect.objectContaining({ roundId: 'round-1' })]);
  });
});
