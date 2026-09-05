export interface Cue {
  startMs: number;
  endMs: number;
  /** Cue text with only <i>, <b>, <u> kept; line breaks as \n. */
  text: string;
}

const TIME = /(?:(\d+):)?(\d{2}):(\d{2})[.,](\d{3})/;

export function parseTimestamp(value: string): number | null {
  const m = TIME.exec(value.trim());
  if (!m) return null;
  const h = m[1] ? Number(m[1]) : 0;
  return ((h * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + Number(m[4]);
}

/** Minimal WebVTT parser: cue timings and text, ignoring settings, regions, and styles. */
export function parseVtt(source: string): Cue[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const cues: Cue[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const arrow = line.indexOf('-->');
    if (arrow === -1) {
      i++;
      continue;
    }
    const start = parseTimestamp(line.slice(0, arrow));
    const end = parseTimestamp(
      line
        .slice(arrow + 3)
        .split(/\s+/)
        .filter(Boolean)[0] ?? '',
    );
    i++;
    const text: string[] = [];
    while (i < lines.length && lines[i]!.trim() !== '') {
      text.push(lines[i]!);
      i++;
    }
    if (start !== null && end !== null && end > start)
      cues.push({ startMs: start, endMs: end, text: sanitise(text.join('\n')) });
  }
  return cues;
}

/** Drops every tag except simple italics, bold, underline; unescapes the few VTT entities. */
export function sanitise(text: string): string {
  return text
    .replace(/<\/?(?!\/?[ibu]>)[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

/** Cues active at a time, in order. */
export function activeCues(cues: Cue[], timeMs: number): Cue[] {
  return cues.filter((c) => timeMs >= c.startMs && timeMs < c.endMs);
}
