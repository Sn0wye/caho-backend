import 'fastify';
import type { Session, SessionUser } from '@/auth/session-types';
import type { Pubsub } from '@/lib/pub-sub';
import type { Redis } from 'ioredis';

declare module 'fastify' {
  interface FastifyInstance {
    db: typeof db;
    redis: Redis;
    pubsub: Pubsub;
  }

  interface FastifyRequest {
    getUser(): SessionUser;
    getSession(): Session;
  }
}
