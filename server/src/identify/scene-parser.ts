// Filename parsing for scene and Plex style names. parse-torrent-title does the heavy
// lifting for titles, years, and release tags; the episode patterns and folder hints here
// cover what it misses (multi-episode ranges, "S02.E07", "1x05", "Season 01/Episode 3").
import ptt from 'parse-torrent-title';

export type ParsedKind = 'movie' | 'episode';

export interface ParsedName {
  kind: ParsedKind;
  title: string;
  year: number | null;
  season: number | null;
  episode: number | null;
  /** Last episode number for multi-episode files like S01E01-E02; null for single episodes. */
  episodeEnd: number | null;
  /** Low when we had to fall back to folder names or found no year and no episode markers. */
  confidence: 'high' | 'low';
}

const EPISODE_PATTERNS: RegExp[] = [
  // S01E02, S01E02E03, S01E02-E03, S01E02-03, S01.E02, S01 E02
  /\bS(\d{1,2})[ ._-]?E(\d{1,3})(?:[ ._-]?(?:E|-E?)(\d{1,3}))*/i,
  // 1x05, 1x05-06
  /\b(\d{1,2})x(\d{1,3})(?:-(\d{1,3}))?\b/i,
  // Season 1 Episode 5
  /\bSeason[ ._-]?(\d{1,2})[ ._-]+Episode[ ._-]?(\d{1,3})\b/i,
];

// Used when the season comes from the folder: "Episode 3", "E03", "Ep 3", "03 - Title"
const EPISODE_ONLY_PATTERNS: RegExp[] = [
  /\b(?:Episode|Ep|E)[ ._-]?(\d{1,3})\b/i,
  /^(\d{1,3})\b[ ._-]/,
];
const SEASON_FOLDER = /^(?:Season|Series|S)[ ._-]?(\d{1,2})$/i;
const SPECIALS_FOLDER = /^Specials$/i;
const TITLE_YEAR_FOLDER = /^(.+?)[ ._]?\((\d{4})\)/;

export function parseSceneName(fileName: string, parentDirs: string[] = []): ParsedName {
  const base = stripExtension(fileName);
  const parent = parentDirs[parentDirs.length - 1] ?? null;
  const grandparent = parentDirs[parentDirs.length - 2] ?? null;
  const seasonFolder = parent
    ? (SEASON_FOLDER.exec(parent)?.[1] ?? (SPECIALS_FOLDER.test(parent) ? '0' : null))
    : null;

  const episodeMatch = matchEpisode(base);
  if (episodeMatch) {
    const before = base.slice(0, episodeMatch.index).trim();
    let title = cleanTitle(before, true);
    let confidence: ParsedName['confidence'] = 'high';
    if (!title && seasonFolder !== null && grandparent) title = cleanTitle(grandparent);
    else if (!title && parent) title = cleanTitle(parent);
    if (!title) {
      title = cleanTitle(base);
      confidence = 'low';
    }
    const year =
      extractYear(before) ??
      (seasonFolder !== null && grandparent ? extractYear(grandparent) : null);
    return {
      kind: 'episode',
      title,
      year,
      season: episodeMatch.season,
      episode: episodeMatch.episode,
      episodeEnd: episodeMatch.episodeEnd,
      confidence,
    };
  }

  if (seasonFolder !== null) {
    // Season folder without an SxxExx marker in the file name: "Season 01/Episode 3.mkv".
    const episode = matchEpisodeOnly(base);
    const title = grandparent ? cleanTitle(grandparent) : cleanTitle(base);
    return {
      kind: 'episode',
      title,
      year: grandparent ? extractYear(grandparent) : null,
      season: Number(seasonFolder),
      episode,
      episodeEnd: null,
      confidence: episode === null || !grandparent ? 'low' : 'high',
    };
  }

  const parsed = ptt.parse(base);
  let title = parsed.title ? cleanTitle(parsed.title) : '';
  let year = parsed.year ?? null;
  let confidence: ParsedName['confidence'] = year ? 'high' : 'low';

  // Plex style "Title (Year)/anything.mkv": the folder is more reliable than the file.
  if (parent) {
    const folder = TITLE_YEAR_FOLDER.exec(parent);
    if (folder) {
      const folderTitle = cleanTitle(folder[1]!);
      const folderYear = Number(folder[2]);
      if (!year || !title || title.toLowerCase() !== folderTitle.toLowerCase()) {
        title = folderTitle;
        year = folderYear;
        confidence = 'high';
      }
    }
  }
  if (!title) {
    title = cleanTitle(base);
    confidence = 'low';
  }
  return { kind: 'movie', title, year, season: null, episode: null, episodeEnd: null, confidence };
}

interface EpisodeMatch {
  index: number;
  season: number;
  episode: number;
  episodeEnd: number | null;
}

function matchEpisode(name: string): EpisodeMatch | null {
  for (const pattern of EPISODE_PATTERNS) {
    const m = pattern.exec(name);
    if (!m) continue;
    const season = Number(m[1]);
    const episode = Number(m[2]);
    // Reject things like "1920x1080" that look like 1x05 patterns.
    if (pattern.source.startsWith('\\b(\\d{1,2})x') && /\d{3,4}x\d{3,4}/.test(m[0])) continue;
    let episodeEnd: number | null = null;
    if (m[3]) episodeEnd = Number(m[3]);
    else if (pattern === EPISODE_PATTERNS[0]) {
      // Capture groups only keep the last repetition; re-scan the matched text for all episode numbers.
      const all = [...m[0].matchAll(/E(\d{1,3})/gi)].map((x) => Number(x[1]));
      const trailing = /-(\d{1,3})$/.exec(m[0]);
      const last = trailing ? Number(trailing[1]) : all[all.length - 1];
      if (last !== undefined && last > episode) episodeEnd = last;
    }
    if (episodeEnd !== null && episodeEnd <= episode) episodeEnd = null;
    return { index: m.index, season, episode, episodeEnd };
  }
  return null;
}

function matchEpisodeOnly(name: string): number | null {
  for (const pattern of EPISODE_ONLY_PATTERNS) {
    const m = pattern.exec(name);
    if (m) return Number(m[1]);
  }
  return null;
}

function extractYear(text: string): number | null {
  const years = [...text.matchAll(/(?<!\d)(19[2-9]\d|20[0-4]\d)(?!\d)/g)].map((m) => Number(m[1]));
  // Prefer the last year-like token so "2012.2009" (film 2012 from 2009) yields 2009.
  return years.length ? years[years.length - 1]! : null;
}

function stripExtension(fileName: string): string {
  return fileName.replace(/\.[a-z0-9]{2,4}$/i, '');
}

/**
 * Turns "Some.Show_Name (2019) -" into "Some Show Name". A trailing bare year is only
 * removed when stripTrailingYear is set: titles from parse-torrent-title already had their
 * year removed, and a remaining number is part of the title ("Blade Runner 2049").
 */
export function cleanTitle(raw: string, stripTrailingYear = false): string {
  let t = raw
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\((?:19|20)\d{2}\)/g, ' ')
    .replace(/[._]/g, ' ')
    .replace(/\s*[-–]\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (stripTrailingYear) t = t.replace(/\s(19[2-9]\d|20[0-4]\d)$/, '');
  return t.trim();
}
