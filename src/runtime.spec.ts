import { buildLogger } from '@/lib/logger';
import { FakeConsoleOutput } from '@/lib/logger.fakes';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { closeServerResources, runServer } from './runtime';
import { FakeServerProcess, FakeServerResources } from './runtime.fakes';

function buildRuntime(listen: () => Promise<string>) {
  const output = new FakeConsoleOutput();
  const { logger } = buildLogger({ consoleOutput: output });
  const resources = new FakeServerResources();
  const process = new FakeServerProcess();
  const runtime = { listen, resources, log: logger, process };
  return { runtime, resources, process, output };
}

const listening = () => Promise.resolve('http://0.0.0.0:8080');
const events = (output: FakeConsoleOutput) =>
  output.lines.map(line => JSON.parse(line).event);

afterEach(() => {
  vi.useRealTimers();
});

describe('server shutdown', () => {
  it('drains producers before traces and logs', async () => {
    const resources = new FakeServerResources();
    const { logger } = buildLogger({ consoleOutput: new FakeConsoleOutput() });
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
    const { logger } = buildLogger({ consoleOutput: output });
    expect(await closeServerResources(resources, logger)).toBe(false);
    expect(resources.closed.at(-1)).toBe('logs');
    expect(JSON.parse(output.lines[0])).toMatchObject({
      event: 'server.shutdown_failed',
      step: 'closeDatabase',
      err: { message: 'database failed' }
    });
  });
});

describe('runServer', () => {
  it('releases resources and sets a failing exit code when listen fails', async () => {
    const { runtime, resources, process, output } = buildRuntime(() =>
      Promise.reject(new Error('EADDRINUSE'))
    );
    await runServer(runtime);
    expect(resources.closed).toHaveLength(5);
    expect(process.exitCode).toBe(1);
    expect(process.exits).toEqual([]);
    expect(events(output)).toContain('server.startup_failed');
  });

  it('drains once on a signal and exits cleanly, ignoring repeats', async () => {
    const { runtime, resources, process, output } = buildRuntime(listening);
    await runServer(runtime);
    process.signal('SIGTERM');
    process.signal('SIGINT');
    await vi.waitFor(() => expect(process.exits).toEqual([0]));
    expect(resources.closed).toHaveLength(5);
    expect(events(output)).toEqual(['server.started', 'server.stopping']);
  });

  it('exits with failure when a resource fails to close', async () => {
    const { runtime, resources, process } = buildRuntime(listening);
    resources.failStep = 'redis';
    await runServer(runtime);
    process.signal('SIGTERM');
    await vi.waitFor(() => expect(process.exits).toEqual([1]));
  });

  it('forces exit when shutdown outlives the deadline', async () => {
    vi.useFakeTimers();
    const { runtime, resources, process } = buildRuntime(listening);
    resources.hangStep = 'database';
    await runServer({ ...runtime, shutdownDeadlineMs: 50 });
    process.signal('SIGTERM');
    await vi.advanceTimersByTimeAsync(49);
    expect(process.exits).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(process.exits).toEqual([1]);
  });

  it('logs an uncaught exception, drains and exits with failure', async () => {
    const { runtime, resources, process, output } = buildRuntime(listening);
    await runServer(runtime);
    process.crash('uncaughtException', new Error('boom'));
    await vi.waitFor(() => expect(process.exits).toEqual([1]));
    expect(resources.closed).toHaveLength(5);
    expect(JSON.parse(output.lines[1])).toMatchObject({
      level: 60,
      event: 'process.uncaught_exception',
      err: { message: 'boom' }
    });
  });

  it('wraps a non-Error rejection reason and drains once on repeats', async () => {
    const { runtime, resources, process, output } = buildRuntime(listening);
    await runServer(runtime);
    process.crash('unhandledRejection', 'nope');
    process.crash('unhandledRejection', 'again');
    await vi.waitFor(() => expect(process.exits).toEqual([1]));
    expect(resources.closed).toHaveLength(5);
    expect(JSON.parse(output.lines[1])).toMatchObject({
      event: 'process.unhandled_rejection',
      err: { message: 'Non-Error crash reason: nope' }
    });
  });

  it('exits with failure after a crash even when cleanup succeeds', async () => {
    const { runtime, process } = buildRuntime(listening);
    await runServer(runtime);
    process.crash('uncaughtException', new Error('boom'));
    process.signal('SIGTERM');
    await vi.waitFor(() => expect(process.exits).toEqual([1]));
  });
});
