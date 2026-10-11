import type { RoomEvent } from '@/contracts';
import { BadRequestError } from '@/errors';
import type { BlackCard } from '@/repositories/cards';
import type { IGameStore } from '@/repositories/game-store/IGameStore';
import { toRoomPlayer } from '@/schemas';
import type { Round, RoundPlayedCard, RoundStatus } from '@/schemas';
import type { IGameEventPublisher } from '@/services/IGameEventPublisher';
import type { IBlackCardDeck } from '@/services/room/IBlackCardDeck';
import type { IRoomService, RoundScore } from '@/services/room/IRoomService';
import { assertCanRotate } from '@/services/room/gameRules';
import { getRandomJudge } from '@/utils/getRandomJudge';
import { createId } from '@paralleldrive/cuid2';
import type { Logger } from 'pino';
import type { IRoundTimerStore } from './IRoundTimerStore';
import {
  DEFAULT_ROUND_TIMER_CONFIG,
  RoundDeadlines,
  type RoundTimerConfig
} from './RoundDeadlines';
import { parseDeadlineKey } from './deadlineKeys';

// The RoomService domain rules a Round leans on (ADR-0004: they return outcome
// structs, the Round decides what follows): play validation and Hand refill,
// the Judge-pick check, scoring and the win condition.
export type RoundRules = Pick<
  IRoomService,
  'getRoom' | 'playCards' | 'checkJudgePick' | 'scoreRoundWinner'
>;

type RoundEndOutcome = Omit<
  Extract<RoomEvent, { event: 'room.round-end' }>['payload'],
  'roundNumber'
>;

const ABORTED: RoundEndOutcome = {
  winner: null,
  winnerId: null,
  newScore: null,
  reason: 'aborted'
};

const ACTIVE_PHASES: RoundStatus[] = ['PLAYING', 'JUDGING'];

/**
 * Everything about a Round once it exists: opening it, the PLAYING -> JUDGING ->
 * COMPLETE/ABORTED phases, Judge rotation, the play / judging / Judge-grace
 * deadlines (Redis keys mirrored to Postgres, ADR-0003) and the round-start,
 * time-to-judge and round-end broadcasts. Callers say what happened; this
 * decides the outcome. Every transition is an idempotent claim and only the
 * claim's winner broadcasts (ADR-0003/0004). Merged RoundFlow and
 * RoundTimekeeper, whose gaps hid two bugs (#25).
 *
 * @example
 * await rounds.startFirstRound(roomCode, start.judgeId, start.blackCard);
 * await rounds.playCards(roomCode, playerId, ['white-1']);
 * await rounds.onExpired('caho:round:abc:play');
 */
export class RoundLifecycle {
  private readonly clocks: RoundDeadlines;

  constructor(
    private readonly store: IGameStore,
    private readonly rules: RoundRules,
    private readonly deck: IBlackCardDeck,
    timerStore: IRoundTimerStore,
    private readonly publisher: IGameEventPublisher,
    config: RoundTimerConfig = DEFAULT_ROUND_TIMER_CONFIG,
    private readonly log?: Logger
  ) {
    this.clocks = new RoundDeadlines(timerStore, store.rounds, config, log);
  }

  // Open Round 1 after the Host started the Room (RoomService.startGame picked
  // its Judge and Black Card so room.started could carry them).
  public async startFirstRound(
    roomCode: string,
    judgeId: string,
    blackCard: BlackCard
  ): Promise<Round> {
    return await this.openRound(roomCode, 1, judgeId, blackCard);
  }

  // A Player submits their answer. Broadcasts the ready flag to the Room and the
  // refilled Hand back to that Player, then moves to judging once every active
  // Player has played. The play rules live in RoomService. issue #1.
  public async playCards(
    roomCode: string,
    playerId: string,
    playedCardIds: string[]
  ): Promise<void> {
    const { player, cardsDrawn } = await this.rules.playCards(
      roomCode,
      playerId,
      playedCardIds
    );
    this.log?.debug(
      {
        event: 'round.cards_played',
        roomCode,
        playerId,
        playedCount: playedCardIds.length
      },
      'Player played cards'
    );
    await this.publisher.publish(roomCode, {
      event: 'room.player-update',
      payload: toRoomPlayer(player)
    });
    await this.publisher.publish(player.id, {
      event: 'player.cards-drawn',
      payload: cardsDrawn
    });
    await this.advanceIfAllPlayed(await this.activeRound(roomCode));
  }

