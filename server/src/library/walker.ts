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

/** Recursively yields video files under a root. Hidden entries and unreadable dirs are skipped. */
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
        if (!isSampleDir(entry.name)) pending.push(full);
        continue;
      }
      if (!entry.isFile() && !entry.isSymbolicLink()) continue;
      if (!VIDEO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
      if (isSampleFile(entry.name)) continue;
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
