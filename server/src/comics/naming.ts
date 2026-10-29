// Comic and manga file names: volume and chapter numbers, the series name, and the reading order.

export interface ComicNumbering {
  /** "v03", "Vol. 3", "Volume 03", "Tome 3", "第3巻". */
  volume: number | null;
  /** "c120", "Ch. 120.5", "Chapter 120", "#12", "第120話", or a bare trailing number. */
  chapter: number | null;
  /** The chapter came from a bare number ("Batman 001", "One Piece - 121"), not a marker. */
  bare: boolean;
  /** Extras, specials, omake, one-shots: kept after the numbered books they sit beside. */
  special: boolean;
  /** The name with the numbering and release tags taken out, for files with no series folder. */
  series: string;
}

const NUM = String.raw`(\d+(?:\.\d+)?)`;
const VOLUME = [
  new RegExp(String.raw`\b(?:vol(?:ume)?|tome|tomo|band|bd)\.?\s*${NUM}`, 'i'),
  new RegExp(String.raw`\b[vt]${NUM}\b`, 'i'),
  new RegExp(String.raw`第\s*${NUM}\s*[巻卷]`),
];
const CHAPTER = [
  new RegExp(String.raw`\b(?:ch(?:apter|ap)?|ep(?:isode)?|issue|no)\.?\s*${NUM}`, 'i'),
  new RegExp(String.raw`\bc${NUM}`, 'i'),
  new RegExp(String.raw`#\s*${NUM}`),
  new RegExp(String.raw`第\s*${NUM}\s*[話话回章]`),
];
const SPECIAL =
  /\b(?:extras?|specials?|omake|one[\s-]?shot|side[\s-]?stor(?:y|ies)|bonus|short stor(?:y|ies)|art ?book|databook|guide ?book)\b/i;

