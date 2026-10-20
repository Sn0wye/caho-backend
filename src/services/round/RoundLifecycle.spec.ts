import { BadRequestError, ForbiddenError } from '@/errors';
import {
  makeBlackCard,
  makeWhiteCard
} from '@/repositories/game-store/gameStore.fixtures';
import {
  ROOM_CODE,
  findPlayer,
  makePlayedCards,
  makePlayer,
  makeRoomPlayer,
  makeRound
} from '@/services/room/RoomService.fixtures';
import { describe, expect, it } from 'vitest';
import {
  JUDGE_ID,
  ROUND_ID,
  buildTable,
  eventsNamed,
  expire,
  judgingSeed,
  phaseOf,
  playAll,
  tableSeed
} from './RoundLifecycle.fixtures';
import { graceKey, judgeKey, playKey } from './deadlineKeys';

// A Round's whole lifecycle, driven through RoundLifecycle on the shared table
// in RoundLifecycle.fixtures. See issue #25.

describe('opening a Round', () => {
  it('opens Round 1, arms its play deadline and announces it with the Judge', async () => {
    const table = await buildTable(tableSeed({ rounds: [] }));

    const round = await table.rounds.startFirstRound(ROOM_CODE, JUDGE_ID, makeBlackCard());

    expect(round).toEqual(expect.objectContaining({ roundNumber: 1, status: 'PLAYING', judgeId: JUDGE_ID }));
    expect(round.playDeadline).not.toBeNull();
    expect(table.timers.armed.get(playKey(round.id))).toBe(60);
    expect(table.publisher.published).toEqual([
      {
        channel: ROOM_CODE,
        event: { event: 'room.round-start', payload: { roundNumber: 1, judgeId: JUDGE_ID, blackCard: makeBlackCard() } }
      }
    ]);
  });
});

describe('playing', () => {
  it('broadcasts the ready flag and the refilled Hand, and waits for the others', async () => {
    const table = await buildTable();

    await table.rounds.playCards(ROOM_CODE, 'player-a', ['card-player-a']);

    expect(table.publisher.published).toEqual([
      { channel: ROOM_CODE, event: { event: 'room.player-update', payload: makeRoomPlayer('player-a', { isReady: true }) } },
      { channel: 'player-a', event: { event: 'player.cards-drawn', payload: [makeWhiteCard('pool-1')] } }
    ]);
    expect(await phaseOf(table)).toBe('PLAYING');
  });

  it('prompts the Judge exactly once when everyone has played, even if the deadline fires late', async () => {
    const table = await buildTable();

    await playAll(table);
    await table.rounds.onExpired(playKey(ROUND_ID));

    const prompts = eventsNamed(table, 'room.time-to-judge');
    expect(prompts).toHaveLength(1);
    expect(await phaseOf(table)).toBe('JUDGING');
    expect(table.timers.armed.get(judgeKey(ROUND_ID))).toBe(90);
  });

  it('does not wait for an Inactive Player', async () => {
    const seed = tableSeed();
    seed.players?.push(makePlayer({ id: 'player-gone', isActive: false }));
    const table = await buildTable(seed);

    await playAll(table);

    expect(eventsNamed(table, 'room.time-to-judge')).toHaveLength(1);
  });

  it('starts judging when the last Player who has not played drops', async () => {
    const table = await buildTable();
    await playAll(table, ['player-a']);

    await table.service.setPlayerActive(ROOM_CODE, 'player-b', false);
    await table.rounds.onPlayerDropped(ROOM_CODE, 'player-b');

    expect(eventsNamed(table, 'room.time-to-judge')).toEqual([
      { event: 'room.time-to-judge', payload: { roundNumber: 1, roundPlayedCards: [expect.objectContaining({ player: expect.objectContaining({ id: 'player-a' }) })] } }
    ]);
  });

  it('starts judging when the last Player who has not played leaves', async () => {
    const table = await buildTable();
    await playAll(table, ['player-a']);

    await table.service.leaveRoom({ roomCode: ROOM_CODE, playerId: 'player-b' });
    await table.rounds.onPlayerLeft(ROOM_CODE, 'player-b');

    expect(eventsNamed(table, 'room.time-to-judge')).toHaveLength(1);
    expect(await phaseOf(table)).toBe('JUDGING');
  });

  it('leaves a Round nobody played to its deadline when everyone else drops', async () => {
    const table = await buildTable();

    for (const id of ['player-a', 'player-b']) {
      await table.service.setPlayerActive(ROOM_CODE, id, false);
      await table.rounds.onPlayerDropped(ROOM_CODE, id);
    }

    expect(await phaseOf(table)).toBe('PLAYING');
    expect(eventsNamed(table, 'room.time-to-judge')).toEqual([]);
  });

  it('rejects a play from the Judge and broadcasts nothing', async () => {
    const table = await buildTable();

    await expect(table.rounds.playCards(ROOM_CODE, JUDGE_ID, [`card-${JUDGE_ID}`])).rejects.toThrow(ForbiddenError);
    expect(table.publisher.published).toEqual([]);
  });
});

