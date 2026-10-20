import { userSchema } from '@/schemas';
import { z } from 'zod';
import { passwordField, usernameField } from './credentials';

export const signUpRequest = z.object({
  username: usernameField,
  password: passwordField
});

export type SignUpRequest = z.infer<typeof signUpRequest>;

export const signUpResponse = userSchema.omit({ password: true });

export type SignUpResponse = z.infer<typeof signUpResponse>;
