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
    /** Sidecar file path for external subtitles; null for embedded tracks. */
    sourcePath: text('source_path'),
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

export const liveCategories = sqliteTable('live_categories', {
  /** Provider category id. */
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  kind: text('kind', { enum: ['live', 'vod', 'series'] }).notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
});

export const liveChannels = sqliteTable(
  'live_channels',
  {
    /** Provider stream id. */
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    number: integer('number'),
    logoUrl: text('logo_url'),
    categoryId: text('category_id'),
    /** Provider's guide channel id; programmes join on this. */
    epgChannelId: text('epg_channel_id'),
    hasArchive: integer('has_archive', { mode: 'boolean' }).notNull().default(false),
    archiveDays: integer('archive_days').notNull().default(0),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    index('live_channels_category_idx').on(t.categoryId),
    index('live_channels_epg_idx').on(t.epgChannelId),
  ],
);

export const liveProgrammes = sqliteTable(
  'live_programmes',
  {
    id: text('id').primaryKey(),
    epgChannelId: text('epg_channel_id').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    startAt: text('start_at').notNull(),
    endAt: text('end_at').notNull(),
  },
  (t) => [index('live_programmes_channel_start_idx').on(t.epgChannelId, t.startAt)],
);

/** Provider VOD titles ("IPTV Movies"), matched against TMDB like local movies. */
export const iptvMovies = sqliteTable(
  'iptv_movies',
  {
    /** Provider stream id. */
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    categoryId: text('category_id'),
    logoUrl: text('logo_url'),
    containerExtension: text('container_extension').notNull().default('mp4'),
    addedAt: text('added_at'),
    parsedTitle: text('parsed_title').notNull(),
    parsedYear: integer('parsed_year'),
    tmdbId: integer('tmdb_id'),
    title: text('title').notNull(),
    year: integer('year'),
    overview: text('overview'),
    genresJson: text('genres_json').notNull().default('[]'),
    rating: integer('rating', { mode: 'number' }),
    runtimeMs: integer('runtime_ms'),
    posterKey: text('poster_key'),
    backdropKey: text('backdrop_key'),
    needsReview: integer('needs_review', { mode: 'boolean' }).notNull().default(true),
    matchAttemptedAt: text('match_attempted_at'),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    index('iptv_movies_category_idx').on(t.categoryId),
    index('iptv_movies_title_idx').on(t.title),
  ],
);

export const iptvSeries = sqliteTable(
  'iptv_series',
  {
    /** Provider series id. */
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    categoryId: text('category_id'),
    coverUrl: text('cover_url'),
    parsedTitle: text('parsed_title').notNull(),
    parsedYear: integer('parsed_year'),
    tmdbId: integer('tmdb_id'),
    title: text('title').notNull(),
    year: integer('year'),
    overview: text('overview'),
    genresJson: text('genres_json').notNull().default('[]'),
    rating: integer('rating', { mode: 'number' }),
    posterKey: text('poster_key'),
    backdropKey: text('backdrop_key'),
    needsReview: integer('needs_review', { mode: 'boolean' }).notNull().default(true),
    matchAttemptedAt: text('match_attempted_at'),
    /** When the episode list was last pulled from the provider; null means never. */
    episodesFetchedAt: text('episodes_fetched_at'),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    index('iptv_series_category_idx').on(t.categoryId),
    index('iptv_series_title_idx').on(t.title),
  ],
);

export const iptvEpisodes = sqliteTable(
  'iptv_episodes',
  {
    /** Provider episode id. */
    id: text('id').primaryKey(),
    seriesId: text('series_id')
      .notNull()
      .references(() => iptvSeries.id, { onDelete: 'cascade' }),
    seasonNumber: integer('season_number').notNull(),
    episodeNumber: integer('episode_number').notNull(),
    title: text('title').notNull(),
    containerExtension: text('container_extension').notNull().default('mp4'),
    durationMs: integer('duration_ms'),
    overview: text('overview'),
    imageUrl: text('image_url'),
  },
  (t) => [index('iptv_episodes_series_idx').on(t.seriesId)],
);

/** Recordings of live channels made by the server (see live/recorder.ts). */
export const recordings = sqliteTable(
  'recordings',
  {
    id: text('id').primaryKey(),
    channelId: text('channel_id').notNull(),
    channelName: text('channel_name').notNull(),
    channelLogoUrl: text('channel_logo_url'),
    title: text('title').notNull(),
    description: text('description'),
    programmeId: text('programme_id'),
    /** Planned start; the scheduler starts the recording at this time. */
    startAt: text('start_at').notNull(),
    /** Planned end including padding; null means it runs until stopped by hand. */
    endAt: text('end_at'),
    actualStartAt: text('actual_start_at'),
    actualEndAt: text('actual_end_at'),
    state: text('state', { enum: ['scheduled', 'recording', 'done', 'failed'] }).notNull(),
    /** Absolute path of the .ts file once recording has started. */
    filePath: text('file_path'),
    sizeBytes: integer('size_bytes').notNull().default(0),
    durationMs: integer('duration_ms'),
    error: text('error'),
    createdBy: text('created_by'),
    ...timestamps,
  },
  (t) => [index('recordings_state_start_idx').on(t.state, t.startAt)],
);
