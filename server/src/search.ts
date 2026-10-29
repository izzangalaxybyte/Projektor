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
 * Whether the title matches: the query run together appears in the title run together
 * ("iron man" / "Ironman", "spiderman" / "Spider-Man"), or each word of the query starts a word of
 * the title, in any order ("dark knight batman"). Word starts rather than anywhere keep
 * "Spider-Man" from finding "Spider-Woman".
 */
export function matchesSearch(title: string, query: string): boolean {
  const words = splitWords(query);
  if (words.length === 0) return true;
  if (searchKey(title).includes(words.join(''))) return true;
  const titleWords = splitWords(title);
  return words.every((w) => titleWords.some((t) => t.startsWith(w)));
}

function splitWords(text: string): string[] {
  return text
    .split(/[^\p{L}\p{N}&\p{M}]+/u)
    .map(searchKey)
    .filter(Boolean);
}
