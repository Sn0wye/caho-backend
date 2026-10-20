import type { IRoundRepository } from '@/repositories/round/IRoundRepository';
import type { Room, Round } from '@/schemas';
import type { Logger } from 'pino';

// How long an ended Round may sit without a successor before the sweep treats
// its rotation as dead. Long enough that a live rotation (claim -> openRound)
// is never raced; a Round's own rotation takes milliseconds.
export const STALLED_ROTATION_GRACE_MS = 15_000;

// What the sweep does with each Round it finds; RoundLifecycle owns both moves.
export type RoundRecovery = {
  advanceExpired(round: Round): Promise<void>;
  resumeRotation(round: Round): Promise<void>;
};

/**
 * The Round backstop sweep (ADR-0003): advance every active Round past a
 * deadline whose expiry event was missed, and resume every rotation that died
 * after its Round ended. Runs at startup, every 30s and on a Redis reconnect.
 *
 * @example
 * await reconcileRounds(store.rounds, recovery, logger);
 */
export async function reconcileRounds(
  rounds: Pick<IRoundRepository, 'findExpiredActive' | 'findStalledEnded'>,
  recovery: RoundRecovery,
  log?: Logger,
  now: number = Date.now()
): Promise<void> {
  const expired = await rounds.findExpiredActive(new Date(now));
  const stalled = await rounds.findStalledEnded(
    new Date(now - STALLED_ROTATION_GRACE_MS)
  );
  const counts = {
    expiredRoundCount: expired.length,
    stalledRoundCount: stalled.length
  };
  log?.info(
    { event: 'round.reconciliation_started', ...counts },
    'Round reconciliation started'
  );
  await eachIsolated(expired, round => recovery.advanceExpired(round), log);
  await eachIsolated(stalled, round => resumeLogged(round, recovery, log), log);
  log?.info(
    { event: 'round.reconciliation_completed', ...counts },
    'Round reconciliation completed'
  );
}

// One Round's failure (say, a Room left with no Judge to rotate to) is logged
// and must not stop the sweep: it repeats every 30s and would block forever.
async function eachIsolated(
  found: Round[],
  recover: (round: Round) => Promise<void>,
  log?: Logger
): Promise<void> {
  for (const round of found) {
    try {
      await recover(round);
    } catch (err) {
      log?.error(
        { event: 'round.reconciliation_failed', roundId: round.id, err },
        'Round reconciliation failed'
      );
    }
  }
}

function resumeLogged(
  ended: Round,
  recovery: RoundRecovery,
  log?: Logger
): Promise<void> {
  log?.warn(
    {
      event: 'round.rotation_resumed',
      roomCode: ended.roomCode,
      roundId: ended.id,
      roundNumber: ended.roundNumber
    },
    'Resuming a stalled Round rotation'
  );
  return recovery.resumeRotation(ended);
}

export type StalledRotationStep =
  | { kind: 'rotate' }
  | { kind: 'open'; judgeId: string };

/**
 * Where a dead rotation stopped. rotateJudge moves the Room to the next Round
 * number (and Judge) before openRound, so a Room still on `ended` needs the
 * whole rotation and a Room one ahead only needs its Round opened.
 *
 * @example
 * stalledRotationStep(room, ended); // { kind: 'open', judgeId: 'player-b' }
 */
export function stalledRotationStep(
  room: Room,
  ended: Round
): StalledRotationStep {
  if (room.round === ended.roundNumber) {
    return { kind: 'rotate' };
  }
  if (room.round === ended.roundNumber + 1 && room.judgeId) {
    return { kind: 'open', judgeId: room.judgeId };
  }
  throw new Error(
    `Cannot resume rotation of Round ${ended.roundNumber} in Room ${room.code}: Room is on Round ${room.round} with Judge ${room.judgeId} (expected Round ${ended.roundNumber}, or ${ended.roundNumber + 1} with a Judge)`
  );
}
