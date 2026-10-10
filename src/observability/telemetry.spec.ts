import { trace } from '@opentelemetry/api';
import { afterEach, describe, expect, it } from 'vitest';
import { FailureLogWindow } from './failure-log-window';
import { SafeSpanExporter } from './safe-span-exporter';
import {
  type TelemetrySettings,
  buildTelemetry,
  seqTraceEndpoint
} from './telemetry';
import { FakeSpanExporter, TelemetryTestHarness } from './telemetry.fakes';

const settings: TelemetrySettings = {
  disabled: false,
  sampleRatio: 1,
  serviceName: 'caho-backend',
  serviceVersion: 'test',
  environment: 'test'
};
let harness: TelemetryTestHarness | undefined;
afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

describe('Seq telemetry configuration', () => {
  it('uses the base URL without duplicating a trailing slash', () => {
    expect(seqTraceEndpoint('https://seq.example.com/')).toBe(
      'https://seq.example.com/ingest/otlp/v1/traces'
    );
    expect(seqTraceEndpoint('https://seq.example.com/seq')).toBe(
      'https://seq.example.com/seq/ingest/otlp/v1/traces'
    );
    expect(seqTraceEndpoint()).toBeUndefined();
  });

  it('requires an endpoint and respects explicit disabling', () => {
    expect(buildTelemetry(settings, () => {})).toBeNull();
    expect(
      buildTelemetry(
        { ...settings, seqUrl: 'https://seq.example.com', disabled: true },
        () => {}
      )
    ).toBeNull();
    expect(
      buildTelemetry(
        { ...settings, seqUrl: 'https://seq.example.com' },
        () => {}
      )
    ).not.toBeNull();
    expect(
      buildTelemetry(
        { ...settings, tracesEndpoint: 'http://collector:4318/v1/traces' },
        () => {}
      )
    ).not.toBeNull();
  });
});

describe('safe trace export', () => {
  it('exports real SDK spans without query text, credentials or headers', async () => {
    harness = new TelemetryTestHarness();
    harness.start();
    const span = trace.getTracer('test').startSpan('pg.query:select', {
      attributes: {
        'db.statement': 'select secret',
        'db.query.text': 'select private',
        'db.postgresql.values': ['password'],
        'url.full': 'https://host/?code=secret',
        'http.request.header.authorization': 'Bearer secret',
        'db.system': 'postgresql',
        roomCode: 'ABC123'
      }
    });
    span.addEvent('metadata', { password: 'secret', safe: true });
    span.end();
    const fake = new FakeSpanExporter();
    const exporter = new SafeSpanExporter(fake, () => {});
    exporter.export(harness.exporter.getFinishedSpans(), () => {});
    const exported = fake.spans[0];
    expect(exported.spanContext()).toEqual(span.spanContext());
    expect(exported.ended).toBe(true);
    expect(exported.duration[0]).toBeGreaterThanOrEqual(0);
    expect(exported.attributes).toEqual({
      'db.system': 'postgresql',
      roomCode: 'ABC123'
    });
    expect(exported.events[0].attributes).toEqual({ safe: true });
    await exporter.shutdown();
    expect(fake.closed).toBe(true);
  });

  it('reports exporter failures while preserving the result callback', () => {
    const fake = new FakeSpanExporter();
    fake.fail = true;
    let failures = 0;
    let resultCode = -1;
    const exporter = new SafeSpanExporter(fake, () => {
      failures++;
    });
    exporter.export([], result => {
      resultCode = result.code;
    });
    expect(failures).toBe(1);
    expect(resultCode).toBe(1);
  });

  it('bounds failure reports while completing every batch and resets after success', () => {
    const fake = new FakeSpanExporter();
    const reports: number[] = [];
    let timestamp = 0;
    let callbacks = 0;
    const exporter = new SafeSpanExporter(
      fake,
      count => reports.push(count),
      new FailureLogWindow(() => timestamp)
    );
    fake.fail = true;
    for (let index = 0; index < 100; index++)
      exporter.export([], () => callbacks++);
    expect(reports).toEqual([0]);
    expect(callbacks).toBe(100);
    timestamp = 30000;
    exporter.export([], () => callbacks++);
    expect(reports).toEqual([0, 99]);
    fake.fail = false;
    exporter.export([], () => callbacks++);
    fake.fail = true;
    exporter.export([], () => callbacks++);
    expect(reports).toEqual([0, 99, 0]);
    expect(callbacks).toBe(103);
  });
});
