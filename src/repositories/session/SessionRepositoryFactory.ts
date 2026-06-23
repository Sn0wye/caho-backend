import { SessionRepository } from './SessionRepository';

export function SessionRepositoryFactory(): SessionRepository {
  return new SessionRepository();
}
