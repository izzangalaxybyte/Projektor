import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, unwrap, withAccessToken } from '../api/client.js';
import { useLiveChannels } from '../hooks/useLive.js';
import { HtmlVideoPlayer } from '../player/HtmlVideoPlayer.js';
import {
  formatRate,
  loadPrefs,
  RATE_OPTIONS,
  savePrefs,
  SKIP_OPTIONS,
  type PlaybackRate,
  type PlayerPrefs,
  type SkipSeconds,
} from '../player/prefs.js';
import { buildDeviceProfile } from '../player/profile.js';
import { fmt } from './ItemPage.js';

export type ProviderSource = 'catchup' | 'movie' | 'episode' | 'recording';

/**
 * Seekable provider content: a catch-up programme, an IPTV movie, or a series episode. Unlike the
 * live player this one has the same skip-amount and speed controls as the file player.
 */
export function LiveCatchupPage({ source = 'catchup' }: { source?: ProviderSource }) {
  const {
    channelId = '',
    programmeId = '',
    vodId = '',
    seriesId = '',
    episodeId = '',
    recordingId = '',
  } = useParams();
  const navigate = useNavigate();
  const channels = useLiveChannels();
  const channel = channels.data?.find((c) => c.id === channelId);
  const sourceKey =
    source === 'catchup'
      ? programmeId
      : source === 'movie'
        ? vodId
        : source === 'recording'
          ? recordingId
          : episodeId;
  const backTo =
    source === 'catchup'
      ? `/live/${channelId}/watch`
      : source === 'movie'
        ? `/live/movies/${vodId}`
        : source === 'recording'
          ? '/live/recordings'
          : `/live/series/${seriesId}`;

  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<HtmlVideoPlayer | null>(null);
  const [currentMs, setCurrentMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [paused, setPaused] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showControls, setShowControls] = useState(true);
  const [prefs, setPrefs] = useState<PlayerPrefs>(() => loadPrefs());
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const updatePrefs = (patch: Partial<PlayerPrefs>) => {
    const next = { ...prefsRef.current, ...patch };
    setPrefs(next);
    savePrefs(next);
    if (patch.rate !== undefined) playerRef.current?.setRate(patch.rate);
  };
  const skip = (direction: 1 | -1) => {
    const p = playerRef.current;
    if (p) p.seek(p.currentMs + direction * prefsRef.current.skipSeconds * 1000);
  };

  const profile = useMemo(() => buildDeviceProfile(), []);
  const decision = useQuery({
    queryKey: ['live', 'decide', source, sourceKey, profile.name],
    enabled: !!sourceKey,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    queryFn: async () =>
      unwrap(
        await api.POST('/api/live/decide', {
          body:
            source === 'catchup'
              ? { channelId, profile, programmeId }
              : source === 'movie'
                ? { profile, vodId }
                : source === 'recording'
                  ? { profile, recordingId }
                  : { profile, episodeId },
        }),
      ),
  });

  useEffect(() => {
    if (!videoRef.current) return;
    const player = new HtmlVideoPlayer(videoRef.current);
    playerRef.current = player;
    const offs = [
      player.on('timeupdate', () => setCurrentMs(player.currentMs)),
      player.on('durationchange', () => setDurationMs(player.durationMs)),
      player.on('playing', () => setPaused(false)),
      player.on('pause', () => setPaused(true)),
      player.on('ended', () => setPaused(true)),
      player.on('error', () => setError('This programme could not be played.')),
    ];
    return () => {
      offs.forEach((off) => off());
      player.destroy();
      playerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const d = decision.data;
    const player = playerRef.current;
    if (!d || !player) return;
    setError(null);
    player.knownDurationMs = d.durationMs ?? 0;
    player.load(withAccessToken(d.url), { hls: d.method === 'hls', startMs: 0 });
    player.setRate(prefsRef.current.rate);
    return () => {
      if (d.sessionId)
        void api.DELETE('/api/live/sessions/{id}', { params: { path: { id: d.sessionId } } });
    };
  }, [decision.data]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const p = playerRef.current;
      if (!p || (e.target as HTMLElement)?.tagName === 'SELECT') return;
      if (e.key === ' ' || e.key === 'k') {
        e.preventDefault();
        p.toggle();
      } else if (e.key === 'ArrowRight') skip(1);
      else if (e.key === 'ArrowLeft') skip(-1);
      else if (e.key === 'f') void document.documentElement.requestFullscreen?.();
      else if (e.key === 'Escape' && !document.fullscreenElement) navigate(backTo);
      setShowControls(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate, channelId]);

  useEffect(() => {
    if (paused || !showControls) return;
    const t = setTimeout(() => setShowControls(false), 3500);
    return () => clearTimeout(t);
  }, [paused, showControls, currentMs]);

  // EVENT playlists report an infinite duration until they end; the guide knows the real length.
  const knownDurationMs = decision.data?.durationMs ?? 0;
  const effectiveDurationMs = durationMs > 0 ? durationMs : knownDurationMs;
  const title =
    source === 'catchup'
      ? `${channel?.name ?? ''}${decision.data?.title ? ` · ${decision.data.title}` : ''}`
      : (decision.data?.title ?? '');
  const badge =
    source === 'catchup'
      ? 'Catch-up'
      : source === 'recording'
        ? 'Recording'
        : decision.data?.method === 'direct'
          ? 'Direct play'
          : 'Remux';

  return (
    <div
      className={`player ${showControls || paused ? 'controls-visible' : ''}`}
      onMouseMove={() => setShowControls(true)}
      onClick={() => setShowControls(true)}
      data-testid="player"
    >
      <video ref={videoRef} className="player-video" playsInline data-testid="video" />
      {(error || decision.isError) && (
        <div className="player-message" role="alert">
          {error ?? (decision.error as Error).message}
        </div>
      )}
      <div className="player-top">
        <button
          type="button"
          className="link-button"
          onClick={() => navigate(backTo)}
          aria-label="Back"
        >
          ← Back
        </button>
        <span className="player-title" data-testid="catchup-title">
          {title}
        </span>
        <span className="decision-badge" data-testid="decision" title={decision.data?.reason}>
          {badge}
        </span>
      </div>
      <div className="player-controls catchup">
        <button
          type="button"
          className="ctl"
          onClick={() => skip(-1)}
          aria-label={`Skip back ${prefs.skipSeconds} seconds`}
          data-testid="skip-back"
        >
          ↺{prefs.skipSeconds}
        </button>
        <button
          type="button"
          className="ctl"
          onClick={() => playerRef.current?.toggle()}
          aria-label={paused ? 'Play' : 'Pause'}
          data-testid="toggle"
        >
          {paused ? '▶' : '❚❚'}
        </button>
        <button
          type="button"
          className="ctl"
          onClick={() => skip(1)}
          aria-label={`Skip forward ${prefs.skipSeconds} seconds`}
          data-testid="skip-forward"
        >
          {prefs.skipSeconds}↻
        </button>
        <span className="time" data-testid="time">
          {fmt(currentMs)}
        </span>
        <input
          type="range"
          className="seek"
          min={0}
          max={Math.max(effectiveDurationMs, 1)}
          value={Math.min(currentMs, effectiveDurationMs)}
          onChange={(e) => playerRef.current?.seek(Number(e.target.value))}
          aria-label="Seek"
          data-testid="seek"
        />
        <span className="time">{fmt(effectiveDurationMs)}</span>
        <select
          aria-label="Skip amount"
          value={prefs.skipSeconds}
          onChange={(e) => updatePrefs({ skipSeconds: Number(e.target.value) as SkipSeconds })}
          data-testid="skip-select"
          title="How far forward and back jump"
        >
          {SKIP_OPTIONS.map((n) => (
            <option key={n} value={n}>
              +{n}s
            </option>
          ))}
        </select>
        <select
          aria-label="Playback speed"
          value={prefs.rate}
          onChange={(e) => updatePrefs({ rate: Number(e.target.value) as PlaybackRate })}
          data-testid="speed-select"
        >
          {RATE_OPTIONS.map((r) => (
            <option key={r} value={r}>
              {formatRate(r)}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="ctl"
          onClick={() => void document.documentElement.requestFullscreen?.()}
          aria-label="Fullscreen"
        >
          ⛶
        </button>
      </div>
    </div>
  );
}
