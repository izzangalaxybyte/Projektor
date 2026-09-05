import { describe, expect, it } from 'vitest';
import { buildDeviceProfile } from './profile.js';

describe('buildDeviceProfile', () => {
  it('reports only what canPlayType accepts', () => {
    const fake = {
      canPlayType: (type: string) => (/avc1|mp4a|video\/mp4$|webm/.test(type) ? 'probably' : ''),
    } as unknown as HTMLVideoElement;
    const profile = buildDeviceProfile(fake);
    // The mkv probe carries an avc1 codec string, so it passes this fake too.
    expect(profile.containers).toEqual(['mp4', 'webm', 'mkv']);
    expect(profile.videoCodecs).toEqual(['h264', 'vp9']);
    expect(profile.audioCodecs).toEqual(['aac', 'opus']);
    expect(profile.hlsSegmentContainer).toBe(supports() ? 'fmp4' : 'ts');
  });
});

const supports = () => 'MediaSource' in window;