describe('the play deadline', () => {
  it('moves to judging with what was played, skipping the rest', async () => {
    const table = await buildTable();
    await playAll(table, ['player-a']);

    await table.rounds.onExpired(playKey(ROUND_ID));

    expect(await phaseOf(table)).toBe('JUDGING');
    expect(eventsNamed(table, 'room.round-start')).toEqual([]);
  });

  it('aborts a Round nobody played, rotates the Judge and announces the next Round', async () => {
    const table = await buildTable();

    await table.rounds.onExpired(playKey(ROUND_ID));

    const next = await table.store.rounds.find(ROOM_CODE, 2);
    expect(await phaseOf(table)).toBe('ABORTED');
    expect(next?.judgeId).not.toBe(JUDGE_ID);
    expect(table.timers.armed.get(playKey(next?.id ?? ''))).toBe(60);
    expect(table.publisher.published.map(({ event }) => event)).toEqual([
      { event: 'room.round-end', payload: { roundNumber: 1, winner: null, winnerId: null, newScore: null, reason: 'aborted' } },
      { event: 'room.round-start', payload: { roundNumber: 2, judgeId: next?.judgeId, blackCard: makeBlackCard({ id: 'black-2' }) } }
    ]);
  });

  it('is a no-op when replayed', async () => {
    const table = await buildTable();

    await table.rounds.onExpired(playKey(ROUND_ID));
    await table.rounds.onExpired(playKey(ROUND_ID));

    expect(eventsNamed(table, 'room.round-end')).toHaveLength(1);
    expect(eventsNamed(table, 'room.round-start')).toHaveLength(1);
  });

  it('ignores an expired key that is not a Round deadline', async () => {
    const table = await buildTable();

    await table.rounds.onExpired('session:xyz');

    expect(await phaseOf(table)).toBe('PLAYING');
    expect(table.publisher.published).toEqual([]);
  });
});

describe('the Judge', () => {
  it('keeps a dropped Judge on the 30s grace when everyone then plays, not the 90s window', async () => {
    const table = await buildTable();
    await table.service.setPlayerActive(ROOM_CODE, JUDGE_ID, false);
    await table.rounds.onPlayerDropped(ROOM_CODE, JUDGE_ID);

    await playAll(table);

    expect(await phaseOf(table)).toBe('JUDGING');
    expect(table.timers.armed.get(graceKey(ROUND_ID))).toBe(30);
    expect(table.timers.armed.has(judgeKey(ROUND_ID))).toBe(false);
    await expire(table, graceKey(ROUND_ID));
    expect(await phaseOf(table)).toBe('ABORTED');
  });

  it('cancels the grace when the Judge reconnects during play', async () => {
    const table = await buildTable();
    await table.rounds.onPlayerDropped(ROOM_CODE, JUDGE_ID);

    await table.rounds.onPlayerReturned(ROOM_CODE, JUDGE_ID);

    expect(table.timers.cleared).toEqual([graceKey(ROUND_ID)]);
    expect((await table.store.rounds.findById(ROUND_ID))?.judgeDeadline).toBeNull();
    await playAll(table);
    expect(table.timers.armed.get(judgeKey(ROUND_ID))).toBe(90);
  });

  it('gets a full judging window back when reconnecting during judging', async () => {
    const table = await buildTable();
    await playAll(table);
    await table.rounds.onPlayerDropped(ROOM_CODE, JUDGE_ID);
    table.timers.armed.delete(judgeKey(ROUND_ID));

    await table.rounds.onPlayerReturned(ROOM_CODE, JUDGE_ID);

    expect(table.timers.armed.has(graceKey(ROUND_ID))).toBe(false);
    expect(table.timers.armed.get(judgeKey(ROUND_ID))).toBe(90);
  });

  it('arms the judging window when judging opens while the Judge is reconnecting', async () => {
    const table = await buildTable();
    await table.rounds.onPlayerDropped(ROOM_CODE, JUDGE_ID);
    await playAll(table, ['player-a']);
    table.timers.beforeClear = () => playAll(table, ['player-b']);

    await table.rounds.onPlayerReturned(ROOM_CODE, JUDGE_ID);

    expect(await phaseOf(table)).toBe('JUDGING');
    expect(table.timers.armed.get(judgeKey(ROUND_ID))).toBe(90);
    expect((await table.store.rounds.findById(ROUND_ID))?.judgeDeadline).not.toBeNull();
  });

  it('ignores a grace expiry that arrives after the Judge reconnected', async () => {
    const table = await buildTable();
    await table.service.setPlayerActive(ROOM_CODE, JUDGE_ID, false);
    await table.rounds.onPlayerDropped(ROOM_CODE, JUDGE_ID);

    await table.service.setPlayerActive(ROOM_CODE, JUDGE_ID, true);
    await table.rounds.onPlayerReturned(ROOM_CODE, JUDGE_ID);
    await table.rounds.onExpired(graceKey(ROUND_ID));

    expect(await phaseOf(table)).toBe('PLAYING');
  });

  it('aborts and rotates at once when the Judge leaves', async () => {
    const table = await buildTable();

    await table.service.leaveRoom({ roomCode: ROOM_CODE, playerId: JUDGE_ID });
    await table.rounds.onPlayerLeft(ROOM_CODE, JUDGE_ID);

    expect(await phaseOf(table)).toBe('ABORTED');
    expect((await table.store.rounds.find(ROOM_CODE, 2))?.judgeId).not.toBe(JUDGE_ID);
    expect(table.timers.armed.has(graceKey(ROUND_ID))).toBe(false);
  });

  it('aborts the Round when the judging deadline lapses, once even if replayed', async () => {
    const table = await buildTable();
    await playAll(table);

    await expire(table, judgeKey(ROUND_ID));
    await table.rounds.onExpired(judgeKey(ROUND_ID));

    expect(await phaseOf(table)).toBe('ABORTED');
    expect(eventsNamed(table, 'room.round-start')).toHaveLength(1);
  });

  it('ignores presence changes of anyone but the Judge for the clocks', async () => {
    const table = await buildTable();

    await table.rounds.onPlayerReturned(ROOM_CODE, 'player-a');
    await table.rounds.onPlayerDropped(ROOM_CODE, 'player-a');

    expect(table.timers.armed.size).toBe(0);
    expect(table.timers.cleared).toEqual([]);
  });
});

