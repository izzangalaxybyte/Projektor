import { describe, expect, it } from 'vitest';
import type { PlaybackSession } from './sessions.js';
import { buildRemuxArgs, hlsNaming } from './ffmpeg-args.js';

const base = (over: Partial<PlaybackSession> = {}): PlaybackSession => ({
  id: 'abc',
  fileId: 'f',
  filePath: '/media/show.mkv',
  durationMs: 30_000,
  profile: {
    name: 'x',
    containers: [],
    videoCodecs: [],
    audioCodecs: [],
    maxWidth: null,
    maxBitrate: null,
    hlsSegmentContainer: 'ts',
  },
  decision: {
    method: 'remux',
    video: 'copy',
    audio: 'copy',
    videoStream: {
      index: 0,
      type: 'video',
      codec: 'hevc',
      width: 1920,
      height: 1080,
      channels: null,
      isDefault: true,
      language: null,
    },
    audioStream: {
      index: 2,
      type: 'audio',
      codec: 'aac',
      width: null,
      height: null,
      channels: 2,
      isDefault: false,
      language: 'eng',
    },
    reasons: [],
  },
  startPositionMs: 0,
  createdAt: 0,
  lastAccessAt: 0,
  ...over,
});

describe('buildRemuxArgs', () => {
  it('copies video and the chosen audio track into mpegts segments', () => {
    const args = buildRemuxArgs(base(), '/out');
    expect(args).toEqual([
      '-hide_banner',
      '-loglevel',
      'error',
      '-nostdin',
      '-i',
      '/media/show.mkv',
      '-map',
      '0:0',
      '-map',
      '0:2',
      '-c:v',
      'copy',
      '-c:a',
      'copy',
      '-sn',
      '-dn',
      '-f',
      'hls',
      '-hls_time',
      '6',
      '-hls_list_size',
      '0',
      '-hls_playlist_type',
      'event',
      '-hls_flags',
      'temp_file+independent_segments',
      '-start_number',
      '0',
      '-hls_segment_filename',
      '/out/seg-%d.ts',
      '-hls_segment_type',
      'mpegts',
      '/out/index.m3u8',
    ]);
  });

  it('re-encodes audio to stereo AAC when the decision says so, seeks for a start position, and uses fmp4 when asked', () => {
    const s = base({
      startPositionMs: 90_500,
      profile: { ...base().profile, hlsSegmentContainer: 'fmp4' },
    });
    s.decision = { ...s.decision, audio: 'transcode' };
    const args = buildRemuxArgs(s, '/out');
    expect(args.slice(4, 8)).toEqual(['-ss', '90.500', '-i', '/media/show.mkv']);
    expect(args).toContain('aac');
    expect(args.join(' ')).toContain('-c:a aac -ac 2 -b:a 192k');
    expect(args.join(' ')).toContain('-hls_segment_type fmp4 -hls_fmp4_init_filename init.mp4');
    expect(args).toContain('/out/seg-%d.m4s');
  });

  it('drops audio when the file has none', () => {
    const s = base();
    s.decision = { ...s.decision, audio: 'none', audioStream: null };
    const args = buildRemuxArgs(s, '/out');
    expect(args).toContain('-an');
    expect(args.filter((a) => a === '-map')).toHaveLength(1);
  });

  it('names fmp4 and ts outputs', () => {
    expect(hlsNaming('ts')).toEqual({
      segmentExtension: 'ts',
      initFile: null,
      playlist: 'index.m3u8',
    });
    expect(hlsNaming('fmp4')).toEqual({
      segmentExtension: 'm4s',
      initFile: 'init.mp4',
      playlist: 'index.m3u8',
    });
  });
});
