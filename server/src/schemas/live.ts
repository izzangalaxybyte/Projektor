import { z } from 'zod';
import { Timestamp } from './common.js';
import { DeviceProfile } from './playback.js';

export const LiveCategory = z
  .object({ id: z.string(), name: z.string(), kind: z.enum(['live', 'vod', 'series']) })
  .meta({ id: 'LiveCategory' });

export const LiveProgramme = z
  .object({
    id: z.string(),
    title: z.string(),
    description: z.string().nullable(),
    startAt: Timestamp,
    endAt: Timestamp,
  })
  .meta({ id: 'LiveProgramme' });
export type LiveProgramme = z.infer<typeof LiveProgramme>;

export const LiveChannel = z
  .object({
    id: z.string(),
    name: z.string(),
    number: z.number().int().nullable(),
    logoUrl: z.string().nullable(),
    categoryId: z.string().nullable(),
    hasArchive: z.boolean(),
    archiveDays: z.number().int(),
    now: LiveProgramme.nullable().meta({
      description: 'Programme on air at request time, if the guide knows',
    }),
    next: LiveProgramme.nullable(),
  })
  .meta({ id: 'LiveChannel' });
export type LiveChannel = z.infer<typeof LiveChannel>;

export const LiveStatus = z
  .object({
    configured: z
      .boolean()
      .meta({ description: 'Provider URL, username, and password are all set' }),
    refreshing: z.boolean(),
    lastRefreshAt: Timestamp.nullable(),
    lastError: z.string().nullable(),
    channels: z.number().int(),
    programmes: z.number().int(),
    accountStatus: z
      .string()
      .nullable()
      .meta({ description: "Provider's account status, e.g. Active" }),
    accountExpiresAt: Timestamp.nullable(),
  })
  .meta({ id: 'LiveStatus' });

export const GuideQuery = z.object({
  channel: z.string(),
  from: Timestamp.optional().meta({ description: 'Defaults to now minus 2 hours' }),
  to: Timestamp.optional().meta({ description: 'Defaults to from plus 24 hours' }),
});

export const LiveDecideRequest = z
  .object({
    channelId: z.string(),
    profile: DeviceProfile,
    programmeId: z
      .string()
      .optional()
      .meta({ description: 'A past programme on a catch-up channel; omit for the live stream' }),
  })
  .meta({ id: 'LiveDecideRequest' });

export const LivePlaybackDecision = z
  .object({
    method: z
      .enum(['direct', 'hls'])
      .meta({ description: 'direct: raw MPEG-TS relay; hls: live playlist' }),
    url: z.string().meta({ description: 'Relative URL of the TS stream or the HLS playlist' }),
    sessionId: z.string().nullable(),
    reason: z.string(),
    kind: z.enum(['live', 'catchup']),
    durationMs: z
      .number()
      .int()
      .nullable()
      .meta({ description: 'Programme length for catch-up (seekable); null while live' }),
    title: z.string().nullable().meta({ description: 'Programme title for catch-up' }),
  })
  .meta({ id: 'LivePlaybackDecision' });
