import type { Attributes } from '@opentelemetry/api';
import {
  type ExportResult,
  ExportResultCode,
  W3CTraceContextPropagator
} from '@opentelemetry/core';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK, type NodeSDKConfiguration } from '@opentelemetry/sdk-node';
import {
  BatchSpanProcessor,
  ParentBasedSampler,
  type ReadableSpan,
  type SpanExporter,
  TraceIdRatioBasedSampler
} from '@opentelemetry/sdk-trace-base';
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

export interface TelemetrySettings {
  seqUrl?: string;
  seqApiKey?: string;
  tracesEndpoint?: string;
  disabled: boolean;
  sampleRatio: number;
  serviceName: string;
  serviceVersion: string;
  environment: string;
}

/** Resolve Seq's HTTP/protobuf endpoint. Example: seqTraceEndpoint('http://seq:80'). */
export function seqTraceEndpoint(seqUrl?: string): string | undefined {
  if (!seqUrl) return undefined;
  return `${seqUrl.replace(/\/$/, '')}/ingest/otlp/v1/traces`;
}

function dependencyInstrumentations(
  settings: TelemetrySettings,
  endpoint: string
): NonNullable<NodeSDKConfiguration['instrumentations']> {
  const telemetryOrigins = new Set([new URL(endpoint).origin]);
  if (settings.seqUrl) telemetryOrigins.add(new URL(settings.seqUrl).origin);
  return [
    new PgInstrumentation({
      enhancedDatabaseReporting: false,
      requireParentSpan: true
    }),
    new IORedisInstrumentation({
      requireParentSpan: true,
      dbStatementSerializer: command => command
    }),
    // Seq's Pino transport uses fetch too; never trace telemetry shipping itself.
    new UndiciInstrumentation({
      requireParentforSpans: true,
      ignoreRequestHook: request => telemetryOrigins.has(request.origin)
    })
  ];
}

function seqSpanProcessor(
  settings: TelemetrySettings,
  endpoint: string,
  onFailure: (suppressedCount: number) => void
): BatchSpanProcessor {
  // An override may point at a collector: never forward Seq credentials there.
  const headers =
    !settings.tracesEndpoint && settings.seqApiKey
      ? { 'X-Seq-ApiKey': settings.seqApiKey }
      : undefined;
  const exporter = new SafeSpanExporter(
    new OTLPTraceExporter({ url: endpoint, headers, timeoutMillis: 5000 }),
    onFailure
  );
  return new BatchSpanProcessor(exporter, {
    maxQueueSize: 2048,
    maxExportBatchSize: 512,
    exportTimeoutMillis: 5000
  });
}

/** Build one traces-only SDK before app imports. Example: buildTelemetry(settings, reportExportFailure). */
export function buildTelemetry(
  settings: TelemetrySettings,
  onFailure: (suppressedCount: number) => void
): NodeSDK | null {
  const endpoint = settings.tracesEndpoint ?? seqTraceEndpoint(settings.seqUrl);
  if (settings.disabled || !endpoint) return null;
  return new NodeSDK({
    ...telemetryResource(settings),
    spanProcessors: [seqSpanProcessor(settings, endpoint, onFailure)],
    sampler: new ParentBasedSampler({
      root: new TraceIdRatioBasedSampler(settings.sampleRatio)
    }),
    instrumentations: dependencyInstrumentations(settings, endpoint)
  });
}

function telemetryResource(
  settings: TelemetrySettings
): Partial<NodeSDKConfiguration> {
  return {
    // Process arguments and environment resource detection can capture secrets.
    autoDetectResources: false,
    resource: resourceFromAttributes({
      'service.name': settings.serviceName,
      'service.version': settings.serviceVersion,
      'deployment.environment.name': settings.environment
    }),
    textMapPropagator: new W3CTraceContextPropagator(),
    logRecordProcessors: [],
    metricReaders: []
  };
}
