import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFS, formatRate, loadPrefs, savePrefs, SKIP_OPTIONS } from './prefs.js';

function memory(): Pick<Storage, 'getItem' | 'setItem'> & { data: Record<string, string> } {
  const data: Record<string, string> = {};
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) };
}

describe('player prefs', () => {
  it('defaults to a 10 second skip at normal speed', () => {
    expect(loadPrefs(memory())).toEqual(DEFAULT_PREFS);
    expect(loadPrefs(null)).toEqual(DEFAULT_PREFS);
  });
  it('round-trips valid values and rejects unknown ones', () => {
    const s = memory();
    savePrefs({ skipSeconds: 4, rate: 1.5 }, s);
    expect(loadPrefs(s)).toEqual({ skipSeconds: 4, rate: 1.5 });
    s.data['projektor.player'] = JSON.stringify({ skipSeconds: 42, rate: 9 });
    expect(loadPrefs(s)).toEqual(DEFAULT_PREFS);
    s.data['projektor.player'] = 'not json';
    expect(loadPrefs(s)).toEqual(DEFAULT_PREFS);
  });
  it('offers the requested skip amounts', () => {
    expect([...SKIP_OPTIONS]).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 15]);
    expect(formatRate(1)).toBe('Normal');
    expect(formatRate(1.5)).toBe('1.5×');
  });
});
