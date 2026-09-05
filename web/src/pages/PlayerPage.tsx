import { useMutation, useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, unwrap, withAccessToken, type PlaybackDecision } from '../api/client.js';
import { SubtitleOverlay } from '../components/SubtitleOverlay.js';
import { useItem, useNextEpisode } from '../hooks/useItems.js';
import { HtmlVideoPlayer } from '../player/HtmlVideoPlayer.js';
import { buildDeviceProfile } from '../player/profile.js';
import { fmt } from './ItemPage.js';

const PROGRESS_INTERVAL_MS = 10_000;

export function PlayerPage() {
  const { fileId } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const itemId = params.get('item') ?? undefined;
  const startMs = Number(params.get('t') ?? 0) || 0;

  const item = useItem(itemId);
  const next = useNextEpisode(item.data?.kind === 'episode' ? item.data.id : undefined);
  const file = item.data?.files.find((f) => f.id === fileId) ?? item.data?.files[0];
  const audioTracks = useMemo(() => file?.streams.filter((s) => s.type === 'audio') ?? [], [file]);
  const knownDurationMs = file?.durationMs ?? 0;
  const [audioIndex, setAudioIndex] = useState<number | undefined>(undefined);
  const [subtitleUrl, setSubtitleUrl] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<HtmlVideoPlayer | null>(null);
  const [currentMs, setCurrentMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [paused, setPaused] = useState(true);
  const [ended, setEnded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showControls, setShowControls] = useState(true);
  const lastReport = useRef(0);
  const resumeAt = useRef(startMs);
  const reportRef = useRef<(force?: boolean) => void>(() => undefined);

  const profile = useMemo(() => buildDeviceProfile(), []);
  const decision = useQuery({
    queryKey: ['decide', fileId, audioIndex, profile.name],
    enabled: !!fileId,
    staleTime: Infinity,
    queryFn: async () =>
      unwrap(
        await api.POST('/api/playback/decide', {
          body: {
            fileId: fileId!,
            profile,
            startPositionMs: resumeAt.current,
            ...(audioIndex !== undefined ? { audioStreamIndex: audioIndex } : {}),
          },
        }),
      ),
  });

  const report = useMutation({
    mutationFn: async (input: { positionMs: number; durationMs: number }) =>
      itemId ? unwrap(await api.POST('/api/progress', { body: { itemId, ...input } })) : null,
  });
  const reportNow = useCallback(
    (force = false) => {
      const p = playerRef.current;
      // Remux sessions stream an EVENT playlist until ffmpeg finishes, so the browser reports an
      // infinite duration; fall back to the duration ffprobe measured.
      const duration = p && p.durationMs > 0 ? p.durationMs : knownDurationMs;
      if (!p || !itemId || duration <= 0 || p.currentMs <= 0) return;
      if (!force && Date.now() - lastReport.current < PROGRESS_INTERVAL_MS) return;
      lastReport.current = Date.now();
      report.mutate({ positionMs: p.currentMs, durationMs: duration });
    },
    [itemId, report, knownDurationMs],
  );
  reportRef.current = reportNow;

  // Create the player once the element exists.
  useEffect(() => {
    if (!videoRef.current) return;
    const player = new HtmlVideoPlayer(videoRef.current);
    playerRef.current = player;
    const offs = [
      player.on('timeupdate', () => {
        setCurrentMs(player.currentMs);
        reportRef.current();
      }),
      player.on('durationchange', () => setDurationMs(player.durationMs)),
      player.on('playing', () => {
        setPaused(false);
        setEnded(false);
      }),
      player.on('pause', () => {
        setPaused(true);
        reportRef.current(true);
      }),
      player.on('ended', () => {
        setEnded(true);
        setPaused(true);
        reportRef.current(true);
      }),
      player.on('error', () =>
        setError('Playback failed. Try another audio track or check the server log.'),
      ),
    ];
    return () => {
      offs.forEach((off) => off());
      reportRef.current(true);
      player.destroy();
      playerRef.current = null;
    };
    // Runs once; handlers read the latest reporter through reportRef.
  }, []);

  // (Re)load whenever the decision changes.
  useEffect(() => {
    const d = decision.data;
    const player = playerRef.current;
    if (!d || !player) return;
    setError(null);
    player.load(withAccessToken(d.url), { hls: d.method !== 'direct', startMs: resumeAt.current });
  }, [decision.data]);

  const switchAudio = (index: number) => {
    resumeAt.current = playerRef.current?.currentMs ?? 0;
    setAudioIndex(index);
  };

  // Keyboard: space, arrows, f, escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const p = playerRef.current;
      if (!p || (e.target as HTMLElement)?.tagName === 'SELECT') return;
      if (e.key === ' ' || e.key === 'k') {
        e.preventDefault();
        p.toggle();
      } else if (e.key === 'ArrowRight') p.seek(p.currentMs + 10_000);
      else if (e.key === 'ArrowLeft') p.seek(p.currentMs - 10_000);
      else if (e.key === 'f') void document.documentElement.requestFullscreen?.();
      else if (e.key === 'Escape' && !document.fullscreenElement) navigate(-1);
      setShowControls(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  // Hide controls while playing and idle.
  useEffect(() => {
    if (paused || !showControls) return;
    const t = setTimeout(() => setShowControls(false), 3500);
    return () => clearTimeout(t);
  }, [paused, showControls, currentMs]);

  const effectiveDurationMs = durationMs > 0 ? durationMs : knownDurationMs;
  const title = item.data
    ? item.data.kind === 'episode'
      ? `${item.data.showTitle ?? ''} · ${item.data.title}`
      : item.data.title
    : '';

  return (
    <div
      className={`player ${showControls || paused ? 'controls-visible' : ''}`}
      onMouseMove={() => setShowControls(true)}
      onClick={() => setShowControls(true)}
      data-testid="player"
    >
      <video
        ref={videoRef}
        className="player-video"
        playsInline
        data-testid="video"
        onDoubleClick={() => void document.documentElement.requestFullscreen?.()}
      />
      <SubtitleOverlay url={subtitleUrl} currentMs={currentMs} />
      {(error || decision.isError) && (
        <div className="player-message" role="alert">
          {error ?? (decision.error as Error).message}
        </div>
      )}
      {ended && next.data && (
        <div className="player-message">
          <Link to={`/items/${next.data.id}`} className="button primary" data-testid="next-episode">
            Next: {next.data.title}
          </Link>
        </div>
      )}
      <div className="player-top">
        <button
          type="button"
          className="link-button"
          onClick={() => navigate(-1)}
          aria-label="Back"
        >
          ← Back
        </button>
        <span className="player-title">{title}</span>
        {decision.data && <DecisionBadge decision={decision.data} />}
      </div>
      <div className="player-controls">
        <button
          type="button"
          className="ctl"
          onClick={() => playerRef.current?.toggle()}
          aria-label={paused ? 'Play' : 'Pause'}
          data-testid="toggle"
        >
          {paused ? '▶' : '❚❚'}
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
        {audioTracks.length > 1 && (
          <select
            aria-label="Audio track"
            value={
              (audioIndex ?? decision.data?.audio === 'none')
                ? ''
                : (audioIndex ??
                  audioTracks.find((t) => t.isDefault)?.index ??
                  audioTracks[0]!.index)
            }
            onChange={(e) => switchAudio(Number(e.target.value))}
            data-testid="audio-select"
          >
            {audioTracks.map((t) => (
              <option key={t.index} value={t.index}>
                {t.title ?? t.language ?? `Track ${t.index}`} ({t.codec}
                {t.channels ? ` ${t.channels}ch` : ''})
              </option>
            ))}
          </select>
        )}
        {(decision.data?.subtitles.length ?? 0) > 0 && (
          <select
            aria-label="Subtitles"
            value={subtitleUrl ?? ''}
            onChange={(e) => setSubtitleUrl(e.target.value || null)}
            data-testid="subtitle-select"
          >
            <option value="">Subtitles off</option>
            {decision.data!.subtitles.map((s) => (
              <option key={s.id} value={s.url}>
                {s.title ?? s.language ?? s.format} {s.source === 'external' ? '(file)' : ''}
              </option>
            ))}
          </select>
        )}
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

function DecisionBadge({ decision }: { decision: PlaybackDecision }) {
  const label =
    decision.method === 'direct'
      ? 'Direct play'
      : decision.method === 'remux'
        ? 'Remux'
        : 'Transcoding';
  return (
    <span className="decision-badge" title={decision.reason} data-testid="decision">
      {label}
    </span>
  );
}
