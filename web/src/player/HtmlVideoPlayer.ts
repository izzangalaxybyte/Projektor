import Hls from 'hls.js';
import type { LoadPolicy } from 'hls.js';

const PATIENT: LoadPolicy = {
  default: {
    maxTimeToFirstByteMs: 30_000,
    maxLoadTimeMs: 60_000,
    timeoutRetry: { maxNumRetry: 2, retryDelayMs: 0, maxRetryDelayMs: 0 },
    errorRetry: { maxNumRetry: 1, retryDelayMs: 1000, maxRetryDelayMs: 8000 },
  },
};

export type PlayerEvent =
  'timeupdate' | 'playing' | 'pause' | 'ended' | 'error' | 'durationchange' | 'waiting';

export interface LoadOptions {
  hls: boolean;
  startMs: number;
  /** A live stream: start at the live edge and follow it rather than at startMs. */
  live?: boolean;
}

/**
 * The browser implementation of the Player: a <video> element, native for direct play and for
 * HLS on Safari, hls.js elsewhere. The Tizen build adds an AVPlay implementation in phase 3.
 */
export class HtmlVideoPlayer {
  private hls: Hls | null = null;
  private readonly listeners = new Map<PlayerEvent, Set<() => void>>();

  constructor(readonly video: HTMLVideoElement) {
    for (const ev of [
      'timeupdate',
      'playing',
      'pause',
      'ended',
      'error',
      'durationchange',
      'waiting',
    ] as PlayerEvent[]) {
      video.addEventListener(ev, () => this.emit(ev));
    }
  }

  load(src: string, options: LoadOptions): void {
    this.teardownHls();
    const start = () => {
      if (options.startMs > 0 && !options.live) this.video.currentTime = options.startMs / 1000;
      void this.video.play().catch(() => undefined);
    };
    // hls.js whenever MediaSource exists; the browser's own HLS only where it does not (iOS).
    // Chrome answers "maybe" to the HLS MIME type but cannot actually play our live playlists.
    if (options.hls && Hls.isSupported()) {
      // startPosition matters for EVENT playlists (a remux still being written): without it hls.js
      // starts near the live edge instead of where the viewer asked.
      this.hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        startPosition: options.live ? -1 : options.startMs / 1000,
        liveSyncDurationCount: 3,
        // The server answers the first playlist request only once ffmpeg has written a segment,
        // which can take longer than hls.js's 10 s default while a transcode or a channel starts.
        manifestLoadPolicy: PATIENT,
        playlistLoadPolicy: PATIENT,
      });
      this.hls.on(Hls.Events.MANIFEST_PARSED, start);
      this.hls.on(Hls.Events.ERROR, (_e, data) => {
        if (!data.fatal) return;
        // Left in on purpose: the only way to see why a stream failed on a TV or phone browser.
        console.warn('hls.js fatal error', data.type, data.details, data.error?.message ?? '');
        this.emit('error');
      });
      this.hls.loadSource(src);
      this.hls.attachMedia(this.video);
      return;
    }
    this.video.src = src;
    this.video.addEventListener('loadedmetadata', start, { once: true });
    this.video.load();
  }

  play(): void {
    void this.video.play().catch(() => undefined);
  }
  pause(): void {
    this.video.pause();
  }
  toggle(): void {
    if (this.video.paused) this.play();
    else this.pause();
  }
  seek(ms: number): void {
    const duration = this.durationMs;
    const clamped = Math.max(0, duration > 0 ? Math.min(ms, duration - 500) : ms);
    this.video.currentTime = clamped / 1000;
  }
  get currentMs(): number {
    return Math.floor(this.video.currentTime * 1000);
  }
  get durationMs(): number {
    return Number.isFinite(this.video.duration) ? Math.floor(this.video.duration * 1000) : 0;
  }
  get paused(): boolean {
    return this.video.paused;
  }
  /** Playback speed; survives load() because it lives on the element. */
  setRate(rate: number): void {
    this.video.playbackRate = rate;
    this.video.defaultPlaybackRate = rate;
  }
  get rate(): number {
    return this.video.playbackRate;
  }

  on(event: PlayerEvent, handler: () => void): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(handler);
    return () => this.listeners.get(event)?.delete(handler);
  }

  destroy(): void {
    this.teardownHls();
    this.video.removeAttribute('src');
    this.video.load();
    this.listeners.clear();
  }

  private teardownHls(): void {
    this.hls?.destroy();
    this.hls = null;
  }
  private emit(event: PlayerEvent): void {
    for (const h of this.listeners.get(event) ?? []) h();
  }
}
