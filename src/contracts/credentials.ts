import { z } from 'zod';

// Upper bounds keep oversized bodies away from argon2 and the users table. A
// 1 MB "password" costs a full hash before it can be rejected.
export const USERNAME_MAX_LENGTH = 64;
export const PASSWORD_MAX_LENGTH = 128;

export const usernameField = z.string().min(1).max(USERNAME_MAX_LENGTH);
export const passwordField = z.string().min(8).max(PASSWORD_MAX_LENGTH);
