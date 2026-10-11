import { installHttpObservability } from '@/http/request-observability';
import { buildLogger } from '@/lib/logger';
import { FakeConsoleOutput } from '@/lib/logger.fakes';
import { type FastifyBaseLogger, fastify } from 'fastify';
import {
  type ZodTypeProvider,
  serializerCompiler,
  validatorCompiler
} from 'fastify-type-provider-zod';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkRoutes } from './checks';

class FakeReadinessPostgres {
  available = true;
  async execute(_statement: unknown): Promise<unknown[]> {
    if (!this.available) throw new Error('PostgreSQL unavailable');
    return [];
  }
}

class FakeReadinessRedis {
  available = true;
  async ping(): Promise<string> {
    if (!this.available) throw new Error('Redis unavailable');
    return 'PONG';
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe('readiness outage logging', () => {
  it('caps dependency and HTTP repeats while reporting recovery and correct readiness', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const output = new FakeConsoleOutput();
    const { logger } = buildLogger({ consoleOutput: output });
    const postgres = new FakeReadinessPostgres();
    const redis = new FakeReadinessRedis();
    const app = fastify({
      logger: logger as FastifyBaseLogger,
      disableRequestLogging: true
    }).withTypeProvider<ZodTypeProvider>();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.decorate('db', postgres as unknown as typeof app.db);
    app.decorate('redis', redis as unknown as typeof app.redis);
    installHttpObservability(app);
    app.register(checkRoutes);
    try {
      expect((await app.inject('/readyz')).statusCode).toBe(200);
      expect(output.lines).toHaveLength(0);
      postgres.available = redis.available = false;
      for (let index = 0; index < 100; index++)
        expect((await app.inject('/readyz')).statusCode).toBe(503);
      expect(output.lines).toHaveLength(3);
      vi.setSystemTime(Date.now() + 30000);
      expect((await app.inject('/readyz')).statusCode).toBe(503);
      expect(
        output.lines.slice(3).map(line => JSON.parse(line).suppressedCount)
      ).toEqual([99, 99, 99]);
      postgres.available = true;
      expect((await app.inject('/readyz')).statusCode).toBe(503);
      redis.available = true;
      expect((await app.inject('/readyz')).statusCode).toBe(200);
      const recoveries = output.lines
        .map(line => JSON.parse(line))
        .filter(record => record.event === 'health.dependency_recovered');
      expect(recoveries.map(record => record.dependency)).toEqual([
        'postgres',
        'redis'
      ]);
      expect(
        output.lines
          .map(line => JSON.parse(line))
          .some(record => record.event === 'http.health_recovered')
      ).toBe(true);
      const recoveredLogCount = output.lines.length;
      await app.inject('/readyz');
      expect(output.lines).toHaveLength(recoveredLogCount);
      redis.available = false;
      await app.inject('/readyz');
      expect(output.lines.slice(recoveredLogCount)).toHaveLength(2);
    } finally {
      await app.close();
    }
  });
});
