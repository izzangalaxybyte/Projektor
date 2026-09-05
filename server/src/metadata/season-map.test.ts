import { describe, expect, it } from 'vitest';
import { mapAbsoluteEpisode } from './season-map.js';

const uneven = [
  { seasonNumber: 0, episodeCount: 3 },
  { seasonNumber: 1, episodeCount: 12 },
  { seasonNumber: 2, episodeCount: 25 },
  { seasonNumber: 3, episodeCount: 5 },
];

describe('mapAbsoluteEpisode', () => {
  it('maps across seasons of different lengths and ignores specials', () => {
    expect(mapAbsoluteEpisode(1, uneven)).toEqual({ seasonNumber: 1, episodeNumber: 1 });
    expect(mapAbsoluteEpisode(12, uneven)).toEqual({ seasonNumber: 1, episodeNumber: 12 });
    expect(mapAbsoluteEpisode(13, uneven)).toEqual({ seasonNumber: 2, episodeNumber: 1 });
    expect(mapAbsoluteEpisode(37, uneven)).toEqual({ seasonNumber: 2, episodeNumber: 25 });
    expect(mapAbsoluteEpisode(38, uneven)).toEqual({ seasonNumber: 3, episodeNumber: 1 });
    expect(mapAbsoluteEpisode(42, uneven)).toEqual({ seasonNumber: 3, episodeNumber: 5 });
  });
  it('returns null outside the known seasons', () => {
    expect(mapAbsoluteEpisode(43, uneven)).toBeNull();
    expect(mapAbsoluteEpisode(0, uneven)).toBeNull();
    expect(mapAbsoluteEpisode(5, [])).toBeNull();
  });
  it('applies the offset before mapping', () => {
    // A sequel entry numbered from 1 that TMDB files as season 2.
    expect(mapAbsoluteEpisode(1, uneven, 12)).toEqual({ seasonNumber: 2, episodeNumber: 1 });
    expect(mapAbsoluteEpisode(13, uneven, -12)).toEqual({ seasonNumber: 1, episodeNumber: 1 });
    expect(mapAbsoluteEpisode(1, uneven, -5)).toBeNull();
  });
  it('tolerates unordered season lists', () => {
    expect(mapAbsoluteEpisode(13, [uneven[2]!, uneven[1]!])).toEqual({
      seasonNumber: 2,
      episodeNumber: 1,
    });
  });
});
