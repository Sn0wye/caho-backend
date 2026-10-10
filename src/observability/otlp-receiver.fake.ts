import { type IncomingHttpHeaders, type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

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
