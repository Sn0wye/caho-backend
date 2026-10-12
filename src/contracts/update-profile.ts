import { type UserSchema, userSchema } from '@/schemas';
import { z } from 'zod';

export const updateProfileRequest = z.object({
  avatarUrl: z.string().url().nullable(),
  // Password accounts start without an email, so it stays optional.
  email: z.string().trim().email().nullable(),
  username: z.string().trim().min(1).max(255)
});

export type UpdateProfileRequest = z.infer<typeof updateProfileRequest>;

export const updateProfileResponse = userSchema.omit({ password: true });

/**
 * The conflict a profile update hit: the username if that is what's taken,
 * otherwise the email.
 *
 * @example
 * profileConflictMessage(existing, 'neo'); // 'Esse nome de usuário já está em uso.'
 */
export function profileConflictMessage(
  taken: Pick<UserSchema, 'username'>,
  username: string
): string {
  return taken.username === username
    ? 'Esse nome de usuário já está em uso.'
    : 'Esse email já está em uso.';
}
