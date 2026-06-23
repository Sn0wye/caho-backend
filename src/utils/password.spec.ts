import { describe, expect, it } from 'vitest';
import { hash, verify } from './password';

describe('password hashing', () => {
  it('produces a PHC argon2 digest distinct from the plaintext', async () => {
    const digest = await hash('correct horse');

    expect(digest).not.toBe('correct horse');
    expect(digest.startsWith('$argon2')).toBe(true);
  });

  it('verifies a matching password', async () => {
    const digest = await hash('correct horse');

    expect(await verify(digest, 'correct horse')).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const digest = await hash('correct horse');

    expect(await verify(digest, 'battery staple')).toBe(false);
  });
});