  // The Judge picks a winner: claim the Round, score the winner, announce the
  // Round end, then end the game (maxPoints) or rotate into the next Round.
  public async judgePick(
    roomCode: string,
    judgePlayerId: string,
    winnerPlayerId: string
  ): Promise<void> {
    const { room, round, winner } = await this.rules.checkJudgePick({
      roomCode,
      judgePlayerId,
      winnerPlayerId
    });
    await this.claimJudgedRound(round, winner);
    const score = await this.rules.scoreRoundWinner(room, winnerPlayerId);
    await this.publishRoundEnd(round, {
      winner,
      winnerId: score.winnerPlayer.id,
      newScore: score.winnerPlayer.score,
      reason: 'picked'
    });
    await this.continueAfterPick(round, score);
  }

  // A Player's connection dropped (ADR-0002). A dropped Judge holds the Round on
  // the grace deadline; anyone else stops being awaited, so the Round may now be
  // ready for judging instead of waiting out the play deadline.
  public async onPlayerDropped(
    roomCode: string,
    playerId: string
  ): Promise<void> {
    const round = await this.activeRound(roomCode);
    if (round?.judgeId === playerId) {
      await this.clocks.armGrace(round);
      return;
    }
    await this.advanceIfAllPlayed(round);
  }

  // An explicit Leave (ADR-0002). A leaving Judge aborts the Round and rotates
  // now; anyone else stops being awaited, like a drop.
  public async onPlayerLeft(roomCode: string, playerId: string): Promise<void> {
    const round = await this.activeRound(roomCode);
    if (round?.judgeId === playerId) {
      await this.abortAndRotate(round);
      return;
    }
    await this.advanceIfAllPlayed(round);
  }

  // A Player reconnected. Only a returning Judge changes the Round: their grace
  // is cancelled, and in judging they get a full judging window again.
  public async onPlayerReturned(
    roomCode: string,
    playerId: string
  ): Promise<void> {
    const round = await this.activeRound(roomCode);
    if (round?.judgeId === playerId) {
      await this.clocks.releaseGrace(round);
    }
  }

  // Entry point for a Redis expired-key event. Keys that aren't ours (the
  // keyspace is shared) are ignored. A lapsed judging window or Judge grace
  // aborts and rotates. See ADR-0003.
  public async onExpired(expiredKey: string): Promise<void> {
    const parsed = parseDeadlineKey(expiredKey);
    const round = parsed
      ? await this.store.rounds.findById(parsed.roundId)
      : null;
    if (!parsed || !round) {
      return;
    }
    if (parsed.kind === 'play') {
      await this.onPlayExpired(round);
      return;
    }
    await this.abortAndRotate(round);
  }

  // Startup backstop: advance every Round whose deadline passed while no
  // subscriber was listening. The idempotent claims make it safe to run
  // alongside a live subscriber.
  public async reconcile(): Promise<void> {
    const stale = await this.store.rounds.findExpiredActive(new Date());
    this.log?.info(
      {
        event: 'round.reconciliation_started',
        expiredRoundCount: stale.length
      },
      'Expired Round reconciliation started'
    );
    for (const round of stale) {
      await this.advanceExpired(round);
    }
    this.log?.info(
      {
        event: 'round.reconciliation_completed',
        expiredRoundCount: stale.length
      },
      'Expired Round reconciliation completed'
    );
  }

  // The game is ending (Host /end, or the Host left with no heir): abort the
  // Room's current Round so its pending deadlines become no-ops. Without this a
  // finished game kept rotating Rounds when the timers fired. ADR-0003.
  public async endActiveRound(roomCode: string): Promise<void> {
    const room = await this.store.rooms.getRoomByCode(roomCode);
    const round = room
      ? await this.store.rounds.find(roomCode, room.round)
      : null;
    if (round) {
      await this.abortRound(round);
    }
  }

