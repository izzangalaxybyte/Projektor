import { describe, expect, it } from 'vitest';
import type { MediaFile } from '../api/client.js';
import { closestVersion } from './versions.js';

const file = (fileName: string, sizeBytes = 1) => ({ fileName, sizeBytes }) as MediaFile;

describe('closestVersion', () => {
  it('keeps to the release being watched', () => {
    const options = [
      file('[Other] Show - 02 [720p].mkv', 9),
      file('[Group] Show - 02 [1080p].mkv'),
    ];
    expect(closestVersion('[Group] Show - 01 [1080p].mkv', options)?.fileName).toBe(
      '[Group] Show - 02 [1080p].mkv',
    );
  });

  it('takes the larger file on a tie and the only file when there is one', () => {
    expect(closestVersion('x', [file('a.mkv', 1), file('b.mkv', 2)])?.fileName).toBe('b.mkv');
    expect(closestVersion(undefined, [file('a.mkv')])?.fileName).toBe('a.mkv');
    expect(closestVersion('a.mkv', [])).toBeUndefined();
  });
});
