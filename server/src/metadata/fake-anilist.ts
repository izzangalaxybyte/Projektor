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
  tags?: Array<{ name: string; rank: number; spoiler?: boolean }>;
  /** Linked MAL entry, answered by the fake Jikan below. */
  mal?: { id: number; score: number | null; rating?: string };
  popularity?: number;
}

export function fakeAniListFetch(
  data: FakeAnime[],
  log: string[] = [],
): (url: string, init?: RequestInit) => Promise<Response> {
  const media = (a: FakeAnime) => ({
    id: a.id,
    idMal: a.mal?.id ?? null,
    title: { romaji: a.romaji, english: a.english, native: null },
    synonyms: [],
    format: 'TV',
    episodes: a.episodes,
    seasonYear: a.year,
    startDate: { year: a.year },
    description: a.description ?? `About ${a.romaji}<br><br><i>italic</i> &amp; more`,
    genres: a.genres ?? ['Action', 'Fantasy'],
    averageScore: a.score ?? 85,
    popularity: a.popularity ?? 1000,
    tags: (a.tags ?? []).map((t) => ({
      name: t.name,
      rank: t.rank,
      isGeneralSpoiler: false,
      isMediaSpoiler: t.spoiler ?? false,
    })),
    coverImage: { extraLarge: `https://s4.anilist.co/cover/${a.id}.jpg`, large: null },
    bannerImage: `https://s4.anilist.co/banner/${a.id}.jpg`,
  });
  return async (url, init) => {
    const jikan = /^https:\/\/api\.jikan\.moe\/v4\/anime\/(\d+)$/.exec(url);
    if (jikan) {
      log.push(`mal:${jikan[1]}`);
      const found = data.find((a) => a.mal?.id === Number(jikan[1]))?.mal;
      if (!found) return new Response('{"status":404}', { status: 404 });
      return new Response(
        JSON.stringify({
          data: {
            mal_id: found.id,
            score: found.score,
            scored_by: 100,
            members: 1000,
            rating: found.rating ?? 'PG-13 - Teens 13 or older',
          },
        }),
        { status: 200 },
      );
    }
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
      variables: { search?: string; id?: number; ids?: number[] };
    };
    if (body.variables.ids) {
      log.push(`ids:${body.variables.ids.join(',')}`);
      const found = data.filter((a) => body.variables.ids!.includes(a.id));
      return new Response(JSON.stringify({ data: { Page: { media: found.map(media) } } }), {
        status: 200,
      });
    }
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
