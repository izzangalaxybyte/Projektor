import { describe, expect, it } from 'vitest';
import { apiBaseUrl, DEFAULT_SERVER_URL } from './config.js';

describe('apiBaseUrl', () => {
  it('stays same-origin when served over http(s)', () => {
    expect(apiBaseUrl({ protocol: 'http:', hostname: '192.168.100.20' })).toBe('');
    expect(apiBaseUrl({ protocol: 'https:', hostname: 'projektor.local' })).toBe('');
  });
  it('uses the baked-in server when packaged without an origin', () => {
    expect(apiBaseUrl({ protocol: 'file:', hostname: '' })).toBe(DEFAULT_SERVER_URL);
    expect(DEFAULT_SERVER_URL).toBe('http://192.168.100.20:8096');
  });
});
