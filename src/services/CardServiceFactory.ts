import { CardRepositoryFactory } from '@/repositories/cards';
import { RoomRepositoryFactory } from '@/repositories/room';
import { CardService } from './CardService';

// Wires a CardService for a Room with the production DB-backed repositories.
// Call sites used to do `new CardService(roomCode, basePack)`; the base pack is
// now seeded into the database (issue #5).
export function CardServiceFactory(roomCode: string): CardService {
  return new CardService(
    roomCode,
    CardRepositoryFactory(),
    RoomRepositoryFactory()
  );
}
