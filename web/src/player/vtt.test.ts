import { describe, expect, it } from 'vitest';
import { activeCues, parseTimestamp, parseVtt, sanitise } from './vtt.js';

const SAMPLE = `WEBVTT

1
00:01.000 --> 00:04.000
First <i>subtitle</i> line

00:00:05.000 --> 00:00:08.000 align:start position:10%
Second line
with a break

NOTE this is a comment

01:02:03.500 --> 01:02:04.000
<c.yellow>Styled</c> &amp; <b>bold</b>
`;

describe('vtt', () => {
  it('parses both timestamp forms', () => {
    expect(parseTimestamp('00:01.000')).toBe(1000);
    expect(parseTimestamp('00:00:05.000')).toBe(5000);
    expect(parseTimestamp('01:02:03.500')).toBe(3_723_500);
    expect(parseTimestamp('nope')).toBeNull();
  });
  it('extracts cues with sanitised multi-line text and ignores settings and notes', () => {
    const cues = parseVtt(SAMPLE);
    expect(cues).toEqual([
      { startMs: 1000, endMs: 4000, text: 'First <i>subtitle</i> line' },
      { startMs: 5000, endMs: 8000, text: 'Second line\nwith a break' },
      { startMs: 3_723_500, endMs: 3_724_000, text: 'Styled & <b>bold</b>' },
    ]);
  });
  it('finds the active cue', () => {
    const cues = parseVtt(SAMPLE);
    expect(activeCues(cues, 2000).map((c) => c.text)).toEqual(['First <i>subtitle</i> line']);
    expect(activeCues(cues, 4000)).toEqual([]);
    expect(activeCues(cues, 6500)).toHaveLength(1);
  });
  it('strips class and voice tags but keeps basic formatting', () => {
    expect(sanitise('<v Speaker>Hello <c.red>there</c> <u>you</u>')).toBe('Hello there <u>you</u>');
  });
});
