import { describe, expect, it } from 'vitest';
import { redactUrl } from './redact.js';

describe('redactUrl', () => {
  it('blanks the access token wherever it sits in the query', () => {
    expect(redactUrl('/api/files/f/stream?access_token=abc-123')).toBe(
      '/api/files/f/stream?access_token=REDACTED',
    );
    expect(redactUrl('/api/hls/s/seg-1.m4s?x=1&access_token=a%2Fb&y=2')).toBe(
      '/api/hls/s/seg-1.m4s?x=1&access_token=REDACTED&y=2',
    );
  });

  it('leaves URLs without a token alone', () => {
    expect(redactUrl('/api/items?limit=20')).toBe('/api/items?limit=20');
    expect(redactUrl('/api/token_info?my_access_token=1')).toBe(
      '/api/token_info?my_access_token=1',
    );
  });
});
