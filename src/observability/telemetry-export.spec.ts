import { context, propagation, trace } from '@opentelemetry/api';
import type { NodeSDK } from '@opentelemetry/sdk-node';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeOtlpReceiver } from './otlp-receiver.fake';
import { type TelemetrySettings, buildTelemetry } from './telemetry';

const settings: TelemetrySettings = {
  disabled: false,
  sampleRatio: 1,
  serviceName: 'caho-backend',
  serviceVersion: 'test',
  environment: 'test'
};
let sdk: NodeSDK | null;
let receiver: FakeOtlpReceiver;
afterEach(async () => {
  await sdk?.shutdown();
  await receiver?.close();
  trace.disable();
  context.disable();
  propagation.disable();
});

describe('OTLP HTTP/protobuf export', () => {
  it('sends a protobuf span batch to Seq with the configured ingest key', async () => {
    receiver = new FakeOtlpReceiver();
    const seqUrl = await receiver.start();
    sdk = buildTelemetry(
      { ...settings, seqUrl, seqApiKey: 'private-seq-key' },
      () => {}
    );
    sdk?.start();
    trace.getTracer('export-test').startSpan('round.test').end();
    await sdk?.shutdown();
    sdk = null;
    expect(receiver.requests).toHaveLength(1);
    expect(receiver.requests[0]).toMatchObject({
      path: '/ingest/otlp/v1/traces',
      headers: {
        'x-seq-apikey': 'private-seq-key',
        'content-type': 'application/x-protobuf'
      }
    });
    expect(receiver.requests[0].byteCount).toBeGreaterThan(0);
  });

  it('does not forward Seq credentials to an explicit collector endpoint', async () => {
    receiver = new FakeOtlpReceiver();
    const collectorUrl = await receiver.start();
    sdk = buildTelemetry(
      {
        ...settings,
        seqUrl: 'https://seq.example.com',
        seqApiKey: 'private-seq-key',
        tracesEndpoint: `${collectorUrl}/v1/traces`
      },
      () => {}
    );
    sdk?.start();
    trace.getTracer('export-test').startSpan('round.test').end();
    await sdk?.shutdown();
    sdk = null;
    expect(receiver.requests[0].path).toBe('/v1/traces');
    expect(receiver.requests[0].headers['x-seq-apikey']).toBeUndefined();
  });

  it('samples out new root traces when the configured ratio is zero', async () => {
    receiver = new FakeOtlpReceiver();
    sdk = buildTelemetry(
      { ...settings, seqUrl: await receiver.start(), sampleRatio: 0 },
      () => {}
    );
    sdk?.start();
    trace.getTracer('export-test').startSpan('round.unsampled').end();
    await sdk?.shutdown();
    sdk = null;
    expect(receiver.requests).toHaveLength(0);
  });
});
