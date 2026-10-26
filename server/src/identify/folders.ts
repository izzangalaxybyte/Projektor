// Folder rules for TV and anime libraries. A show lives in one folder under the library root,
// and that folder names the show far more reliably than episode file names do: those are often
// just "069 - Big Trouble In Little Edo.mkv" or carry the episode title in the middle. File names
// still supply the season and episode numbers.

/** Folders that hold many shows rather than being one: "Ongoing", "Other", "Spring 2022". */
const CATCH_ALL =
  /^(?:ongoing|current|other|others|misc|miscellaneous|new|anime|tv|tv shows|shows|series|downloads?|completed|finished|watching|watched|unsorted|to sort|movies? (?:&|and) others?|(?:spring|summer|fall|autumn|winter)(?: \d{4})?)$/i;

/** Folders below a show that hold films, specials, or OVAs rather than numbered episodes. */
const SPECIALS_WORDS = /\b(?:movies?|films?|specials?|ovas?|oads?|onas?)\b/i;

export interface ShowFolder {
  title: string;
  year: number | null;
  /** Position of the show folder in parentDirs. */
  index: number;
}

/**
 * The folder that names the show: the outermost folder under the library root that is not a
 * catch-all, or null for a file sitting loose in the root or in a catch-all folder.
 */
export function showFolder(parentDirs: string[]): ShowFolder | null {
  for (let i = 0; i < parentDirs.length; i++) {
    const dir = parentDirs[i]!;
    if (CATCH_ALL.test(tidy(stripTags(dir)))) continue;
    const { title, year } = cleanFolderTitle(dir);
    return title ? { title, year, index: i } : null;
  }
  return null;
}

/**
 * Release folder names carry the show plus everything about the release. Keeps the title and the
 * first year: "Futurama (1999) Season 1-7 S01-S07 + Extras (Mixed x265 …) REPACK" → Futurama, 1999;
 * "Buffy.the.Vampire.Slayer.seasons.01-07.AMZN.1080p" → Buffy the Vampire Slayer;
 * "Gintama 001-367 (Seasons 1-10) [BD 1080p]" → Gintama.
 */
export function cleanFolderTitle(dirName: string): { title: string; year: number | null } {
  let name = dirName.replace(/_/g, ' ');
  // Dotted scene names have no spaces; a dot inside a spaced name is part of the title.
  if (!name.includes(' ')) name = name.replace(/\./g, ' ');
  name = name.replace(/^(?:\s*\[[^\]]*\])+/, '').trim();

  const yearMatch = /(?<![\d-])(19[2-9]\d|20[0-4]\d)(?!\d)/.exec(name);
  const year = yearMatch ? Number(yearMatch[1]) : null;

  const cut = [
    /[([]/,
    /\s\+/,
    /\s[-–]\s/,
    /\b(?:19[2-9]\d|20[0-4]\d)\b/,
    /\bS\d{1,2}(?:\b|[EP]\d)/i,
    /\bS\d{1,2}[-–]/i,
    /\bSeasons?\b/i,
    /\bSeries\s\d/i,
    /\bComplete\b/i,
    /\b\d{1,4}\s?[-–~]\s?\d{1,4}\b/,
    /\b\d{3,4}p\b/i,
    /\b(?:BD|BDRip|BluRay|WEB|WEB-DL|WEBRip|DVD|DVDRip|HDTV|x26[45]|HEVC|AMZN|Dual|Multi)\b/i,
  ]
    .map((re) => re.exec(name)?.index ?? -1)
    .filter((i) => i > 0);
  if (cut.length) name = name.slice(0, Math.min(...cut));
  return { title: tidy(name), year };
}

/** True when a folder between the show folder and the file holds films, specials, or OVAs. */
export function isSpecialsDir(dirName: string): boolean {
  return SPECIALS_WORDS.test(tidy(dirName.replace(/[._]/g, ' ')));
}

/**
 * Anime file names that announce a film, OVA, or recap rather than an episode:
 * "Digimon Adventure tri. 2 Determination (Dub) Movie.MP4", "Date A Live - OVA - Date to Date",
 * "Nanbaka - Special", "Kobayashi-san Chi no Maid Dragon Shorts - SP1".
 */
export function isSpecialName(fileName: string): boolean {
  const stem = fileName.replace(/\.[a-z0-9]{2,4}$/i, '').replace(/[._]/g, ' ');
  return /\b(?:Movie|Film|OVA|OAD|ONA)\b|\dE(?:OVA|OAD|SP)\b|\bSP ?\d{1,2}\b|\s[-–!]\s?(?:Special|Outtakes)\b/i.test(
    stem.replace(/\[[^\]]*\]/g, ' '),
  );
}

function stripTags(text: string): string {
  return text.replace(/\[[^\]]*\]|\([^)]*\)/g, ' ');
}

function tidy(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–.]+|[\s\-–.,]+$/g, '')
    .trim();
}
