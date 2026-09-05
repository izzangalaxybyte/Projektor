import type { DeviceProfile } from '../api/client.js';

const PROBE: Record<string, string> = {
  // containers
  mp4: 'video/mp4',
  webm: 'video/webm',
  mkv: 'video/x-matroska; codecs="avc1.42E01E, mp4a.40.2"',
  mov: 'video/quicktime',
  // video codecs
  h264: 'video/mp4; codecs="avc1.640028"',
  hevc: 'video/mp4; codecs="hvc1.1.6.L120.B0"',
  vp9: 'video/webm; codecs="vp9"',
  av1: 'video/mp4; codecs="av01.0.08M.08"',
  // audio codecs
  aac: 'audio/mp4; codecs="mp4a.40.2"',
  ac3: 'audio/mp4; codecs="ac-3"',
  eac3: 'audio/mp4; codecs="ec-3"',
  opus: 'audio/webm; codecs="opus"',
  mp3: 'audio/mpeg',
  flac: 'audio/flac',
};

function canPlay(video: HTMLVideoElement, key: string): boolean {
  const type = PROBE[key];
  if (!type) return false;
  return video.canPlayType(type) !== '';
}

/** What this browser can play natively, asked of the video element itself. */
export function buildDeviceProfile(
  video: HTMLVideoElement = document.createElement('video'),
): DeviceProfile {
  const containers = ['mp4', 'webm', 'mkv', 'mov'].filter((c) => canPlay(video, c));
  const videoCodecs = ['h264', 'hevc', 'vp9', 'av1'].filter((c) => canPlay(video, c));
  const audioCodecs = ['aac', 'ac3', 'eac3', 'opus', 'mp3', 'flac'].filter((c) =>
    canPlay(video, c),
  );
  const nativeHls = video.canPlayType('application/vnd.apple.mpegurl') !== '';
  return {
    name: describeBrowser(),
    containers,
    videoCodecs,
    audioCodecs,
    maxWidth: null,
    maxBitrate: null,
    // Safari's native HLS and hls.js both handle fMP4; MPEG-TS is for the Tizen build (phase 3).
    hlsSegmentContainer: nativeHls || supportsMse() ? 'fmp4' : 'ts',
  };
}

export function supportsMse(): boolean {
  return typeof window !== 'undefined' && 'MediaSource' in window;
}

export function supportsNativeHls(
  video: HTMLVideoElement = document.createElement('video'),
): boolean {
  return video.canPlayType('application/vnd.apple.mpegurl') !== '';
}

function describeBrowser(): string {
  const ua = navigator.userAgent;
  if (/Tizen/i.test(ua)) return 'Samsung TV browser';
  if (/Edg\//.test(ua)) return 'Edge';
  if (/Chrome\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua)) return 'Safari';
  if (/Firefox\//.test(ua)) return 'Firefox';
  return 'Browser';
}
