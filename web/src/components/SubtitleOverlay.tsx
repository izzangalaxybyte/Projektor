import { Fragment, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { withAccessToken } from '../api/client.js';
import { activeCues, cueLines, parseVtt, type Cue, type CueSpan } from '../player/vtt.js';

interface Props {
  url: string | null;
  currentMs: number;
  /** Height of controls covering the bottom of the player; cues stay above it. */
  liftPx?: number;
}

/** Renders the active WebVTT cues over the video, the same way on every browser and TV. */
export function SubtitleOverlay({ url, currentMs, liftPx = 0 }: Props) {
  const [cues, setCues] = useState<Cue[]>([]);
  useEffect(() => {
    setCues([]);
    if (!url) return;
    let cancelled = false;
    fetch(withAccessToken(url))
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((text) => !cancelled && setCues(parseVtt(text)))
      .catch(() => !cancelled && setCues([]));
    return () => {
      cancelled = true;
    };
  }, [url]);
  const active = useMemo(() => activeCues(cues, currentMs), [cues, currentMs]);
  if (active.length === 0) return null;
  return (
    <div
      className="subtitle-overlay"
      data-testid="subtitle"
      aria-live="off"
      // Browsers without CSS max() keep the default 12%.
      style={liftPx > 0 ? { bottom: `max(12%, ${liftPx + 8}px)` } : undefined}
    >
      {active.map((c, i) => (
        <p key={i}>
          {cueLines(c.text).map((line, j) => (
            <Fragment key={j}>
              {j > 0 && <br />}
              {line.map((span, k) => (
                <span key={k} style={spanStyle(span)}>
                  {span.text}
                </span>
              ))}
            </Fragment>
          ))}
        </p>
      ))}
    </div>
  );
}

function spanStyle(span: CueSpan): CSSProperties | undefined {
  if (!span.italic && !span.bold && !span.underline) return undefined;
  return {
    fontStyle: span.italic ? 'italic' : undefined,
    fontWeight: span.bold ? 'bold' : undefined,
    textDecoration: span.underline ? 'underline' : undefined,
  };
}
