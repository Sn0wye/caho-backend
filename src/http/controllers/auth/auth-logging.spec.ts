import { UnauthorizedError } from '@/errors';
import { fastifyErrorHandler } from '@/http/error-handler';
import { buildLogger } from '@/lib/logger';
import { FakeConsoleOutput } from '@/lib/logger.fakes';
import { fastifyCookie } from '@fastify/cookie';
import { fastifySensible } from '@fastify/sensible';
import { type FastifyBaseLogger, fastify } from 'fastify';
import {
  type ZodTypeProvider,
  serializerCompiler,
  validatorCompiler
} from 'fastify-type-provider-zod';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeAuthLogService } from './auth-logging.fakes';
import { signInController } from './sign-in';
import { signOutController } from './sign-out';

vi.mock('@/services/auth/AuthServiceFactory', async () => {
  const { fakeAuthLogService } = await import('./auth-logging.fakes');
  return { AuthServiceFactory: () => fakeAuthLogService };
});
afterEach(() => {
  fakeAuthLogService.signInError = undefined;
  fakeAuthLogService.signOutError = undefined;
});

function buildAuthHarness(authenticated = true) {
  const output = new FakeConsoleOutput();
  const { logger } = buildLogger(undefined, true, output);
  const app = fastify({
    logger: logger as FastifyBaseLogger,
    disableRequestLogging: true
  }).withTypeProvider<ZodTypeProvider>();
  app.setSerializerCompiler(serializerCompiler);
  app.setValidatorCompiler(validatorCompiler);
  app.setErrorHandler(fastifyErrorHandler);
  app.register(fastifySensible);
  app.register(fastifyCookie);
  app.addHook('preHandler', async request => {
    request.getSession = () => {
      if (!authenticated) throw new UnauthorizedError();
      return {
        id: 'private-session',
        userId: 'user-1',
        expiresAt: new Date(),
        fresh: false
      };
    };
  });
  app.register(signInController);
  app.register(signOutController);
  return { app, output };
}

describe('auth failure logging', () => {
  it('preserves 401 for wrong credentials while surfacing dependency failures as 500', async () => {
    const { app, output } = buildAuthHarness();
    fakeAuthLogService.signInError = new UnauthorizedError(
      'invalid credentials'
    );
    const rejected = await app.inject({
      method: 'POST',
      url: '/sign-in',
      payload: { username: 'user', password: 'private-password' }
    });
    expect(rejected.statusCode).toBe(401);
    fakeAuthLogService.signInError = new Error('DB unavailable');
    const failed = await app.inject({
      method: 'POST',
      url: '/sign-in',
      payload: { username: 'user', password: 'private-password' }
    });
    expect(failed.statusCode).toBe(500);
    expect(output.lines.map(line => JSON.parse(line).event)).toEqual([
      'auth.sign_in_rejected',
      'http.exception'
    ]);
    expect(output.lines.join('')).not.toContain('private-password');
    await app.close();
  });

  it('keeps anonymous sign-out idempotent while surfacing failed session deletion', async () => {
    const anonymous = buildAuthHarness(false);
    expect(
      (await anonymous.app.inject({ method: 'POST', url: '/sign-out' }))
        .statusCode
    ).toBe(204);
    await anonymous.app.close();
    const { app, output } = buildAuthHarness();
    fakeAuthLogService.signOutError = new Error('session deletion failed');
    expect(
      (await app.inject({ method: 'POST', url: '/sign-out' })).statusCode
    ).toBe(500);
    expect(JSON.parse(output.lines[0])).toMatchObject({
      event: 'http.exception',
      err: { message: 'session deletion failed' }
    });
    expect(output.lines.join('')).not.toContain('private-session');
    await app.close();
  });

  it('records user IDs on successful sign-in and sign-out without session tokens', async () => {
    const { app, output } = buildAuthHarness();
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/sign-in',
          payload: { username: 'user', password: 'private-password' }
        })
      ).statusCode
    ).toBe(200);
    expect(
      (await app.inject({ method: 'POST', url: '/sign-out' })).statusCode
    ).toBe(204);
    expect(output.lines.map(line => JSON.parse(line).event)).toEqual([
      'auth.signed_in',
      'auth.signed_out'
    ]);
    expect(output.lines.join('')).not.toMatch(/private-/);
    await app.close();
  });
});
