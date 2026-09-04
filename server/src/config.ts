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
});

export interface Config {
  port: number;
  host: string;
  logLevel: z.infer<typeof EnvSchema>['LOG_LEVEL'];
  ffmpegPath: string;
  ffprobePath: string;
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
