// Fake AniList GraphQL endpoint for tests.
export interface FakeAnime {
  id: number;
  english: string | null;
  romaji: string;
  year: number;
  episodes: number;
  description?: string;
  genres?: string[];
  score?: number;
}

export function fakeAniListFetch(
  data: FakeAnime[],
  log: string[] = [],
): (url: string, init?: RequestInit) => Promise<Response> {
  const media = (a: FakeAnime) => ({
    id: a.id,
    idMal: null,
    title: { romaji: a.romaji, english: a.english, native: null },
    synonyms: [],
    format: 'TV',
    episodes: a.episodes,
    seasonYear: a.year,
    startDate: { year: a.year },
    description: a.description ?? `About ${a.romaji}<br><br><i>italic</i> &amp; more`,
    genres: a.genres ?? ['Action', 'Fantasy'],
    averageScore: a.score ?? 85,
    popularity: 1000,
    coverImage: { extraLarge: `https://s4.anilist.co/cover/${a.id}.jpg`, large: null },
    bannerImage: `https://s4.anilist.co/banner/${a.id}.jpg`,
  });
  return async (url, init) => {
    if (url.includes('anilist.co') && !url.startsWith('https://graphql')) {
      const sharp = (await import('sharp')).default;
      const png = await sharp({
        create: { width: 30, height: 40, channels: 3, background: '#993366' },
      })
        .png()
        .toBuffer();
      return new Response(png, { status: 200, headers: { 'content-type': 'image/png' } });
    }
    const body = JSON.parse(String(init?.body ?? '{}')) as {
      query: string;
      variables: { search?: string; id?: number };
    };
    log.push(body.variables.search ?? `id:${body.variables.id}`);
    if (body.variables.id !== undefined) {
      const found = data.find((a) => a.id === body.variables.id);
      return new Response(
        JSON.stringify(
          found ? { data: { Media: media(found) } } : { errors: [{ message: 'Not Found.' }] },
        ),
        { status: found ? 200 : 404 },
      );
    }
    const q = (body.variables.search ?? '').toLowerCase();
    const results = data.filter(
      (a) =>
        a.romaji.toLowerCase().includes(q.split(' ')[0]!) ||
        (a.english ?? '').toLowerCase().includes(q.split(' ')[0]!),
    );
    return new Response(JSON.stringify({ data: { Page: { media: results.map(media) } } }), {
      status: 200,
    });
  };
}
