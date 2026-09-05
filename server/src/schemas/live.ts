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
    movies: z.number().int(),
    series: z.number().int(),
    matching: z.boolean().meta({ description: 'TMDB matching of provider titles is running' }),
  })
  .meta({ id: 'LiveStatus' });

export const GuideQuery = z.object({
  channel: z.string(),
  from: Timestamp.optional().meta({ description: 'Defaults to now minus 2 hours' }),
  to: Timestamp.optional().meta({ description: 'Defaults to from plus 24 hours' }),
});

export const LiveDecideRequest = z
  .object({
    channelId: z
      .string()
      .optional()
      .meta({ description: 'Required unless vodId or episodeId is given' }),
    profile: DeviceProfile,
    vodId: z.string().optional().meta({ description: 'An IPTV movie' }),
    episodeId: z.string().optional().meta({ description: 'An IPTV series episode' }),
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
    kind: z.enum(['live', 'catchup', 'vod']),
    durationMs: z
      .number()
      .int()
      .nullable()
      .meta({ description: 'Programme length for catch-up (seekable); null while live' }),
    title: z.string().nullable().meta({ description: 'Programme title for catch-up' }),
  })
  .meta({ id: 'LivePlaybackDecision' });

export const IptvMovie = z
  .object({
    id: z.string(),
    title: z.string(),
    year: z.number().int().nullable(),
    overview: z.string().nullable(),
    genres: z.string().array(),
    rating: z.number().nullable(),
    runtimeMs: z.number().int().nullable(),
    posterKey: z
      .string()
      .nullable()
      .meta({ description: 'Cached TMDB artwork; null when unmatched' }),
    backdropKey: z.string().nullable(),
    logoUrl: z.string().nullable().meta({ description: "The provider's own cover image URL" }),
    categoryId: z.string().nullable(),
    containerExtension: z.string(),
    needsReview: z.boolean(),
    tmdbId: z.number().int().nullable(),
    addedAt: Timestamp.nullable(),
  })
  .meta({ id: 'IptvMovie' });
export type IptvMovie = z.infer<typeof IptvMovie>;

export const IptvMoviePage = z
  .object({ items: IptvMovie.array(), total: z.number().int(), offset: z.number().int() })
  .meta({ id: 'IptvMoviePage' });

export const IptvSeries = z
  .object({
    id: z.string(),
    title: z.string(),
    year: z.number().int().nullable(),
    overview: z.string().nullable(),
    genres: z.string().array(),
    rating: z.number().nullable(),
    posterKey: z.string().nullable(),
    backdropKey: z.string().nullable(),
    coverUrl: z.string().nullable(),
    categoryId: z.string().nullable(),
    needsReview: z.boolean(),
    tmdbId: z.number().int().nullable(),
  })
  .meta({ id: 'IptvSeries' });
export type IptvSeries = z.infer<typeof IptvSeries>;

export const IptvSeriesPage = z
  .object({ items: IptvSeries.array(), total: z.number().int(), offset: z.number().int() })
  .meta({ id: 'IptvSeriesPage' });

export const IptvEpisode = z
  .object({
    id: z.string(),
    seriesId: z.string(),
    seasonNumber: z.number().int(),
    episodeNumber: z.number().int(),
    title: z.string(),
    overview: z.string().nullable(),
    imageUrl: z.string().nullable(),
    durationMs: z.number().int().nullable(),
    containerExtension: z.string(),
  })
  .meta({ id: 'IptvEpisode' });
export type IptvEpisode = z.infer<typeof IptvEpisode>;

export const IptvSeriesDetail = IptvSeries.extend({
  seasons: z.object({ number: z.number().int(), episodes: IptvEpisode.array() }).array(),
}).meta({ id: 'IptvSeriesDetail' });
export type IptvSeriesDetail = z.infer<typeof IptvSeriesDetail>;

export const CatalogQuery = z.object({
  category: z.string().optional(),
  search: z.string().optional(),
  sort: z.enum(['title', 'added']).optional(),
  offset: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().positive().max(200).default(60),
});
