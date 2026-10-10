import type { Attributes } from '@opentelemetry/api';
import type { ExportResult } from '@opentelemetry/core';
import { ExportResultCode } from '@opentelemetry/core';
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base';
import { FailureLogWindow } from './failure-log-window';

const PRIVATE_ATTRIBUTES =
  /^(db\.(statement|query\.text|connection_string|user|redis\.)|db\.postgresql\.values|http\.(url|target|request\.header|response\.header)|url\.(full|query)|.*(password|token|cookie|authorization))/i;

function safeAttributes(attributes: Attributes): Attributes {
  return Object.fromEntries(
    Object.entries(attributes).filter(([key]) => !PRIVATE_ATTRIBUTES.test(key))
  );
}

function spanIdentity(
  span: ReadableSpan
): Omit<
  ReadableSpan,
  | 'attributes'
  | 'events'
  | 'links'
  | 'droppedAttributesCount'
  | 'droppedEventsCount'
  | 'droppedLinksCount'
> {
  // SDK spans expose methods/getters on their prototype; object spread loses them.
  return {
    name: span.name,
    kind: span.kind,
    spanContext: () => span.spanContext(),
    parentSpanContext: span.parentSpanContext,
    startTime: span.startTime,
    endTime: span.endTime,
    status: span.status,
    duration: span.duration,
    ended: span.ended,
    resource: span.resource,
    instrumentationScope: span.instrumentationScope
  };
}

function safeSpan(span: ReadableSpan): ReadableSpan {
  return {
    ...spanIdentity(span),
    attributes: safeAttributes(span.attributes),
    events: span.events.map(event => ({
      ...event,
      attributes: safeAttributes(event.attributes ?? {})
    })),
    links: span.links.map(link => ({
      ...link,
      attributes: safeAttributes(link.attributes ?? {})
    })),
    droppedAttributesCount: span.droppedAttributesCount,
    droppedEventsCount: span.droppedEventsCount,
    droppedLinksCount: span.droppedLinksCount
  };
}

/** Strip query text, URLs and credentials before export. Example: new SafeSpanExporter(otlp, onFailure). */
export class SafeSpanExporter implements SpanExporter {
  constructor(
    private readonly exporter: SpanExporter,
    private readonly onFailure: (suppressedCount: number) => void,
    private readonly failures: FailureLogWindow = new FailureLogWindow(Date.now)
  ) {}

  export(
    spans: ReadableSpan[],
    callback: (result: ExportResult) => void
  ): void {
    this.exporter.export(spans.map(safeSpan), result => {
      if (result.code === ExportResultCode.FAILED) {
        const suppressedCount = this.failures.allow('export');
        if (suppressedCount !== null) this.onFailure(suppressedCount);
      } else this.failures.recover('export');
      callback(result);
    });
  }

  async shutdown(): Promise<void> {
    await this.exporter.shutdown();
  }
}
