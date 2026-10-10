import { buildLogger } from '@/lib/logger';
import { FakeConsoleOutput } from '@/lib/logger.fakes';
import { describe, expect, it } from 'vitest';
import { closeServerResources } from './server-lifecycle';
import { FakeServerResources } from './server-lifecycle.fakes';

describe('server shutdown', () => {
  it('drains producers before traces and logs', async () => {
    const resources = new FakeServerResources();
    const { logger } = buildLogger(undefined, true, new FakeConsoleOutput());
    expect(await closeServerResources(resources, logger)).toBe(true);
    expect(resources.closed).toEqual([
      'app',
      'database',
      'redis',
      'telemetry',
      'logs'
    ]);
  });

  it('continues cleanup after failures and reports which resource failed', async () => {
    const resources = new FakeServerResources();
    resources.failStep = 'database';
    const output = new FakeConsoleOutput();
    const { logger } = buildLogger(undefined, true, output);
    expect(await closeServerResources(resources, logger)).toBe(false);
    expect(resources.closed.at(-1)).toBe('logs');
    expect(JSON.parse(output.lines[0])).toMatchObject({
      event: 'server.shutdown_failed',
      step: 'closeDatabase',
      err: { message: 'database failed' }
    });
  });
});
