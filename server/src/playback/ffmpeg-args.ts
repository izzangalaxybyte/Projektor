// Builds ffmpeg argument arrays for HLS sessions. Pure and unit tested; nothing here spawns.
import type { PlaybackSession } from './sessions.js';

export const HLS_SEGMENT_SECONDS = 6;

export interface HlsNaming {
  segmentExtension: 'ts' | 'm4s';
  initFile: string | null;
  playlist: string;
}

export function hlsNaming(container: 'ts' | 'fmp4'): HlsNaming {
  return container === 'fmp4'
    ? { segmentExtension: 'm4s', initFile: 'init.mp4', playlist: 'index.m3u8' }
    : { segmentExtension: 'ts', initFile: null, playlist: 'index.m3u8' };
}

/** Input, stream mapping, and audio codec arguments shared by remux and transcode. */
function inputAndAudio(
  session: PlaybackSession,
  seekMs: number,
): {
  input: string[];
  maps: string[];
  audio: string[];
} {
  const { decision } = session;
  const input = ['-hide_banner', '-loglevel', 'error', '-nostdin'];
  if (seekMs > 0) input.push('-ss', (seekMs / 1000).toFixed(3));
  input.push('-i', session.filePath);

  const maps = ['-map', `0:${decision.videoStream?.index ?? 'v:0'}`];
  let audio: string[] = ['-an'];
  if (decision.audioStream) {
    maps.push('-map', `0:${decision.audioStream.index}`);
    audio =
      decision.audio === 'copy' ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-ac', '2', '-b:a', '192k'];
  }
  return { input, maps, audio };
}

function hlsOutput(
  session: PlaybackSession,
  outDir: string,
  startNumber: number,
  playlistName = 'index.m3u8',
): string[] {
  const naming = hlsNaming(session.profile.hlsSegmentContainer);
  const args = [
    '-sn',
    '-dn',
    '-f',
    'hls',
    '-hls_time',
    String(HLS_SEGMENT_SECONDS),
    '-hls_list_size',
    '0',
    '-hls_playlist_type',
    'event',
    '-hls_flags',
    'temp_file+independent_segments',
    '-start_number',
    String(startNumber),
    '-hls_segment_filename',
    `${outDir}/seg-%d.${naming.segmentExtension}`,
  ];
  if (naming.initFile)
    args.push('-hls_segment_type', 'fmp4', '-hls_fmp4_init_filename', naming.initFile);
  else args.push('-hls_segment_type', 'mpegts');
  args.push(`${outDir}/${playlistName}`);
  return args;
}

/** Remux: copy the video stream, copy or re-encode audio, segment into HLS. */
export function buildRemuxArgs(session: PlaybackSession, outDir: string): string[] {
  const { input, maps, audio } = inputAndAudio(session, session.startPositionMs);
  // Browsers' MediaSource and Safari want the 'hvc1' sample entry for HEVC; ffmpeg defaults to 'hev1'.
  const tag = session.decision.videoStream?.codec === 'hevc' ? ['-tag:v', 'hvc1'] : [];
  return [...input, ...maps, '-c:v', 'copy', ...tag, ...audio, ...hlsOutput(session, outDir, 0)];
}

/**
 * vaapi: decode, filter, and encode on the GPU. vaapi-encode: decode and filter on the CPU, then
 * upload and encode on the GPU (for sources the GPU cannot decode, such as 10-bit HEVC on
 * Skylake, or HDR where the driver lacks tone mapping). null: everything in software.
 */
export type HardwareEncoder = 'vaapi' | 'vaapi-encode' | null;

/** The next thing to try when a transcode fails before producing a segment. */
export function fallbackHardware(current: HardwareEncoder): HardwareEncoder | undefined {
  if (current === 'vaapi') return 'vaapi-encode';
  if (current === 'vaapi-encode') return null;
  return undefined;
}

/** CPU-side tone mapping to BT.709 SDR; slow at 4K, so it is paired with a 1080p cap. */
export const SOFTWARE_TONEMAP = [
  'zscale=t=linear:npl=100',
  'format=gbrpf32le',
  'zscale=p=bt709',
  'tonemap=hable:desat=0',
  'zscale=t=bt709:m=bt709:r=tv',
];

export interface TranscodeOptions {
  /** First segment to produce; ffmpeg seeks to startSegment * HLS_SEGMENT_SECONDS. */
  startSegment: number;
  hardware: HardwareEncoder;
  vaapiDevice?: string;
  /** Overrides SOFTWARE_HDR_MAX_WIDTH for CPU-side tone mapping. */
  hdrTonemapMaxWidth?: number;
}

/**
 * Widest output when HDR has to be tone-mapped on the CPU. On a four-core Skylake the float
 * tone-mapping chain manages 20 fps at 1080p and comfortably more at 720p; HDR_TONEMAP_MAX_WIDTH
 * raises it on a stronger box.
 */
export const SOFTWARE_HDR_MAX_WIDTH = 1280;

/** ffmpeg's own playlist, written but never served; ours is generated from the duration. */
export const FFMPEG_PLAYLIST = 'ffmpeg.m3u8';

/**
 * Transcode: H.264 video with a keyframe forced at every segment boundary so segment N always
 * covers [N*6, (N+1)*6) seconds regardless of where ffmpeg was started, plus a timestamp offset
 * so segments from different runs share one timeline.
 */
