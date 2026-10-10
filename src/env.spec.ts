import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('optional development Seq settings', () => {
  it.each([undefined, ''])(
    'starts without Seq when settings are %s',
    async setting => {
      vi.stubEnv('NODE_ENV', 'development');
      vi.stubEnv('SEQ_URL', setting ?? '');
      vi.stubEnv('SEQ_API_KEY', setting ?? '');
      if (setting === undefined) {
        delete process.env.SEQ_URL;
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
