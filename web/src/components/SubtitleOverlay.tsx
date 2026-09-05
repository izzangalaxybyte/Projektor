import { useEffect, useMemo, useState } from 'react';
import { withAccessToken } from '../api/client.js';
import { activeCues, parseVtt, type Cue } from '../player/vtt.js';

interface Props {
  url: string | null;
  currentMs: number;
}

/** Renders the active WebVTT cues over the video, the same way on every browser and TV. */
export function SubtitleOverlay({ url, currentMs }: Props) {
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
    <div className="subtitle-overlay" data-testid="subtitle" aria-live="off">
      {active.map((c, i) => (
        <p key={i} dangerouslySetInnerHTML={{ __html: c.text.replace(/\n/g, '<br>') }} />
      ))}
    </div>
  );
}
