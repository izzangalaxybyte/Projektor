import { describe, expect, it } from 'vitest';
import { matchTrack } from './track-preferences.js';

const tracks = [
  { id: 'a', language: 'eng', title: 'English Signs/Songs [whomst]' },
  { id: 'b', language: 'eng', title: 'English [whomst]' },
  { id: 'c', language: 'fre', title: 'French [Aoi-Project]' },
  { id: 'd', language: 'jpn', title: null },
];

describe('matchTrack', () => {
  it('finds the same language and title', () => {
    expect(matchTrack(tracks, { language: 'eng', title: 'English [whomst]' })?.id).toBe('b');
  });

  it('falls back to the title, then the language', () => {
    expect(matchTrack(tracks, { language: null, title: 'French [Aoi-Project]' })?.id).toBe('c');
    expect(matchTrack(tracks, { language: 'jpn', title: 'Japanese 2.0' })?.id).toBe('d');
  });

  it('keeps a full subtitle pick away from a signs-only track in the same language', () => {
    expect(matchTrack(tracks, { language: 'eng', title: 'English [other group]' })?.id).toBe('b');
    expect(matchTrack(tracks, { language: 'eng', title: 'Signs & Songs' })?.id).toBe('a');
  });

  it('finds nothing for an unknown language', () => {
    expect(matchTrack(tracks, { language: 'ger', title: null })).toBeNull();
  });
});