describe('the Judge pick', () => {
  it('broadcasts one self-contained round end, then opens and arms the next Round', async () => {
    const table = await buildTable(judgingSeed());
    const answers = await table.store.playedCards.findByRoomCodeAndRoundNumber(ROOM_CODE, 1);

    await table.rounds.judgePick(ROOM_CODE, JUDGE_ID, 'player-b');

    const next = await table.store.rounds.find(ROOM_CODE, 2);
    expect(table.publisher.published.map(({ event }) => event)).toEqual([
      {
        event: 'room.round-end',
        payload: { roundNumber: 1, winner: answers.find(answer => answer.player.id === 'player-b'), winnerId: 'player-b', newScore: 1, reason: 'picked' }
      },
      { event: 'room.round-start', payload: { roundNumber: 2, judgeId: next?.judgeId, blackCard: makeBlackCard({ id: 'black-2' }) } }
    ]);
    expect(await phaseOf(table)).toBe('COMPLETE');
    expect(table.timers.armed.get(playKey(next?.id ?? ''))).toBe(60);
  });

  it('rotates to a new Judge, records the outgoing one and resets everyone to unready', async () => {
    const table = await buildTable(judgingSeed());

    await table.rounds.judgePick(ROOM_CODE, JUDGE_ID, 'player-b');

    const room = await table.service.getRoom(ROOM_CODE);
    const players = await table.store.players.getRoomPlayersByCode(ROOM_CODE);
    expect(room).toEqual(expect.objectContaining({ round: 2, prevJudgeId: JUDGE_ID }));
    expect(players.filter(player => player.isJudge).map(player => player.id)).toEqual([room.judgeId]);
    expect(players.every(player => !player.isReady)).toBe(true);
  });

  it('never hands the Judge role straight back to the outgoing Judge', async () => {
    for (let i = 0; i < 10; i++) {
      const table = await buildTable(judgingSeed());
      await table.rounds.judgePick(ROOM_CODE, JUDGE_ID, 'player-b');
      expect((await table.store.rounds.find(ROOM_CODE, 2))?.judgeId).not.toBe(JUDGE_ID);
    }
  });

  it('awaits the outgoing Judge in the next Round and skips the new one', async () => {
    const table = await buildTable(judgingSeed());
    await table.rounds.judgePick(ROOM_CODE, JUDGE_ID, 'player-b');
    const next = await table.store.rounds.find(ROOM_CODE, 2);
    const contenders = [JUDGE_ID, 'player-a', 'player-b'].filter(id => id !== next?.judgeId);

    await table.rounds.playCards(ROOM_CODE, contenders[0], [`card-${contenders[0]}`]);
    expect(await phaseOf(table, 2)).toBe('PLAYING');
    const hand = (await findPlayer(table.store, contenders[1]))?.cardIds ?? [];
    await table.rounds.playCards(ROOM_CODE, contenders[1], [hand[0]]);

    expect(contenders).toContain(JUDGE_ID);
    expect(await phaseOf(table, 2)).toBe('JUDGING');
  });

  it('ends the game at maxPoints and starts no further Round', async () => {
    const table = await buildTable(judgingSeed(1));

    await table.rounds.judgePick(ROOM_CODE, JUDGE_ID, 'player-b');

    expect(table.publisher.published.at(-1)?.event).toEqual({
      event: 'room.game-end',
      payload: [
        { id: 'player-b', username: 'player-b', avatarUrl: null, score: 1 },
        { id: JUDGE_ID, username: JUDGE_ID, avatarUrl: null, score: 0 },
        { id: 'player-a', username: 'player-a', avatarUrl: null, score: 0 }
      ]
    });
    expect((await table.service.getRoom(ROOM_CODE)).status).toBe('FINISHED');
    expect(await table.store.rounds.find(ROOM_CODE, 2)).toBeNull();
    expect(table.timers.armed.size).toBe(0);
  });

  it('scores once when the Judge double-clicks: the second pick loses the claim', async () => {
    const table = await buildTable(judgingSeed());

    const picks = await Promise.allSettled([
      table.rounds.judgePick(ROOM_CODE, JUDGE_ID, 'player-b'),
      table.rounds.judgePick(ROOM_CODE, JUDGE_ID, 'player-b')
    ]);

    expect(picks.map(pick => pick.status).sort()).toEqual(['fulfilled', 'rejected']);
    const rejected = picks.find(pick => pick.status === 'rejected');
    expect(rejected?.status === 'rejected' && rejected.reason).toBeInstanceOf(BadRequestError);
    expect(eventsNamed(table, 'room.round-end')).toHaveLength(1);
    expect((await findPlayer(table.store, 'player-b'))?.score).toBe(1);
  });

  it('rejects a pick while playing, from a non-Judge, or of a Player who did not play', async () => {
    const playing = await buildTable(tableSeed({ playedCards: [makePlayedCards('player-a')] }));
    const judging = await buildTable(judgingSeed());

    await expect(playing.rounds.judgePick(ROOM_CODE, JUDGE_ID, 'player-a')).rejects.toThrow(BadRequestError);
    await expect(judging.rounds.judgePick(ROOM_CODE, 'player-a', 'player-b')).rejects.toThrow(ForbiddenError);
    await expect(judging.rounds.judgePick(ROOM_CODE, JUDGE_ID, JUDGE_ID)).rejects.toThrow(BadRequestError);
    expect(await phaseOf(judging)).toBe('JUDGING');
  });
});

