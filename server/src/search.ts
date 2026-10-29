// Title search that forgives how a name is written: "spiderman", "Spider-Man" and "spider man"
// all find "The Amazing Spider-Man", and "Pokemon" finds "Pokémon".

/** Lowercase letters and digits only, accents dropped and "&" read as "and". */
export function searchKey(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

/**
 * Whether every word of the query appears somewhere in the title, punctuation and spacing
 * ignored, so a query split differently from the title ("iron man" / "Ironman") still matches.
 */
export function matchesSearch(title: string, query: string): boolean {
  const key = searchKey(title);
  const words = query
    .split(/[^\p{L}\p{N}&]+/u)
    .map(searchKey)
    .filter(Boolean);
  return words.every((w) => key.includes(w));
}
