import {
  ApplicationError,
  BadRequestError,
  ForbiddenError,
  InternalServerError,
  NotFoundError
} from '@/errors';
import { ROOM_ERRORS } from '@/errors/room';
import type { IRankingRepository } from '@/repositories/ranking';
import type { IRoomRepository } from '@/repositories/room';
import type { IRoomPlayersRepository } from '@/repositories/room-players';
import { generateCode } from '@/utils/generateCode';
import type {
  Player,
  PublicRoomWithPlayerCountAndHost,
  Ranking,
  Room,
  Round,
  RoundPlayedCard,
  WhiteCard
} from '@/schemas';
import { createId } from '@paralleldrive/cuid2';
import type {
  DealtHand,
  GameStart,
  HostLossOutcome,
  IRoomService,
  JudgeChooseWinnerDTO,
  JudgePickResult,
  NextRound,
  PlayResult,
  RoundSnapshot
} from './IRoomService';
import type { CreateRoomDTO } from '@/dto/CreateRoom';
import type { JoinRoomDTO } from '@/dto/JoinRoom';
import type { LeaveRoomDTO } from '@/dto/LeaveRoom';
import { CardServiceFactory } from '../CardServiceFactory';
import type { IRoundRepository } from '@/repositories/round';
import type { IRoundPlayedCardsRepository } from '@/repositories/round-played-cards';
import { getRandomJudge } from '@/utils/getRandomJudge';
import { assertPlayableCards } from '@/services/round/assertPlayableCards';
import type { IWhiteCardDealer } from './IWhiteCardDealer';
import type { IBlackCardDeck } from './IBlackCardDeck';
import { HAND_SIZE, assertRoomCanStart } from './gameRules';

export class RoomService implements IRoomService {
  constructor(
    private readonly roomRepository: IRoomRepository,
    private readonly rankingRepository: IRankingRepository,
    private readonly roomPlayersRepository: IRoomPlayersRepository,
    private readonly roundsRepository: IRoundRepository,
    private readonly roundPlayedCardsRepository: IRoundPlayedCardsRepository,
    private readonly whiteCardDealer: IWhiteCardDealer,
    private readonly blackCardDeck: IBlackCardDeck
  ) {}

  public async getRoom(roomCode: string): Promise<Room> {
    const room = await this.roomRepository.getRoomByCode(roomCode);

    if (!room) {
      throw new NotFoundError(ROOM_ERRORS.ROOM_NOT_FOUND);
    }

    return room;
  }

  public async createRoom(data: CreateRoomDTO): Promise<Room> {
    try {
      const room = await this.roomRepository.create({
        id: createId(),
        status: 'LOBBY',
        code: generateCode(),
        hostId: data.hostId,
        isPublic: data.isPublic,
        maxPlayers: data.maxPlayers,
        maxPoints: data.maxPoints,
        password: data.password,
        round: 0,
        judgeId: null,
        prevJudgeId: null,
        currentBlackCardId: null,
        pickedBlackCards: [],
        pickedWhiteCards: [],
        createdAt: new Date(),
        updatedAt: new Date()
      });

      return room;
    } catch (error) {
      throw new InternalServerError('Erro ao criar sala.', { cause: error });
    }
  }

  public async listPublicRooms(): Promise<PublicRoomWithPlayerCountAndHost[]> {
    return await this.roomRepository.listPublicRooms();
  }

  public async addPlayerToRoom({
    roomCode,
    player
  }: {
    roomCode: string;
    player: Player;
  }): Promise<void> {
    await this.getRoom(roomCode);

    try {
      return await this.roomPlayersRepository.addPlayerToRoom({
        roomCode,
        player
      });
    } catch (error) {
      throw new InternalServerError('Erro ao adicionar jogador na sala.', {
        cause: error
      });
    }
  }

