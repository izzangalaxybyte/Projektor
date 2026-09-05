// The fake provider as a real HTTP server, for the e2e suite and manual runs:
//   FAKE_XTREAM_PORT=8098 FAKE_XTREAM_FILE=../fixtures/movies/... npx tsx src/live/fake-xtream-server.ts
import http from 'node:http';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { fakeXtream, ffmpegLoopSource, type FakeXtreamOptions } from './fake-xtream.js';

export async function startFakeXtreamServer(
  opts: { port: number; host?: string } & Omit<FakeXtreamOptions, 'base'>,
) {
  const host = opts.host ?? '127.0.0.1';
  const provider = fakeXtream({ ...opts, base: `http://${host}:${opts.port}` });
  const server = http.createServer(async (req, res) => {
    const controller = new AbortController();
    res.on('close', () => controller.abort());
    try {
      const response = await provider.fetch(`${provider.base}${req.url ?? '/'}`, {
        signal: controller.signal,
      });
      const headers: Record<string, string> = {};
      response.headers.forEach((v, k) => (headers[k] = v));
      res.writeHead(response.status, headers);
      if (response.body) Readable.fromWeb(response.body as never).pipe(res);
      else res.end();
    } catch (error) {
      res.writeHead(500);
      res.end(String(error));
    }
  });
  await new Promise<void>((resolve) => server.listen(opts.port, host, resolve));
  return {
    url: provider.base,
    provider,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env['FAKE_XTREAM_PORT'] ?? 8098);
  const file = process.env['FAKE_XTREAM_FILE'];
  const started = await startFakeXtreamServer({
    port,
    ...(file ? { liveSource: ffmpegLoopSource(process.env['FFMPEG_PATH'] ?? 'ffmpeg', file) } : {}),
  });
  console.log(
    `fake Xtream provider at ${started.url} (user ${started.provider.username}, password ${started.provider.password})`,
  );
}
