import { env } from '@/env';
import { GitHub, Google } from 'arctic';

// Arctic v3 providers. The constructor now takes the redirect URI (GitHub may be
// null when a single callback URL is registered on the OAuth app) and
// createAuthorizationURL is synchronous. See https://arcticjs.dev/.

export const githubAuth = new GitHub(
  env.GITHUB_CLIENT_ID,
  env.GITHUB_CLIENT_SECRET,
  null
);

export const googleAuth = new Google(
  env.GOOGLE_CLIENT_ID,
  env.GOOGLE_CLIENT_SECRET,
  env.GOOGLE_REDIRECT_URL
);
