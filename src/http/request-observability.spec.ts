import { ForbiddenError, InternalServerError } from '@/errors';
import { fastifyErrorHandler } from '@/http/error-handler';
import { buildLogger } from '@/lib/logger';
import { FakeConsoleOutput } from '@/lib/logger.fakes';
import { TelemetryTestHarness } from '@/lib/telemetry.fakes';
import { fastifySensible } from '@fastify/sensible';
import { fastifyWebsocket } from '@fastify/websocket';
import { SpanStatusCode } from '@opentelemetry/api';
import { type FastifyBaseLogger, fastify } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { ZodError } from 'zod';
import {
  completeSocketUpgrade,
  installHttpObservability
} from './request-observability';

let harness: TelemetryTestHarness;
beforeEach(() => {
  harness = new TelemetryTestHarness();
  harness.start();
});
afterEach(async () => {
  await harness.close();
});

function buildHttpHarness() {
  const output = new FakeConsoleOutput();
  const { logger } = buildLogger({ consoleOutput: output });
  const app = fastify({
    logger: logger as FastifyBaseLogger,
    disableRequestLogging: true,
    requestIdHeader: false
  }).withTypeProvider<ZodTypeProvider>();
  installHttpObservability(app);
  app.register(fastifySensible);
  app.setErrorHandler(fastifyErrorHandler);
  return { app, output };
}

