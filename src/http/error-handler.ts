import {
  BadRequestError,
  ForbiddenError,
  InternalServerError,
  NotFoundError,
  UnauthorizedError,
  UnprocessableEntityError
} from '@/errors';
import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';

type Reply = Parameters<FastifyInstance['errorHandler']>[2];

// Each branch returns: without the early return a matched error fell through to
// the trailing 500, sending a second reply. ForbiddenError used to map to 500.
export const fastifyErrorHandler: FastifyInstance['errorHandler'] = (
  error,
  _req,
  res
) => {
  if (error instanceof ZodError) {
    return res.status(400).send({
      message: 'Validation error',
      errors: error.flatten().fieldErrors
    });
  }

  return sendApplicationError(error, res);
};

function sendApplicationError(error: Error, res: Reply) {
  if (error instanceof BadRequestError) return res.badRequest(error.message);
  if (error instanceof UnauthorizedError) return res.unauthorized(error.message);
  if (error instanceof ForbiddenError) return res.forbidden(error.message);
  if (error instanceof NotFoundError) return res.notFound(error.message);
  if (error instanceof UnprocessableEntityError) {
    return res.unprocessableEntity(error.message);
  }
  if (error instanceof InternalServerError) {
    return res.internalServerError(error.message);
  }
  // Fastify's own errors (e.g. schema validation) carry a 4xx statusCode.
  const statusCode = (error as { statusCode?: number }).statusCode;
  if (statusCode && statusCode < 500) {
    return res.status(statusCode).send({ message: error.message });
  }
  return res.internalServerError(error.message);
}
