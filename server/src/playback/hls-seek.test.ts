import { describe, expect, it } from 'vitest';
import { nextSegmentOfRun } from './hls.js';

describe('nextSegmentOfRun', () => {
  it('is the start segment before the run has written anything', () => {
    expect(nextSegmentOfRun(new Set(), 0)).toBe(0);
    expect(nextSegmentOfRun(new Set([0, 1, 2]), 100)).toBe(100);
  });

  it('follows the segments written from the start', () => {
    expect(nextSegmentOfRun(new Set([100, 101, 102]), 100)).toBe(103);
  });

  it('ignores segments an earlier run left further on', () => {
    // Resumed at 300, then scrubbed back to 100: a seek to 250 is far ahead of this run.
    const written = new Set([300, 301, 302, 303, 100, 101]);
    expect(nextSegmentOfRun(written, 100)).toBe(102);
  });
});
