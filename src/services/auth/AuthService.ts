import { githubAuth, googleAuth } from '@/auth/oauth';
import {
  claimUsername,
  type GithubEmail,
  pickGithubEmail,
  sanitizeUsername,
  usernameFromEmail
} from '@/auth/oauth-profile';
import {
  createBlankSessionCookie,
  createSessionCookie
} from '@/auth/session-cookie';
import { generateSessionToken } from '@/auth/session-token';
import { db } from '@/db';
import { oauthAccounts, users } from '@/db/schema';
import { env } from '@/env';
import {
  BadRequestError,
  InternalServerError,
  UnauthorizedError
} from '@/errors';
import type { IUserRepository } from '@/repositories/user/IUserRepository';
import type { SessionService } from '@/services/auth/SessionService';
import { hash, verify } from '@/utils/password';
import { createId } from '@paralleldrive/cuid2';
import { eq } from 'drizzle-orm';
import {
  ArcticFetchError,
  generateCodeVerifier,
  generateState,
  OAuth2RequestError
} from 'arctic';

interface GithubUser {
  id: number;
  name?: string | null;
  login: string;
  email: string | null;
  avatar_url: string;
}

type GoogleUser = {
  sub: string;
  name: string;
  given_name: string;
  family_name: string;
  picture: string;
  email: string;
  email_verified: boolean;
  locale: string;
};

export class AuthService {
  db: typeof db;

  constructor(
    private readonly userRepository: IUserRepository,
    private readonly sessionService: SessionService
  ) {
    this.db = db;
  }

  // Mint a fresh session token, persist its session, and return the cookie that
  // carries the raw token. Centralizes the token→session→cookie flow shared by
  // password and OAuth sign-in.
  private async issueSession(userId: string) {
    const token = generateSessionToken();
    await this.sessionService.createSession(token, userId);
    return createSessionCookie(token);
  }

  public async signIn(username: string, password: string) {
    const user = await this.userRepository.findByUsername(username);

    if (!user) {
      throw new UnauthorizedError('Usuário ou senha inválidos');
    }

    const passwordsMatch = await verify(user.password, password);

    if (!passwordsMatch) {
      throw new UnauthorizedError('Usuário ou senha inválidos');
    }

    const cookie = await this.issueSession(user.id);

    return {
      cookie,
      user
    };
  }

  public async signUp(username: string, password: string) {
    const userExists = await this.userRepository.findByUsername(username);

    if (userExists) {
      throw new UnauthorizedError('Já existe um usuário com esse nome.');
    }

    const hashedPassword = await hash(password);

    const dbUser = (
      await db
        .insert(users)
        .values({
          username,
          password: hashedPassword,
          avatarUrl: null,
          email: null,
          name: null
        })
        .returning()
    )[0];

    const user = {
      id: dbUser.id,
      username: dbUser.username,
      name: dbUser.name,
      email: dbUser.email,
      avatarUrl: dbUser.avatarUrl
    };

    const cookie = await this.issueSession(user.id);

    return {
      cookie,
      user
    };
  }

  public async signOut(sessionId: string) {
    await this.sessionService.invalidateSession(sessionId);
    return createBlankSessionCookie();
  }

  public async signInWithGithub() {
    const state = generateState();
    // `user:email` exposes private emails via /user/emails; the public profile
    // only carries an email when the user made it public.
    const url = githubAuth.createAuthorizationURL(state, ['user:email']);

    return {
      state,
      url
    };
  }

  public async githubCallback({
    authorizationCode
  }: {
    authorizationCode: string;
  }) {
    try {
      const tokens = await githubAuth.validateAuthorizationCode(
        authorizationCode
      );
      const accessToken = tokens.accessToken();
      const githubUser = await fetchGithubJson<GithubUser>(
        '/user',
        accessToken
      );
      const email =
        (await this.fetchGithubEmail(accessToken)) ?? githubUser.email;

      const cookie = await this.signInWithOAuthAccount({
        providerId: 'github',
        providerUserId: String(githubUser.id),
        username: sanitizeUsername(githubUser.login),
        name: githubUser.name ?? null,
        email,
        avatarUrl: githubUser.avatar_url
      });

      return {
        cookie,
        redirectUrl: env.FRONTEND_AUTH_REDIRECT_URL
      };
    } catch (e) {
      if (e instanceof OAuth2RequestError || e instanceof ArcticFetchError) {
        throw new BadRequestError('Invalid code');
      }

      throw new InternalServerError('Failed to sign in with GitHub');
    }
  }

