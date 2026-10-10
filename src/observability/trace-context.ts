import { context, isSpanContextValid, trace } from '@opentelemetry/api';

/** Correlate Pino events using Seq's native fields. Example: mixin: activeTraceFields. */
export function activeTraceFields(): { trace_id?: string; span_id?: string } {
  const spanContext = trace.getSpan(context.active())?.spanContext();
  if (!spanContext || !isSpanContextValid(spanContext)) return {};
  return { trace_id: spanContext.traceId, span_id: spanContext.spanId };
}
