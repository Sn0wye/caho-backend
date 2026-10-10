import type { App } from '@/app';
import { UnauthorizedError } from '@/errors';
import { AuthServiceFactory } from '@/services/auth/AuthServiceFactory';
import { z } from 'zod';

export const signOutController = async (app: App) => {
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
        const authService = AuthServiceFactory();

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
