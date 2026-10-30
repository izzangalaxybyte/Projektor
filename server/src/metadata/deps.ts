import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { ImageStore } from '../images/store.js';
import { SettingsService } from '../settings/service.js';
import { AniListClient } from './anilist.js';
import { AnimeMatcher } from './anime-matcher.js';
import { refreshAnimeRatings, type RatingsSummary } from './anime-ratings.js';
import { JikanClient } from './jikan.js';
import { Matcher } from './matcher.js';
import { TmdbClient } from './tmdb.js';

export interface MetadataDeps {
  tmdb: TmdbClient | null;
  anilist: AniListClient;
  images: ImageStore;
  matcher: Matcher | null;
  animeMatcher: AnimeMatcher;
  jikan: JikanClient;
}

/** Builds the metadata clients from current settings and the app's outbound fetch. */
export function metadataDeps(app: FastifyInstance, log?: FastifyBaseLogger): MetadataDeps {
  const fetcher = app.httpFetch;
  const key = new SettingsService(app.db).get('tmdb.apiKey');
  const tmdb = key ? new TmdbClient(key, fetcher) : null;
  const anilist = new AniListClient(fetcher);
  const images = new ImageStore(app.config.imagesDir, fetcher);
  const matcher = tmdb ? new Matcher({ db: app.db, tmdb, images, log }) : null;
  const animeMatcher = new AnimeMatcher({ db: app.db, anilist, tmdb, images, log });
  return { tmdb, anilist, images, matcher, animeMatcher, jikan: new JikanClient(fetcher) };
}

/** Fetches stale anime scores in the background (anime-ratings.ts); stops when [stopped] says so. */
export function refreshRatings(
  app: FastifyInstance,
  stopped: () => boolean,
  log?: FastifyBaseLogger,
): Promise<RatingsSummary> {
  const { anilist, jikan, tmdb } = metadataDeps(app, log);
  return refreshAnimeRatings({ db: app.db, anilist, jikan, tmdb, log }, stopped);
}
