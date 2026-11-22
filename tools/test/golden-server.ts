import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { GoldenCapture } from '@bluelytics/contract';
import { goldenBody, goldenHeaders, goldenManifest } from '@bluelytics/contract/golden';

/** Headers the capture got from Cloudflare's edge, not from the legacy API. */
const EDGE_HEADERS = new Set(['date', 'content-length', 'cf-cache-status', 'cf-ray', 'report-to', 'nel', 'server', 'alt-svc', 'age']);

export interface Served {
  status: number;
  headers: [string, string][];
  body: Uint8Array;
}

/** Lets a test change what one capture answers (another value, another header…). */
export type Override = (capture: GoldenCapture, served: Served) => Served;

export interface GoldenServer {
  url: string;
  /** Every request seen, as `METHOD path?query`. */
  requests: string[];
  close(): Promise<void>;
}

function served(capture: GoldenCapture): Served {
  const { status, headers } = goldenHeaders(capture.name);
  return { status, headers: headers.filter(([name]) => !EDGE_HEADERS.has(name)), body: goldenBody(capture.name) };
}

function findCapture(req: IncomingMessage): GoldenCapture | undefined {
  const url = new URL(req.url ?? '/', 'http://localhost');
  url.searchParams.delete('ts');
  const query = url.searchParams.size === 0 ? null : url.searchParams.toString();
  const origin = req.headers.origin;
  const matches = goldenManifest().filter((capture) => capture.method === req.method && capture.path === url.pathname && capture.query === query);
  return matches.find((capture) => capture.requestHeaders['Origin'] === origin) ?? matches[0];
}

/** Replays the legacy captures of `packages/contract/golden/` over HTTP on 127.0.0.1. */
export async function startGoldenServer(override: Override = (_capture, response) => response): Promise<GoldenServer> {
  const requests: string[] = [];
  const server = createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`);
    const capture = findCapture(req);
    if (capture === undefined) {
      res.writeHead(404, { 'content-type': 'application/json; charset=UTF-8' }).end('{"error":"Not found"}\n');
      return;
    }
    const { status, headers, body } = override(capture, served(capture));
    res.writeHead(status, headers.flat());
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}
