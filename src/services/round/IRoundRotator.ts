import type { BlackCard } from '@/schemas';

// What a rotation yields the timer engine for its room.round-start broadcast.
// RoomService.startNextRound returns a richer shape that structurally satisfies
// this. See issue #4.
export type RoundRotation = {
  roundNumber: number;
  // The Judge for the new Round — carried into room.round-start so the frontend
  // can move the Judge without a refetch. RoomService.startNextRound sets this on
  // the new Round row. ADR-0005.
  judgeId: string;
  blackCard: BlackCard;
};

// The single Judge-rotation path the timer engine reuses. An aborted Round
// rotates the Judge by starting the next one — the same machinery a normal
// Judge pick uses — so rotation lives in exactly one place. RoomService
// structurally satisfies this via its existing startNextRound. See issue #4.
export interface IRoundRotator {
  startNextRound(
    roomCode: string,
    currentRound: number
  ): Promise<RoundRotation>;
}
