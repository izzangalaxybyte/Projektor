export interface SeasonLength {
  seasonNumber: number;
  episodeCount: number;
}

export interface MappedEpisode {
  seasonNumber: number;
  episodeNumber: number;
}

/**
 * Maps an absolute episode number onto TMDB seasons by cumulative episode counts. Season 0
 * (specials) is ignored. `offset` is added to the absolute number first, so a show whose
 * fansub numbering starts over for a sequel entry can be shifted onto the right TMDB season.
 * Returns null when the number falls outside every season.
 */
export function mapAbsoluteEpisode(
  absolute: number,
  seasons: SeasonLength[],
  offset = 0,
): MappedEpisode | null {
  let remaining = absolute + offset;
  if (remaining < 1) return null;
  const ordered = seasons
    .filter((s) => s.seasonNumber > 0 && s.episodeCount > 0)
    .sort((a, b) => a.seasonNumber - b.seasonNumber);
  for (const season of ordered) {
    if (remaining <= season.episodeCount)
      return { seasonNumber: season.seasonNumber, episodeNumber: remaining };
    remaining -= season.episodeCount;
  }
  return null;
}
