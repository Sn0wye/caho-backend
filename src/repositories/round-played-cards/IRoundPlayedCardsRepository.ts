import type { CreateRoundPlayedCardDTO } from '@/dto/CreateRoundPlayedCard';
import type { Round, RoundPlayedCard } from '@/schemas';

type CreatedPlayedCards = Omit<RoundPlayedCard, 'player' | 'whiteCards'>;

export interface IRoundPlayedCardsRepository {
  create(data: CreateRoundPlayedCardDTO): Promise<CreatedPlayedCards>;
  // Locks the Round row, runs `assertRoundOpen` on it, then records the answer,
  // all in one transaction, so a phase advance can't slip in between.
  createInLockedRound(
    data: CreateRoundPlayedCardDTO,
    assertRoundOpen: (lockedRound: Round) => void
  ): Promise<CreatedPlayedCards>;
  findByRoomCodeAndRoundNumber(
    roomCode: string,
    roundNumber: number
  ): Promise<RoundPlayedCard[]>;
}
