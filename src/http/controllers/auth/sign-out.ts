import type { App } from '@/app';
import type { AuthService } from '@/services/auth/AuthService';
import { UnauthorizedError } from '@/errors';
import { z } from 'zod';

export const signOutController = async (
  app: App,
  { auth: authService }: { auth: Pick<AuthService, 'signOut'> }
) => {
  app.post(
    '/sign-out',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Sign out',
        response: {
          204: z.never()
        }
      }
    },
    async (req, res) => {
      try {

        const session = req.getSession();

        const cookie = await authService.signOut(session.id);
        res.setCookie(cookie.name, cookie.value, cookie.attributes);
        req.log.info(
          { event: 'auth.signed_out', userId: session.userId },
          'User signed out'
        );

        return res.status(204).send();
      } catch (err) {
        if (!(err instanceof UnauthorizedError)) throw err;
        return res.status(204).send();
      }
    }
  );
};
