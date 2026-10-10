import {
  BadRequestError,
  ForbiddenError,
  InternalServerError,
  NotFoundError,
  UnauthorizedError,
  UnprocessableEntityError
} from '@/errors';
import { STATUS_CODES } from 'node:http';
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
  const statusCode = statusCodeOf(error);
  const unexpected = statusCode === 500 && !(error instanceof InternalServerError);

  // Unexpected errors may carry driver or library internals; log them, but
  // don't send them to the client.
  if (unexpected) res.log.error(error);

  // Send the `errorSchema` shape explicitly. Routes declare it for their error
  // responses, and a bare `{ message }` fails serialization, replacing the
  // message with "Response doesn't match the schema".
  return res.status(statusCode).send({
    error: STATUS_CODES[statusCode] ?? 'Error',
    statusCode,
    message: unexpected ? 'Internal Server Error' : error.message
  });
}

function statusCodeOf(error: Error): number {
  if (error instanceof BadRequestError) return 400;
  if (error instanceof UnauthorizedError) return 401;
  if (error instanceof ForbiddenError) return 403;
  if (error instanceof NotFoundError) return 404;
  if (error instanceof UnprocessableEntityError) return 422;
  if (error instanceof InternalServerError) return 500;
  // Fastify's own and @fastify/sensible's errors carry their statusCode.
  const statusCode = (error as { statusCode?: number }).statusCode;
  if (statusCode && statusCode >= 400 && statusCode < 500) return statusCode;
  return 500;
}
