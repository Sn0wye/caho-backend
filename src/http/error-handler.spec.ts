import { fastifySensible } from '@fastify/sensible';
import { fastify } from 'fastify';
import {
  type ZodTypeProvider,
  serializerCompiler,
  validatorCompiler
} from 'fastify-type-provider-zod';
import { describe, expect, it } from 'vitest';
import { UnauthorizedError } from '@/errors';
import { errorSchema } from '@/schemas/error';
import { fastifyErrorHandler } from './error-handler';

async function buildApp() {
  const app = fastify().withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(fastifyErrorHandler);
  await app.register(fastifySensible);

  const schema = { response: { 401: errorSchema } };

  app.post('/reply-helper', { schema }, async (_req, res) =>
    res.unauthorized('Usuário ou senha inválidos')
  );
  app.post('/thrown', { schema }, async () => {
    throw new UnauthorizedError('Já existe um usuário com esse nome.');
  });

  return app;
}

describe('fastifyErrorHandler', () => {
  it.each([
    ['/reply-helper', 'Usuário ou senha inválidos'],
    ['/thrown', 'Já existe um usuário com esse nome.']
  ])('keeps the message of %s within the error schema', async (url, message) => {
    const app = await buildApp();

    const res = await app.inject({ method: 'POST', url });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({
      error: 'Unauthorized',
      statusCode: 401,
      message
    });
  });
});
