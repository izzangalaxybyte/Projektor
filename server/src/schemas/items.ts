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
  })
  .meta({ id: 'StreamInfo' });

export const MediaFile = z
  .object({
    id: Id,
    fileName: z.string(),
    sizeBytes: z.number().int().nonnegative(),
    container: z.string(),
    durationMs: z.number().int().nonnegative(),
    bitrate: z.number().int().nonnegative().nullable(),
    streams: StreamInfo.array(),
  })
  .meta({ id: 'MediaFile' });

export const ItemDetail = ItemSummary.extend({
  overview: z.string().nullable(),
  tagline: z.string().nullable(),
  genres: z.string().array(),
  rating: z.number().nullable(),
  airDate: z.string().nullable(),
  runtimeMs: z.number().int().nullable(),
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
  needsReview: z.coerce.boolean().optional(),
  sort: z.enum(['title', 'year', 'added', 'lastPlayed']).default('title'),
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
