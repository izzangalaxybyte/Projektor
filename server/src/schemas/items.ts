import { z } from 'zod';
import { Id, ItemKind, LibraryKind, Timestamp } from './common.js';

export const ProgressState = z
  .object({
    positionMs: z.number().int().nonnegative(),
    durationMs: z.number().int().positive(),
    watched: z.boolean(),
    updatedAt: Timestamp,
  })
  .meta({ id: 'ProgressState' });
export type ProgressState = z.infer<typeof ProgressState>;

export const ItemSummary = z
  .object({
    id: Id,
    kind: ItemKind,
    libraryKind: LibraryKind,
    title: z.string(),
    year: z.number().int().nullable(),
    posterKey: z.string().nullable(),
    backdropKey: z.string().nullable(),
    seasonNumber: z.number().int().nullable(),
    episodeNumber: z.number().int().nullable(),
    showTitle: z.string().nullable(),
    needsReview: z.boolean(),
    progress: ProgressState.nullable(),
    favorite: z
      .boolean()
      .meta({ description: "Movies and shows in the user's favorites; always false otherwise." }),
    runtimeMs: z.number().int().nullable().meta({
      description:
        'Movies and episodes: runtime from TMDB, else the longest file. Null for shows and seasons.',
    }),
  })
  .meta({ id: 'ItemSummary' });
export type ItemSummary = z.infer<typeof ItemSummary>;

export const StreamInfo = z
  .object({
    index: z.number().int().nonnegative(),
    type: z.enum(['video', 'audio', 'subtitle']),
    codec: z.string(),
    language: z.string().nullable(),
    title: z.string().nullable(),
    isDefault: z.boolean(),
    isForced: z.boolean(),
    width: z.number().int().nullable(),
    height: z.number().int().nullable(),
    channels: z.number().int().nullable(),
    bitDepth: z
      .number()
      .int()
      .nullable()
      .meta({ description: 'Video bits per sample; null when unknown' }),
    hdr: z
      .boolean()
      .meta({ description: 'PQ or HLG transfer (HDR10, Dolby Vision base layer, HLG)' }),
  })
  .meta({ id: 'StreamInfo' });
export type StreamInfo = z.infer<typeof StreamInfo>;

export const SubtitleTrack = z
  .object({
    id: Id,
    source: z.enum(['embedded', 'external', 'opensubtitles']),
    streamIndex: z.number().int().nullable(),
    language: z.string().nullable(),
    title: z.string().nullable(),
    format: z.string().meta({ description: 'Source format: subrip, ass, mov_text, webvtt, ...' }),
    url: z.string().meta({ description: 'WebVTT URL under /api/subtitles' }),
    assUrl: z
      .string()
      .nullable()
      .meta({ description: 'ASS and SSA tracks: the original script, styling intact, for libass' }),
    fontsUrl: z
      .string()
      .nullable()
      .meta({ description: 'ASS and SSA tracks: lists the fonts attached to the media file' }),
  })
  .meta({ id: 'SubtitleTrack' });

export type SubtitleTrack = z.infer<typeof SubtitleTrack>;

export const SubtitleFont = z
  .object({
    name: z.string().meta({ description: 'The attachment file name in the media file' }),
    url: z.string(),
  })
  .meta({ id: 'SubtitleFont' });

export const MediaFile = z
  .object({
    id: Id,
    fileName: z.string(),
    sizeBytes: z.number().int().nonnegative(),
    container: z.string(),
    durationMs: z.number().int().nonnegative(),
    bitrate: z.number().int().nonnegative().nullable(),
    streams: StreamInfo.array(),
    subtitles: SubtitleTrack.array(),
  })
  .meta({ id: 'MediaFile' });
export type MediaFile = z.infer<typeof MediaFile>;

export const ItemDetail = ItemSummary.extend({
  overview: z.string().nullable(),
  tagline: z.string().nullable(),
  genres: z.string().array(),
  rating: z.number().nullable(),
  airDate: z.string().nullable(),
  tmdbId: z.number().int().nullable(),
  anilistId: z.number().int().nullable(),
  files: MediaFile.array(),
  children: ItemSummary.array().meta({ description: 'Seasons of a show, episodes of a season' }),
}).meta({ id: 'ItemDetail' });
export type ItemDetail = z.infer<typeof ItemDetail>;

export const ItemsQuery = z.object({
  libraryKind: LibraryKind.optional(),
  kind: ItemKind.optional(),
  parentId: Id.optional(),
  search: z.string().optional(),
  // z.coerce.boolean() would turn the string 'false' into true; parse the two literals instead.
  needsReview: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  sort: z.enum(['title', 'year', 'added', 'lastPlayed']).default('title'),
});

export const MatchCandidate = z
  .object({
    source: z.enum(['tmdb', 'anilist']),
    id: z.number().int(),
    title: z.string(),
    year: z.number().int().nullable(),
    overview: z.string().nullable(),
    posterUrl: z
      .string()
      .nullable()
      .meta({ description: 'Remote poster URL for preview; not cached' }),
    score: z
      .number()
      .meta({ description: 'Ranking score, higher is better; 0.85 is the auto-accept threshold' }),
  })
  .meta({ id: 'MatchCandidate' });
export type MatchCandidate = z.infer<typeof MatchCandidate>;

export const CandidatesQuery = z.object({
  query: z.string().optional().meta({ description: 'Defaults to the item title' }),
  year: z.coerce.number().int().optional(),
});

export const FixMatchRequest = z
  .object({
    tmdbId: z.number().int().optional(),
    anilistId: z.number().int().optional(),
    seasonOffset: z
      .number()
      .int()
      .optional()
      .meta({ description: 'Anime only: shift when mapping absolute episodes onto TMDB seasons' }),
  })
  .meta({ id: 'FixMatchRequest' });
