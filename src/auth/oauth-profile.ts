// Turns an OAuth provider's identity into the fields a CAHO user needs. Google
// has no handle, so its username comes from the email; GitHub's login is used
// as-is. Either may already belong to someone else, so the final username is
// claimed against the users table with a numeric suffix.

const USERNAME_MAX_LENGTH = 255;
const FALLBACK_USERNAME = 'player';

export type GithubEmail = {
  email: string;
  primary: boolean;
  verified: boolean;
};

/**
 * Strips characters that don't belong in a handle.
 * @example sanitizeUsername('jane doe!') // 'janedoe'
 */
export function sanitizeUsername(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9._-]/g, '');
  return cleaned.slice(0, USERNAME_MAX_LENGTH) || FALLBACK_USERNAME;
}

/**
 * Everything before the `@` of an email, sanitized.
 * @example usernameFromEmail('jane.doe@gmail.com') // 'jane.doe'
 */
export function usernameFromEmail(email: string): string {
  return sanitizeUsername(email.split('@')[0] ?? '');
}

/**
 * Returns `base` if free, else `base1`, `base2`, ... until one is.
 * @example await claimUsername('jane', isTaken) // 'jane2'
 */
export async function claimUsername(
  base: string,
  isTaken: (username: string) => Promise<boolean>
): Promise<string> {
  for (let suffix = 0; ; suffix++) {
    const tail = suffix === 0 ? '' : String(suffix);
    const candidate = base.slice(0, USERNAME_MAX_LENGTH - tail.length) + tail;

    if (!(await isTaken(candidate))) {
      return candidate;
    }
  }
}

/**
 * GitHub's `/user` email is only set when public, so pick from `/user/emails`:
 * the primary verified address, else any verified one.
 * @example pickGithubEmail([{ email: 'a@b.c', primary: true, verified: true }]) // 'a@b.c'
 */
export function pickGithubEmail(emails: GithubEmail[]): string | null {
  const verified = emails.filter(email => email.verified);
  const primary = verified.find(email => email.primary);

  return (primary ?? verified[0])?.email ?? null;
}
