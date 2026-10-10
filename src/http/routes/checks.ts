import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

export const checkRoutes = async (app: FastifyInstance) => {
  app.get(
    '/readyz',
    {
      schema: {
        tags: ['Health'],
        description: 'Check if server, database and redis are ready',
        response: {
          200: z.object({
            message: z.literal('ok'),
            services: z.object({
              http: z.boolean(),
              db: z.boolean(),
              redis: z.boolean()
            })
          }),
          503: z.object({
            message: z.string(),
            services: z.object({
              http: z.boolean(),
              db: z.boolean(),
              redis: z.boolean()
            })
          })
        }
      }
    },
    async (req, res) => {
      const healthStatus = {
        http: true,
        db: true,
        redis: true
      };

      try {
        await app.db.execute(sql`SELECT 1`);
      } catch (err) {
        req.log.error(
          { event: 'health.dependency_failed', dependency: 'postgres', err },
          'Readiness dependency failed'
        );
        healthStatus.db = false;
      }
      try {
        await app.redis.ping();
      } catch (err) {
        req.log.error(
          { event: 'health.dependency_failed', dependency: 'redis', err },
          'Readiness dependency failed'
        );
        healthStatus.redis = false;
      }
      const ready = healthStatus.db && healthStatus.redis;
      return res.status(ready ? 200 : 503).send({
        message: ready ? 'ok' : 'Service Unavailable',
        services: healthStatus
      });
    }
  );
};