  // The Host starts the game: pick the first Judge, draw the first Black Card,
  // deal every Player a Hand and open Round 1. Moved out of the start-room
  // controller so the rules are testable and broadcasts live in the
  // orchestrator (ADR-0004). Hands persist across Rounds. issue #1, slice 3.
  public async startGame(
    roomCode: string,
    requesterId: string
  ): Promise<GameStart> {
    const room = await this.getRoom(roomCode);
    const players =
      await this.roomPlayersRepository.getRoomPlayersByCode(roomCode);
    assertRoomCanStart(room, players, requesterId);

    const judgeId = getRandomJudge(null, players);
    const blackCard = await this.blackCardDeck.drawBlackCard(roomCode);
    await this.roomPlayersRepository.setPlayersAsUnready(roomCode);
    const startedRoom = await this.roomRepository.update(roomCode, {
      status: 'IN_PROGRESS',
      round: 1,
      judgeId,
      prevJudgeId: null,
      currentBlackCardId: blackCard.id
    });

    const hands = await this.dealInitialHands({
      roomCode,
      cardsPerPlayer: HAND_SIZE
    });
    const round = await this.createRound({
      roomCode,
      judgeId,
      blackCardId: blackCard.id,
      roundNumber: 1,
      roundWinnerId: null
    });
    const startedPlayers =
      await this.roomPlayersRepository.getRoomPlayersByCode(roomCode);

    return {
      room: startedRoom,
      players: startedPlayers,
      round,
      blackCard,
      hands
    };
  }

  // Single end-of-game path: both the host's manual /end and the maxPoints
  // win-condition route through here so the Room reaches FINISHED and the
  // Ranking is built exactly one way. See issue #1, slice 2.
  public async endGame(roomCode: string): Promise<Ranking> {
    try {
      await this.abortActiveRound(roomCode);
      await this.roomRepository.update(roomCode, {
        status: 'FINISHED'
      });

      const ranking =
        await this.rankingRepository.getRankingByRoomCode(roomCode);

      return ranking;
    } catch (error) {
      throw new InternalServerError('Erro ao finalizar sala.', {
        cause: error
      });
    }
  }

  // Close the in-flight Round so its pending play/judge timers become no-ops
  // (their claims need PLAYING/JUDGING). Without this a finished game kept
  // rotating Rounds when the timers fired. ADR-0003.
  private async abortActiveRound(roomCode: string): Promise<void> {
    const room = await this.roomRepository.getRoomByCode(roomCode);
    const round = room
      ? await this.roundsRepository.find(roomCode, room.round)
      : null;
    if (!round) {
      return;
    }
    await this.roundsRepository.claimAdvance(
      round.id,
      ['PLAYING', 'JUDGING'],
      'ABORTED'
    );
  }

  public async joinRoom(input: JoinRoomDTO): Promise<Room> {
    const { roomCode, player, password } = input;

    try {
      const room = await this.getRoom(roomCode);

      player.isHost = room.hostId === player.id;
      const players =
        await this.roomPlayersRepository.getRoomPlayersByCode(roomCode);

      this.assertCanJoin(room, players, player.id, password);
      await this.addPlayerToRoom({ player, roomCode });

      return room;
    } catch (error) {
      if (error instanceof ApplicationError) {
        throw error;
      }

      throw new InternalServerError('Erro ao entrar na sala.', {
        cause: error
      });
    }
  }

  // Joining an IN_PROGRESS Room is allowed (the orchestrator deals the newcomer
  // a Hand); a FINISHED Room is over and cannot be joined.
  private assertCanJoin(
    room: Room,
    players: Player[],
    playerId: string,
    password: string | null
  ): void {
    if (room.status === 'FINISHED') {
      throw new BadRequestError(ROOM_ERRORS.ROOM_FINISHED);
    }
    if (players.some(p => p.id === playerId)) {
      throw new BadRequestError(ROOM_ERRORS.PLAYER_ALREADY_IN_ROOM);
    }
    if (players.length >= room.maxPlayers) {
      throw new BadRequestError(ROOM_ERRORS.ROOM_IS_FULL);
    }
    if (!room.isPublic && room.password !== password) {
      throw new BadRequestError(ROOM_ERRORS.WRONG_PASSWORD);
    }
  }

  public async leaveRoom(input: LeaveRoomDTO): Promise<void> {
    const { roomCode, playerId } = input;

    try {
      // An explicit Leave removes the Player entirely. A connection drop is the
      // separate path that keeps them as an Inactive Player. See ADR-0002.
      await this.roomPlayersRepository.deletePlayerFromRoom(roomCode, playerId);
    } catch (error) {
      throw new InternalServerError('Erro ao sair da sala.', { cause: error });
    }
  }

  // Rooms the Player currently belongs to. The per-user WebSocket only knows a
  // userId, so presence updates use this to find which Rooms to broadcast to.
  public async getPlayerRoomCodes(playerId: string): Promise<string[]> {
    return await this.roomPlayersRepository.getRoomCodesByPlayerId(playerId);
  }

