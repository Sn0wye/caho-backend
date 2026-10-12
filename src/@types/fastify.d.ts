import 'fastify';
import type { Session, SessionUser } from '@/auth/session-types';

declare module 'fastify' {
  interface FastifyRequest {
    getUser(): SessionUser;
    getSession(): Session;
  }
}
