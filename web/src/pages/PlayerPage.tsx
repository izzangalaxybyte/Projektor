import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, unwrap, withAccessToken, type PlaybackDecision } from '../api/client.js';
import { SubtitleOverlay } from '../components/SubtitleOverlay.js';
import { useItem, useNextEpisode } from '../hooks/useItems.js';
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
import { releaseSessionOnPageHide } from '../player/release.js';
import { planSeek } from '../player/timeline.js';
import { fmt } from './ItemPage.js';

const PROGRESS_INTERVAL_MS = 10_000;

export function PlayerPage() {
  const { fileId } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const itemId = params.get('item') ?? undefined;
  const startMs = Number(params.get('t') ?? 0) || 0;

  const qc = useQueryClient();
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
  const [prefs, setPrefs] = useState<PlayerPrefs>(() => loadPrefs());
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const updatePrefs = (patch: Partial<PlayerPrefs>) => {
    const next = { ...prefsRef.current, ...patch };
    setPrefs(next);
    savePrefs(next);
    if (patch.rate !== undefined) playerRef.current?.setRate(patch.rate);
  };
  const lastReport = useRef(0);
  const resumeAt = useRef(startMs);
  // A remux session's HLS timeline starts at the position it was opened at; everything the page
  // shows or reports is absolute, so it adds this back.
  const offsetRef = useRef(0);
  const decisionRef = useRef<PlaybackDecision | null>(null);
  const knownDurationRef = useRef(knownDurationMs);
  knownDurationRef.current = knownDurationMs;
  const [seekEpoch, setSeekEpoch] = useState(0);
  const seekTo = (absoluteMs: number) => {
    const p = playerRef.current;
    const d = decisionRef.current;
    if (!p || !d) return;
    const plan = planSeek({
      targetMs: absoluteMs,
      offsetMs: offsetRef.current,
      availableMs: p.durationMs,
      method: d.method,
      knownDurationMs: knownDurationRef.current,
    });
    if (plan.kind === 'restart') {
      // Beyond what ffmpeg has remuxed so far: open a new session starting there.
      resumeAt.current = plan.ms;
      setSeekEpoch((e) => e + 1);
    } else p.seek(plan.ms);
  };
  const skip = (direction: 1 | -1) => {
    const p = playerRef.current;
    if (p)
      seekTo(p.currentMs + offsetRef.current + direction * prefsRef.current.skipSeconds * 1000);
  };
  const reportRef = useRef<(force?: boolean) => void>(() => undefined);

  const profile = useMemo(() => buildDeviceProfile(), []);
  const decision = useQuery({
    queryKey: ['decide', fileId, audioIndex, profile.name, seekEpoch],
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
    // Detail pages and home rows cache progress; make them refetch after a report.
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['item', itemId] });
      void qc.invalidateQueries({ queryKey: ['continue'] });
      void qc.invalidateQueries({ queryKey: ['children'] });
    },
  });
  const reportNow = useCallback(
    (force = false) => {
      const p = playerRef.current;
      // Remux sessions stream an EVENT playlist until ffmpeg finishes, so the browser reports an
      // infinite duration; fall back to the duration ffprobe measured.
      const position = p ? p.currentMs + offsetRef.current : 0;
      const duration =
        knownDurationMs > 0 ? knownDurationMs : p ? p.durationMs + offsetRef.current : 0;
      if (!p || !itemId || duration <= 0 || position <= 0) return;
      if (!force && Date.now() - lastReport.current < PROGRESS_INTERVAL_MS) return;
      lastReport.current = Date.now();
      report.mutate({ positionMs: position, durationMs: duration });
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
        setCurrentMs(player.currentMs + offsetRef.current);
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
    decisionRef.current = d;
    // A remux is written from the requested position with a timeline starting at zero, so the
    // player starts at zero and the page adds the offset back; other methods are absolute.
    const isRemux = d.method === 'remux';
    offsetRef.current = isRemux ? resumeAt.current : 0;
    player.knownDurationMs = Math.max(0, knownDurationMs - offsetRef.current);
    player.load(withAccessToken(d.url), {
      hls: d.method !== 'direct',
      startMs: isRemux ? 0 : resumeAt.current,
    });
    player.setRate(prefsRef.current.rate);
    const offPageHide = d.sessionId
      ? releaseSessionOnPageHide(`/api/playback/sessions/${d.sessionId}`)
      : () => undefined;
    return () => {
      offPageHide();
      // Free the server's ffmpeg as soon as this session is replaced or the page closes.
      if (d.sessionId)
        void api.DELETE('/api/playback/sessions/{id}', { params: { path: { id: d.sessionId } } });
    };
  }, [decision.data, knownDurationMs]);

  const switchAudio = (index: number) => {
    resumeAt.current = (playerRef.current?.currentMs ?? 0) + offsetRef.current;
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
      } else if (e.key === 'ArrowRight') skip(1);
      else if (e.key === 'ArrowLeft') skip(-1);
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

  const effectiveDurationMs = Math.max(knownDurationMs, durationMs + offsetRef.current);
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
          onChange={(e) => seekTo(Number(e.target.value))}
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
