import type { App } from '@/app';
import { signInRequest, signInResponse } from '@/contracts';
import { UnauthorizedError } from '@/errors';
import { errorSchema } from '@/schemas';
import { AuthServiceFactory } from '@/services/auth/AuthServiceFactory';

export const signInController = async (app: App) => {
  app.post(
    '/sign-in',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Sign in with username & password',
        body: signInRequest,
        response: {
          200: signInResponse,
          401: errorSchema
        }
      }
    },
    async (req, res) => {
      const { username, password } = req.body;

      try {
        const authService = AuthServiceFactory();
        const { cookie, user } = await authService.signIn(username, password);

        res.setCookie(cookie.name, cookie.value, cookie.attributes);
        req.log.info(
          { event: 'auth.signed_in', userId: user.id, provider: 'password' },
          'User signed in'
        );

        return {
          ...user,
          token: cookie.value
        };
      } catch (e) {
        if (!(e instanceof UnauthorizedError)) throw e;
        req.log.warn(
          { event: 'auth.sign_in_rejected', provider: 'password' },
          'Sign-in rejected'
        );
        return res.unauthorized('Usuário ou senha inválidos');
      }
    }
  );
};
