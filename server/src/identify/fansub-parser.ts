// Filename parsing for fansub style anime releases, e.g.
//   [SubsPlease] Frieren - Sousou no Frieren - 28 (1080p) [ABC123].mkv
//   [Judas] Spy x Family - S02E03v2 [1080p][HEVC x265 10bit][Multi-Subs].mkv
//   [Erai-raws] Jujutsu Kaisen 2nd Season - 05 [1080p].mkv
// Anime numbering is usually absolute within a titled entry; a season is only known when the
// name says so (SxxEyy, "2nd Season", "Season 2", "S2", "(Season 1)") or the folder does.
import type { ParsedName } from './scene-parser.js';

export interface ParsedFansub extends ParsedName {
  kind: 'episode';
  /** Title including any season phrase, as fansub groups and AniList name it. */
  searchTitle: string;
  group: string | null;
  version: number | null;
}

const SEASON_FOLDER = /^(?:Season|Series|S)[ ._-]?(\d{1,2})$/i;
const LEADING_GROUP = /^\[([^\]]+)\]\s*/;
const YEAR_PAREN = /\((19[2-9]\d|20[0-4]\d)\)/;
const SEASON_PAREN = /\((?:Season|S)\s*(\d{1,2})\)/i;
const SXXEYY = /\bS(\d{1,2})E(\d{1,4})(?:-E?(\d{1,4}))?(?:v(\d))?\b/i;
// " - 13", " - 13v2", " - 13-14", " - 13 END", " - 1000", "- 05.5" (half episodes are floored)
const DASH_EPISODE =
  /\s[-–]\s(\d{1,4})(?:\.\d)?(?:\s*[-~]\s*(\d{1,4}))?(?:v(\d))?(?:\s+(?:END|FINAL|OVA|SP))?\s*$/i;
const DASH_EPISODE_MID =
  /\s[-–]\s(\d{1,4})(?:\.\d)?(?:\s*[-~]\s*(\d{1,4}))?(?:v(\d))?(?:\s+(?:END|FINAL))?(?=\s[-–]\s|\s*$)/i;
const WORD_EPISODE = /\b(?:Episode|Ep\.?|E)\s?(\d{1,4})(?:v(\d))?\b/i;
const TRAILING_NUMBER = /(?:^|\s)(\d{1,4})(?:v(\d))?$/;
const SEASON_IN_TITLE: RegExp[] = [
  /\s(\d{1,2})(?:st|nd|rd|th)\s+Season\b/i,
  /\sSeason\s+(\d{1,2})\b/i,
  /\sS(\d{1,2})\b(?!E)/,
  /\s(?:Part|Cour)\s+(\d{1,2})\b/i,
];

export function parseFansubName(fileName: string, parentDirs: string[] = []): ParsedFansub {
  let rest = fileName
    .replace(/\.[a-z0-9]{2,4}$/i, '')
    .replace(/_/g, ' ')
    .trim();

  let group: string | null = null;
  const lead = LEADING_GROUP.exec(rest);
  if (lead) {
    group = lead[1]!.trim();
    rest = rest.slice(lead[0].length);
  }

  const yearMatch = YEAR_PAREN.exec(rest);
  let year = yearMatch ? Number(yearMatch[1]) : null;
  const seasonParen = SEASON_PAREN.exec(rest);
  let season: number | null = seasonParen ? Number(seasonParen[1]) : null;

  // Drop every bracketed or parenthesised tag: resolution, codec, hash, audio, subs.
  rest = rest
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  let episode: number | null = null;
  let episodeEnd: number | null = null;
  let version: number | null = null;
  let titlePart = rest;

  const sxe = SXXEYY.exec(rest);
  if (sxe) {
    season = Number(sxe[1]);
    episode = Number(sxe[2]);
    episodeEnd = sxe[3] ? Number(sxe[3]) : null;
    version = sxe[4] ? Number(sxe[4]) : null;
    titlePart = rest.slice(0, sxe.index);
  } else {
    const dash = DASH_EPISODE.exec(rest) ?? DASH_EPISODE_MID.exec(rest);
    if (dash) {
      episode = Number(dash[1]);
      episodeEnd = dash[2] ? Number(dash[2]) : null;
      version = dash[3] ? Number(dash[3]) : null;
      titlePart = rest.slice(0, dash.index);
    } else {
      const word = WORD_EPISODE.exec(rest);
      if (word) {
        episode = Number(word[1]);
        version = word[2] ? Number(word[2]) : null;
        titlePart = rest.slice(0, word.index);
      } else {
        const trailing = TRAILING_NUMBER.exec(rest);
        if (trailing) {
          episode = Number(trailing[1]);
          version = trailing[2] ? Number(trailing[2]) : null;
          titlePart = rest.slice(0, trailing.index);
        }
      }
    }
  }
  if (episodeEnd !== null && episodeEnd <= episode!) episodeEnd = null;

  let searchTitle = tidy(titlePart);
  let title = searchTitle;
  for (const pattern of SEASON_IN_TITLE) {
    const m = pattern.exec(` ${title}`);
    if (m) {
      if (season === null) season = Number(m[1]);
      title = tidy(` ${title}`.replace(pattern, ' '));
      break;
    }
  }

  const parent = parentDirs[parentDirs.length - 1];
  const grandparent = parentDirs[parentDirs.length - 2];
  const folderSeason = parent ? SEASON_FOLDER.exec(parent)?.[1] : undefined;
  if (folderSeason !== undefined && season === null) season = Number(folderSeason);
  if (!title) {
    const folder = folderSeason !== undefined ? grandparent : parent;
    if (folder) {
      const folderYear = YEAR_PAREN.exec(folder);
      if (folderYear && year === null) year = Number(folderYear[1]);
      title = tidy(folder.replace(/\[[^\]]*\]/g, ' ').replace(/\([^)]*\)/g, ' '));
      searchTitle = title;
    }
  }
  if (!title) title = searchTitle = tidy(rest) || fileName;

  return {
    kind: 'episode',
    title,
    searchTitle,
    year,
    season,
    episode,
    episodeEnd,
    confidence: episode !== null && titlePart.trim() !== '' ? 'high' : 'low',
    group,
    version,
  };
}

function tidy(text: string): string {
  return text
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–]+|[\s\-–]+$/g, '')
    .trim();
}
