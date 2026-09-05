import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, unwrap, withAccessToken } from '../api/client.js';
import { fmtClock, programmeProgress, useLiveChannels, useLiveGuide } from '../hooks/useLive.js';
import {
  channelByNumber,
  neighbourChannel,
  NUMBER_ENTRY_COMMIT_MS,
  NUMBER_ENTRY_MAX_DIGITS,
} from '../live/channel-entry.js';
import { HtmlVideoPlayer } from '../player/HtmlVideoPlayer.js';
import { buildDeviceProfile } from '../player/profile.js';

/**
 * Live channel playback. No seek bar: the stream follows the live edge. Up/Down (or the buttons)
 * change channel, digits jump to a channel number, G opens the guide for this channel.
 */
export function LivePlayerPage() {
  const { channelId = '' } = useParams();
  const navigate = useNavigate();
  const channels = useLiveChannels();
  const channel = channels.data?.find((c) => c.id === channelId);
  const guide = useLiveGuide(channelId);

  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<HtmlVideoPlayer | null>(null);
  const [paused, setPaused] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showControls, setShowControls] = useState(true);
  const [showGuide, setShowGuide] = useState(false);
  const [digits, setDigits] = useState('');
  const [entryMessage, setEntryMessage] = useState<string | null>(null);
  const channelsRef = useRef(channels.data);
  channelsRef.current = channels.data;

  const profile = useMemo(() => buildDeviceProfile(), []);
  const decision = useQuery({
    queryKey: ['live', 'decide', channelId, profile.name],
    enabled: !!channelId,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    queryFn: async () =>
      unwrap(await api.POST('/api/live/decide', { body: { channelId, profile } })),
  });

  useEffect(() => {
    if (!videoRef.current) return;
    const player = new HtmlVideoPlayer(videoRef.current);
    playerRef.current = player;
    const offs = [
      player.on('playing', () => setPaused(false)),
      player.on('pause', () => setPaused(true)),
      player.on('error', () =>
        setError('This channel could not be played. The provider may be down or busy.'),
      ),
    ];
    return () => {
      offs.forEach((off) => off());
      player.destroy();
      playerRef.current = null;
    };
  }, []);

  // Load on each decision; release the HLS session when leaving it.
  useEffect(() => {
    const d = decision.data;
    const player = playerRef.current;
    if (!d || !player) return;
    setError(null);
    player.load(withAccessToken(d.url), { hls: d.method === 'hls', startMs: 0, live: true });
    return () => {
      if (d.sessionId)
        void api.DELETE('/api/live/sessions/{id}', { params: { path: { id: d.sessionId } } });
    };
  }, [decision.data]);

  const goTo = (id: string | undefined) => {
    if (id && id !== channelId) navigate(`/live/${id}/watch`, { replace: true });
  };
  const step = (dir: 1 | -1) =>
    goTo(neighbourChannel(channelsRef.current ?? [], channelId, dir)?.id);

  // Number entry commits a moment after the last digit.
  useEffect(() => {
    if (!digits) return;
    const t = setTimeout(() => {
      const target = channelByNumber(channelsRef.current ?? [], digits);
      setDigits('');
      if (target) goTo(target.id);
      else {
        setEntryMessage(`No channel ${Number(digits)}`);
        setTimeout(() => setEntryMessage(null), 2000);
      }
    }, NUMBER_ENTRY_COMMIT_MS);
    return () => clearTimeout(t);
    // goTo reads the latest channelId through the closure each time digits change.
  }, [digits]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const p = playerRef.current;
      if (!p) return;
      if (/^\d$/.test(e.key)) setDigits((d) => (d + e.key).slice(-NUMBER_ENTRY_MAX_DIGITS));
      else if (e.key === 'ArrowUp' || e.key === 'PageUp') {
        e.preventDefault();
        step(1);
      } else if (e.key === 'ArrowDown' || e.key === 'PageDown') {
        e.preventDefault();
        step(-1);
      } else if (e.key === ' ' || e.key === 'k') {
        e.preventDefault();
        p.toggle();
      } else if (e.key === 'g') setShowGuide((v) => !v);
      else if (e.key === 'f') void document.documentElement.requestFullscreen?.();
      else if (e.key === 'Escape') {
        if (showGuide) setShowGuide(false);
        else if (!document.fullscreenElement) navigate('/live');
      }
      setShowControls(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [channelId, showGuide, navigate]);

  useEffect(() => {
    if (paused || !showControls || showGuide) return;
    const t = setTimeout(() => setShowControls(false), 3500);
    return () => clearTimeout(t);
  }, [paused, showControls, showGuide]);

  const now = channel?.now ?? null;
  return (
    <div
      className={`player live ${showControls || paused || showGuide ? 'controls-visible' : ''}`}
      onMouseMove={() => setShowControls(true)}
      onClick={() => setShowControls(true)}
      data-testid="live-player"
    >
      <video ref={videoRef} className="player-video" playsInline data-testid="video" />
      {(error || decision.isError) && (
        <div className="player-message" role="alert">
          {error ?? (decision.error as Error).message}
        </div>
      )}
      {(digits || entryMessage) && (
        <div className="number-entry" data-testid="number-entry">
          {digits || entryMessage}
        </div>
      )}
      <div className="player-top">
        <button
          type="button"
          className="link-button"
          onClick={() => navigate('/live')}
          aria-label="Back"
        >
          ← Channels
        </button>
        <span className="player-title" data-testid="channel-name">
          {channel ? (
            <>
              {channel.number !== null && <span className="muted">{channel.number} </span>}
              {channel.name}
            </>
          ) : (
            '…'
          )}
        </span>
        <span className="decision-badge" data-testid="live-badge">
          Live
        </span>
      </div>
      <div className="player-controls live-controls">
        <button
          type="button"
          className="ctl"
          onClick={() => step(-1)}
          aria-label="Previous channel"
          data-testid="channel-down"
        >
          Ch −
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
          onClick={() => step(1)}
          aria-label="Next channel"
          data-testid="channel-up"
        >
          Ch +
        </button>
        <span className="live-now">
          {now ? (
            <>
              <span className="now-title" data-testid="now-title">
                {now.title}
              </span>
              <span className="muted small">
                {fmtClock(now.startAt)}–{fmtClock(now.endAt)}
                {channel?.next ? ` · Next: ${channel.next.title}` : ''}
              </span>
              <span className="progress">
                <span style={{ width: `${Math.round(programmeProgress(now) * 100)}%` }} />
              </span>
            </>
          ) : (
            <span className="muted small">No guide information</span>
          )}
        </span>
        <button
          type="button"
          className="ctl"
          onClick={() => setShowGuide((v) => !v)}
          aria-pressed={showGuide}
          aria-label="Guide"
          data-testid="guide-toggle"
        >
          Guide
        </button>
        <button
          type="button"
          className="ctl"
          onClick={() => void document.documentElement.requestFullscreen?.()}
          aria-label="Fullscreen"
        >
          ⛶
        </button>
      </div>
      {showGuide && (
        <aside className="guide-panel" data-testid="guide-panel" aria-label="Guide">
          <h2>{channel?.name ?? 'Guide'}</h2>
          {guide.isPending && <p className="muted">Loading…</p>}
          {guide.data?.length === 0 && <p className="muted">No programmes listed.</p>}
          <ul className="plain">
            {(guide.data ?? []).map((p) => {
              const live =
                new Date(p.startAt).getTime() <= Date.now() &&
                new Date(p.endAt).getTime() > Date.now();
              const past = new Date(p.endAt).getTime() <= Date.now();
              return (
                <li key={p.id} className={`guide-row ${live ? 'live' : past ? 'past' : ''}`}>
                  <span className="muted small">{fmtClock(p.startAt)}</span>
                  <span>
                    <span className="guide-title">{p.title}</span>
                    {p.description && (
                      <span className="muted small guide-desc">{p.description}</span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </aside>
      )}
    </div>
  );
}
