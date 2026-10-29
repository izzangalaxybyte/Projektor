import type { MediaFile } from '../api/client.js';

/**
 * The version of the next episode most like the one being watched: the file whose name shares the
 * longest start with the current one (same release group and naming), largest on a tie. Mirrors
 * closestVersion in the Android core module.
 */
export function closestVersion(
  currentFileName: string | undefined,
  options: MediaFile[],
): MediaFile | undefined {
  if (currentFileName === undefined || options.length < 2) return options[0];
  const score = (f: MediaFile) => commonPrefix(f.fileName, currentFileName);
  return options.reduce((best, f) =>
    score(f) > score(best) || (score(f) === score(best) && f.sizeBytes > best.sizeBytes) ? f : best,
  );
}

function commonPrefix(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i]!.toLowerCase() === b[i]!.toLowerCase()) i++;
  return i;
}
