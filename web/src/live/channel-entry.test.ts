import { describe, expect, it } from 'vitest';
import { channelByNumber, neighbourChannel } from './channel-entry.js';

const channels = [
  { id: 'a', number: 1 },
  { id: 'b', number: 2 },
  { id: 'c', number: null },
];

describe('neighbourChannel', () => {
  it('steps and wraps', () => {
    expect(neighbourChannel(channels, 'a', 1)?.id).toBe('b');
    expect(neighbourChannel(channels, 'c', 1)?.id).toBe('a');
    expect(neighbourChannel(channels, 'a', -1)?.id).toBe('c');
  });
  it('falls back to the first channel when the current one is gone', () => {
    expect(neighbourChannel(channels, 'zzz', 1)?.id).toBe('a');
    expect(neighbourChannel([], 'a', 1)).toBeNull();
  });
});

describe('channelByNumber', () => {
  it('matches typed digits to a channel number', () => {
    expect(channelByNumber(channels, '2')?.id).toBe('b');
    expect(channelByNumber(channels, '02')?.id).toBe('b');
    expect(channelByNumber(channels, '9')).toBeNull();
    expect(channelByNumber(channels, '')).toBeNull();
  });
});
