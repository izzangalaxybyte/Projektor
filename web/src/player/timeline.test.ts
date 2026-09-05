import { describe, expect, it } from 'vitest';
import { planSeek } from './timeline.js';

const base = { offsetMs: 0, availableMs: 600_000, knownDurationMs: 5_400_000 };

describe('planSeek', () => {
  it('seeks locally for direct play and transcodes, clamped to the file', () => {
    expect(planSeek({ ...base, method: 'direct', targetMs: 4_000_000 })).toEqual({
      kind: 'local',
      ms: 4_000_000,
    });
    expect(planSeek({ ...base, method: 'transcode', targetMs: 9_000_000 })).toEqual({
      kind: 'local',
      ms: 5_399_500,
    });
    expect(planSeek({ ...base, method: 'direct', targetMs: -5 })).toEqual({ kind: 'local', ms: 0 });
  });

  it('seeks locally inside the remuxed part and restarts beyond it', () => {
    expect(planSeek({ ...base, method: 'remux', targetMs: 300_000 })).toEqual({
      kind: 'local',
      ms: 300_000,
    });
    expect(planSeek({ ...base, method: 'remux', targetMs: 599_000 })).toEqual({
      kind: 'restart',
      ms: 599_000,
    });
    expect(planSeek({ ...base, method: 'remux', targetMs: 2_700_000 })).toEqual({
      kind: 'restart',
      ms: 2_700_000,
    });
  });

  it('accounts for a session that started mid-file', () => {
    const mid = { ...base, method: 'remux' as const, offsetMs: 2_700_000, availableMs: 120_000 };
    expect(planSeek({ ...mid, targetMs: 2_760_000 })).toEqual({ kind: 'local', ms: 60_000 });
    expect(planSeek({ ...mid, targetMs: 1_000_000 })).toEqual({ kind: 'restart', ms: 1_000_000 });
    expect(planSeek({ ...mid, targetMs: 3_000_000 })).toEqual({ kind: 'restart', ms: 3_000_000 });
  });

  it('treats a finished remux as a plain file', () => {
    const done = { ...base, method: 'remux' as const, availableMs: 5_400_000 };
    expect(planSeek({ ...done, targetMs: 5_000_000 })).toEqual({ kind: 'local', ms: 5_000_000 });
    expect(planSeek({ ...done, targetMs: 5_399_900 })).toEqual({ kind: 'local', ms: 5_399_500 });
  });
});
