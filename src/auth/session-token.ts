import { sha256 } from '@oslojs/crypto/sha2';
import {
  encodeBase32LowerCaseNoPadding,
  encodeHexLowerCase
} from '@oslojs/encoding';

// Session secret pattern from the Lucia v3 migration guide
// (https://lucia-auth.com/lucia-v3/migrate): the cookie carries the raw token,
// the DB stores only its SHA-256 hash so a leaked DB row can't be replayed.

const TOKEN_BYTES = 20;

export function generateSessionToken(): string {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return encodeBase32LowerCaseNoPadding(bytes);
}

export function hashToken(token: string): string {
  return encodeHexLowerCase(sha256(new TextEncoder().encode(token)));
}
