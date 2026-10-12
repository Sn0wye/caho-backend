import type { UpdateProfileRequest } from '@/contracts/update-profile';
import type { Profile, UserSchema } from '@/schemas';

export type IUserRepository = {
  findByUsername(username: string): Promise<UserSchema | null>;
  // Save a User's profile. Throws BadRequestError when another User already
  // holds the username or email.
  updateProfile(userId: string, profile: UpdateProfileRequest): Promise<Profile>;
};
