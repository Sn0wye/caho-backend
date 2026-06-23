import { SessionRepositoryFactory } from '@/repositories/session';
import { SessionService } from './SessionService';

export function SessionServiceFactory(): SessionService {
  return new SessionService(SessionRepositoryFactory());
}
