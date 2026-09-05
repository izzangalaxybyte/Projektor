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
