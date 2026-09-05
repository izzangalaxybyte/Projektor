import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { ImageStore } from '../images/store.js';
import { SettingsService } from '../settings/service.js';
import { AniListClient } from './anilist.js';
import { AnimeMatcher } from './anime-matcher.js';
import { Matcher } from './matcher.js';
import { TmdbClient } from './tmdb.js';

export interface MetadataDeps {
  tmdb: TmdbClient | null;
  anilist: AniListClient;
  images: ImageStore;
  matcher: Matcher | null;
  animeMatcher: AnimeMatcher;
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
  return { tmdb, anilist, images, matcher, animeMatcher };
}
