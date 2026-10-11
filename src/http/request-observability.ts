import type { App } from '@/app';
import { FailureLogWindow } from '@/lib/failure-log-window';
import {
  type Context,
  ROOT_CONTEXT,
  type Span,
  SpanKind,
  SpanStatusCode,
  context,
  propagation,
  trace
} from '@opentelemetry/api';
import type { FastifyReply, FastifyRequest } from 'fastify';

const requestSpans = new WeakMap<FastifyRequest, Span>();
const requestStartTimes = new WeakMap<FastifyRequest, number>();
const completedRequests = new WeakSet<FastifyRequest>();
const HEALTH_ROUTES = new Set(['/ping', '/readyz']);

function requestRoute(request: FastifyRequest): string {
  // Route templates avoid OAuth codes, query strings and attacker-controlled paths.
  return request.routeOptions.url ?? 'unmatched';
}

interface RequestCompletionFields {
  event: string;
  method: string;
  route: string;
  statusCode: number;
  durationMs: number;
  roomCode?: string;
  suppressedCount?: number;
}

function requestRoomCode(request: FastifyRequest): string | undefined {
  const roomCode = (request.params as { roomCode?: string })?.roomCode;
  return typeof roomCode === 'string' && /^[A-Z0-9]{6}$/.test(roomCode)
    ? roomCode
    : undefined;
}

function requestCompletionFields(
  request: FastifyRequest,
  statusCode: number,
  durationMs: number
): RequestCompletionFields {
  return {
    event: 'http.request_completed',
    method: request.method,
    route: requestRoute(request),
    statusCode,
    durationMs,
    roomCode: requestRoomCode(request)
  };
}

function writeRequestSummary(
  request: FastifyRequest,
  statusCode: number,
  durationMs: number,
  failures?: FailureLogWindow
): void {
  const suppressedCount = healthSummaryDue(request, statusCode, failures);
  if (suppressedCount === null) return;
  const fields = requestCompletionFields(request, statusCode, durationMs);
  if (HEALTH_ROUTES.has(fields.route)) fields.suppressedCount = suppressedCount;
  if (statusCode >= 500) request.log.error(fields, 'HTTP request failed');
  else if (statusCode >= 400) request.log.warn(fields, 'HTTP request rejected');
  else if (!HEALTH_ROUTES.has(requestRoute(request)))
    request.log.info(fields, 'HTTP request completed');
}

function healthSummaryDue(
  request: FastifyRequest,
  statusCode: number,
  failures?: FailureLogWindow
): number | null {
  const route = requestRoute(request);
  if (!HEALTH_ROUTES.has(route)) return 0;
  if (statusCode >= 400) return failures ? failures.allow(route) : 0;
  const suppressedCount = failures?.recover(route);
  if (suppressedCount !== null && suppressedCount !== undefined)
    request.log.info(
      { event: 'http.health_recovered', route, suppressedCount },
      'Health endpoint recovered'
    );
  return null;
}

// A null status means the client aborted before any response was sent.
function endRequestSpan(
  request: FastifyRequest,
  statusCode: number | null
): void {
  const span = requestSpans.get(request);
  if (!span) return;
  if (statusCode !== null)
    span.setAttribute('http.response.status_code', statusCode);
  if (statusCode === null || statusCode >= 500)
    span.setStatus({ code: SpanStatusCode.ERROR });
  span.end();
  requestSpans.delete(request);
  requestStartTimes.delete(request);
}

function completeRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  failures: FailureLogWindow
): void {
  if (completedRequests.has(request)) return;
  completedRequests.add(request);
  writeRequestSummary(request, reply.statusCode, reply.elapsedTime, failures);
  endRequestSpan(request, reply.statusCode);
}

function beginRequest(request: FastifyRequest): Context {
  const route = requestRoute(request);
  const parent = propagation.extract(ROOT_CONTEXT, request.headers);
  const span = trace.getTracer('caho.http').startSpan(
    `${request.method} ${route}`,
    {
      kind: SpanKind.SERVER,
      attributes: { 'http.request.method': request.method, 'http.route': route }
    },
    parent
  );
  requestSpans.set(request, span);
  requestStartTimes.set(request, performance.now());
  return trace.setSpan(parent, span);
}

/** Install one request event and one server span per request. Example: installHttpObservability(app). */
export function installHttpObservability(app: Pick<App, 'addHook'>): void {
  app.addHook('onRequest', (request, reply, done) => {
    if (HEALTH_ROUTES.has(requestRoute(request))) return done();
    const requestContext = beginRequest(request);
    reply.header('x-request-id', request.id);
    context.with(requestContext, done);
  });
  installRequestCompletion(app, new FailureLogWindow(Date.now));
}

/** End the HTTP span when Fastify hijacks a WS upgrade. Example: completeSocketUpgrade(request). */
export function completeSocketUpgrade(request: FastifyRequest): void {
  if (!requestSpans.has(request)) return;
  completedRequests.add(request);
  const durationMs =
    performance.now() - (requestStartTimes.get(request) ?? performance.now());
  writeRequestSummary(request, 101, durationMs);
  endRequestSpan(request, 101);
}

function installRequestCompletion(
  app: Pick<App, 'addHook'>,
  failures: FailureLogWindow
): void {
  app.addHook('onResponse', async (request, reply) =>
    completeRequest(request, reply, failures)
  );
  app.addHook('onRequestAbort', async request => {
    request.log.warn(
      { event: 'http.request_aborted', route: requestRoute(request) },
      'HTTP request aborted'
    );
    endRequestSpan(request, null);
  });
}

/** Attach an exception to the owning request span. Example: recordRequestFailure(request, error). */
export function recordRequestFailure(
  request: FastifyRequest,
  error: Error
): void {
  const span = requestSpans.get(request);
  span?.setStatus({ code: SpanStatusCode.ERROR });
  span?.recordException(error);
}
