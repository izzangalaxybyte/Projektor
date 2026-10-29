// Turns probed media files into library items using only what the filename and folders say.
// Everything created here is flagged needsReview until a metadata match (1.7/1.8) confirms it.
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { now, schema, type Db } from '../db/index.js';
import { parseFansubName } from './fansub-parser.js';
import { isSpecialName, isSpecialsDir, showFolder } from './folders.js';
import { parseSceneName, type ParsedName } from './scene-parser.js';

export interface IdentifySummary {
  movies: number;
  episodes: number;
  skipped: number;
}

/** Lowercased title without leading articles, used to group files under the same item. */
export function sortKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/^(the|a|an)\s+/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Comic libraries never reach the identifier; their books are scanned by comics/scanner.ts.
type LibraryKind = 'movie' | 'tv' | 'anime' | 'comic';

export type NameParser = (
  fileName: string,
  parentDirs: string[],
  libraryKind: LibraryKind,
) => ParsedName;

const SEASON_DIR = /^(?:Season|Series|S)[ ._-]?\d{1,2}$/i;

/**
 * Default parser: scene rules for movie libraries. In TV and anime libraries the show is named by
 * its folder (see folders.ts) and the file name supplies the numbers: fansub rules for anime,
 * scene rules for TV with fansub numbering as a fallback for anime-style names. Films, OVAs, and
 * specials inside a show folder, and TV files with no season or episode at all, go to season 0. An anime file whose name gives no season keeps its
 * number as absoluteEpisode for later season mapping.
 */
export const defaultParser: NameParser = (fileName, parentDirs, libraryKind) => {
  if (libraryKind === 'movie') return parseSceneName(fileName, parentDirs);
  const folder = showFolder(parentDirs);
  const inner = folder ? parentDirs.slice(folder.index + 1) : [];
  let parsed: ParsedName =
    libraryKind === 'anime'
      ? parseFansubName(fileName, parentDirs)
      : parseTv(fileName, parentDirs, inner);
  const special =
    inner.some(isSpecialsDir) ||
    (libraryKind === 'anime' && isSpecialName(fileName)) ||
    (libraryKind === 'tv' && parsed.episode === null && parsed.season === null);
  const fileTitle = parsed.title;
  if (special && parsed.season !== 0) {
    parsed = { ...parsed, season: 0, episode: null, episodeEnd: null };
  }
  // An anime folder named only by the start of the title ("demon" for "Demon Lord", "Bleach"
  // around "Bleach Sennen Kessen-hen") yields to the fuller title in the file name, which is the
  // AniList entry; a fuller folder name ("Love Live! School Idol Project") wins as usual.
  const ownTitle = libraryKind === 'anime' ? parseFansubName(fileName).title : '';
  const fileExtendsFolder =
    libraryKind === 'anime' &&
    !special &&
    folder !== null &&
    sortKey(ownTitle).startsWith(sortKey(folder.title) + ' ');
  if (folder && !fileExtendsFolder) {
    // A special's own year (a film's release) says nothing about when the show began.
    parsed = {
      ...parsed,
      title: folder.title,
      year: folder.year ?? (special ? null : parsed.year),
    };
  } else if (fileExtendsFolder) {
    parsed = { ...parsed, title: ownTitle };
  }
  if (parsed.episode === null) parsed = { ...parsed, episodeTitle: fileTitle };
  if (libraryKind === 'anime' && parsed.season === null && parsed.episode !== null) {
    return { ...parsed, episode: null, episodeEnd: null, absoluteEpisode: parsed.episode };
  }
  return { ...parsed, absoluteEpisode: null };
};

/**
 * Scene rules, then fansub numbering for anime-style names in a TV library ("Death Note 01
 * 'Rebirth'", "Wolverine and the X-Men - Ep. 15") as season 1, but only for files in the show or
 * a season folder: anywhere else an unmarked file is a special, not episode one.
 */
function parseTv(fileName: string, parentDirs: string[], inner: string[]): ParsedName {
  const scene = parseSceneName(fileName, parentDirs);
  if (scene.kind === 'episode' && scene.episode !== null) return scene;
  if (!inner.every((d) => SEASON_DIR.test(d))) return { ...scene, kind: 'episode' };
  const fansub = parseFansubName(fileName, parentDirs);
  if (fansub.episode === null) return { ...scene, kind: 'episode' };
  return {
    kind: 'episode',
    title: fansub.title,
    year: fansub.year,
    season: fansub.season ?? scene.season ?? 1,
    episode: fansub.episode,
    episodeEnd: fansub.episodeEnd,
    confidence: 'low',
  };
}

