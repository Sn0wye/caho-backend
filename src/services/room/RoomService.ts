import {
  ApplicationError,
  BadRequestError,
  InternalServerError,
  NotFoundError
} from '@/errors';
import { ROOM_ERRORS } from '@/errors/room';
import type { IRankingRepository } from '@/repositories/ranking';
import type { IRoomRepository } from '@/repositories/room';
import type { IRoomPlayersRepository } from '@/repositories/room-players';
import { generateCode } from '@/utils/generateCode';
import type {
  BlackCard,
  Player,
  PublicRoomWithPlayerCountAndHost,
  Ranking,
  Room,
  Round,
  RoundPlayedCard,
  RoundWithRelations,
  WhiteCard
} from '@/schemas';
import { createId } from '@paralleldrive/cuid2';
import type {
  HostLossOutcome,
  IRoomService,
  JudgeChooseWinnerDTO,
  JudgePickResult
} from './IRoomService';
import type { CreateRoomDTO } from '@/dto/CreateRoom';
import type { JoinRoomDTO } from '@/dto/JoinRoom';
import type { LeaveRoomDTO } from '@/dto/LeaveRoom';
import { CardServiceFactory } from '../CardServiceFactory';
import type { IRoundRepository } from '@/repositories/round';
import type { IRoundPlayedCardsRepository } from '@/repositories/round-played-cards';
import { getRandomJudge } from '@/utils/getRandomJudge';
import type { IWhiteCardDealer } from './IWhiteCardDealer';

export class RoomService implements IRoomService {
  constructor(
    private readonly roomRepository: IRoomRepository,
    private readonly rankingRepository: IRankingRepository,
    private readonly roomPlayersRepository: IRoomPlayersRepository,
    private readonly roundsRepository: IRoundRepository,
    private readonly roundPlayedCardsRepository: IRoundPlayedCardsRepository,
    private readonly whiteCardDealer: IWhiteCardDealer
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
    } catch (e) {
      throw new InternalServerError('Erro ao criar sala.');
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
    const room = await this.roomRepository.getRoomByCode(roomCode);

    if (!room) {
      throw new NotFoundError(ROOM_ERRORS.ROOM_NOT_FOUND);
    }

    try {
      return await this.roomPlayersRepository.addPlayerToRoom({
        roomCode,
        player
      });
    } catch (e) {
      throw new InternalServerError('Erro ao adicionar jogador na sala.');
    }
  }

  public async startRoom(roomCode: string): Promise<void> {
    const existingRoom = await this.roomRepository.getRoomByCode(roomCode);

    if (!existingRoom) {
      throw new NotFoundError(ROOM_ERRORS.ROOM_NOT_FOUND);
    }

    const players =
      await this.roomPlayersRepository.getRoomPlayersByCode(roomCode);
    const playersReady = players.every(p => p.isReady);

    if (!playersReady) {
      throw new BadRequestError(ROOM_ERRORS.NOT_ALL_PLAYERS_READY);
    }

    try {
      await this.roomRepository.update(existingRoom.id, {
        status: 'IN_PROGRESS'
      });
    } catch {
      throw new InternalServerError('Erro ao iniciar sala.');
    }
  }

  // Single end-of-game path: both the host's manual /end and the maxPoints
  // win-condition route through here so the Room reaches FINISHED and the
  // Ranking is built exactly one way. See issue #1, slice 2.
  public async endGame(roomCode: string): Promise<Ranking> {
    try {
      await this.roomRepository.update(roomCode, {
        status: 'FINISHED'
      });

      const ranking =
        await this.rankingRepository.getRankingByRoomCode(roomCode);

      return ranking;
    } catch (error) {
      throw new InternalServerError('Erro ao finalizar sala.');
    }
  }

