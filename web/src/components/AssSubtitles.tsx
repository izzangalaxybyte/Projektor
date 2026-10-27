import { useEffect, useRef, useState, type RefObject } from 'react';
import { withAccessToken, type SubtitleTrack } from '../api/client.js';
import { SubtitleOverlay } from './SubtitleOverlay.js';

interface Props {
  track: SubtitleTrack;
  videoRef: RefObject<HTMLVideoElement | null>;
  /** Where the video's own timeline starts in the file (remux sessions start at zero). */
  offsetMs: number;
  currentMs: number;
}

/**
 * Draws an ASS or SSA track with libass (JASSUB, in a worker), the way VLC does: the script's own
 * fonts, colours, outlines, positions and effects, with the fonts attached to the media file.
 * Where JASSUB cannot run (no WebAssembly, workers or OffscreenCanvas), it falls back to the
 * plain WebVTT overlay.
 */
export function AssSubtitles({ track, videoRef, offsetMs, currentMs }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<{ timeOffset: number; destroy(): Promise<void> } | null>(null);
  const offsetRef = useRef(offsetMs);
  offsetRef.current = offsetMs;
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
    const host = hostRef.current;
    const video = videoRef.current;
    if (!host || !video || !track.assUrl) return;
    let cancelled = false;
    let canvas: HTMLCanvasElement | null = null;
    const fail = (err: unknown) => {
      console.warn('ASS renderer unavailable, showing plain subtitles', err);
      if (!cancelled) setFailed(true);
    };
    void (async () => {
      const fonts = track.fontsUrl
        ? await fetch(withAccessToken(track.fontsUrl))
            .then((r) => (r.ok ? (r.json() as Promise<Array<{ url: string }>>) : []))
            .catch(() => [])
        : [];
      const { default: JASSUB } = await import('jassub');
      if (cancelled) return;
      // A canvas can hand its drawing to a worker only once, so every track gets a fresh one.
      canvas = document.createElement('canvas');
      canvas.className = 'ass-canvas';
      host.appendChild(canvas);
      const instance = new JASSUB({
        video,
        canvas,
        subUrl: withAccessToken(track.assUrl!),
        fonts: fonts.map((f) => withAccessToken(f.url)),
        timeOffset: offsetRef.current / 1000,
      });
      instanceRef.current = instance;
      await instance.ready;
    })().catch(fail);
    return () => {
      cancelled = true;
      void instanceRef.current?.destroy().catch(() => undefined);
      instanceRef.current = null;
      canvas?.remove();
    };
  }, [track.assUrl, track.fontsUrl, videoRef]);

  useEffect(() => {
    if (instanceRef.current) instanceRef.current.timeOffset = offsetMs / 1000;
  }, [offsetMs]);

  if (failed) return <SubtitleOverlay url={track.url} currentMs={currentMs} />;
  return <div ref={hostRef} className="ass-host" data-testid="ass-subtitles" />;
}
