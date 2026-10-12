import { FailureLogWindow } from '@/lib/failure-log-window';
import { type SQL, sql } from 'drizzle-orm';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { z } from 'zod';

// The two dependencies readiness pings, passed in so a spec can fake them.
export type ReadinessProbes = {
  postgres: { execute(query: SQL): Promise<unknown> };
  redis: { ping(): Promise<string> };
};

export const checkRoutes = async (
  app: FastifyInstance,
  { probes }: { probes: ReadinessProbes }
) => {
  const failures = new FailureLogWindow(Date.now);
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
        await probes.postgres.execute(sql`SELECT 1`);
        readinessRecovered(req.log, 'postgres', failures);
      } catch (err) {
        readinessFailure(req.log, 'postgres', err, failures);
        healthStatus.db = false;
      }
      try {
        await probes.redis.ping();
        readinessRecovered(req.log, 'redis', failures);
      } catch (err) {
        readinessFailure(req.log, 'redis', err, failures);
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

function readinessFailure(
  log: FastifyBaseLogger,
  dependency: string,
  err: unknown,
  failures: FailureLogWindow
): void {
  const suppressedCount = failures.allow(dependency);
  if (suppressedCount === null) return;
  log.error(
    { event: 'health.dependency_failed', dependency, err, suppressedCount },
    'Readiness dependency failed'
  );
}

function readinessRecovered(
  log: FastifyBaseLogger,
  dependency: string,
  failures: FailureLogWindow
): void {
  const suppressedCount = failures.recover(dependency);
  if (suppressedCount === null) return;
  log.info(
    { event: 'health.dependency_recovered', dependency, suppressedCount },
    'Readiness dependency recovered'
  );
}