  // A Host who Leaves or drops is handled by Room status, not one flat rule
  // (ADR-0002). In LOBBY the unstarted Room ends. In IN_PROGRESS the Host role
  // moves to an active Player so the game continues; if none remain the Room ends.
  // Both Leave (row already deleted) and drop (row marked inactive) route here.
  // See issue #3.
  public async handleHostLoss(
    roomCode: string,
    departingPlayerId: string
  ): Promise<HostLossOutcome> {
    const room = await this.getRoom(roomCode);

    if (room.hostId !== departingPlayerId || room.status === 'FINISHED') {
      return { kind: 'not-host' };
    }

    if (room.status === 'LOBBY') {
      const ranking = await this.endGame(roomCode);
      return { kind: 'room-ended', ranking };
    }

    return await this.reassignHostInProgress(room, departingPlayerId);
  }

  // IN_PROGRESS half of host-loss: move the Host to an active Player so the game
  // survives, or end the Room if none remain. See handleHostLoss / issue #3.
  private async reassignHostInProgress(
    room: Room,
    departingPlayerId: string
  ): Promise<HostLossOutcome> {
    const players = await this.roomPlayersRepository.getRoomPlayersByCode(
      room.code
    );
    const heir = players.find(
      player => player.isActive && player.id !== departingPlayerId
    );

    if (!heir) {
      const ranking = await this.endGame(room.code);
      return { kind: 'room-ended', ranking };
    }

    // The repository keys Rooms by Code; passing room.id here silently updated
    // nothing, so the Host was never actually reassigned.
    await this.roomRepository.update(room.code, { hostId: heir.id });
    await this.clearDepartedHostFlag(room.code, departingPlayerId);

    const newHost = await this.updatePlayerInRoom(room.code, heir.id, {
      isHost: true
    });
    return { kind: 'host-reassigned', newHost };
  }

  // A dropped ex-Host still has its row (marked inactive); clear its Host flag so a
  // reconnect returns as an ordinary active Player, not Host. On explicit Leave the
  // row is already gone, so there is nothing to clear. See ADR-0002, issue #3.
  private async clearDepartedHostFlag(
    roomCode: string,
    playerId: string
  ): Promise<void> {
    const departing = await this.roomPlayersRepository.getPlayerFromRoom(
      roomCode,
      playerId
    );
    if (departing) {
      await this.roomPlayersRepository.updatePlayerInRoom(roomCode, playerId, {
        isHost: false
      });
    }
  }

  // Flips a Player's presence. A dropped connection sets `isActive` false (an
  // Inactive Player, kept in the Room and Ranking); reconnecting sets it true.
  // See ADR-0002.
  public async setPlayerActive(
    roomCode: string,
    playerId: string,
    isActive: boolean
  ): Promise<Player> {
    return await this.updatePlayerInRoom(roomCode, playerId, { isActive });
  }

  // Lobby ready toggle. Mid-game, `isReady` means "has played this Round", so
  // toggling it there let a Player skip a Round or play twice.
  public async togglePlayerReady(
    roomCode: string,
    playerId: string
  ): Promise<Player> {
    const room = await this.getRoom(roomCode);
    if (room.status !== 'LOBBY') {
      throw new BadRequestError(
        `Só é possível ficar pronto no lobby (status da sala ${roomCode}: ${room.status}).`
      );
    }

    const player = await this.getPlayerFromRoom(roomCode, playerId);
    return await this.updatePlayerInRoom(roomCode, playerId, {
      isReady: !player.isReady
    });
  }

  // True once every active non-Judge Player has played this Round. Inactive
  // Players are never awaited, so they are excluded from the count. See ADR-0002.
  public async allActivePlayersPlayed(roomCode: string): Promise<boolean> {
    const players =
      await this.roomPlayersRepository.getRoomPlayersByCode(roomCode);
    const contenders = players.filter(
      player => player.isActive && !player.isJudge
    );

    return contenders.every(player => player.isReady);
  }

  public async getRoomPlayers(roomCode: string): Promise<Player[]> {
    await this.getRoom(roomCode);

    try {
      const players =
        await this.roomPlayersRepository.getRoomPlayersByCode(roomCode);
      return players;
    } catch (error) {
      throw new InternalServerError('Erro ao buscar jogadores da sala.', {
        cause: error
      });
    }
  }

  public async getRoomBlackCardId(roomCode: string): Promise<string | null> {
    const room = await this.getRoom(roomCode);
    return room.currentBlackCardId;
  }

