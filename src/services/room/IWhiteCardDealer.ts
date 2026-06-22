import type { WhiteCard } from '@/schemas';

// Thin seam over card-pack dealing so RoomService can be unit-tested without a
// live database. The production adapter wraps CardService; specs use a fake.
// See issue #1 (persistent Hand + refill).
export interface IWhiteCardDealer {
  dealWhiteCards(roomCode: string, count: number): Promise<WhiteCard[]>;
}
