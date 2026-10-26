import { describe, expect, it } from 'vitest';
import { cleanVtt } from './service.js';

describe('cleanVtt', () => {
  it('drops leftover ASS override blocks and vector drawings, and cues left empty', () => {
    const vtt = [
      'WEBVTT',
      '',
      '00:21.717 --> 00:23.507',
      "<b>{=74}<i>There's someone...</i></b>",
      '',
      '00:30.000 --> 00:31.000',
      'm 0 0 l 1920 0 1920 1080 0 1080',
      '',
      '00:32.000 --> 00:33.000',
      '<b>Show me.</b>',
      '',
    ].join('\n');
    expect(cleanVtt(vtt)).toBe(
      [
        'WEBVTT',
        '',
        '00:21.717 --> 00:23.507',
        "<b><i>There's someone...</i></b>",
        '',
        '00:32.000 --> 00:33.000',
        '<b>Show me.</b>',
        '',
      ].join('\n'),
    );
  });

  it('leaves ordinary cues alone, including ones that start with the letter m', () => {
    const vtt = 'WEBVTT\n\n00:01.000 --> 00:02.000\nmaybe 2 or 3 of them\n';
    expect(cleanVtt(vtt)).toBe(vtt);
  });
});
