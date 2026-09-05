// Drizzle schema. Every table uses text UUID primary keys and ISO 8601 UTC timestamps.
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

const timestamps = {
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
};

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  pinHash: text('pin_hash').notNull(),
  isAdmin: integer('is_admin', { mode: 'boolean' }).notNull().default(false),
  avatarColor: text('avatar_color').notNull(),
  failedAttempts: integer('failed_attempts').notNull().default(0),
  lockedUntil: text('locked_until'),
  ...timestamps,
});

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    deviceName: text('device_name').notNull(),
    createdAt: text('created_at').notNull(),
    lastSeenAt: text('last_seen_at').notNull(),
  },
  (t) => [
    uniqueIndex('sessions_token_hash_idx').on(t.tokenHash),
    index('sessions_user_idx').on(t.userId),
  ],
);

export const libraries = sqliteTable('libraries', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  kind: text('kind', { enum: ['movie', 'tv', 'anime'] }).notNull(),
  lastScannedAt: text('last_scanned_at'),
  ...timestamps,
});

export const libraryPaths = sqliteTable(
  'library_paths',
  {
    id: text('id').primaryKey(),
    libraryId: text('library_id')
      .notNull()
      .references(() => libraries.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
  },
  (t) => [uniqueIndex('library_paths_unique_idx').on(t.libraryId, t.path)],
);

export const movies = sqliteTable(
  'movies',
  {
    id: text('id').primaryKey(),
    libraryId: text('library_id')
      .notNull()
      .references(() => libraries.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    sortTitle: text('sort_title').notNull(),
    year: integer('year'),
    tmdbId: integer('tmdb_id'),
    overview: text('overview'),
    tagline: text('tagline'),
    genresJson: text('genres_json').notNull().default('[]'),
    rating: integer('rating', { mode: 'number' }),
    releaseDate: text('release_date'),
    runtimeMs: integer('runtime_ms'),
    posterKey: text('poster_key'),
    backdropKey: text('backdrop_key'),
    needsReview: integer('needs_review', { mode: 'boolean' }).notNull().default(true),
    /** When metadata matching last ran for this item, so unmatched items are not retried every scan. */
    matchAttemptedAt: text('match_attempted_at'),
    ...timestamps,
  },
  (t) => [index('movies_library_idx').on(t.libraryId), index('movies_tmdb_idx').on(t.tmdbId)],
);

export const shows = sqliteTable(
  'shows',
  {
    id: text('id').primaryKey(),
    libraryId: text('library_id')
      .notNull()
      .references(() => libraries.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    sortTitle: text('sort_title').notNull(),
    year: integer('year'),
    tmdbId: integer('tmdb_id'),
    anilistId: integer('anilist_id'),
    overview: text('overview'),
    genresJson: text('genres_json').notNull().default('[]'),
    rating: integer('rating', { mode: 'number' }),
    firstAirDate: text('first_air_date'),
    posterKey: text('poster_key'),
    backdropKey: text('backdrop_key'),
    needsReview: integer('needs_review', { mode: 'boolean' }).notNull().default(true),
    /** Anime only: shifts absolute episode numbers before mapping onto TMDB seasons. */
    seasonOffset: integer('season_offset').notNull().default(0),
    matchAttemptedAt: text('match_attempted_at'),
    ...timestamps,
  },
  (t) => [index('shows_library_idx').on(t.libraryId), index('shows_tmdb_idx').on(t.tmdbId)],
);

export const seasons = sqliteTable(
  'seasons',
  {
    id: text('id').primaryKey(),
    showId: text('show_id')
      .notNull()
      .references(() => shows.id, { onDelete: 'cascade' }),
    seasonNumber: integer('season_number').notNull(),
    title: text('title'),
    overview: text('overview'),
    posterKey: text('poster_key'),
    tmdbId: integer('tmdb_id'),
    ...timestamps,
  },
  (t) => [uniqueIndex('seasons_show_number_idx').on(t.showId, t.seasonNumber)],
);

export const episodes = sqliteTable(
  'episodes',
  {
    id: text('id').primaryKey(),
    showId: text('show_id')
      .notNull()
      .references(() => shows.id, { onDelete: 'cascade' }),
    seasonId: text('season_id').references(() => seasons.id, { onDelete: 'set null' }),
    seasonNumber: integer('season_number'),
    episodeNumber: integer('episode_number'),
    /** Anime: episode number as written in the filename, before season mapping. */
    absoluteNumber: integer('absolute_number'),
    title: text('title'),
    overview: text('overview'),
    airDate: text('air_date'),
    stillKey: text('still_key'),
    runtimeMs: integer('runtime_ms'),
    tmdbId: integer('tmdb_id'),
    ...timestamps,
  },
  (t) => [index('episodes_show_season_episode_idx').on(t.showId, t.seasonNumber, t.episodeNumber)],
);

export const mediaFiles = sqliteTable(
  'media_files',
  {
    id: text('id').primaryKey(),
    libraryId: text('library_id')
      .notNull()
      .references(() => libraries.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    fileName: text('file_name').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    mtimeMs: integer('mtime_ms').notNull(),
    /** Set once the file has been probed; null means probe pending. */
    probedAt: text('probed_at'),
    container: text('container'),
    durationMs: integer('duration_ms'),
    bitrate: integer('bitrate'),
    probeJson: text('probe_json'),
    /** True when the file disappeared from disk on the last scan. Kept so progress survives moves. */
    missing: integer('missing', { mode: 'boolean' }).notNull().default(false),
    movieId: text('movie_id').references(() => movies.id, { onDelete: 'set null' }),
    episodeId: text('episode_id').references(() => episodes.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('media_files_path_idx').on(t.path),
    index('media_files_library_idx').on(t.libraryId),
    index('media_files_movie_idx').on(t.movieId),
    index('media_files_episode_idx').on(t.episodeId),
  ],
);

export const streams = sqliteTable(
  'streams',
  {
    id: text('id').primaryKey(),
    fileId: text('file_id')
      .notNull()
      .references(() => mediaFiles.id, { onDelete: 'cascade' }),
    streamIndex: integer('stream_index').notNull(),
    type: text('type', { enum: ['video', 'audio', 'subtitle'] }).notNull(),
    codec: text('codec').notNull(),
    language: text('language'),
    title: text('title'),
    isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
    isForced: integer('is_forced', { mode: 'boolean' }).notNull().default(false),
    width: integer('width'),
    height: integer('height'),
    channels: integer('channels'),
  },
  (t) => [uniqueIndex('streams_file_index_idx').on(t.fileId, t.streamIndex)],
);

export const subtitles = sqliteTable(
  'subtitles',
  {
    id: text('id').primaryKey(),
    fileId: text('file_id')
      .notNull()
      .references(() => mediaFiles.id, { onDelete: 'cascade' }),
    source: text('source', { enum: ['embedded', 'external', 'opensubtitles'] }).notNull(),
    streamIndex: integer('stream_index'),
    language: text('language'),
    title: text('title'),
    /** Original format before conversion: srt, ass, subrip, mov_text, webvtt. */
    format: text('format').notNull(),
    /** Path of the cached WebVTT file under DATA_DIR/subtitles, null until converted. */
    vttPath: text('vtt_path'),
    ...timestamps,
  },
  (t) => [index('subtitles_file_idx').on(t.fileId)],
);

export const playbackState = sqliteTable(
  'playback_state',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    itemId: text('item_id').notNull(),
    itemKind: text('item_kind', { enum: ['movie', 'episode'] }).notNull(),
    positionMs: integer('position_ms').notNull(),
    durationMs: integer('duration_ms').notNull(),
    watched: integer('watched', { mode: 'boolean' }).notNull().default(false),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.itemId] }),
    index('playback_user_updated_idx').on(t.userId, t.updatedAt),
  ],
);

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull(),
});
