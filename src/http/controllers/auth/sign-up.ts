import type { App } from '@/app';
import type { AuthModules } from '@/http/routes/auth';
import { signUpRequest, signUpResponse } from '@/contracts';
import { errorSchema } from '@/schemas';
import { credentialRateLimit } from '@/http/rate-limit';

export const signUpController = async (
  app: App,
  { auth: authService }: Pick<AuthModules, 'auth'>
) => {
  app.post(
    '/sign-up',
    {
      config: { rateLimit: credentialRateLimit },
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
