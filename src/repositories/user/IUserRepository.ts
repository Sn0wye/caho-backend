import type { UserSchema } from '@/schemas';

export type IUserRepository = {
  findByUsername(username: string): Promise<UserSchema | null>;
};
