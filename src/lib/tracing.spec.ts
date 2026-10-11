import { SpanStatusCode } from '@opentelemetry/api';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TelemetryTestHarness } from './telemetry.fakes';
import { activeTraceFields, traceBackground, traceOperation } from './tracing';

let harness: TelemetryTestHarness;
beforeEach(() => {
  harness = new TelemetryTestHarness();
  harness.start();
});
afterEach(async () => {
  await harness.close();
});

describe('operation tracing', () => {
  it('preserves parent context across awaits and separates background work', async () => {
    let parentTrace = '';
    await traceOperation('parent', {}, async () => {
      parentTrace = activeTraceFields().trace_id ?? '';
      await Promise.resolve();
      await traceOperation('child', {}, async () => {
        expect(activeTraceFields().trace_id).toBe(parentTrace);
      });
      await traceBackground('background', {}, async () => {
        expect(activeTraceFields().trace_id).not.toBe(parentTrace);
      });
    });
    const spans = harness.exporter.getFinishedSpans();
    expect(spans).toHaveLength(3);
    expect(
      spans.find(span => span.name === 'child')?.parentSpanContext?.traceId
    ).toBe(parentTrace);
    expect(activeTraceFields()).toEqual({});
  });

  it('records exceptions, ends failed spans and rethrows the original error', async () => {
    const failure = new Error('dependency failed');
    await expect(
      traceOperation('failure', {}, async () => {
        throw failure;
      })
    ).rejects.toBe(failure);
    const span = harness.exporter.getFinishedSpans()[0];
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    expect(span.events[0].attributes?.['exception.message']).toBe(
      'dependency failed'
    );
  });
});
