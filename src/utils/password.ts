import { env } from '@/env';
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';

// Argon2id with a server-side pepper (PASSWORD_SECRET), replacing the deprecated
// oslo/password. @node-rs/argon2 reads the algorithm params from the PHC string,
// so digests produced by the old oslo Argon2id (same secret) still verify.

const secret = new Uint8Array(Buffer.from(env.PASSWORD_SECRET));

export const hash = (password: string) => argonHash(password, { secret });

export const verify = (hashed: string, password: string) =>
  argonVerify(hashed, password, { secret });
