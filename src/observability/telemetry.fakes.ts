import { context, propagation, trace } from '@opentelemetry/api';
import { type ExportResult, ExportResultCode } from '@opentelemetry/core';
import { NodeSDK } from '@opentelemetry/sdk-node';
import {
  InMemorySpanExporter,
  type ReadableSpan,
  SimpleSpanProcessor,
  type SpanExporter
} from '@opentelemetry/sdk-trace-base';

export class FakeSpanExporter implements SpanExporter {
  readonly spans: ReadableSpan[] = [];
  fail = false;
  closed = false;

  export(
    spans: ReadableSpan[],
    callback: (result: ExportResult) => void
  ): void {
    this.spans.push(...spans);
    callback({
      code: this.fail ? ExportResultCode.FAILED : ExportResultCode.SUCCESS
    });
  }

  async shutdown(): Promise<void> {
    this.closed = true;
  }
}

export class TelemetryTestHarness {
  readonly exporter = new InMemorySpanExporter();
  readonly sdk = new NodeSDK({
    spanProcessors: [new SimpleSpanProcessor(this.exporter)],
    autoDetectResources: false,
    logRecordProcessors: [],
    metricReaders: []
  });

  start(): void {
    this.sdk.start();
  }

  async close(): Promise<void> {
    await this.sdk.shutdown();
    trace.disable();
    context.disable();
    propagation.disable();
  }
}