  public async updatePlayerInRoom(
    roomCode: string,
    playerId: string,
    payload: Partial<Player>
  ): Promise<Player> {
    try {
      // TODO: improve this to return the updated player
      await this.roomPlayersRepository.updatePlayerInRoom(
        roomCode,
        playerId,
        payload
      );
    } catch (error) {
      throw new InternalServerError('Erro ao atualizar jogador na sala.', {
        cause: error
      });
    }

    return await this.getPlayerFromRoom(roomCode, playerId);
  }

  public async getPlayerFromRoom(
    roomCode: string,
    playerId: string
  ): Promise<Player> {
    const player = await this.roomPlayersRepository.getPlayerFromRoom(
      roomCode,
      playerId
    );

    if (!player) {
      throw new NotFoundError(ROOM_ERRORS.PLAYER_NOT_FOUND);
    }

    return player;
  }

  // TODO: must return player
  public async incrementPlayerScore(input: {
    roomCode: string;
    playerId: string;
    by: number;
  }): Promise<void> {
    try {
      return await this.roomPlayersRepository.incrementPlayerScore(input);
    } catch (error) {
      throw new InternalServerError(
        'Erro ao incrementar pontuação do jogador.',
        { cause: error }
      );
    }
  }

  public async updateRoom(
    roomCode: string,
    data: Partial<Room>
  ): Promise<Room> {
    try {
      return await this.roomRepository.update(roomCode, data);
    } catch (error) {
      throw new InternalServerError('Erro ao atualizar sala.', {
        cause: error
      });
    }
  }

  public async getCurrentWhiteCards(
    roomCode: string,
    playerId: string
  ): Promise<WhiteCard[]> {
    await this.getRoom(roomCode);
    const player = await this.getPlayerFromRoom(roomCode, playerId);

    // Resolve the player's Hand (stored as ids) against the DB card pool. See
    // issue #5 (cards moved to the database).
    const cardService = CardServiceFactory(roomCode);
    const hand = await Promise.all(
      player.cardIds.map(id => cardService.getWhiteCardById(id))
    );

    return hand.filter((card): card is WhiteCard => card !== undefined);
  }

  // A Player submits their answer. The rules (phase, not the Judge, one play per
  // Round, cards from their own Hand, count matches the Black Card's pick) live
  // in assertPlayableCards. Returns the Player as now stored plus the refill.
  public async playCards(
    roomCode: string,
    playerId: string,
    playedCardIds: string[]
  ): Promise<PlayResult> {
    const round = await this.requireActiveRound(roomCode);
    const player = await this.getPlayerFromRoom(roomCode, playerId);
    const blackCard = await this.blackCardDeck.findBlackCard(
      roomCode,
      round.blackCardId
    );
    assertPlayableCards({
      round,
      player,
      playedCardIds,
      pick: blackCard?.pick ?? 1
    });

    await this.roundPlayedCardsRepository.create({
      playerId: player.id,
      roundId: round.id,
      whiteCardIds: playedCardIds
    });

    const cardsDrawn = await this.refillHand(roomCode, player, playedCardIds);
    return {
      player: await this.getPlayerFromRoom(roomCode, playerId),
      cardsDrawn
    };
  }

  // Refill exactly the cards just played so the Hand tops back up to its
  // standing size (10) and persists into the next Round. issue #1, slice 3.
  private async refillHand(
    roomCode: string,
    player: Player,
    playedCardIds: string[]
  ): Promise<WhiteCard[]> {
    const newWhiteCards = await this.whiteCardDealer.dealWhiteCards(
      roomCode,
      playedCardIds.length
    );
    const cardIds = player.cardIds
      .filter(cardId => !playedCardIds.includes(cardId))
      .concat(newWhiteCards.map(card => card.id));

    await this.roomPlayersRepository.updatePlayerInRoom(roomCode, player.id, {
      cardIds,
      isReady: true
    });
    return newWhiteCards;
  }

  // The current Round of an in-progress Room, or a 4xx explaining why there is
  // none (Room not started / finished, or the Round row is missing).
  private async requireActiveRound(roomCode: string): Promise<Round> {
    const room = await this.getRoom(roomCode);
    if (room.status !== 'IN_PROGRESS') {
      throw new BadRequestError(
        `A sala ${roomCode} não está em jogo (status: ${room.status}, esperado: IN_PROGRESS).`
      );
    }

    const round = await this.roundsRepository.find(roomCode, room.round);
    if (!round) {
      throw new NotFoundError(ROOM_ERRORS.ROUND_NOT_FOUND);
    }
    return round;
  }

