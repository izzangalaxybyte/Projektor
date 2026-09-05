import { describe, expect, it } from 'vitest';
import { buildDeviceProfile } from './profile.js';

describe('buildDeviceProfile', () => {
  it('reports only what canPlayType accepts', () => {
    const fake = {
      canPlayType: (type: string) => (/avc1|mp4a|video\/mp4$|webm/.test(type) ? 'probably' : ''),
    } as unknown as HTMLVideoElement;
    const profile = buildDeviceProfile(fake);
    // Matroska is deliberately left out even though the probe would pass: browsers stall on big MKVs.
    expect(profile.containers).toEqual(['mp4', 'webm']);
    expect(profile.videoCodecs).toEqual(['h264', 'vp9']);
    expect(profile.audioCodecs).toEqual(['aac', 'opus']);
    expect(profile.hlsSegmentContainer).toBe(supports() ? 'fmp4' : 'ts');
  });
});

const supports = () => 'MediaSource' in window;
