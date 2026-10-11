import { type IncomingHttpHeaders, type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
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

export class FakeOtlpReceiver {
  readonly requests: Array<{
    path?: string;
    headers: IncomingHttpHeaders;
    byteCount: number;
  }> = [];
  private readonly server: Server = createServer((request, response) => {
    let byteCount = 0;
    request.on('data', (chunk: Buffer) => {
      byteCount += chunk.length;
    });
    request.on('end', () => {
      this.requests.push({
        path: request.url,
        headers: request.headers,
        byteCount
      });
      response.writeHead(200, { 'content-type': 'application/x-protobuf' });
      response.end();
    });
  });

  async start(): Promise<string> {
    await new Promise<void>(resolve =>
      this.server.listen(0, '127.0.0.1', resolve)
    );
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve, reject) =>
      this.server.close(error => (error ? reject(error) : resolve()))
    );
  }
}
