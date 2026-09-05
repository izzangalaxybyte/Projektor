// One provider connection per channel, fanned out to every viewer, packager, or recorder that
// wants it. IPTV accounts allow one or two concurrent connections, so nothing may pull a channel
// twice, and the connection is dropped shortly after the last subscriber leaves.
import { PassThrough, Readable } from 'node:stream';
import type { FastifyBaseLogger } from 'fastify';
import type { LiveRefresher } from './refresher.js';
import type { Fetcher } from './xtream.js';

export class LiveStreamError extends Error {
  constructor(
    public readonly statusCode: 404 | 502 | 503 | 504,
    message: string,
  ) {
    super(message);
  }
}

export interface RelayOptions {
  /** Concurrent provider connections allowed; the account's max_connections or fewer. */
  maxStreams: number;
  /** How long a channel stays connected with no subscribers, so a reconnect is instant. */
  graceMs: number;
  fetcher?: Fetcher | undefined;
}

export interface Subscription {
  /** MPEG-TS bytes as they arrive. Ends when the provider connection ends. */
  stream: Readable;
  /** Resolves once the provider has answered with a 200, or rejects with a LiveStreamError. */
  ready: Promise<void>;
  close(): void;
}

/** A slow subscriber may buffer this much before it is dropped rather than stalling the others. */
const MAX_BUFFERED_BYTES = 16 * 1024 * 1024;
/** Several providers only answer clients that look like a common player. */
const USER_AGENT = 'VLC/3.0.20 LibVLC/3.0.20';

class Relay {
  readonly subscribers = new Set<PassThrough>();
  readonly controller = new AbortController();
  readonly ready: Promise<void>;
  bytes = 0;
  private graceTimer: NodeJS.Timeout | null = null;

  constructor(
    readonly channelId: string,
    url: string,
    fetcher: Fetcher,
    private readonly log: FastifyBaseLogger,
    private readonly onDone: () => void,
  ) {
    let resolveReady!: () => void;
    let rejectReady!: (e: Error) => void;
    this.ready = new Promise<void>((res, rej) => {
      resolveReady = res;
      rejectReady = rej;
    });
    this.ready.catch(() => undefined);
    void this.pump(url, fetcher, resolveReady, rejectReady);
  }

  private async pump(
    url: string,
    fetcher: Fetcher,
    resolveReady: () => void,
    rejectReady: (e: Error) => void,
  ): Promise<void> {
    let response: Response;
    try {
      response = await fetcher(url, {
        signal: this.controller.signal,
        headers: { 'user-agent': USER_AGENT, accept: '*/*' },
        redirect: 'follow',
      });
    } catch (error) {
      const aborted = this.controller.signal.aborted;
      const e = new LiveStreamError(
        aborted ? 504 : 502,
        aborted
          ? 'Stream closed before the provider answered'
          : `Provider unreachable: ${error instanceof Error ? error.message : String(error)}`,
      );
      rejectReady(e);
      this.finish();
      return;
    }
    if (!response.ok || !response.body) {
      rejectReady(new LiveStreamError(502, `Provider answered ${response.status} for the stream`));
      this.controller.abort();
      this.finish();
      return;
    }
    resolveReady();
    try {
      for await (const chunk of Readable.fromWeb(response.body as never)) {
        const buf = chunk as Buffer;
        this.bytes += buf.length;
        for (const sub of this.subscribers) {
          if (sub.writableLength > MAX_BUFFERED_BYTES) {
            this.log.warn(
              { channelId: this.channelId },
              'dropping a subscriber that stopped reading',
            );
            this.drop(sub);
            continue;
          }
          sub.write(buf);
        }
      }
    } catch (error) {
      if (!this.controller.signal.aborted)
        this.log.warn(
          { channelId: this.channelId, error: String(error) },
          'live stream ended with an error',
        );
    }
    this.finish();
  }

  subscribe(): Subscription {
    if (this.graceTimer) {
      clearTimeout(this.graceTimer);
      this.graceTimer = null;
    }
    const stream = new PassThrough({ highWaterMark: 1024 * 1024 });
    this.subscribers.add(stream);
    return {
      stream,
      ready: this.ready,
      close: () => this.drop(stream),
    };
  }

  private drop(stream: PassThrough): void {
    if (!this.subscribers.delete(stream)) return;
    stream.end();
    if (this.subscribers.size === 0 && !this.controller.signal.aborted) {
      this.graceTimer = setTimeout(() => this.controller.abort(), this.graceMs);
      this.graceTimer.unref();
    }
  }

  graceMs = 5000;

  abort(): void {
    this.controller.abort();
  }

  private finished = false;
  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    if (this.graceTimer) clearTimeout(this.graceTimer);
    for (const sub of this.subscribers) sub.end();
    this.subscribers.clear();
    this.onDone();
  }
}

export class LiveRelayManager {
  private readonly relays = new Map<string, Relay>();

  constructor(
    private readonly live: LiveRefresher,
    private readonly log: FastifyBaseLogger,
    private readonly options: RelayOptions,
  ) {}

  /** Number of open provider connections. */
  active(): number {
    return this.relays.size;
  }

  /** Attaches to the channel's provider stream, opening it when this is the first subscriber. */
  subscribe(channelId: string): Subscription {
    const client = this.live.client();
    if (!client) throw new LiveStreamError(503, 'IPTV credentials are not set');
    return this.subscribeUrl(channelId, client.liveUrl(channelId));
  }

  /**
   * Attaches to any provider stream (a channel, or a catch-up programme) identified by `key`.
   * Subscribers with the same key share one connection.
   */
  subscribeUrl(channelId: string, url: string): Subscription {
    let relay = this.relays.get(channelId);
    if (!relay) {
      if (!this.live.credentials()) throw new LiveStreamError(503, 'IPTV credentials are not set');
      if (this.relays.size >= this.options.maxStreams)
        throw new LiveStreamError(
          503,
          'All provider connections are in use; stop another stream first',
        );
      const fetcher = this.options.fetcher ?? ((u, init) => fetch(u, init));
      const created: Relay = new Relay(channelId, url, fetcher, this.log, () => {
        if (this.relays.get(channelId) === created) this.relays.delete(channelId);
        this.log.info({ channelId, bytes: created.bytes }, 'live relay closed');
      });
      created.graceMs = this.options.graceMs;
      this.relays.set(channelId, created);
      this.log.info({ channelId }, 'live relay opened');
      relay = created;
    }
    return relay.subscribe();
  }

  async close(): Promise<void> {
    for (const relay of this.relays.values()) relay.abort();
    this.relays.clear();
  }
}
