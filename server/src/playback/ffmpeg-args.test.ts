import { describe, expect, it } from 'vitest';
import type { PlaybackSession } from './sessions.js';
import {
  buildRemuxArgs,
  buildTranscodeArgs,
  hlsNaming,
  segmentCount,
  vodPlaylist,
} from './ffmpeg-args.js';

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
      '-tag:v',
      'hvc1',
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

describe('buildTranscodeArgs', () => {
  const session = (): PlaybackSession => {
    const s = base({ profile: { ...base().profile, maxWidth: 1280, maxBitrate: 4_000_000 } });
    s.decision = { ...s.decision, method: 'transcode', video: 'transcode', audio: 'transcode' };
    return s;
  };

  it('encodes h264 with libx264, forced keyframes, scaling, and a bitrate cap from segment 0', () => {
    const args = buildTranscodeArgs(session(), '/out', { startSegment: 0, hardware: null });
    const joined = args.join(' ');
    expect(joined).not.toContain('-ss');
    expect(joined).toContain('-vf scale=1280:-2');
    expect(joined).toContain(
      '-c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p -profile:v high -level 4.1',
    );
    expect(joined).toContain('-maxrate 4000000 -bufsize 8000000');
    expect(joined).toContain('-force_key_frames expr:gte(t,n_forced*6) -sc_threshold 0');
    expect(joined).toContain('-c:a aac -ac 2 -b:a 192k');
    expect(joined).not.toContain('-output_ts_offset');
    expect(joined).toContain('-start_number 0');
    expect(args[args.length - 1]).toBe('/out/ffmpeg.m3u8');
  });

  it('seeks to the segment start and offsets timestamps when starting mid-file', () => {
    const args = buildTranscodeArgs(session(), '/out', { startSegment: 40, hardware: null });
    const joined = args.join(' ');
    expect(joined).toContain('-ss 240.000 -i /media/show.mkv');
    expect(joined).toContain('-output_ts_offset 240');
    expect(joined).toContain('-start_number 40');
  });

  it('uses VAAPI decode, scale, and encode when hardware is available', () => {
    const args = buildTranscodeArgs(session(), '/out', {
      startSegment: 0,
      hardware: 'vaapi',
      vaapiDevice: '/dev/dri/renderD129',
    });
    const joined = args.join(' ');
    expect(joined).toContain('-init_hw_device vaapi=va:/dev/dri/renderD129 -filter_hw_device va');
    expect(joined).toContain('-hwaccel vaapi -hwaccel_output_format vaapi -i /media/show.mkv');
    expect(joined).toContain(
      '-vf scale_vaapi=w=1280:h=-2:format=nv12 -c:v h264_vaapi -profile:v high',
    );
    expect(joined).toContain('-b:v 4000000 -maxrate 4000000 -bufsize 8000000');
    expect(joined).not.toContain('libx264');
  });

  it('skips scaling when the source fits and uses qp without a bitrate cap on vaapi', () => {
    const s = session();
    s.profile = { ...s.profile, maxWidth: null, maxBitrate: null };
    expect(
      buildTranscodeArgs(s, '/out', { startSegment: 0, hardware: null }).join(' '),
    ).not.toContain('scale=');
    expect(
      buildTranscodeArgs(s, '/out', { startSegment: 0, hardware: 'vaapi' }).join(' '),
    ).toContain('-vf scale_vaapi=format=nv12 -c:v h264_vaapi -profile:v high -qp 23');
  });
});

describe('vodPlaylist', () => {
  it('lays out 6 second segments with a short tail and an end marker', () => {
    expect(segmentCount(30_005)).toBe(6);
    expect(segmentCount(30_000)).toBe(5);
    expect(segmentCount(100)).toBe(1);
    const playlist = vodPlaylist(20_500, 'ts');
    expect(playlist).toContain('#EXT-X-PLAYLIST-TYPE:VOD');
    expect(playlist).toContain('#EXT-X-TARGETDURATION:6');
    expect(playlist).toContain('#EXTINF:6.000,\nseg-0.ts');
    expect(playlist).toContain('#EXTINF:6.000,\nseg-2.ts');
    expect(playlist).toContain('#EXTINF:2.500,\nseg-3.ts');
    expect(playlist.trim().endsWith('#EXT-X-ENDLIST')).toBe(true);
    expect(playlist).not.toContain('seg-4');
  });
  it('adds the init segment map for fmp4', () => {
    const playlist = vodPlaylist(6_000, 'fmp4');
    expect(playlist).toContain('#EXT-X-VERSION:7');
    expect(playlist).toContain('#EXT-X-MAP:URI="init.mp4"');
    expect(playlist).toContain('seg-0.m4s');
  });

  it('tone-maps HDR sources on the GPU and in software', () => {
    const b = base();
    const hdr: PlaybackSession = {
      ...b,
      decision: {
        ...b.decision,
        method: 'transcode',
        video: 'transcode',
        videoStream: { ...b.decision.videoStream!, hdr: true, bitDepth: 10 },
      },
    };
    const gpu = buildTranscodeArgs(hdr, '/out', { startSegment: 0, hardware: 'vaapi' }).join(' ');
    expect(gpu).toContain('-vf tonemap_vaapi=format=nv12:t=bt709:m=bt709:p=bt709 -c:v h264_vaapi');
    const soft = buildTranscodeArgs(hdr, '/out', { startSegment: 0, hardware: null }).join(' ');
    expect(soft).toContain('tonemap=hable');
    expect(soft).toContain('-pix_fmt yuv420p');
  });
});
