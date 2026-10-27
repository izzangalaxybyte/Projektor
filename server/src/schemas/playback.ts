import { z } from 'zod';
import { Id } from './common.js';
import { SubtitleTrack } from './items.js';

export const DeviceProfile = z
  .object({
    name: z.string().min(1).max(80),
    containers: z.string().array().meta({ description: 'e.g. mp4, mkv, webm' }),
    videoCodecs: z
      .string()
      .array()
      .meta({ description: 'e.g. h264, hevc, vp9, av1; add hevc10 when 10-bit HEVC decodes' }),
    audioCodecs: z.string().array().meta({ description: 'e.g. aac, ac3, eac3, opus, flac' }),
    maxWidth: z.number().int().positive().nullable(),
    maxBitrate: z.number().int().positive().nullable().meta({ description: 'bits per second' }),
    hlsSegmentContainer: z.enum(['ts', 'fmp4']),
    hdr: z.boolean().optional().meta({
      description: 'Device shows HDR itself; otherwise HDR sources are tone-mapped to SDR',
    }),
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
    subtitles: SubtitleTrack.array().meta({
      description: 'Text subtitles available for this file as WebVTT',
    }),
    audioStreamIndex: z.number().int().nullable().meta({
      description:
        "The audio stream played: the request's, else the one last picked for this show; null leaves it to the player",
    }),
    preferredSubtitleId: z.string().nullable().meta({
      description: 'The subtitle last picked for this show, matched in this file; null when none',
    }),
    subtitlesOff: z.boolean().meta({
      description: 'Subtitles were last turned off for this show',
    }),
  })
  .meta({ id: 'PlaybackDecision' });

export const TrackChoiceRequest = z
  .object({
    fileId: Id,
    audioStreamIndex: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .meta({ description: 'The audio stream picked' }),
    subtitleId: z.string().optional().meta({ description: 'The subtitle picked' }),
    subtitlesOff: z.boolean().optional().meta({ description: 'Subtitles were turned off' }),
  })
  .meta({ id: 'TrackChoiceRequest' });
export type PlaybackDecision = z.infer<typeof PlaybackDecision>;

export const ProgressUpdateRequest = z
  .object({
    itemId: Id,
    positionMs: z.number().int().nonnegative(),
    durationMs: z.number().int().positive(),
  })
  .meta({ id: 'ProgressUpdateRequest' });
