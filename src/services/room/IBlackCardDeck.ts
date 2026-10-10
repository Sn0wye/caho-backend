import type { BlackCard } from '@/repositories/cards';

// Seam over Black Card draws so RoomService can start Rounds in unit tests
// without a live database. The production adapter wraps CardService, which
// records each draw on the Room so a card never repeats.
export interface IBlackCardDeck {
  drawBlackCard(roomCode: string): Promise<BlackCard>;
  findBlackCard(roomCode: string, id: string): Promise<BlackCard | undefined>;
}
