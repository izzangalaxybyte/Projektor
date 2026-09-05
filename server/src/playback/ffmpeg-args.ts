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
function inputAndAudio(session: PlaybackSession): {
  input: string[];
  maps: string[];
  audio: string[];
} {
  const { decision, startPositionMs } = session;
  const input = ['-hide_banner', '-loglevel', 'error', '-nostdin'];
  if (startPositionMs > 0) input.push('-ss', (startPositionMs / 1000).toFixed(3));
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

function hlsOutput(session: PlaybackSession, outDir: string, startNumber: number): string[] {
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
  args.push(`${outDir}/${naming.playlist}`);
  return args;
}

/** Remux: copy the video stream, copy or re-encode audio, segment into HLS. */
export function buildRemuxArgs(session: PlaybackSession, outDir: string): string[] {
  const { input, maps, audio } = inputAndAudio(session);
  return [...input, ...maps, '-c:v', 'copy', ...audio, ...hlsOutput(session, outDir, 0)];
}