export function buildTranscodeArgs(
  session: PlaybackSession,
  outDir: string,
  options: TranscodeOptions,
): string[] {
  const seekSeconds = options.startSegment * HLS_SEGMENT_SECONDS;
  const { input, maps, audio } = inputAndAudio(session, seekSeconds * 1000);
  const { profile, decision } = session;

  const video: string[] = [];
  const width = decision.videoStream?.width ?? null;
  const hdr = decision.videoStream?.hdr === true;
  // CPU-side HDR tone mapping cannot keep up at 4K, so those paths cap the output at 1080p.
  const tonemapCap = options.hdrTonemapMaxWidth ?? SOFTWARE_HDR_MAX_WIDTH;
  const capWidth =
    hdr && options.hardware !== 'vaapi'
      ? Math.min(profile.maxWidth ?? tonemapCap, tonemapCap)
      : profile.maxWidth;
  const targetWidth = capWidth !== null && width !== null && width > capWidth ? capWidth : null;
  const maxBitrate = profile.maxBitrate;

  if (options.hardware === 'vaapi') {
    // Decode on the GPU when possible, keep frames there, scale on the GPU, encode with VAAPI.
    input.unshift(
      '-init_hw_device',
      `vaapi=va:${options.vaapiDevice ?? '/dev/dri/renderD128'}`,
      '-filter_hw_device',
      'va',
    );
    input.splice(input.indexOf('-i'), 0, '-hwaccel', 'vaapi', '-hwaccel_output_format', 'vaapi');
    // HDR sources are tone-mapped to BT.709 on the GPU (this also converts 10-bit to 8-bit);
    // everything else just becomes 8-bit nv12, scaled when the profile asks for it.
    const filters = decision.videoStream?.hdr
      ? [
          'tonemap_vaapi=format=nv12:t=bt709:m=bt709:p=bt709',
          ...(targetWidth !== null ? [`scale_vaapi=w=${targetWidth}:h=-2`] : []),
        ]
      : [
          targetWidth !== null
            ? `scale_vaapi=w=${targetWidth}:h=-2:format=nv12`
            : 'scale_vaapi=format=nv12',
        ];
    video.push('-vf', filters.join(','), '-c:v', 'h264_vaapi', '-profile:v', 'high');
    if (maxBitrate !== null)
      video.push(
        '-b:v',
        String(maxBitrate),
        '-maxrate',
        String(maxBitrate),
        '-bufsize',
        String(maxBitrate * 2),
      );
    else video.push('-qp', '23');
  } else if (options.hardware === 'vaapi-encode') {
    // Software decode and filters (scale first, so tone mapping runs at the output size), then
    // upload the frames and encode on the GPU.
    input.unshift(
      '-init_hw_device',
      `vaapi=va:${options.vaapiDevice ?? '/dev/dri/renderD128'}`,
      '-filter_hw_device',
      'va',
    );
    const filters: string[] = [];
    if (targetWidth !== null) filters.push(`scale=${targetWidth}:-2`);
    if (hdr) filters.push(...SOFTWARE_TONEMAP);
    filters.push('format=nv12', 'hwupload');
    video.push('-vf', filters.join(','), '-c:v', 'h264_vaapi', '-profile:v', 'high');
    if (maxBitrate !== null)
      video.push(
        '-b:v',
        String(maxBitrate),
        '-maxrate',
        String(maxBitrate),
        '-bufsize',
        String(maxBitrate * 2),
      );
    else video.push('-qp', '23');
  } else {
    const soft: string[] = [];
    if (targetWidth !== null) soft.push(`scale=${targetWidth}:-2`);
    // Software tone mapping (slow, but correct colours) for boxes without VAAPI.
    if (hdr) soft.push(...SOFTWARE_TONEMAP);
    if (soft.length) video.push('-vf', soft.join(','));
    video.push(
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '23',
      '-pix_fmt',
      'yuv420p',
      '-profile:v',
      'high',
      '-level',
      '4.1',
    );
    if (maxBitrate !== null)
      video.push('-maxrate', String(maxBitrate), '-bufsize', String(maxBitrate * 2));
  }
  video.push(
    '-force_key_frames',
    `expr:gte(t,n_forced*${HLS_SEGMENT_SECONDS})`,
    '-sc_threshold',
    '0',
  );
  const offset = seekSeconds > 0 ? ['-output_ts_offset', String(seekSeconds)] : [];

  return [
    ...input,
    ...maps,
    ...video,
    ...audio,
    ...offset,
    ...hlsOutput(session, outDir, options.startSegment, FFMPEG_PLAYLIST),
  ];
}

/** Segment count for a duration: a partial last segment counts. */
export function segmentCount(durationMs: number): number {
  return Math.max(1, Math.ceil(durationMs / (HLS_SEGMENT_SECONDS * 1000)));
}

/** VOD media playlist for a transcode session, valid before any segment exists. */
export function vodPlaylist(durationMs: number, container: 'ts' | 'fmp4'): string {
  const naming = hlsNaming(container);
  const count = segmentCount(durationMs);
  const lines = [
    '#EXTM3U',
    `#EXT-X-VERSION:${container === 'fmp4' ? 7 : 3}`,
    `#EXT-X-TARGETDURATION:${HLS_SEGMENT_SECONDS}`,
    '#EXT-X-MEDIA-SEQUENCE:0',
    '#EXT-X-PLAYLIST-TYPE:VOD',
    '#EXT-X-INDEPENDENT-SEGMENTS',
  ];
  if (naming.initFile) lines.push(`#EXT-X-MAP:URI="${naming.initFile}"`);
  const totalSeconds = durationMs / 1000;
  for (let i = 0; i < count; i++) {
    const remaining = totalSeconds - i * HLS_SEGMENT_SECONDS;
    const length = Math.min(HLS_SEGMENT_SECONDS, remaining);
    lines.push(`#EXTINF:${length.toFixed(3)},`, `seg-${i}.${naming.segmentExtension}`);
  }
  lines.push('#EXT-X-ENDLIST', '');
  return lines.join('\n');
}
