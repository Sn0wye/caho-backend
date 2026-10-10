import { z } from 'zod';

export const userSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  username: z.string(),
  password: z.string(),
  avatarUrl: z.string().nullable()
});

export type UserSchema = z.infer<typeof userSchema>;

// The broadcastable slice of a User. Played Cards go to the whole Room, and the
// full row used to ship each Player's password hash and email with them.
export const publicUserSchema = userSchema.pick({
  id: true,
  username: true,
  avatarUrl: true
});

export type PublicUser = z.infer<typeof publicUserSchema>;
