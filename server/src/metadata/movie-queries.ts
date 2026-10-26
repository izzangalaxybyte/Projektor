// Alternative TMDB searches for a movie whose parsed title found nothing confident. Release names
// often differ from TMDB's title: a collection's films drop the series name ("Harry.Potter.Complete.
// Collection/02. Chamber.Of.Secrets.2002"), TMDB calls Episode IV just "Star Wars", and numbers
// get spelled out ("Furious Seven" is "Furious 7").

const NUMBER_WORDS: Record<string, string> = {
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
  ten: '10',
};

/** The parsed title first, then each distinct variant worth one more search. */
export function movieSearchTitles(title: string, filePath: string | null): string[] {
  const queries = [title];
  const collection = filePath ? collectionName(filePath) : null;
  if (collection && !normalise(title).includes(normalise(collection))) {
    queries.push(`${collection} ${title}`);
  }
  // "Star Wars Episode V - The Empire Strikes Back" → "The Empire Strikes Back", "Star Wars"
  const episode = /^(.*?)\s+Episode\s+[IVX]+\b\s*[-–:]?\s*(.+)$/i.exec(title);
  if (episode) queries.push(episode[2]!, episode[1]!);
  // "F1 The Movie" → "F1"
  const movie = /^(.+?)\s+The Movie$/i.exec(title);
  if (movie) queries.push(movie[1]!);
  // "Furious Seven" → "Furious 7"
  const digits = title.replace(
    /\b(one|two|three|four|five|six|seven|eight|nine|ten)\b/gi,
    (w) => NUMBER_WORDS[w.toLowerCase()]!,
  );
  if (digits !== title) queries.push(digits);
  // "Fast and Furious 9 The Fast Saga" → "Fast and Furious 9"
  const numbered = /^(.+?\s\d{1,2})\s+\S.*$/.exec(title);
  if (numbered) queries.push(numbered[1]!);
  return [...new Set(queries.map((q) => q.trim()).filter(Boolean))];
}

/**
 * The series name from a collection folder above the film's own folder:
 * "Harry.Potter.Complete.Collection.2001-2011.1080p.BluRay" → "Harry Potter".
 */
export function collectionName(filePath: string): string | null {
  const dirs = filePath.split('/').slice(0, -1);
  for (const dir of dirs) {
    const name = dir.includes(' ') ? dir : dir.replace(/\./g, ' ');
    const m =
      /^(.+?)\s+(?:Complete\s+)?(?:Collection|Trilogy|Quadrilogy|Saga|Anthology|Box ?Set)\b/i.exec(
        name,
      );
    if (m) return m[1]!.replace(/\s+Complete$/i, '').trim();
  }
  return null;
}

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
