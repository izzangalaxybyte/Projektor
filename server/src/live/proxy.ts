// Passes a provider file (VOD movie or series episode) through to the client with byte ranges
// intact, so players can seek. Credentials stay in the provider URL on the server side.
import type { FastifyReply, FastifyRequest } from 'fastify';
import { CONTAINER_MIME } from '../routes/files.js';
import { LiveStreamError } from './relay.js';
import type { Fetcher } from './xtream.js';

const USER_AGENT = 'VLC/3.0.20 LibVLC/3.0.20';
const PASS_HEADERS = [
  'content-type',
  'content-length',
  'content-range',
  'accept-ranges',
  'last-modified',
  'etag',
];

export async function proxyFile(
  request: FastifyRequest,
  reply: FastifyReply,
  url: string,
  ext: string,
  fetcher: Fetcher = (u, init) => fetch(u, init),
): Promise<void> {
  const controller = new AbortController();
  request.raw.on('close', () => controller.abort());
  const headers: Record<string, string> = { 'user-agent': USER_AGENT, accept: '*/*' };
  if (typeof request.headers.range === 'string') headers['range'] = request.headers.range;
  let upstream: Response;
  try {
    upstream = await fetcher(url, {
      method: request.method === 'HEAD' ? 'HEAD' : 'GET',
      headers,
      signal: controller.signal,
      redirect: 'follow',
    });
  } catch (error) {
    if (controller.signal.aborted) return;
    throw new LiveStreamError(
      502,
      `Provider unreachable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!upstream.ok && upstream.status !== 206 && upstream.status !== 416)
    throw new LiveStreamError(502, `Provider answered ${upstream.status} for the file`);
  const out: Record<string, string> = { 'cache-control': 'no-store' };
  for (const name of PASS_HEADERS) {
    const v = upstream.headers.get(name);
    if (v) out[name] = v;
  }
  if (!out['content-type'] || out['content-type'] === 'application/octet-stream')
    out['content-type'] = CONTAINER_MIME[ext] ?? 'application/octet-stream';
  reply.hijack();
  reply.raw.writeHead(upstream.status, out);
  if (request.method === 'HEAD' || !upstream.body) {
    reply.raw.end();
    return;
  }
  const reader = upstream.body.getReader();
  const pump = async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!reply.raw.write(value)) await new Promise<void>((r) => reply.raw.once('drain', r));
    }
  };
  pump()
    .catch(() => undefined)
    .finally(() => reply.raw.end());
}
