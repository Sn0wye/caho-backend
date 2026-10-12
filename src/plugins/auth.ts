import {
  createSessionCookie,
  readBearerToken,
  readSessionCookie
} from '@/auth/session-cookie';
import type { Session, SessionUser } from '@/auth/session-types';
import { UnauthorizedError } from '@/errors';
import type { SessionService } from '@/services/auth/SessionService';
import type { FastifyInstance } from 'fastify';
import { fastifyPlugin } from 'fastify-plugin';

// Resolves a session token to its User; SessionService in production.
export type SessionValidator = Pick<SessionService, 'validateSessionToken'>;

export const authPlugin = fastifyPlugin(
  async (
    app: FastifyInstance,
    { sessions: sessionService }: { sessions: SessionValidator }
  ) => {
    app.addHook('preHandler', async (req, res) => {
      const token =
        readSessionCookie(req.headers.cookie ?? '') ??
        readBearerToken(req.headers.authorization ?? '');
      let user: SessionUser | null = null;
      let session: Session | null = null;

      if (token) {
        const result = await sessionService.validateSessionToken(token);
        if (result.session?.fresh) {
          // Token is unchanged on renewal; re-set the cookie to refresh max-age.
          const cookie = createSessionCookie(token);
          res.setCookie(cookie.name, cookie.value, cookie.attributes);
        }

        user = result.user;
        session = result.session;
      }

      req.getUser = () => {
        if (!user) {
          throw new UnauthorizedError();
        }
        return user;
      };

      req.getSession = () => {
        if (!session) {
          throw new UnauthorizedError();
        }
        return session;
      };

      return;
    });
  },
  { name: 'auth', fastify: '4.x' }
);