  // A missing scope (accounts authorized before `user:email` was requested)
  // answers 403; fall back to the public profile email instead of failing.
  private async fetchGithubEmail(accessToken: string) {
    try {
      const emails = await fetchGithubJson<GithubEmail[]>(
        '/user/emails',
        accessToken
      );
      return pickGithubEmail(emails);
    } catch {
      return null;
    }
  }

  public async signInWithGoogle() {
    const state = generateState();
    const codeVerifier = generateCodeVerifier();

    const url = googleAuth.createAuthorizationURL(state, codeVerifier, [
      'profile',
      'email'
    ]);

    return {
      redirectUrl: url.toString(),
      state,
      codeVerifier
    };
  }

  public async googleCallback({
    authorizationCode,
    codeVerifier
  }: {
    authorizationCode: string;
    codeVerifier: string;
  }) {
    try {
      const tokens = await googleAuth.validateAuthorizationCode(
        authorizationCode,
        codeVerifier
      );

      const response = await fetch(
        'https://openidconnect.googleapis.com/v1/userinfo',
        {
          headers: {
            Authorization: `Bearer ${tokens.accessToken()}`
          }
        }
      );

      if (!response.ok) {
        throw new InternalServerError('Failed to fetch Google user');
      }

      const googleUser: GoogleUser = await response.json();

      const cookie = await this.signInWithOAuthAccount({
        providerId: 'google',
        providerUserId: googleUser.sub,
        username: usernameFromEmail(googleUser.email),
        name: googleUser.name,
        email: googleUser.email,
        avatarUrl: googleUser.picture
      });

      return {
        cookie,
        redirectUrl: env.FRONTEND_AUTH_REDIRECT_URL
      };
    } catch (e) {
      if (e instanceof OAuth2RequestError || e instanceof ArcticFetchError) {
        throw new BadRequestError('Invalid code');
      }

      throw new InternalServerError('Failed to sign in with Google');
    }
  }

  // Shared by every provider: reuse the linked user when the provider account
  // is known, otherwise create a fresh one. Never links by username or email:
  // password users pick both freely, so matching on them would hand their
  // account to whoever owns the same handle/email on the provider.
  private async signInWithOAuthAccount(profile: OAuthProfile) {
    const existingAccount = await db.query.oauthAccounts.findFirst({
      where: (account, { and, eq }) =>
        and(
          eq(account.providerId, profile.providerId),
          eq(account.providerUserId, profile.providerUserId)
        )
    });

    const userId = existingAccount
      ? await this.backfillOAuthUser(existingAccount.userId, profile)
      : await this.createOAuthUser(profile);

    return this.issueSession(userId);
  }

  private async createOAuthUser(profile: OAuthProfile) {
    const userId = createId();
    const username = await this.claimFreeUsername(profile.username);

    await db.transaction(async tx => {
      await tx.insert(users).values({
        id: userId,
        name: profile.name,
        email: profile.email,
        avatarUrl: profile.avatarUrl,
        username,
        password: ''
      });

      await tx.insert(oauthAccounts).values({
        providerId: profile.providerId,
        providerUserId: profile.providerUserId,
        userId
      });
    });

    return userId;
  }

  // Google users created before this fix have an empty username, and GitHub
  // users never got an email. Fill those in on their next sign-in without
  // touching anything the user already set.
  private async backfillOAuthUser(userId: string, profile: OAuthProfile) {
    const user = await db.query.users.findFirst({
      where: (users, { eq }) => eq(users.id, userId)
    });

    if (!user || (user.username && user.email)) {
      return userId;
    }

    await db
      .update(users)
      .set({
        username:
          user.username || (await this.claimFreeUsername(profile.username)),
        email: user.email ?? profile.email
      })
      .where(eq(users.id, userId));

    return userId;
  }

  private claimFreeUsername(base: string) {
    return claimUsername(
      base,
      async username => !!(await this.userRepository.findByUsername(username))
    );
  }
}

type OAuthProfile = {
  providerId: 'github' | 'google';
  providerUserId: string;
  username: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
};

async function fetchGithubJson<T>(path: string, accessToken: string) {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json'
    }
  });

  if (!response.ok) {
    throw new InternalServerError(
      `GitHub ${path} answered ${response.status}, expected 200`
    );
  }

  return (await response.json()) as T;
}
