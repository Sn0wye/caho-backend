import type { CreateRoomDTO } from '@/dto/CreateRoom';
import type { JoinRoomDTO } from '@/dto/JoinRoom';
import type { LeaveRoomDTO } from '@/dto/LeaveRoom';
import {
  ApplicationError,
  BadRequestError,
  ForbiddenError,
  InternalServerError,
  NotFoundError
} from '@/errors';
import { ROOM_ERRORS } from '@/errors/room';
import type { IGameStore } from '@/repositories/game-store/IGameStore';
import type {
  Player,
  Ranking,
  Room,
  Round,
  RoundPlayedCard,
  WhiteCard
} from '@/schemas';
import { assertPlayableCards } from '@/services/round/assertPlayableCards';
import { generateCode } from '@/utils/generateCode';
import { getRandomJudge } from '@/utils/getRandomJudge';
import { createId } from '@paralleldrive/cuid2';
import type { IBlackCardDeck } from './IBlackCardDeck';
import type {
  DealtHand,
  GameStart,
  HostLossOutcome,
  IRoomService,
  JudgeChooseWinnerDTO,
  JudgePick,
  PlayResult,
  RoundScore
} from './IRoomService';
import type { IWhiteCardDealer } from './IWhiteCardDealer';
import { HAND_SIZE, assertRoomCanStart } from './gameRules';

export class RoomService implements IRoomService {
  constructor(
    private readonly store: IGameStore,
    private readonly whiteCardDealer: IWhiteCardDealer,
    private readonly blackCardDeck: IBlackCardDeck
  ) {}

  public async getRoom(roomCode: string): Promise<Room> {
    const room = await this.store.rooms.getRoomByCode(roomCode);

    if (!room) {
      throw new NotFoundError(ROOM_ERRORS.ROOM_NOT_FOUND);
    }

    return room;
  }

