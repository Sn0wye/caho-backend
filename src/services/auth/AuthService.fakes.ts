import type { IUserRepository } from '@/repositories/user/IUserRepository';
import type { UserSchema } from '@/schemas';

// In-memory user lookup for AuthService specs; seed Users via the constructor.
export class FakeUserRepository implements IUserRepository {
  constructor(private readonly users: UserSchema[] = []) {}

  async findByUsername(username: string): Promise<UserSchema | null> {
    return this.users.find(user => user.username === username) ?? null;
  }
}
