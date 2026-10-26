import { opendir, stat } from 'node:fs/promises';
import path from 'node:path';

export const VIDEO_EXTENSIONS = new Set([
  '.mkv',
  '.mp4',
  '.m4v',
  '.avi',
  '.mov',
  '.wmv',
  '.ts',
  '.m2ts',
  '.webm',
  '.flv',
  '.mpg',
  '.mpeg',
  '.ogv',
]);

export interface WalkedFile {
  path: string;
  fileName: string;
  sizeBytes: number;
  mtimeMs: number;
}

export interface WalkOptions {
  /** Called for directories that could not be read; the walk continues. */
  onError?: (dir: string, error: unknown) => void;
}

/**
 * Recursively yields video files under a root. Hidden entries, unreadable dirs, samples, and
 * disc extras are skipped.
 */
export async function* walkVideos(
  root: string,
  options: WalkOptions = {},
): AsyncGenerator<WalkedFile> {
  const pending = [root];
  while (pending.length > 0) {
    const dir = pending.pop()!;
    let handle;
    try {
      handle = await opendir(dir);
    } catch (error) {
      options.onError?.(dir, error);
      continue;
    }
    for await (const entry of handle) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // A show's own folder is never an extras folder, even for a show called "Extras".
        if (!isSampleDir(entry.name) && (dir === root || !isExtraDir(entry.name)))
          pending.push(full);
        continue;
      }
      if (!entry.isFile() && !entry.isSymbolicLink()) continue;
      if (!VIDEO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
      if (isSampleFile(entry.name) || isExtraFile(entry.name)) continue;
      try {
        const info = await stat(full);
        if (!info.isFile()) continue;
        yield {
          path: full,
          fileName: entry.name,
          sizeBytes: info.size,
          mtimeMs: Math.floor(info.mtimeMs),
        };
      } catch (error) {
        options.onError?.(full, error);
      }
    }
  }
}

/**
 * Release "sample" clips sit beside the film and would otherwise be linked to it and played
 * first. Only the release conventions count: the whole name is "sample", or it ends in
 * "-sample", ".sample", or "[sample]", or it lives in a Sample folder. A title that merely
 * contains the word ("Sample Movie (2019)", "Sample.Show.S01E02") is left alone.
 */
export function isSampleFile(fileName: string): boolean {
  const stem = fileName.replace(/\.[^.]+$/, '');
  if (/^sample$/i.test(stem)) return true;
  return /[\s._\-[(]sample[\])]?$/i.test(stem);
}

export function isSampleDir(dirName: string): boolean {
  return /^samples?$/i.test(dirName);
}

/**
 * Disc and release extras: featurettes, interviews, trailers, creditless openings and endings.
 * They are not episodes or films, and each one used to become an item of its own. Only folders
 * named for that purpose count ("Extras", "Featurettes", "NC", "Movie 14 Extras"), matched after
 * dropping bracketed tags. The walker never applies this to a top-level folder, so a show called
 * "Extras" is still scanned.
 */
export function isExtraDir(dirName: string): boolean {
  const name = dirName
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    .replace(/[._]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return /^(?:.+ )?extras$|^(?:(?:season|s) ?\d{1,2} )?(?:extras?(?: videos?)?|bonus(?: features)?|featurettes?|behind the scenes|deleted scenes|interviews?|trailers?|promos?|menus?|nc|ncop|nced|creditless|openings?(?: (?:&|and) endings?)?|endings?|other extras|special features)$/i.test(
    name,
  );
}

/**
 * Creditless openings and endings and files marked "(Extra)" that sit among the episodes rather
 * than in an extras folder: "[Judas] Gintama - NCOP 16a.mkv", "Fuuka - NCOP.mkv",
 * "Steins;Gate - Creditless ED.mkv", "Dragon Ball Z (Extra) - Interview.mp4".
 */
export function isExtraFile(fileName: string): boolean {
  const stem = fileName.replace(/\.[^.]+$/, '').replace(/[._]/g, ' ');
  if (
    /\bNC ?(?:OP|ED)\b|\bNC(?:OP|ED)\d|\b(?:Creditless|Textless|Clean) (?:OP|ED|Opening|Ending)\b|\((?:Extra|Bonus)\)|\s-\s(?:EXTRA|Extra)\s-\s/i.test(
      stem,
    )
  ) {
    return true;
  }
  // Release-group promo clips named after the group: "ETRG.mp4", "RARBG.mp4".
  if (/^(?:ETRG|RARBG|YIFY|YTS|TGx|EVO|PSA)$/i.test(stem.trim())) return true;
  // An opening, ending, or promo named as such at the end: "[Mites] Nisekoi - ED1 [1080p]",
  // "Koi to Senkyo to Chocolate - PV", "Kaichou wa Maid-sama OP1".
  const bare = stem.replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').trim();
  return /\s(?:[-–]\s)?(?:OP|ED|PV|CM)\s?\d{0,2}(?:[ .]\d+)?[a-z]?$/.test(bare);
}