  private async continueAfterPick(
    round: Round,
    score: RoundScore
  ): Promise<void> {
    if (!score.gameEnded) {
      await this.rotateJudge(round);
      return;
    }
    this.log?.info(
      { event: 'room.ended', roomCode: round.roomCode, reason: 'max_points' },
      'Room ended at maxPoints'
    );
    await this.publisher.publish(round.roomCode, {
      event: 'room.game-end',
      payload: score.ranking ?? []
    });
  }

  // JUDGING -> COMPLETE guards a double-click scoring twice or a pick racing the
  // judging deadline. roundWinnerId relates to round_played_cards.id.
  private async claimJudgedRound(
    round: Round,
    winner: RoundPlayedCard
  ): Promise<void> {
    const claimed = await this.store.rounds.claimAdvance(
      round.id,
      'JUDGING',
      'COMPLETE'
    );
    if (!claimed) {
      throw new BadRequestError(
        `A rodada ${round.roundNumber} já foi decidida.`
      );
    }
    await this.store.rounds.update(round.id, { roundWinnerId: winner.id });
    this.log?.info(
      {
        event: 'round.winner_picked',
        roomCode: round.roomCode,
        roundNumber: round.roundNumber,
        winnerId: winner.player.id
      },
      'Judge picked Round winner'
    );
  }

  // The current Round of an in-progress Room while it is still PLAYING/JUDGING.
  private async activeRound(roomCode: string): Promise<Round | null> {
    const room = await this.store.rooms.getRoomByCode(roomCode);
    if (room?.status !== 'IN_PROGRESS') {
      return null;
    }
    const round = await this.store.rounds.find(roomCode, room.round);
    return round && ACTIVE_PHASES.includes(round.status) ? round : null;
  }

  // Checked after every play and after every non-Judge drop or leave: before
  // #25 it ran only on a play, so losing the last Player owed a play stalled
  // the Round until the deadline. With no plays at all (everyone else gone) the
  // play deadline aborts it instead.
  private async advanceIfAllPlayed(round: Round | null): Promise<void> {
    if (
      round?.status !== 'PLAYING' ||
      !(await this.allActivePlayersPlayed(round))
    ) {
      return;
    }
    const plays = await this.playsOf(round);
    if (plays.length > 0) {
      await this.advanceToJudging(round, plays);
    }
  }

  // Only active non-Judge Players are awaited; an Inactive Player never blocks
  // the Round (ADR-0002). `isJudge` is derived from the Room on read.
  private async allActivePlayersPlayed(round: Round): Promise<boolean> {
    const players = await this.store.players.getRoomPlayersByCode(
      round.roomCode
    );
    return players
      .filter(player => player.isActive && !player.isJudge)
      .every(player => player.isReady);
  }

  private async playsOf(round: Round): Promise<RoundPlayedCard[]> {
    return await this.store.playedCards.findByRoomCodeAndRoundNumber(
      round.roomCode,
      round.roundNumber
    );
  }

  // Play window elapsed: Players who didn't submit are skipped. With plays,
  // judge them; with none, abort and rotate.
  private async onPlayExpired(round: Round): Promise<void> {
    if (round.status !== 'PLAYING') {
      return;
    }
    const plays = await this.playsOf(round);
    if (plays.length === 0) {
      await this.abortAndRotate(round);
      return;
    }
    await this.advanceToJudging(round, plays);
  }

  // The single guarded PLAYING -> JUDGING transition shared by "everyone played"
  // and the play deadline, so the Judge is prompted exactly once. A Round held
  // for a dropped Judge (judgeDeadline set while playing = the grace) stays on
  // that grace; arming the 90s window there stalled the Room 3x longer (#25).
  private async advanceToJudging(
    round: Round,
    plays: RoundPlayedCard[]
  ): Promise<void> {
    const claimed = await this.store.rounds.claimAdvance(
      round.id,
      'PLAYING',
      'JUDGING'
    );
    if (!claimed) {
      this.log?.debug(
        {
          event: 'round.transition_skipped',
          roundId: round.id,
          expectedPhase: 'PLAYING'
        },
        'Round transition already claimed'
      );
      return;
    }
    if (claimed.judgeDeadline == null) {
      await this.clocks.armJudgingWindow(round.id);
    }
    await this.publisher.publish(round.roomCode, {
      event: 'room.time-to-judge',
      payload: { roundNumber: round.roundNumber, roundPlayedCards: plays }
    });
    this.log?.info(
      {
        event: 'round.judging_started',
        roomCode: round.roomCode,
        roundId: round.id,
        roundNumber: round.roundNumber,
        playedCount: plays.length
      },
      'Round advanced to judging'
    );
  }