  public async setPlayersAsUnready(roomCode: string): Promise<void> {
    try {
      await this.roomPlayersRepository.setPlayersAsUnready(roomCode);
    } catch (error) {
      throw new InternalServerError(
        'Erro ao definir jogadores como não prontos.',
        { cause: error }
      );
    }
  }

  public async createRound(data: CreateRoundDTO): Promise<Round> {
    try {
      const round = await this.roundsRepository.create({
        id: createId(),
        roomCode: data.roomCode,
        judgeId: data.judgeId,
        blackCardId: data.blackCardId,
        roundNumber: data.roundNumber,
        roundWinnerId: data.roundWinnerId,
        status: 'PLAYING',
        playDeadline: null,
        judgeDeadline: null,
        createdAt: new Date(),
        updatedAt: new Date()
      });

      return round;
    } catch (error) {
      throw new InternalServerError('Erro ao criar rodada.', { cause: error });
    }
  }

  public async getRoundPlayedCards(
    roomCode: string,
    roundNumber: number
  ): Promise<RoundPlayedCard[]> {
    const roundPlayedCards =
      await this.roundPlayedCardsRepository.findByRoomCodeAndRoundNumber(
        roomCode,
        roundNumber
      );

    return roundPlayedCards;
  }

  // The Round currently in play for a Room (its round number lives on the Room).
  // Drives presence-driven Judge-loss: a drop arms the judge-grace timer on this
  // Round, an explicit Judge leave aborts it. See ADR-0002/0003, issue #4.
  public async getActiveRound(roomCode: string): Promise<Round | null> {
    const room = await this.getRoom(roomCode);
    return await this.roundsRepository.find(roomCode, room.round);
  }

  // Everything a (re)connecting client needs to render the current Round, since
  // WS events are only live deltas. Played Cards are hidden until judging, when
  // `room.time-to-judge` reveals them to the whole Room anyway.
  public async getRoundSnapshot(
    roomCode: string
  ): Promise<RoundSnapshot | null> {
    const round = await this.getActiveRound(roomCode);
    if (!round) {
      return null;
    }

    const blackCard = await this.blackCardDeck.findBlackCard(
      roomCode,
      round.blackCardId
    );
    const revealed = round.status === 'JUDGING' || round.status === 'COMPLETE';
    const roundPlayedCards = revealed
      ? await this.getRoundPlayedCards(roomCode, round.roundNumber)
      : [];

    return {
      roundNumber: round.roundNumber,
      status: round.status,
      judgeId: round.judgeId,
      playDeadline: round.playDeadline,
      judgeDeadline: round.judgeDeadline,
      blackCard: blackCard ?? null,
      roundPlayedCards
    };
  }

  public async getRoundNumber(roomCode: string): Promise<number> {
    const room = await this.getRoom(roomCode);
    return room.round;
  }

  // Open the Round after `currentRound`: rotate the Judge away from the one who
  // just judged, draw a Black Card and reset everyone's "played" flag. Callers
  // pass the Round they are leaving; a stale number (another path already
  // rotated) is rejected so two paths can't open two Rounds.
  public async startNextRound(
    roomCode: string,
    currentRound: number
  ): Promise<NextRound> {
    const room = await this.getRoom(roomCode);
    this.assertCanRotate(room, currentRound);

    const players =
      await this.roomPlayersRepository.getRoomPlayersByCode(roomCode);
    // Exclude the Judge who just judged (room.judgeId). Excluding prevJudgeId
    // let the same Player judge twice in a row.
    const nextJudgeId = getRandomJudge(room.judgeId, players);
    const blackCard = await this.blackCardDeck.drawBlackCard(roomCode);

    // `isReady` doubles as "played this Round"; never resetting it locked every
    // Player out of Round 2 with "already played".
    await this.roomPlayersRepository.setPlayersAsUnready(roomCode);
    const updatedRoom = await this.roomRepository.update(roomCode, {
      round: currentRound + 1,
      judgeId: nextJudgeId,
      prevJudgeId: room.judgeId
    });
    const nextRound = await this.createRound({
      roomCode,
      judgeId: nextJudgeId,
      blackCardId: blackCard.id,
      roundNumber: currentRound + 1,
      roundWinnerId: null
    });

    const judge = await this.getPlayerFromRoom(roomCode, nextJudgeId);
    return {
      ...nextRound,
      room: updatedRoom,
      judge,
      roundWinner: null,
      roundPlayedCards: [],
      blackCard
    };
  }

