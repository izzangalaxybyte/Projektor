import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api, unwrap, type ItemSummary } from '../api/client.js';

export type LibraryKind = 'movie' | 'tv' | 'anime';
export type Sort = 'title' | 'year' | 'added' | 'lastPlayed';

export const KIND_LABEL: Record<LibraryKind, string> = {
  movie: 'Movies',
  tv: 'TV Shows',
  anime: 'Anime',
};
export const KIND_PATH: Record<LibraryKind, string> = {
  movie: '/movies',
  tv: '/tv',
  anime: '/anime',
};

const PAGE = 60;

/** Paged browse of a library kind. */
export function useLibraryItems(libraryKind: LibraryKind, sort: Sort) {
  return useInfiniteQuery({
    queryKey: ['items', libraryKind, sort],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) =>
      unwrap(
        await api.GET('/api/items', {
          params: { query: { libraryKind, sort, offset: pageParam, limit: PAGE } },
        }),
      ),
    getNextPageParam: (last) =>
      last.offset + last.items.length < last.total ? last.offset + last.items.length : undefined,
  });
}

export function useRecentlyAdded(libraryKind: LibraryKind, limit = 20) {
  return useQuery({
    queryKey: ['recent', libraryKind, limit],
    queryFn: async () =>
      unwrap(
        await api.GET('/api/items', { params: { query: { libraryKind, sort: 'added', limit } } }),
      ).items,
  });
}

export function useContinueWatching(libraryKind?: LibraryKind) {
  return useQuery({
    queryKey: ['continue', libraryKind ?? 'all'],
    queryFn: async () =>
      unwrap(
        await api.GET('/api/progress/continue', {
          params: { query: { limit: 20, ...(libraryKind ? { libraryKind } : {}) } },
        }),
      ),
  });
}

export function useSearch(query: string) {
  return useQuery({
    queryKey: ['search', query],
    enabled: query.trim().length >= 2,
    queryFn: async () =>
      unwrap(
        await api.GET('/api/items', { params: { query: { search: query.trim(), limit: 60 } } }),
      ).items,
  });
}

export function useItem(id: string | undefined) {
  return useQuery({
    queryKey: ['item', id],
    enabled: !!id,
    queryFn: async () =>
      unwrap(await api.GET('/api/items/{id}', { params: { path: { id: id! } } })),
  });
}

export function useChildren(parentId: string | undefined) {
  return useQuery({
    queryKey: ['children', parentId],
    enabled: !!parentId,
    queryFn: async () =>
      unwrap(
        await api.GET('/api/items', { params: { query: { parentId: parentId!, limit: 200 } } }),
      ).items,
  });
}

export function useNextEpisode(episodeId: string | undefined) {
  return useQuery({
    queryKey: ['next', episodeId],
    enabled: !!episodeId,
    queryFn: async () =>
      unwrap(await api.GET('/api/items/{id}/next', { params: { path: { id: episodeId! } } })),
  });
}

/** "S1 E2" or the year, for tile subtitles. */
export function subtitleFor(item: ItemSummary): string {
  if (item.kind === 'episode') {
    const s = item.seasonNumber !== null ? `S${item.seasonNumber} ` : '';
    return `${s}E${item.episodeNumber ?? '?'}${item.showTitle ? ` · ${item.showTitle}` : ''}`;
  }
  if (item.kind === 'season') return item.showTitle ?? '';
  return item.year ? String(item.year) : '';
}