  public async joinRoom(input: JoinRoomDTO): Promise<Room> {
    const { roomCode, player, password } = input;

    try {
      const room = await this.roomRepository.getRoomByCode(roomCode);

      if (!room) {
        throw new NotFoundError(ROOM_ERRORS.ROOM_NOT_FOUND);
      }

      player.isHost = room.hostId === player.id;
      const players =
        await this.roomPlayersRepository.getRoomPlayersByCode(roomCode);

      const playerAlreadyInRoom = players.some(p => p.id === player.id);
      if (playerAlreadyInRoom) {
        throw new BadRequestError(ROOM_ERRORS.PLAYER_ALREADY_IN_ROOM);
      }

      if (players.length >= room.maxPlayers) {
        throw new BadRequestError(ROOM_ERRORS.ROOM_IS_FULL);
      }

      if (!room.isPublic && room.password !== password) {
        throw new BadRequestError(ROOM_ERRORS.WRONG_PASSWORD);
      }

      await this.addPlayerToRoom({ player, roomCode });

      return room;
    } catch (error) {
      if (error instanceof ApplicationError) {
        throw error;
      }

      throw new InternalServerError('Erro ao entrar na sala.');
    }
  }

  public async leaveRoom(input: LeaveRoomDTO): Promise<void> {
    const { roomCode, playerId } = input;

    try {
      // An explicit Leave removes the Player entirely. A connection drop is the
      // separate path that keeps them as an Inactive Player. See ADR-0002.
      await this.roomPlayersRepository.deletePlayerFromRoom(roomCode, playerId);
    } catch (error) {
      throw new InternalServerError('Erro ao sair da sala.');
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

    if (room.hostId !== departingPlayerId) {
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

    await this.roomRepository.update(room.id, { hostId: heir.id });
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
    const exists = await this.roomRepository.getRoomByCode(roomCode);

    if (!exists) {
      throw new NotFoundError(ROOM_ERRORS.ROOM_NOT_FOUND);
    }

    try {
      const players =
        await this.roomPlayersRepository.getRoomPlayersByCode(roomCode);
      return players;
    } catch {
      throw new InternalServerError('Erro ao buscar jogadores da sala.');
    }
  }

  public async getRoomBlackCardId(roomCode: string): Promise<string | null> {
    const room = await this.roomRepository.getRoomByCode(roomCode);

    if (!room) {
      throw new NotFoundError(ROOM_ERRORS.ROOM_NOT_FOUND);
    }

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

      const updatedPlayer = await this.roomPlayersRepository.getPlayerFromRoom(
        roomCode,
        playerId
      );

      if (!updatedPlayer) {
        throw new NotFoundError(ROOM_ERRORS.PLAYER_NOT_FOUND);
      }

      return updatedPlayer;
    } catch {
      throw new InternalServerError('Erro ao atualizar jogador na sala.');
    }
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
        'Erro ao incrementar pontuação do jogador.'
      );
    }
  }

  public async updateRoom(
    roomCode: string,
    data: Partial<Room>
  ): Promise<Room> {
    try {
      return await this.roomRepository.update(roomCode, data);
    } catch {
      throw new InternalServerError('Erro ao atualizar sala.');
    }
  }

  public async getCurrentWhiteCards(
    roomCode: string,
    playerId: string
  ): Promise<WhiteCard[]> {
    const room = await this.roomRepository.getRoomByCode(roomCode);

    if (!room) {
      throw new NotFoundError(ROOM_ERRORS.ROOM_NOT_FOUND);
    }

    const player = await this.roomPlayersRepository.getPlayerFromRoom(
      roomCode,
      playerId
    );

    if (!player) {
      throw new NotFoundError(ROOM_ERRORS.PLAYER_NOT_FOUND);
    }

    // Resolve the player's Hand (stored as ids) against the DB card pool. See
    // issue #5 (cards moved to the database).
    const cardService = CardServiceFactory(roomCode);
    const hand = await Promise.all(
      player.cardIds.map(id => cardService.getWhiteCardById(id))
    );

    return hand.filter((card): card is WhiteCard => card !== undefined);
  }

  public async playCards(
    roomCode: string,
    playerId: string,
    playedCardIds: string[]
  ): Promise<WhiteCard[]> {
    const room = await this.roomRepository.getRoomByCode(roomCode);
    if (!room) {
      throw new NotFoundError(ROOM_ERRORS.ROOM_NOT_FOUND);
    }

    const player = await this.roomPlayersRepository.getPlayerFromRoom(
      roomCode,
      playerId
    );

    if (!player) {
      throw new NotFoundError(ROOM_ERRORS.PLAYER_NOT_FOUND);
    }

    // get the current round or create a new one.

    const currentRound = await this.roundsRepository.find(roomCode, room.round);

    if (!currentRound) {
      throw new NotFoundError(ROOM_ERRORS.ROUND_NOT_FOUND);
    }

    await this.roundPlayedCardsRepository.create({
      playerId: player.id,
      roundId: currentRound.id,
      whiteCardIds: playedCardIds
    });

    // Refill exactly the cards just played so the Hand tops back up to its
    // standing size (10) and persists into the next Round. issue #1, slice 3.
    const newWhiteCards = await this.whiteCardDealer.dealWhiteCards(
      roomCode,
      playedCardIds.length
    );

    // remove cards from player hand and complete with new cards
    player.cardIds = player.cardIds.filter(
      cardId => !playedCardIds.includes(cardId)
    );

    player.cardIds.push(...newWhiteCards.map(card => card.id));

    await this.roomPlayersRepository.updatePlayerInRoom(roomCode, playerId, {
      cardIds: player.cardIds,
      isReady: true
    });

    return newWhiteCards;
  }

  public async setPlayersAsUnready(roomCode: string): Promise<void> {
    try {
      await this.roomPlayersRepository.setPlayersAsUnready(roomCode);
    } catch (error) {
      throw new InternalServerError(
        'Erro ao definir jogadores como não prontos.'
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
    } catch (e) {
      throw new InternalServerError('Erro ao criar rodada.');
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
    const room = await this.roomRepository.getRoomByCode(roomCode);

    if (!room) {
      throw new NotFoundError(ROOM_ERRORS.ROOM_NOT_FOUND);
    }

    return await this.roundsRepository.find(roomCode, room.round);
  }

  public async getRoundNumber(roomCode: string): Promise<number> {
    const room = await this.roomRepository.getRoomByCode(roomCode);

    if (!room) {
      throw new NotFoundError(ROOM_ERRORS.ROOM_NOT_FOUND);
    }

    return room.round;
  }

  public async judgeChooseWinner(
    data: JudgeChooseWinnerDTO
  ): Promise<RoundPlayedCard> {
    const room = await this.getRoom(data.roomCode);

    if (!room) {
      throw new NotFoundError('Room not found');
    }

    const player = await this.getPlayerFromRoom(
      data.roomCode,
      data.judgePlayerId
    );

    if (!player) {
      throw new NotFoundError('Player not found');
    }

    if (!player.isJudge) {
      throw new Error('Player is not a judge');
    }

    const round = await this.roundsRepository.find(data.roomCode, room.round);

    if (!round) {
      throw new NotFoundError('Round not found');
    }

    round.roundWinnerId = data.winnerPlayerId;
    round.updatedAt = new Date();

    try {
      await this.roundsRepository.update(round.id, round);
    } catch (error) {
      throw new InternalServerError('Erro ao escolher vencedor.');
    }

    const roundPlayedCards =
      await this.roundPlayedCardsRepository.findByRoomCodeAndRoundNumber(
        data.roomCode,
        room.round
      );

    const winner = roundPlayedCards.find(
      roundPlayedCard => roundPlayedCard.player.id === data.winnerPlayerId
    );

    if (!winner) {
      throw new NotFoundError('Vencedor não encontrado');
    }

    return winner;
  }

  public async startNextRound(
    roomCode: string,
    currentRound: number
  ): Promise<
    RoundWithRelations & {
      blackCard: BlackCard;
    }
  > {
    const [room, players, round] = await Promise.all([
      this.roomRepository.getRoomByCode(roomCode),
      this.roomPlayersRepository.getRoomPlayersByCode(roomCode),
      this.roundsRepository.find(roomCode, currentRound)
    ]);

    if (!room) {
      throw new NotFoundError(ROOM_ERRORS.ROOM_NOT_FOUND);
    }

    if (!round) {
      throw new NotFoundError(ROOM_ERRORS.ROUND_NOT_FOUND);
    }

    const cardService = CardServiceFactory(roomCode);
    const newBlackCard = await cardService.getNewBlackCard();

    const nextJudgeId = getRandomJudge(room.prevJudgeId, players);

    const updatedRoom = await this.roomRepository.update(room.id, {
      round: room.round + 1,
      judgeId: nextJudgeId,
      prevJudgeId: room.judgeId
    });

    const nextRound = await this.roundsRepository.create({
      id: createId(),
      roomCode,
      judgeId: nextJudgeId,
      blackCardId: newBlackCard.id,
      roundNumber: round.roundNumber + 1,
      roundWinnerId: null,
      status: 'PLAYING',
      playDeadline: null,
      judgeDeadline: null,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    const judge = players.find(player => player.id === nextJudgeId);

    if (!judge) {
      throw new NotFoundError('Judge not found');
    }

    const blackCard = await cardService.getBlackCardById(newBlackCard.id);
    if (!blackCard) {
      throw new NotFoundError('Black card not found');
    }

    return {
      ...nextRound,
      room: updatedRoom,
      judge,
      roundWinner: null,
      roundPlayedCards: [],
      blackCardId: blackCard.id,
      blackCard
    };
  }

  public async processJudgeChooseWinner({
    roomCode,
    judgePlayerId,
    winnerPlayerId
  }: {
    roomCode: string;
    judgePlayerId: string;
    winnerPlayerId: string;
  }): Promise<JudgePickResult> {
    const room = await this.getRoom(roomCode);

    if (!room) {
      throw new NotFoundError('Room not found');
    }

    const player = await this.getPlayerFromRoom(roomCode, judgePlayerId);

    if (!player) {
      throw new NotFoundError('Player not found');
    }

    if (!player.isJudge) {
      throw new Error('Player is not a judge');
    }

    const winner = await this.judgeChooseWinner({
      judgePlayerId: player.id,
      roomCode: room.code,
      winnerPlayerId
    });

    // The Judge's pick scores the winner — issue #1, slice 1. The played card's
    // `player` is a bare User and cannot carry score, so we fetch the updated
    // Player to broadcast the new score.
    await this.incrementPlayerScore({
      roomCode: room.code,
      playerId: winnerPlayerId,
      by: 1
    });
    const winnerPlayer = await this.getPlayerFromRoom(room.code, winnerPlayerId);

    // Win-condition branch: reaching maxPoints ends the game instead of dealing
    // another Round. issue #1, slice 2.
    const gameEnded = winnerPlayer.score >= room.maxPoints;
    const ranking = gameEnded ? await this.endGame(room.code) : null;

    return { room, winner, winnerPlayer, gameEnded, ranking };
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
  }): Promise<Array<{ playerId: string; cards: WhiteCard[] }>> {
    const players = await this.getRoomPlayers(roomCode);
    const result = [];

    for (const player of players) {
      const cards = await this.whiteCardDealer.dealWhiteCards(
        roomCode,
        cardsPerPlayer
      );

      await this.updatePlayerInRoom(roomCode, player.id, {
        cardIds: cards.map(card => card.id)
      });

      result.push({ playerId: player.id, cards });
    }

    return result;
  }
}
