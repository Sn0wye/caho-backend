import {
  type UpdateProfileRequest,
  profileConflictMessage
} from '@/contracts/update-profile';
import { BadRequestError } from '@/errors';
import type { IUserRepository } from '@/repositories/user/IUserRepository';
import type { Profile, UserSchema } from '@/schemas';

// In-memory user store for AuthService and route specs; seed Users via the
// constructor.
export class FakeUserRepository implements IUserRepository {
  constructor(private readonly users: UserSchema[] = []) {}

  async findByUsername(username: string): Promise<UserSchema | null> {
    return this.users.find(user => user.username === username) ?? null;
  }

  async updateProfile(
    userId: string,
    profile: UpdateProfileRequest
  ): Promise<Profile> {
    const taken = this.users.find(
      user =>
        user.id !== userId &&
        (user.username === profile.username ||
          (profile.email !== null && user.email === profile.email))
    );
    if (taken) {
      throw new BadRequestError(profileConflictMessage(taken, profile.username));
    }
    const user = this.users.find(candidate => candidate.id === userId);
    if (!user) {
      throw new Error(`No User ${userId}; seed it through the constructor`);
    }
    Object.assign(user, profile);
    const { password: _password, ...saved } = user;
    return saved;
  }
}
