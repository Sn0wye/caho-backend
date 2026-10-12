import { db } from '@/db';
import { users } from '@/db/schema';
import {
  type UpdateProfileRequest,
  profileConflictMessage
} from '@/contracts/update-profile';
import { BadRequestError } from '@/errors';
import type { Profile, UserSchema } from '@/schemas';
import { and, eq, ne, or } from 'drizzle-orm';
import type { IUserRepository } from './IUserRepository';

export class UserRepository implements IUserRepository {
  async findByUsername(username: string): Promise<UserSchema | null> {
    const user = await db.query.users.findFirst({
      where: (users, { eq }) => eq(users.username, username)
    });

    return user ? user : null;
  }

  // Moved from the update-profile controller, which queried the db directly.
  async updateProfile(
    userId: string,
    profile: UpdateProfileRequest
  ): Promise<Profile> {
    const { username, email, avatarUrl } = profile;
    const taken = await this.findProfileConflict(userId, profile);
    if (taken) {
      throw new BadRequestError(profileConflictMessage(taken, username));
    }

    const [updated] = await db
      .update(users)
      .set({ email, avatarUrl, username })
      .where(eq(users.id, userId))
      .returning({
        id: users.id,
        name: users.name,
        username: users.username,
        email: users.email,
        avatarUrl: users.avatarUrl
      });
    return updated;
  }

  // Another User already holding the username, or the email when one is set.
  private async findProfileConflict(
    userId: string,
    { username, email }: UpdateProfileRequest
  ): Promise<UserSchema | undefined> {
    return await db.query.users.findFirst({
      where: and(
        ne(users.id, userId),
        email
          ? or(eq(users.username, username), eq(users.email, email))
          : eq(users.username, username)
      )
    });
  }
}
