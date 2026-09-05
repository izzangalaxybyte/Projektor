// A fake TMDB used by tests: serves canned search results, details, and a tiny PNG for images.
import sharp from 'sharp';

export interface FakeTmdbData {
  movies: Array<{
    id: number;
    title: string;
    year: number;
    overview?: string;
    genres?: string[];
    runtime?: number;
    poster?: boolean;
  }>;
  shows: Array<{
    id: number;
    name: string;
    year: number;
    seasons: Array<{ number: number; episodes: Array<{ number: number; name: string }> }>;
  }>;
}

export function fakeTmdbFetch(
  data: FakeTmdbData,
  log: string[] = [],
): (url: string, init?: RequestInit) => Promise<Response> {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  return async (rawUrl) => {
    const url = new URL(rawUrl);
    log.push(url.pathname + url.search);
    if (url.hostname === 'image.tmdb.org') {
      const png = await sharp({
        create: { width: 40, height: 60, channels: 3, background: '#336699' },
      })
        .png()
        .toBuffer();
      return new Response(png, { status: 200, headers: { 'content-type': 'image/png' } });
    }
    if (url.searchParams.get('api_key') === 'bad')
      return json({ status_message: 'Invalid API key' }, 401);
    const p = url.pathname.replace(/^\/3/, '');
    const q = (url.searchParams.get('query') ?? '').toLowerCase();
    if (p === '/search/movie') {
      const year = url.searchParams.get('year');
      const results = data.movies
        .filter(
          (m) =>
            m.title.toLowerCase().includes(q.split(' ')[0] ?? '') &&
            (!year || String(m.year) === year),
        )
        .map((m) => ({
          id: m.id,
          title: m.title,
          release_date: `${m.year}-05-01`,
          popularity: 10,
          poster_path: m.poster === false ? null : `/p${m.id}.jpg`,
        }));
      return json({ results });
    }
    if (p === '/search/tv') {
      const results = data.shows
        .filter((s) => s.name.toLowerCase().includes(q.split(' ')[0] ?? ''))
        .map((s) => ({
          id: s.id,
          name: s.name,
          first_air_date: `${s.year}-01-10`,
          popularity: 10,
          poster_path: `/p${s.id}.jpg`,
        }));
      return json({ results });
    }
    let m = /^\/movie\/(\d+)$/.exec(p);
    if (m) {
      const movie = data.movies.find((x) => x.id === Number(m![1]));
      if (!movie) return json({ status_message: 'not found' }, 404);
      return json({
        id: movie.id,
        title: movie.title,
        overview: movie.overview ?? `About ${movie.title}`,
        tagline: 'A tagline',
        release_date: `${movie.year}-05-01`,
        runtime: movie.runtime ?? 120,
        vote_average: 7.5,
        genres: (movie.genres ?? ['Drama']).map((name, i) => ({ id: i, name })),
        poster_path: movie.poster === false ? null : `/p${movie.id}.jpg`,
        backdrop_path: `/b${movie.id}.jpg`,
      });
    }
    m = /^\/tv\/(\d+)$/.exec(p);
    if (m) {
      const show = data.shows.find((x) => x.id === Number(m![1]));
      if (!show) return json({ status_message: 'not found' }, 404);
      return json({
        id: show.id,
        name: show.name,
        overview: `About ${show.name}`,
        first_air_date: `${show.year}-01-10`,
        vote_average: 8.1,
        genres: [{ id: 1, name: 'Drama' }],
        poster_path: `/p${show.id}.jpg`,
        backdrop_path: `/b${show.id}.jpg`,
        seasons: show.seasons.map((s) => ({
          season_number: s.number,
          episode_count: s.episodes.length,
          name: `Season ${s.number}`,
        })),
      });
    }
    m = /^\/tv\/(\d+)\/season\/(\d+)$/.exec(p);
    if (m) {
      const show = data.shows.find((x) => x.id === Number(m![1]));
      const season = show?.seasons.find((s) => s.number === Number(m![2]));
      if (!show || !season) return json({ status_message: 'not found' }, 404);
      return json({
        season_number: season.number,
        name: `Season ${season.number}`,
        overview: `Season ${season.number} of ${show.name}`,
        poster_path: `/s${show.id}-${season.number}.jpg`,
        episodes: season.episodes.map((e) => ({
          id: show.id * 1000 + season.number * 100 + e.number,
          episode_number: e.number,
          name: e.name,
          overview: `Overview of ${e.name}`,
          air_date: `${show.year}-02-${String(e.number).padStart(2, '0')}`,
          still_path: `/st${show.id}-${season.number}-${e.number}.jpg`,
          runtime: 45,
        })),
      });
    }
    return json({ status_message: 'unknown route' }, 404);
  };
}