  private assertCanRotate(room: Room, currentRound: number): void {
    if (room.status !== 'IN_PROGRESS') {
      throw new BadRequestError(
        `Não há próxima rodada: a sala ${room.code} está ${room.status}, esperado IN_PROGRESS.`
      );
    }
    if (room.round !== currentRound) {
      throw new BadRequestError(
        `Rodada ${currentRound} já encerrada; a sala ${room.code} está na rodada ${room.round}.`
      );
    }
  }

  // The Judge picks the winning Played Card. Only the Room's Judge, only while
  // the Round is JUDGING, only a Player who played. The JUDGING -> COMPLETE claim
  // is the guard against a double-click scoring twice or a pick racing the
  // judging deadline. Scores the winner — issue #1, slice 1.
  public async processJudgeChooseWinner({
    roomCode,
    judgePlayerId,
    winnerPlayerId
  }: JudgeChooseWinnerDTO): Promise<JudgePickResult> {
    const room = await this.getRoom(roomCode);
    if (room.judgeId !== judgePlayerId) {
      throw new ForbiddenError(
        `Apenas o juiz da rodada pode escolher (juiz: ${room.judgeId}, você: ${judgePlayerId}).`
      );
    }

    const round = await this.requireActiveRound(roomCode);
    const winner = await this.findWinningPlay(round, winnerPlayerId);
    await this.claimJudgedRound(round, winner);

    await this.incrementPlayerScore({
      roomCode,
      playerId: winnerPlayerId,
      by: 1
    });
    const winnerPlayer = await this.getPlayerFromRoom(roomCode, winnerPlayerId);

    // Win-condition branch: reaching maxPoints ends the game instead of dealing
    // another Round. issue #1, slice 2.
    const gameEnded = winnerPlayer.score >= room.maxPoints;
    const ranking = gameEnded ? await this.endGame(roomCode) : null;

    return { room, winner, winnerPlayer, gameEnded, ranking };
  }

  private async findWinningPlay(
    round: Round,
    winnerPlayerId: string
  ): Promise<RoundPlayedCard> {
    if (round.status !== 'JUDGING') {
      throw new BadRequestError(
        `A rodada ${round.roundNumber} não está em julgamento (fase: ${round.status}).`
      );
    }

    const plays = await this.getRoundPlayedCards(
      round.roomCode,
      round.roundNumber
    );
    const winner = plays.find(play => play.player.id === winnerPlayerId);
    const stillInRoom = await this.roomPlayersRepository.getPlayerFromRoom(
      round.roomCode,
      winnerPlayerId
    );
    if (!winner || !stillInRoom) {
      throw new BadRequestError(
        `O jogador ${winnerPlayerId} não tem jogada válida na rodada ${round.roundNumber}.`
      );
    }
    return winner;
  }

  private async claimJudgedRound(
    round: Round,
    winner: RoundPlayedCard
  ): Promise<void> {
    const claimed = await this.roundsRepository.claimAdvance(
      round.id,
      'JUDGING',
      'COMPLETE'
    );
    if (!claimed) {
      throw new BadRequestError(
        `A rodada ${round.roundNumber} já foi decidida.`
      );
    }
    // roundWinnerId relates to round_played_cards.id (see roundsRelations).
    await this.roundsRepository.update(round.id, {
      roundWinnerId: winner.id,
      updatedAt: new Date()
    });
  }

  // Deal a fresh Hand to EVERY Player at room start, including the first Judge —
  // a Hand now persists across Rounds and is refilled in playCards, so there is
  // no per-Round full redeal. issue #1, slice 3.
  public async dealInitialHands({
    roomCode,
    cardsPerPlayer
  }: {
    roomCode: string;
    cardsPerPlayer: number;
  }): Promise<DealtHand[]> {
    const players = await this.getRoomPlayers(roomCode);
    const result: DealtHand[] = [];

    for (const player of players) {
      const cards = await this.dealHand(roomCode, player.id, cardsPerPlayer);
      result.push({ playerId: player.id, cards });
    }

    return result;
  }

  // Replace one Player's Hand with `count` fresh cards. Used at start and for a
  // Player joining mid-game, who would otherwise hold no cards.
  public async dealHand(
    roomCode: string,
    playerId: string,
    count: number
  ): Promise<WhiteCard[]> {
    const cards = await this.whiteCardDealer.dealWhiteCards(roomCode, count);
    await this.updatePlayerInRoom(roomCode, playerId, {
      cardIds: cards.map(card => card.id)
    });
    return cards;
  }
}
