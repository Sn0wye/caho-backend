import { githubAuth, googleAuth } from '@/auth/oauth';
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
import {
  ArcticFetchError,
  generateCodeVerifier,
  generateState,
  OAuth2RequestError
} from 'arctic';

interface GithubUser {
  id: string;
  name?: string;
  login: string;
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
    // No extra scopes: the public profile read below only needs the default
    // user data, matching the pre-arctic-v3 behavior.
    const url = githubAuth.createAuthorizationURL(state, []);

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
      const githubUserResponse = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${tokens.accessToken()}`
        }
      });
      const githubUser: GithubUser = await githubUserResponse.json();

      const existingAccount = await db.query.oauthAccounts
        .findFirst({
          where: (account, { and, eq }) =>
            and(
              eq(account.providerId, 'github'),
              eq(account.providerUserId, githubUser.id)
            )
        })
        .execute();

      if (existingAccount) {
        const cookie = await this.issueSession(existingAccount.userId);

        return {
          cookie,
          redirectUrl: env.FRONTEND_AUTH_REDIRECT_URL
        };
      }

      const userExists = await this.userRepository.findByUsername(
        githubUser.login
      );

      const userId = userExists?.id ?? createId();

      await db.transaction(async tx => {
        if (!userExists) {
          await tx
            .insert(users)
            .values({
              id: userId,
              avatarUrl: githubUser.avatar_url,
              name: githubUser.name,
              username: githubUser.login,
              password: ''
            })
            .execute();
        }

        await tx
          .insert(oauthAccounts)
          .values({
            providerId: 'github',
            providerUserId: githubUser.id,
            userId
          })
          .execute();
      });

      const cookie = await this.issueSession(userId);

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

      const existingAccount = await db.query.oauthAccounts
        .findFirst({
          where: (account, { and, eq }) =>
            and(
              eq(account.providerId, 'google'),
              eq(account.providerUserId, googleUser.sub)
            )
        })
        .execute();

      if (existingAccount) {
        const cookie = await this.issueSession(existingAccount.userId);

        return {
          cookie,
          redirectUrl: env.FRONTEND_AUTH_REDIRECT_URL
        };
      }

      const userExists = await this.userRepository.findByUsername(
        googleUser.email
      );

      const userId = userExists?.id ?? createId();

      await db.transaction(async tx => {
        if (!userExists) {
          await tx
            .insert(users)
            .values({
              id: userId,
              name: googleUser.name,
              email: googleUser.email,
              avatarUrl: googleUser.picture,
              username: '',
              password: ''
            })
            .execute();
        }

        await tx
          .insert(oauthAccounts)
          .values({
            providerId: 'google',
            providerUserId: googleUser.sub,
            userId
          })
          .execute();
      });

      const cookie = await this.issueSession(userId);

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
}
