import type { App } from '@/app';
import type { AuthModules } from '@/http/routes/auth';
import { BadRequestError } from '@/errors';
import { z } from 'zod';
import { oauthRateLimit } from '@/http/rate-limit';

export const signInWithGithub = async (
  app: App,
  { auth: authService }: Pick<AuthModules, 'auth'>
) => {
  app.get(
    '/github',
    {
      config: { rateLimit: oauthRateLimit },
      schema: {
        tags: ['Auth'],
        summary: 'Sign in with GitHub OAuth'
      }
    },
    async (_, res) => {
      const { url, state } = await authService.signInWithGithub();

      res.setCookie('github_oauth_state', state, {
        path: '/',
        httpOnly: true,
        maxAge: 60 * 10,
        sameSite: 'lax'
      });

      return res.redirect(url.toString());
    }
  );

  app.get(
    '/github/callback',
    {
      config: { rateLimit: oauthRateLimit },
      schema: {
        tags: ['Auth'],
        summary: 'GitHub OAuth Callback',
        querystring: z.object({
          code: z.string(),
          state: z.string()
        })
      }
    },
    async (req, res) => {
      const { code, state } = req.query;

      const storedState = req.cookies.github_oauth_state ?? null;

      if (!code || !state || !storedState || state !== storedState) {
        req.log.warn(
          { event: 'auth.oauth_state_rejected', provider: 'github' },
          'OAuth state rejected'
        );
        throw new BadRequestError('Invalid state');
      }

      const { cookie, redirectUrl } = await authService.githubCallback({
        authorizationCode: code
      });

      res.setCookie(cookie.name, cookie.value, cookie.attributes);
      req.log.info(
        { event: 'auth.signed_in', provider: 'github' },
        'OAuth sign-in completed'
      );

      return res.redirect(redirectUrl);
    }
  );
};
