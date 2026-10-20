import { userSchema } from '@/schemas';
import { z } from 'zod';
import { passwordField, usernameField } from './credentials';

export const signInRequest = z.object({
  username: usernameField,
  password: passwordField
});

export type SignInRequest = z.infer<typeof signInRequest>;

export const signInResponse = userSchema.omit({ password: true }).extend({
  token: z.string().min(1)
});

export type SignInResponse = z.infer<typeof signInResponse>;
