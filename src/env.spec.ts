import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('optional development Seq settings', () => {
  it('defaults to safe logging and accepts optional telemetry settings', async () => {
    vi.stubEnv('OTEL_EXPORTER_OTLP_TRACES_ENDPOINT', '');
    vi.stubEnv('LOG_LEVEL', 'debug');
    vi.stubEnv('OTEL_TRACES_SAMPLER_ARG', '0.25');
    vi.stubEnv('OTEL_SDK_DISABLED', 'true');
    vi.resetModules();
    const { env } = await import('./env');
    expect(env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT).toBeUndefined();
    expect(env.OTEL_TRACES_SAMPLER_ARG).toBe(0.25);
    expect(env.OTEL_SDK_DISABLED).toBe('true');
    expect(env.LOG_LEVEL).toBe('debug');
    expect(env.OTEL_SERVICE_NAME).toBe('caho-backend');
  });
  it.each([undefined, ''])(
    'starts without Seq when settings are %s',
    async setting => {
      vi.stubEnv('NODE_ENV', 'development');
      vi.stubEnv('SEQ_URL', setting ?? '');
      vi.stubEnv('SEQ_API_KEY', setting ?? '');
      if (setting === undefined) {
        // biome-ignore lint/performance/noDelete: Node converts undefined assignments to a literal string.
        delete process.env.SEQ_URL;
        // biome-ignore lint/performance/noDelete: Exercise an absent variable, not the string undefined.
        delete process.env.SEQ_API_KEY;
      }
      vi.resetModules();
      const { env } = await import('./env');
      expect(env.SEQ_URL).toBeUndefined();
      expect(env.SEQ_API_KEY).toBeUndefined();
    }
  );

  it('preserves explicit Seq settings when dev opts in', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('SEQ_URL', 'http://localhost:5341');
    vi.stubEnv('SEQ_API_KEY', 'dev-key');
    vi.resetModules();
    const { env } = await import('./env');
    expect(env.SEQ_URL).toBe('http://localhost:5341');
    expect(env.SEQ_API_KEY).toBe('dev-key');
  });
});
