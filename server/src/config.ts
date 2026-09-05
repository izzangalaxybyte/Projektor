import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8096),
  HOST: z.string().default('0.0.0.0'),
  DATA_DIR: z.string().default('./data'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  FFMPEG_PATH: z.string().default('ffmpeg'),
  FFPROBE_PATH: z.string().default('ffprobe'),
  SCAN_DEBOUNCE_MS: z.coerce.number().int().positive().default(5000),
  HLS_IDLE_MS: z.coerce.number().int().positive().default(60_000),
  HLS_MAX_PROCESSES: z.coerce.number().int().positive().default(4),
  HLS_MAX_TRANSCODES: z.coerce.number().int().positive().default(2),
  HLS_SEEK_AHEAD_SEGMENTS: z.coerce.number().int().nonnegative().default(3),
  VAAPI_DEVICE: z.string().default('/dev/dri/renderD128'),
  HARDWARE_ACCEL: z.enum(['auto', 'vaapi', 'none']).default('auto'),
  WEB_DIST: z.string().optional(),
  IPTV_URL: z.string().default('http://playshare.co:8080/'),
  LIVE_MAX_STREAMS: z.coerce.number().int().positive().default(2),
  LIVE_REFRESH: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  WATCH_LIBRARIES: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
});

export interface Config {
  port: number;
  host: string;
  logLevel: z.infer<typeof EnvSchema>['LOG_LEVEL'];
  ffmpegPath: string;
  ffprobePath: string;
  /** Quiet period after a folder change before a scan is queued. */
  scanDebounceMs: number;
  /** Stop an HLS session after this long without a request. */
  hlsIdleMs: number;
  /** Cap on concurrent ffmpeg processes across sessions. */
  hlsMaxProcesses: number;
  hlsMaxTranscodes: number;
  /** Segments a player may request ahead of ffmpeg before the transcode restarts there. */
  hlsSeekAheadSegments: number;
  vaapiDevice: string;
  /** auto probes VAAPI at startup; none forces libx264. */
  hardwareAccel: 'auto' | 'vaapi' | 'none';
  /** Built web app to serve at /; unset means API only. */
  webDist: string | null;
  /** Whether to refresh the IPTV guide on a schedule. */
  liveRefresh: boolean;
  /** Provider URL used until an admin sets one in Settings. */
  iptvUrl: string;
  /** Concurrent provider connections; keep at or below the account's max_connections. */
  liveMaxStreams: number;
  /** Whether to watch library folders for changes. */
  watchLibraries: boolean;
  /** Absolute root for all server-owned state. */
  dataDir: string;
  dbPath: string;
  imagesDir: string;
  subtitlesDir: string;
  transcodeDir: string;
}

/** Builds a Config from environment variables and creates the data directory layout. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.parse(env);
  return configForDataDir(path.resolve(parsed.DATA_DIR), {
    port: parsed.PORT,
    host: parsed.HOST,
    logLevel: parsed.LOG_LEVEL,
    ffmpegPath: parsed.FFMPEG_PATH,
    ffprobePath: parsed.FFPROBE_PATH,
    scanDebounceMs: parsed.SCAN_DEBOUNCE_MS,
    hlsIdleMs: parsed.HLS_IDLE_MS,
    hlsMaxProcesses: parsed.HLS_MAX_PROCESSES,
    hlsMaxTranscodes: parsed.HLS_MAX_TRANSCODES,
    hlsSeekAheadSegments: parsed.HLS_SEEK_AHEAD_SEGMENTS,
    vaapiDevice: parsed.VAAPI_DEVICE,
    hardwareAccel: parsed.HARDWARE_ACCEL,
    webDist: parsed.WEB_DIST ? path.resolve(parsed.WEB_DIST) : null,
    liveRefresh: parsed.LIVE_REFRESH,
    iptvUrl: parsed.IPTV_URL,
    liveMaxStreams: parsed.LIVE_MAX_STREAMS,
    watchLibraries: parsed.WATCH_LIBRARIES,
  });
}

/** Builds a Config rooted at an explicit data directory. Used by tests with a temp dir. */
export function configForDataDir(
  dataDir: string,
  overrides: Partial<
    Omit<Config, 'dataDir' | 'dbPath' | 'imagesDir' | 'subtitlesDir' | 'transcodeDir'>
  > = {},
): Config {
  const config: Config = {
    port: 8096,
    host: '0.0.0.0',
    logLevel: 'info',
    ffmpegPath: 'ffmpeg',
    ffprobePath: 'ffprobe',
    scanDebounceMs: 5000,
    hlsIdleMs: 60_000,
    hlsMaxProcesses: 4,
    hlsMaxTranscodes: 2,
    hlsSeekAheadSegments: 3,
    vaapiDevice: '/dev/dri/renderD128',
    hardwareAccel: 'none',
    webDist: null,
    liveRefresh: false,
    iptvUrl: 'http://playshare.co:8080/',
    liveMaxStreams: 2,
    watchLibraries: true,
    ...overrides,
    dataDir,
    dbPath: path.join(dataDir, 'projektor.sqlite'),
    imagesDir: path.join(dataDir, 'images'),
    subtitlesDir: path.join(dataDir, 'subtitles'),
    transcodeDir: path.join(dataDir, 'transcode'),
  };
  for (const dir of [config.dataDir, config.imagesDir, config.subtitlesDir, config.transcodeDir]) {
    mkdirSync(dir, { recursive: true });
  }
  return config;
}