/** Links each unlinked file in fileIds to a movie or episode, creating items as needed. */
export function identifyFiles(
  db: Db,
  fileIds: string[],
  log?: FastifyBaseLogger,
  parser: NameParser = defaultParser,
): IdentifySummary {
  const summary: IdentifySummary = { movies: 0, episodes: 0, skipped: 0 };
  if (fileIds.length === 0) return summary;

  const files = db
    .select({
      id: schema.mediaFiles.id,
      path: schema.mediaFiles.path,
      fileName: schema.mediaFiles.fileName,
      libraryId: schema.mediaFiles.libraryId,
      libraryKind: schema.libraries.kind,
      probedAt: schema.mediaFiles.probedAt,
      probeJson: schema.mediaFiles.probeJson,
    })
    .from(schema.mediaFiles)
    .innerJoin(schema.libraries, eq(schema.libraries.id, schema.mediaFiles.libraryId))
    .where(
      and(
        inArray(schema.mediaFiles.id, fileIds),
        isNull(schema.mediaFiles.movieId),
        isNull(schema.mediaFiles.episodeId),
      ),
    )
    .all();

  for (const file of files) {
    // A file ffprobe could not read is not media; leave it unlinked.
    if (file.probedAt && file.probeJson && JSON.parse(file.probeJson).error) {
      summary.skipped += 1;
      continue;
    }
    const libraryRoots = db
      .select({ path: schema.libraryPaths.path })
      .from(schema.libraryPaths)
      .where(eq(schema.libraryPaths.libraryId, file.libraryId))
      .all()
      .map((r) => r.path);
    const parentDirs = relativeParentDirs(file.path, libraryRoots);
    const parsed = parser(file.fileName, parentDirs, file.libraryKind);
    try {
      if (
        file.libraryKind === 'movie' ||
        (parsed.kind === 'movie' && file.libraryKind !== 'anime' && file.libraryKind !== 'tv')
      ) {
        linkMovie(db, file.id, file.libraryId, parsed);
        summary.movies += 1;
      } else {
        linkEpisode(db, file.id, file.libraryId, parsed);
        summary.episodes += 1;
      }
    } catch (error) {
      summary.skipped += 1;
      log?.warn({ path: file.path, error: String(error) }, 'identify failed');
    }
  }
  return summary;
}

/** Directory names between the library root and the file, outermost first. */
export function relativeParentDirs(filePath: string, roots: string[]): string[] {
  const root = roots
    .filter((r) => filePath.startsWith(r + path.sep))
    .sort((a, b) => b.length - a.length)[0];
  const rel = root ? path.relative(root, filePath) : filePath;
  const parts = rel.split(path.sep);
  parts.pop();
  return parts.filter(Boolean);
}

function linkMovie(db: Db, fileId: string, libraryId: string, parsed: ParsedName): void {
  const key = sortKey(parsed.title);
  const ts = now();
  const existing = db
    .select({ id: schema.movies.id })
    .from(schema.movies)
    .where(
      and(
        eq(schema.movies.libraryId, libraryId),
        eq(schema.movies.sortTitle, key),
        parsed.year ? eq(schema.movies.year, parsed.year) : isNull(schema.movies.year),
      ),
    )
    .get();
  const movieId = existing?.id ?? randomUUID();
  if (!existing) {
    db.insert(schema.movies)
      .values({
        id: movieId,
        libraryId,
        title: parsed.title,
        sortTitle: key,
        year: parsed.year,
        needsReview: true,
        createdAt: ts,
        updatedAt: ts,
      })
      .run();
  }
  db.update(schema.mediaFiles)
    .set({ movieId, updatedAt: ts })
    .where(eq(schema.mediaFiles.id, fileId))
    .run();
}

function linkEpisode(db: Db, fileId: string, libraryId: string, parsed: ParsedName): void {
  const key = sortKey(parsed.title);
  const ts = now();
  let show = db
    .select({ id: schema.shows.id })
    .from(schema.shows)
    .where(and(eq(schema.shows.libraryId, libraryId), eq(schema.shows.sortTitle, key)))
    .get();
  if (!show) {
    show = { id: randomUUID() };
    db.insert(schema.shows)
      .values({
        id: show.id,
        libraryId,
        title: parsed.title,
        sortTitle: key,
        year: parsed.year,
        needsReview: true,
        createdAt: ts,
        updatedAt: ts,
      })
      .run();
  }

  let seasonId: string | null = null;
  if (parsed.season !== null) {
    const season = db
      .select({ id: schema.seasons.id })
      .from(schema.seasons)
      .where(
        and(eq(schema.seasons.showId, show.id), eq(schema.seasons.seasonNumber, parsed.season)),
      )
      .get();
    seasonId = season?.id ?? randomUUID();
    if (!season) {
      db.insert(schema.seasons)
        .values({
          id: seasonId,
          showId: show.id,
          seasonNumber: parsed.season,
          title: parsed.season === 0 ? 'Specials' : `Season ${parsed.season}`,
          createdAt: ts,
          updatedAt: ts,
        })
        .run();
    }
  }

  const absolute = parsed.absoluteEpisode ?? null;
  const conditions = [eq(schema.episodes.showId, show.id)];
  if (absolute !== null) {
    conditions.push(eq(schema.episodes.absoluteNumber, absolute));
  } else {
    conditions.push(
      parsed.season === null
        ? isNull(schema.episodes.seasonNumber)
        : eq(schema.episodes.seasonNumber, parsed.season),
    );
    conditions.push(
      parsed.episode === null
        ? isNull(schema.episodes.episodeNumber)
        : eq(schema.episodes.episodeNumber, parsed.episode),
    );
  }
  // Files with no number at all cannot be grouped, so each gets its own row.
  const existing =
    parsed.episode === null && absolute === null
      ? undefined
      : db
          .select({ id: schema.episodes.id })
          .from(schema.episodes)
          .where(and(...conditions))
          .get();
  const episodeId = existing?.id ?? randomUUID();
  if (!existing) {
    db.insert(schema.episodes)
      .values({
        id: episodeId,
        showId: show.id,
        seasonId,
        seasonNumber: parsed.season,
        episodeNumber: parsed.episode,
        absoluteNumber: absolute,
        title:
          parsed.episode === null && absolute === null
            ? (parsed.episodeTitle ?? parsed.title)
            : null,
        createdAt: ts,
        updatedAt: ts,
      })
      .run();
  }
  db.update(schema.mediaFiles)
    .set({ episodeId, updatedAt: ts })
    .where(eq(schema.mediaFiles.id, fileId))
    .run();
}
