import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from '../api/client.js';

const GUIDE_REFRESH_MS = 60_000;

export function useLiveStatus() {
  return useQuery({
    queryKey: ['live', 'status'],
    queryFn: async () => unwrap(await api.GET('/api/live/status')),
    refetchInterval: (q) => (q.state.data?.refreshing ? 2_000 : GUIDE_REFRESH_MS),
  });
}

export function useLiveCategories() {
  return useQuery({
    queryKey: ['live', 'categories'],
    queryFn: async () => unwrap(await api.GET('/api/live/categories')),
  });
}

/** All channels (the list is small enough to filter client-side), with now/next kept fresh. */
export function useLiveChannels() {
  return useQuery({
    queryKey: ['live', 'channels'],
    queryFn: async () => unwrap(await api.GET('/api/live/channels')),
    refetchInterval: GUIDE_REFRESH_MS,
  });
}

export function useLiveGuide(channelId: string | undefined, hoursBack = 2, hoursAhead = 12) {
  return useQuery({
    queryKey: ['live', 'guide', channelId, hoursBack, hoursAhead],
    enabled: !!channelId,
    queryFn: async () => {
      const now = Date.now();
      return unwrap(
        await api.GET('/api/live/guide', {
          params: {
            query: {
              channel: channelId!,
              from: new Date(now - hoursBack * 3600_000).toISOString(),
              to: new Date(now + hoursAhead * 3600_000).toISOString(),
            },
          },
        }),
      );
    },
    refetchInterval: GUIDE_REFRESH_MS,
  });
}

/** 0..1 through the programme at `now`, for the little progress bars. */
export function programmeProgress(p: { startAt: string; endAt: string }, now = Date.now()): number {
  const start = new Date(p.startAt).getTime();
  const end = new Date(p.endAt).getTime();
  if (end <= start) return 0;
  return Math.min(1, Math.max(0, (now - start) / (end - start)));
}

export function fmtClock(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
