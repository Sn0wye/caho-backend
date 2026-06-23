import { CardRepository } from './CardRepository';
import type { ICardRepository } from './ICardRepository';

export function CardRepositoryFactory(): ICardRepository {
  return new CardRepository();
}