  public async createRoom(data: CreateRoomDTO): Promise<Room> {
    try {
      const room = await this.store.rooms.create({
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

  public async addPlayerToRoom({
    roomCode,
    player
  }: {
    roomCode: string;
    player: Player;
  }): Promise<void> {
    await this.getRoom(roomCode);

    try {
      return await this.store.players.addPlayerToRoom({
        roomCode,
        player
      });
    } catch (error) {
      throw new InternalServerError('Erro ao adicionar jogador na sala.', {
        cause: error
      });
    }
  }

  // The Host starts the game: pick the first Judge, draw the first Black Card
  // and deal every Player a Hand. Moved out of the start-room controller so the
  // rules are testable and broadcasts live in the orchestrator (ADR-0004). Hands
  // persist across Rounds. issue #1, slice 3. Round 1 itself is opened by
  // RoundLifecycle.startFirstRound, which owns every Round once it exists (#25).
  public async startGame(
    roomCode: string,
    requesterId: string
  ): Promise<GameStart> {
    const room = await this.getRoom(roomCode);
    const players = await this.store.players.getRoomPlayersByCode(roomCode);
    assertRoomCanStart(room, players, requesterId);

    const judgeId = getRandomJudge(null, players);
    const blackCard = await this.blackCardDeck.drawBlackCard(roomCode);
    await this.store.players.setPlayersAsUnready(roomCode);
    const startedRoom = await this.store.rooms.update(roomCode, {
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
    const startedPlayers =
      await this.store.players.getRoomPlayersByCode(roomCode);

    return {
      room: startedRoom,
      players: startedPlayers,
      judgeId,
      blackCard,
      hands
    };
  }

  // Single end-of-game path: both the host's manual /end and the maxPoints
  // win-condition route through here so the Room reaches FINISHED and the
  // Ranking is built exactly one way. See issue #1, slice 2. The in-flight Round
  // is aborted by the caller through RoundLifecycle.endActiveRound, the one
  // definition of an abort (#25).
  public async endGame(roomCode: string): Promise<Ranking> {
    try {
      await this.store.rooms.update(roomCode, {
        status: 'FINISHED'
      });

      const ranking = await this.store.ranking.getRankingByRoomCode(roomCode);

      return ranking;
    } catch (error) {
      throw new InternalServerError('Erro ao finalizar sala.', {
        cause: error
      });
    }
  }

  public async joinRoom(input: JoinRoomDTO): Promise<Room> {
    const { roomCode, player, password } = input;

    try {
      const room = await this.getRoom(roomCode);

      player.isHost = room.hostId === player.id;
      const players = await this.store.players.getRoomPlayersByCode(roomCode);

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
      await this.store.players.deletePlayerFromRoom(roomCode, playerId);
    } catch (error) {
      throw new InternalServerError('Erro ao sair da sala.', { cause: error });
    }
  }

  // Rooms the Player currently belongs to. The per-user WebSocket only knows a
  // userId, so presence updates use this to find which Rooms to broadcast to.
  public async getPlayerRoomCodes(playerId: string): Promise<string[]> {
    return await this.store.players.getRoomCodesByPlayerId(playerId);
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
    const players = await this.store.players.getRoomPlayersByCode(room.code);
    const heir = players.find(
      player => player.isActive && player.id !== departingPlayerId
    );

    if (!heir) {
      const ranking = await this.endGame(room.code);
      return { kind: 'room-ended', ranking };
    }

    // The repository keys Rooms by Code; passing room.id here silently updated
    // nothing, so the Host was never actually reassigned.
    await this.store.rooms.update(room.code, { hostId: heir.id });
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
    const departing = await this.store.players.getPlayerFromRoom(
      roomCode,
      playerId
    );
    if (departing) {
      await this.store.players.updatePlayerInRoom(roomCode, playerId, {
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

  public async updatePlayerInRoom(
    roomCode: string,
    playerId: string,
    payload: Partial<Player>
  ): Promise<Player> {
    try {
      // TODO: improve this to return the updated player
      await this.store.players.updatePlayerInRoom(roomCode, playerId, payload);
    } catch (error) {
      throw new InternalServerError('Erro ao atualizar jogador na sala.', {
        cause: error
      });
    }

    return await this.getPlayerFromRoom(roomCode, playerId);
  }

  private async getPlayerFromRoom(
    roomCode: string,
    playerId: string
  ): Promise<Player> {
    const player = await this.store.players.getPlayerFromRoom(
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
      return await this.store.players.incrementPlayerScore(input);
    } catch (error) {
      throw new InternalServerError(
        'Erro ao incrementar pontuação do jogador.',
        { cause: error }
      );
    }
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

    await this.store.playedCards.create({
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

    await this.store.players.updatePlayerInRoom(roomCode, player.id, {
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

    const round = await this.store.rounds.find(roomCode, room.round);
    if (!round) {
      throw new NotFoundError(ROOM_ERRORS.ROUND_NOT_FOUND);
    }
    return round;
  }

  public async setPlayersAsUnready(roomCode: string): Promise<void> {
    try {
      await this.store.players.setPlayersAsUnready(roomCode);
    } catch (error) {
      throw new InternalServerError(
        'Erro ao definir jogadores como não prontos.',
        { cause: error }
      );
    }
  }

  // The Judge's pick is valid: only the Room's Judge, only while the Round is
  // JUDGING, only a Player who played. Returns the Round and the winning Played
  // Card; RoundLifecycle then claims JUDGING -> COMPLETE, which guards a
  // double-click or a pick racing the judging deadline (#25).
  public async checkJudgePick({
    roomCode,
    judgePlayerId,
    winnerPlayerId
  }: JudgeChooseWinnerDTO): Promise<JudgePick> {
    const room = await this.getRoom(roomCode);
    if (room.judgeId !== judgePlayerId) {
      throw new ForbiddenError(
        `Apenas o juiz da rodada pode escolher (juiz: ${room.judgeId}, você: ${judgePlayerId}).`
      );
    }

    const round = await this.requireActiveRound(roomCode);
    const winner = await this.findWinningPlay(round, winnerPlayerId);
    return { room, round, winner };
  }

  // Score the Round winner, then apply the win-condition: reaching maxPoints
  // ends the game instead of dealing another Round. issue #1, slices 1-2.
  public async scoreRoundWinner(
    room: Room,
    winnerPlayerId: string
  ): Promise<RoundScore> {
    await this.incrementPlayerScore({
      roomCode: room.code,
      playerId: winnerPlayerId,
      by: 1
    });
    const winnerPlayer = await this.getPlayerFromRoom(room.code, winnerPlayerId);
    const gameEnded = winnerPlayer.score >= room.maxPoints;
    const ranking = gameEnded ? await this.endGame(room.code) : null;

    return { winnerPlayer, gameEnded, ranking };
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

    const plays = await this.store.playedCards.findByRoomCodeAndRoundNumber(
      round.roomCode,
      round.roundNumber
    );
    const winner = plays.find(play => play.player.id === winnerPlayerId);
    const stillInRoom = await this.store.players.getPlayerFromRoom(
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
    const players = await this.store.players.getRoomPlayersByCode(roomCode);
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
