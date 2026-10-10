import {
  type Attributes,
  type Context,
  ROOT_CONTEXT,
  SpanStatusCode,
  context,
  trace
} from '@opentelemetry/api';

/** Trace one bounded async operation, preserving its caller. Example: traceOperation('round.expiry', {}, work). */
export async function traceOperation<Result>(
  name: string,
  attributes: Attributes,
  work: () => Promise<Result>,
  parent: Context = context.active()
): Promise<Result> {
  return trace
    .getTracer('caho.operations')
    .startActiveSpan(name, { attributes }, parent, async span => {
      try {
        return await work();
      } catch (err) {
        span.setStatus({ code: SpanStatusCode.ERROR });
        if (err instanceof Error) span.recordException(err);
        throw err;
      } finally {
        span.end();
      }
    });
}

/** Start a background task independently of an ended request. Example: traceBackground('round.reconcile', {}, work). */
export function traceBackground<Result>(
  name: string,
  attributes: Attributes,
  work: () => Promise<Result>
): Promise<Result> {
  return traceOperation(name, attributes, work, ROOT_CONTEXT);
}
