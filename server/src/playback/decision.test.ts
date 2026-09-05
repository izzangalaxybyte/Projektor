import { describe, expect, it } from 'vitest';
import type { DeviceProfile } from '../schemas/index.js';
import { decide, type DecisionFile } from './decision.js';

const stream = (
  index: number,
  type: 'video' | 'audio' | 'subtitle',
  codec: string,
  extra: Partial<DecisionFile['streams'][number]> = {},
) => ({
  index,
  type,
  codec,
  width: type === 'video' ? 1920 : null,
  height: type === 'video' ? 1080 : null,
  channels: type === 'audio' ? 6 : null,
  isDefault: false,
  language: null,
  ...extra,
});

const mp4H264Aac: DecisionFile = {
  container: 'mp4',
  bitrate: 4_000_000,
  streams: [stream(0, 'video', 'h264'), stream(1, 'audio', 'aac')],
};
const mkvHevcAc3: DecisionFile = {
  container: 'mkv',
  bitrate: 12_000_000,
  streams: [stream(0, 'video', 'hevc'), stream(1, 'audio', 'ac3'), stream(2, 'subtitle', 'subrip')],
};
const mkvH264Dual: DecisionFile = {
  container: 'mkv',
  bitrate: 3_000_000,
  streams: [
    stream(0, 'video', 'h264'),
    stream(1, 'audio', 'aac', { isDefault: true, language: 'jpn' }),
    stream(2, 'audio', 'aac', { language: 'eng' }),
    stream(3, 'subtitle', 'ass'),
  ],
};

const chrome: DeviceProfile = {
  name: 'Chrome',
  containers: ['mp4', 'webm', 'mkv'],
  videoCodecs: ['h264', 'vp9', 'av1'],
  audioCodecs: ['aac', 'opus', 'mp3'],
  maxWidth: null,
  maxBitrate: null,
  hlsSegmentContainer: 'fmp4',
};
const safari: DeviceProfile = {
  name: 'Safari',
  containers: ['mp4', 'mov'],
  videoCodecs: ['h264', 'hevc'],
  audioCodecs: ['aac', 'ac3', 'eac3'],
  maxWidth: null,
  maxBitrate: null,
  hlsSegmentContainer: 'fmp4',
};
const oldTv: DeviceProfile = {
  name: 'Tizen 5',
  containers: ['mp4', 'mkv', 'ts'],
  videoCodecs: ['h264'],
  audioCodecs: ['aac', 'ac3'],
  maxWidth: 1920,
  maxBitrate: 8_000_000,
  hlsSegmentContainer: 'ts',
};

describe('decide', () => {
  it('direct plays when container, codecs, and limits all fit', () => {
    const d = decide(mp4H264Aac, chrome);
    expect(d).toMatchObject({ method: 'direct', video: 'copy', audio: 'copy' });
    expect(decide(mkvH264Dual, chrome).method).toBe('direct');
  });

  it('remuxes when only the container is wrong', () => {
    // Safari plays hevc + ac3 but not mkv.
    expect(decide(mkvHevcAc3, safari)).toMatchObject({
      method: 'remux',
      video: 'copy',
      audio: 'copy',
    });
    expect(decide(mkvHevcAc3, safari).reasons).toEqual(['container mkv not supported']);
  });

  it('remuxes with audio transcode when only the audio codec is wrong', () => {
    const d = decide(
      { ...mp4H264Aac, streams: [stream(0, 'video', 'h264'), stream(1, 'audio', 'dts')] },
      chrome,
    );
    expect(d).toMatchObject({ method: 'remux', video: 'copy', audio: 'transcode' });
  });

  it('transcodes when the video codec is unsupported and copies audio the device can play', () => {
    const d = decide(mkvHevcAc3, oldTv);
    expect(d).toMatchObject({ method: 'transcode', video: 'transcode', audio: 'copy' });
    expect(d.reasons).toEqual([
      'video codec hevc not supported',
      'bitrate 12000000 exceeds 8000000',
    ]);
  });

  it('transcodes when the device cannot play either codec', () => {
    expect(decide(mkvHevcAc3, chrome)).toMatchObject({
      method: 'transcode',
      video: 'transcode',
      audio: 'transcode',
    });
  });

  it('transcodes when width or bitrate exceed the profile limits', () => {
    const uhd = {
      ...mp4H264Aac,
      streams: [
        stream(0, 'video', 'h264', { width: 3840, height: 2160 }),
        stream(1, 'audio', 'aac'),
      ],
    };
    expect(decide(uhd, oldTv).reasons).toEqual(['width 3840 exceeds 1920']);
    expect(decide({ ...mp4H264Aac, bitrate: 20_000_000 }, oldTv).method).toBe('transcode');
  });

  it('picks the default audio track, or the requested one, and remuxes to switch tracks', () => {
    expect(decide(mkvH264Dual, chrome).audioStream?.language).toBe('jpn');
    const eng = decide(mkvH264Dual, chrome, { audioStreamIndex: 2 });
    expect(eng.audioStream?.language).toBe('eng');
    expect(eng.method).toBe('remux');
    expect(eng.reasons).toEqual(['non-default audio track requested']);
    expect(decide(mkvH264Dual, chrome, { audioStreamIndex: 1 }).method).toBe('direct');
  });

  it('matches codecs case-insensitively and reports a missing video stream', () => {
    expect(decide(mp4H264Aac, { ...chrome, videoCodecs: ['H264'] }).method).toBe('direct');
    const audioOnly = { container: 'mp4', bitrate: null, streams: [stream(0, 'audio', 'aac')] };
    expect(decide(audioOnly, chrome).reasons).toContain('no video stream');
  });
});
