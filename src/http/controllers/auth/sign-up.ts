import type { App } from '@/app';
import { signUpRequest, signUpResponse } from '@/contracts';
import { errorSchema } from '@/schemas';
import { AuthServiceFactory } from '@/services/auth/AuthServiceFactory';

export const signUpController = async (app: App) => {
  app.post(
    '/sign-up',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Sign up with username & password',
        body: signUpRequest,
        response: {
          200: signUpResponse,
          401: errorSchema
        }
      }
    },
    async (req, res) => {
      const authService = AuthServiceFactory();

      const { username, password } = req.body;
      const { cookie, user } = await authService.signUp(username, password);
      req.log.info(
        { event: 'auth.signed_up', userId: user.id, provider: 'password' },
        'User registered'
      );

      res.setCookie(cookie.name, cookie.value, cookie.attributes);

      return {
        ...user,
        token: cookie.value
      };
    }
  );
};
