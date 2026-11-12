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

/**
 * Drops every tag except simple italics, bold, underline; unescapes the VTT entities and numeric
 * ones, since the text is shown as written and nothing else decodes them.
 */
export function sanitise(text: string): string {
  return text
    .replace(/<\/?(?!\/?[ibu]>)[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&lrm;/g, '‎')
    .replace(/&rlm;/g, '‏')
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (entity, code: string) => {
      const point = /^x/i.test(code) ? parseInt(code.slice(1), 16) : Number(code);
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
    })
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

export interface CueSpan {
  text: string;
  italic: boolean;
  bold: boolean;
  underline: boolean;
}

const MARKUP = /<(\/?)([ibu])>|\n/g;

/**
 * Splits sanitised cue text into lines of styled spans. Cue text comes from subtitle files and
 * downloads, so it is rendered as text nodes and never parsed as HTML.
 */
export function cueLines(text: string): CueSpan[][] {
  const lines: CueSpan[][] = [[]];
  const depth = { i: 0, b: 0, u: 0 };
  const push = (part: string) => {
    if (!part) return;
    lines[lines.length - 1]!.push({
      text: part,
      italic: depth.i > 0,
      bold: depth.b > 0,
      underline: depth.u > 0,
    });
  };
  let last = 0;
  for (const m of text.matchAll(MARKUP)) {
    push(text.slice(last, m.index));
    last = m.index + m[0].length;
    if (m[0] === '\n') lines.push([]);
    else {
      const tag = m[2] as 'i' | 'b' | 'u';
      depth[tag] = Math.max(0, depth[tag] + (m[1] ? -1 : 1));
    }
  }
  push(text.slice(last));
  return lines;
}

/** Cues active at a time, in order. */
export function activeCues(cues: Cue[], timeMs: number): Cue[] {
  return cues.filter((c) => timeMs >= c.startMs && timeMs < c.endMs);
}