describe('ending the game', () => {
  it('aborts the active Round once, announcing it, and leaves its deadlines no-ops', async () => {
    const table = await buildTable();

    await table.rounds.endActiveRound(ROOM_CODE);
    await table.service.endGame(ROOM_CODE);
    await table.rounds.endActiveRound(ROOM_CODE);
    await table.rounds.onExpired(playKey(ROUND_ID));

    expect(await phaseOf(table)).toBe('ABORTED');
    expect(table.publisher.published.map(({ event }) => event)).toEqual([
      { event: 'room.round-end', payload: { roundNumber: 1, winner: null, winnerId: null, newScore: null, reason: 'aborted' } }
    ]);
  });
});

describe('Round logging', () => {
  it('logs only the winning judging transition, without private cards', async () => {
    const table = await buildTable();
    await playAll(table);
    await table.rounds.onExpired(playKey(ROUND_ID));

    const judging = table.output.lines.map(line => JSON.parse(line)).filter(line => line.event === 'round.judging_started');
    expect(judging).toEqual([expect.objectContaining({ roomCode: ROOM_CODE, roundId: ROUND_ID, playedCount: 2 })]);
    expect(table.output.lines.join('')).not.toContain('whiteCards');
  });

  it('records reconciliation counts and the abort', async () => {
    const table = await buildTable(tableSeed({ rounds: [makeRound({ playDeadline: new Date(0) })] }));

    await table.rounds.reconcile();

    const events = table.output.lines.map(line => JSON.parse(line).event);
    expect(events).toEqual(['round.reconciliation_started', 'round.aborted', 'round.started', 'round.reconciliation_completed']);
    expect(JSON.parse(table.output.lines[1])).toMatchObject({ phase: 'PLAYING', roundNumber: 1, level: 40 });
  });
});
