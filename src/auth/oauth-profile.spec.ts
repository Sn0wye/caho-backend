import { describe, expect, it } from 'vitest';
import {
  claimUsername,
  pickGithubEmail,
  sanitizeUsername,
  usernameFromEmail
} from './oauth-profile';

describe('usernameFromEmail', () => {
  it('keeps everything before the @', () => {
    expect(usernameFromEmail('jane.doe@gmail.com')).toBe('jane.doe');
  });

  it('drops characters that are not valid in a handle', () => {
    expect(usernameFromEmail('jane+caho@gmail.com')).toBe('janecaho');
  });
});

describe('sanitizeUsername', () => {
  it('falls back when nothing usable is left', () => {
    expect(sanitizeUsername('!!!')).toBe('player');
  });
});

describe('claimUsername', () => {
  const takenBy = (taken: string[]) => async (username: string) =>
    taken.includes(username);

  it('returns the base when it is free', async () => {
    expect(await claimUsername('jane', takenBy([]))).toBe('jane');
  });

  it('appends the first free numeric suffix', async () => {
    expect(await claimUsername('jane', takenBy(['jane', 'jane1']))).toBe(
      'jane2'
    );
  });
});

describe('pickGithubEmail', () => {
  it('prefers the primary verified email', () => {
    expect(
      pickGithubEmail([
        { email: 'other@x.com', primary: false, verified: true },
        { email: 'main@x.com', primary: true, verified: true }
      ])
    ).toBe('main@x.com');
  });

  it('skips unverified emails', () => {
    expect(
      pickGithubEmail([
        { email: 'main@x.com', primary: true, verified: false },
        { email: 'other@x.com', primary: false, verified: true }
      ])
    ).toBe('other@x.com');
  });

  it('returns null when nothing is verified', () => {
    expect(
      pickGithubEmail([{ email: 'main@x.com', primary: true, verified: false }])
    ).toBeNull();
  });
});