describe('HTTP observability', () => {
  it('keeps the matched endpoint when a handler delegates to not found', async () => {
    const { app, output } = buildHttpHarness();
    app.get('/auth/callback/:provider', async (_request, reply) =>
      reply.callNotFound()
    );
    const response = await app.inject(
      '/auth/callback/google?code=private-code'
    );
    await app.close();
    expect(response.statusCode).toBe(404);
    expect(
      output.lines
        .map(line => JSON.parse(line))
        .find(record => record.event === 'http.request_completed')
    ).toMatchObject({ route: '/auth/callback/:provider', statusCode: 404 });
    expect(output.lines.join('')).not.toContain('private-code');
  });

  it('identifies unknown endpoints without logging query secrets', async () => {
    const { app, output } = buildHttpHarness();
    const response = await app.inject('/missing-endpoint?code=private-code');
    await app.close();
    expect(response.statusCode).toBe(404);
    expect(
      output.lines
        .map(line => JSON.parse(line))
        .find(record => record.event === 'http.request_completed')
    ).toMatchObject({
      route: 'unmatched',
      requestPath: '/missing-endpoint',
      statusCode: 404
    });
    expect(output.lines.join('')).not.toContain('private-code');
    const span = harness.exporter.getFinishedSpans()[0];
    expect(span.name).toBe('GET /missing-endpoint');
    expect(span.attributes).toMatchObject({
      'http.route': 'unmatched',
      'url.path': '/missing-endpoint',
      'http.response.status_code': 404
    });
    expect(JSON.stringify(span.attributes)).not.toContain('private-code');
  });

  it('bounds unknown endpoint paths in request logs', async () => {
    const { app, output } = buildHttpHarness();
    await app.inject(`/${'x'.repeat(4096)}?token=private-token`);
    await app.close();
    const summary = output.lines
      .map(line => JSON.parse(line))
      .find(record => record.event === 'http.request_completed');
    expect(summary.requestPath).toBe(`/${'x'.repeat(2047)}`);
    expect(output.lines.join('')).not.toContain('private-token');
    expect(harness.exporter.getFinishedSpans()[0].name).toBe(
      `GET /${'x'.repeat(2047)}`
    );
  });

  it('ends the server span for hijacked WebSocket handshakes', async () => {
    const { app, output } = buildHttpHarness();
    await app.register(fastifyWebsocket);
    app.get('/socket', { websocket: true }, (connection, request) => {
      completeSocketUpgrade(request);
      connection.socket.close(1000);
    });
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const socket = new WebSocket(`${address.replace('http:', 'ws:')}/socket`);
    await new Promise<void>((resolve, reject) => {
      socket.once('close', () => resolve());
      socket.once('error', reject);
    });
    await app.close();
    expect(
      harness.exporter
        .getFinishedSpans()
        .find(span => span.name === 'GET /socket')?.attributes[
        'http.response.status_code'
      ]
    ).toBe(101);
    expect(
      output.lines
        .map(line => JSON.parse(line))
        .filter(record => record.event === 'http.request_completed')
    ).toHaveLength(1);
  });
  it('correlates concurrent async requests with remote W3C context and safe routes', async () => {
    const { app, output } = buildHttpHarness();
    app.get('/auth/callback/:provider', async request => {
      await Promise.resolve();
      request.log.info({ event: 'inside.request' }, 'Request work');
      return { ok: true };
    });
    const traceId = '0123456789abcdef0123456789abcdef';
    const responses = await Promise.all([
      app.inject({
        url: '/auth/callback/google?code=private-code',
        headers: {
          traceparent: `00-${traceId}-0123456789abcdef-01`,
          cookie: 'private-cookie',
          authorization: 'Bearer private-token',
          'x-request-id': 'untrusted'
        }
      }),
      app.inject('/auth/callback/github')
    ]);
    await app.close();
    const spans = harness.exporter.getFinishedSpans();
    expect(spans).toHaveLength(2);
    expect(spans.some(span => span.spanContext().traceId === traceId)).toBe(
      true
    );
    expect(
      spans.every(span => span.name === 'GET /auth/callback/:provider')
    ).toBe(true);
    const records = output.lines.map(line => JSON.parse(line));
    expect(
      records.filter(record => record.event === 'http.request_completed')
    ).toHaveLength(2);
    expect(
      records
        .filter(record => record.event === 'http.request_completed')
        .every(
          record =>
            record.route === '/auth/callback/:provider' && !record.requestPath
        )
    ).toBe(true);
    const work = records.filter(record => record.event === 'inside.request');
    expect(new Set(work.map(record => record.trace_id)).size).toBe(2);
    expect(work.some(record => record.trace_id === traceId)).toBe(true);
    expect(
      records
        .filter(record => record.event === 'http.request_completed')
        .every(record => record.span_id)
    ).toBe(true);
    expect(responses[0].headers['x-request-id']).not.toBe('untrusted');
    expect(output.lines.join('')).not.toMatch(
      /private-code|private-cookie|private-token|untrusted/
    );
  });

  it('suppresses successful health checks but records failure and exception stacks', async () => {
    const { app, output } = buildHttpHarness();
    app.get('/ping', async () => 'ok');
    app.get('/readyz', async (_request, reply) =>
      reply.code(503).send({ ready: false })
    );
    app.get('/failure', async () => {
      throw new InternalServerError('operation failed', {
        cause: new Error('DB down')
      });
    });
    app.get('/forbidden', async () => {
      throw new ForbiddenError('rejected');
    });
    app.get('/invalid', async () => {
      throw new ZodError([]);
    });
    await app.inject('/ping');
    expect(output.lines).toHaveLength(0);
    await app.inject('/readyz');
    await app.inject('/failure');
    await app.inject('/forbidden');
    await app.inject('/invalid');
    await app.close();
    const records = output.lines.map(line => JSON.parse(line));
    expect(
      records.filter(record => record.event === 'http.exception')
    ).toHaveLength(1);
    expect(
      records.find(record => record.event === 'http.exception')?.err.stack
    ).toContain('DB down');
    expect(records.find(record => record.route === '/readyz')?.statusCode).toBe(
      503
    );
    const failureSpan = harness.exporter
      .getFinishedSpans()
      .find(span => span.name === 'GET /failure');
    expect(failureSpan?.status.code).toBe(SpanStatusCode.ERROR);
    expect(failureSpan?.events).toHaveLength(1);
    expect(
      harness.exporter
        .getFinishedSpans()
        .find(span => span.name === 'GET /forbidden')?.status.code
    ).toBe(SpanStatusCode.UNSET);
  });
});
