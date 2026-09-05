import { z } from 'zod';
import { Id } from './common.js';

export const DeviceProfile = z
  .object({
    name: z.string().min(1).max(80),
    containers: z.string().array().meta({ description: 'e.g. mp4, mkv, webm' }),
    videoCodecs: z.string().array().meta({ description: 'e.g. h264, hevc, vp9, av1' }),
    audioCodecs: z.string().array().meta({ description: 'e.g. aac, ac3, eac3, opus, flac' }),
    maxWidth: z.number().int().positive().nullable(),
    maxBitrate: z.number().int().positive().nullable().meta({ description: 'bits per second' }),
    hlsSegmentContainer: z.enum(['ts', 'fmp4']),
  })
  .meta({ id: 'DeviceProfile' });
export type DeviceProfile = z.infer<typeof DeviceProfile>;

export const PlaybackDecideRequest = z
  .object({
    fileId: Id,
    profile: DeviceProfile,
    audioStreamIndex: z.number().int().nonnegative().optional(),
    subtitleStreamIndex: z.number().int().nonnegative().optional(),
    startPositionMs: z.number().int().nonnegative().default(0),
  })
  .meta({ id: 'PlaybackDecideRequest' });

export const PlaybackMethod = z
  .enum(['direct', 'remux', 'transcode'])
  .meta({ id: 'PlaybackMethod' });
export type PlaybackMethod = z.infer<typeof PlaybackMethod>;

export const PlaybackDecision = z
  .object({
    method: PlaybackMethod,
    video: z.enum(['copy', 'transcode']),
    audio: z.enum(['copy', 'transcode', 'none']),
    url: z.string().meta({ description: 'Relative URL of the media or HLS master playlist' }),
    sessionId: Id.nullable(),
    reason: z.string(),
    subtitleUrls: z
      .object({ streamIndex: z.number().int(), language: z.string().nullable(), url: z.string() })
      .array(),
  })
  .meta({ id: 'PlaybackDecision' });
export type PlaybackDecision = z.infer<typeof PlaybackDecision>;

export const ProgressUpdateRequest = z
  .object({
    itemId: Id,
    positionMs: z.number().int().nonnegative(),
    durationMs: z.number().int().positive(),
  })
  .meta({ id: 'ProgressUpdateRequest' });