  // Route a Round known to be past a deadline. A lapsed Judge deadline takes
  // precedence over the play deadline: the Round was held for the Judge.
  private async advanceExpired(round: Round): Promise<void> {
    if (
      round.judgeDeadline != null &&
      round.judgeDeadline.getTime() <= Date.now()
    ) {
      await this.abortAndRotate(round);
      return;
    }
    await this.onPlayExpired(round);
  }

  private async abortAndRotate(round: Round): Promise<void> {
    if (!(await this.abortRound(round))) {
      return;
    }
    // Tell the Room the Round died with no winner before announcing the next,
    // so the frontend can render "nobody scored". ADR-0005.
    await this.publishRoundEnd(round, ABORTED);
    await this.rotateJudge(round);
  }

  // The one definition of an abort: the claim is the idempotency guard, so a
  // replayed event or a second instance can't abort (and rotate) twice.
  private async abortRound(round: Round): Promise<boolean> {
    const claimed = await this.store.rounds.claimAdvance(
      round.id,
      ACTIVE_PHASES,
      'ABORTED'
    );
    if (claimed) {
      this.log?.warn(
        {
          event: 'round.aborted',
          roomCode: round.roomCode,
          roundId: round.id,
          roundNumber: round.roundNumber,
          phase: round.status
        },
        'Round aborted without a winner'
      );
    }
    return claimed != null;
  }

  private async publishRoundEnd(
    round: Round,
    outcome: RoundEndOutcome
  ): Promise<void> {
    await this.publisher.publish(round.roomCode, {
      event: 'room.round-end',
      payload: { roundNumber: round.roundNumber, ...outcome }
    });
  }

  // Open the Round after `outgoing` with the next Judge and a fresh Black Card.
  private async rotateJudge(outgoing: Round): Promise<void> {
    const room = await this.rules.getRoom(outgoing.roomCode);
    assertCanRotate(room, outgoing.roundNumber);
    const players = await this.store.players.getRoomPlayersByCode(room.code);
    // Exclude the Judge who just judged (room.judgeId). Excluding prevJudgeId
    // let the same Player judge twice in a row.
    const judgeId = getRandomJudge(room.judgeId, players);
    const blackCard = await this.deck.drawBlackCard(room.code);
    // `isReady` doubles as "played this Round"; never resetting it locked every
    // Player out of Round 2 with "already played".
    await this.store.players.setPlayersAsUnready(room.code);
    const roundNumber = outgoing.roundNumber + 1;
    await this.store.rooms.update(room.code, {
      round: roundNumber,
      judgeId,
      prevJudgeId: room.judgeId
    });
    await this.openRound(room.code, roundNumber, judgeId, blackCard);
  }

  // Open a Round, arm its play deadline, announce it: the one sequence behind
  // starting a Room, a Judge pick and an abort. Hands persist and refill on
  // play, so there is no per-Round redeal. issue #1 / #4.
  private async openRound(
    roomCode: string,
    roundNumber: number,
    judgeId: string,
    blackCard: BlackCard
  ): Promise<Round> {
    const round = await this.store.rounds.create({
      id: createId(),
      roomCode,
      roundNumber,
      judgeId,
      blackCardId: blackCard.id,
      roundWinnerId: null,
      status: 'PLAYING',
      playDeadline: this.clocks.playDeadline(),
      judgeDeadline: null,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    await this.clocks.armPlay(round.id);
    this.log?.info(
      { event: 'round.started', roomCode, roundId: round.id, roundNumber },
      'Round started'
    );
    await this.publisher.publish(roomCode, {
      event: 'room.round-start',
      payload: { roundNumber, judgeId, blackCard }
    });
    return round;
  }
}