/** Brackets that hold the numbering rather than a tag: "[Volume 03 - guya]", "(#2)". */
const NUMBERING_IN_BRACKETS =
  /[[({]\s*((?:vol(?:ume)?|v|ch(?:apter|ap)?|c|#)\.?\s*\d+(?:\.\d+)?(?![a-z\d])[^\])}]*)[\])}]/gi;

/** Drops the extension, release tags in brackets, and separators that are not decimal points. */
export function cleanName(fileName: string): string {
  return fileName
    .replace(/\.(cb[zr7t]|zip|rar|7z|tar|pdf|epub)$/i, '')
    .replace(NUMBERING_IN_BRACKETS, ' $1 ')
    .replace(/\[[^\]]*\]|\{[^}]*\}/g, ' ')
    .replace(/\((?:[^()]*)\)/g, ' ')
    .replace(/_/g, ' ')
    .replace(/(?<!\d)\.|\.(?!\d)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstMatch(patterns: RegExp[], text: string): RegExpExecArray | null {
  let best: RegExpExecArray | null = null;
  for (const re of patterns) {
    const m = re.exec(text);
    if (m && (best === null || m.index < best.index)) best = m;
  }
  return best;
}

/** Reads the numbering out of a comic file name. */
export function parseComicName(fileName: string): ComicNumbering {
  const name = cleanName(fileName);
  const vol = firstMatch(VOLUME, name);
  // Look for the chapter after the volume marker, so "v03 c020" reads chapter 20, not "3".
  const rest = vol ? name.slice(vol.index + vol[0].length) : name;
  let chap = firstMatch(CHAPTER, rest);
  let bare = false;
  if (!chap) {
    // A bare number: the last one that is not a year ("Spider-Man 2099 001" is issue 1,
    // "Batman v2 015" is issue 15 of volume 2).
    const numbers = [...rest.matchAll(/(?<![\w.])(\d+(?:\.\d+)?)(?![\w])/g)].filter(
      (m) => !/^(?:19|20)\d\d$/.test(m[1]!),
    );
    const last = numbers.at(-1);
    if (last) {
      chap = last;
      bare = true;
    }
  }
  const cut = vol ? vol.index : chap ? chap.index : name.length;
  const series = name
    .slice(0, cut)
    .replace(/[\s\-–—:,#]+$/, '')
    .trim();
  return {
    volume: vol ? Number(vol[1]) : null,
    chapter: chap ? Number(chap[1]) : null,
    bare,
    special: SPECIAL.test(name),
    series: series || name,
  };
}

/** "Vol. 3", "Ch. 120.5", "Vol. 3 · Ch. 20", "#12", or null when the name carries no number. */
export function numberingLabel(
  n: Pick<ComicNumbering, 'volume' | 'chapter' | 'bare'>,
): string | null {
  const parts: string[] = [];
  if (n.volume !== null) parts.push(`Vol. ${n.volume}`);
  if (n.chapter !== null) parts.push(n.bare ? `#${n.chapter}` : `Ch. ${n.chapter}`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/** Natural order: "page2" before "page10", case ignored. */
export function naturalCompare(a: string, b: string): number {
  return collator.compare(a, b);
}

export interface SortableBook {
  volume: number | null;
  chapter: number | null;
  special: boolean;
  fileName: string;
}

/**
 * Reading order within a series: every volume first (by volume, then chapter inside it), then the
 * loose chapters that come after the last collected volume (by chapter), then anything without a
 * number. Specials follow the regular book with the same number. So "v01".."v20" then "c120"
 * onwards reads in order whatever the files are called.
 */
export function compareBooks(a: SortableBook, b: SortableBook): number {
  const group = (x: SortableBook) => (x.volume !== null ? 0 : x.chapter !== null ? 1 : 2);
  return (
    group(a) - group(b) ||
    (a.volume ?? 0) - (b.volume ?? 0) ||
    (a.chapter ?? -1) - (b.chapter ?? -1) ||
    Number(a.special) - Number(b.special) ||
    naturalCompare(a.fileName, b.fileName)
  );
}

/** A leading reading-order number: "001 Birds of Prey 118", "02 - Marvel Zombies", "00b (prelude) …". */
const READING_ORDER = /^\d{1,4}[a-z]?(?=[\s._()-])/i;

/**
 * Story-arc folders number their books in the order to read them, ahead of each book's own issue
 * number ("010 Infinity Wars - Arachknight 001"); when most books do, that order wins.
 */
export function inReadingOrder(books: readonly { fileName: string }[]): boolean {
  const numbered = books.filter((b) => READING_ORDER.test(b.fileName)).length;
  return books.length >= 2 && numbered >= books.length * 0.8;
}

/** One series' books in reading order. */
export function sortBooks<T extends SortableBook>(books: T[]): T[] {
  return inReadingOrder(books)
    ? books.sort((a, b) => naturalCompare(a.fileName, b.fileName))
    : books.sort(compareBooks);
}

/**
 * Folders that split one series rather than name one: "Volumes", "Chapters", "Vol 01",
 * "Specials". A book in one belongs to the series folder above it.
 */
export function isGroupingFolder(name: string): boolean {
  const clean = cleanName(name);
  // A bare range ("001-100", "11-20") splits a long run of issues into folders.
  return /^(?:volumes?|vols?|chapters?|chaps?|issues?|specials?|extras?|omake|one[\s-]?shots?|tankobons?|ongoing|completed?|(?:vol(?:ume)?|v|ch(?:apter|ap)?|c|season|part)\s*\d+(?:\s*-\s*\d+)?|\d+\s*-\s*\d+)$/i.test(
    clean,
  );
}

/** Share-site stamps left in folder names. */
const SITE_TAGS = /-=[^=]*=-|\b(?:GetComics\.INFO|TheComicsHQ)\b/gi;

/** A series title from its folder name: tags in brackets, the year, and a reading-order prefix dropped. */
export function seriesTitle(folderName: string): string {
  let clean = folderName.replace(SITE_TAGS, ' ');
  // Innermost first, so "(001 - 027 (ongoing) + Annuals)" goes as a whole.
  for (let prev = ''; prev !== clean;) {
    prev = clean;
    clean = clean.replace(/\[[^[\]]*\]|\{[^{}]*\}|\([^()]*\)/g, ' ');
  }
  clean = clean
    // An unclosed bracket and everything after it: "Death of the Family [ironFUR".
    .replace(/[[({].*$/, ' ')
    .replace(/_/g, ' ')
    // "06.Batman - …", "01 - Peace In Our Time", "2004-12 - Wolverine …".
    .replace(/^\s*(?:\d{4}-\d{2}|\d{1,3})(?:\.(?!\d)\s*|\s*[-–]\s+)/, '')
    .replace(/[\s\-–:,+&]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  return clean || folderName;
}

/** Folder names that only make sense with the series above them: "Annual", "Variant Covers". */
export function isGenericFolderTitle(title: string): boolean {
  return /^(?:annuals?|variants?(?: covers?)?|covers?|art ?books?|mini[\s-]?series|prequels?|interludes?|tie[\s-]?ins?|side[\s-]?stor(?:y|ies)\b.*)$/i.test(
    title,
  );
}

/** Sort key for titles: case folded, a leading article dropped. */
export function sortTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/^(?:the|a|an)\s+/, '')
    .trim();
}
