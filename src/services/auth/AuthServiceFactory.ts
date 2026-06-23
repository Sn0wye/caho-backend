import { UserRepository } from '@/repositories/user';
import { AuthService } from './AuthService';
import { SessionServiceFactory } from './SessionServiceFactory';

export function AuthServiceFactory(): AuthService {
  return new AuthService(new UserRepository(), SessionServiceFactory());
}
