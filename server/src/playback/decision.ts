// Decides how a file reaches a device: direct play, remux into HLS, or transcode into HLS.
import type { DeviceProfile, PlaybackMethod } from '../schemas/index.js';

export interface DecisionStream {
  index: number;
  type: 'video' | 'audio' | 'subtitle';
  codec: string;
  width: number | null;
  height: number | null;
  channels: number | null;
  isDefault: boolean;
  language: string | null;
  bitDepth?: number | null;
  hdr?: boolean;
}

export interface DecisionFile {
  container: string | null;
  bitrate: number | null;
  streams: DecisionStream[];
}

export interface DecisionOptions {
  audioStreamIndex?: number | undefined;
}

export interface Decision {
  method: PlaybackMethod;
  /** Whether the video stream is copied or re-encoded (always h264 for now). */
  video: 'copy' | 'transcode';
  /** Whether the chosen audio stream is copied or re-encoded to AAC stereo. */
  audio: 'copy' | 'transcode' | 'none';
  videoStream: DecisionStream | null;
  audioStream: DecisionStream | null;
  reasons: string[];
}

/** Codecs the transcoder produces; every profile is assumed to play these. */
export const TRANSCODE_VIDEO_CODEC = 'h264';
export const TRANSCODE_AUDIO_CODEC = 'aac';

export function decide(
  file: DecisionFile,
  profile: DeviceProfile,
  options: DecisionOptions = {},
): Decision {
  const reasons: string[] = [];
  const video = file.streams.find((s) => s.type === 'video') ?? null;
  const audio = pickAudio(file.streams, options.audioStreamIndex);

  const containerOk = file.container !== null && has(profile.containers, file.container);
  if (!containerOk) reasons.push(`container ${file.container ?? 'unknown'} not supported`);

  let videoOk = video !== null;
  if (!video) reasons.push('no video stream');
  else {
    if (!has(profile.videoCodecs, video.codec)) {
      videoOk = false;
      reasons.push(`video codec ${video.codec} not supported`);
    } else if ((video.bitDepth ?? 8) > 8 && !has(profile.videoCodecs, `${video.codec}10`)) {
      // Browsers say yes to HEVC and then choke on Main 10; only devices that list hevc10 get a copy.
      videoOk = false;
      reasons.push(`${video.bitDepth}-bit ${video.codec} not supported`);
    }
    if (video.hdr && !profile.hdr) {
      videoOk = false;
      reasons.push('HDR source needs tone mapping for this device');
    }
    if (profile.maxWidth !== null && video.width !== null && video.width > profile.maxWidth) {
      videoOk = false;
      reasons.push(`width ${video.width} exceeds ${profile.maxWidth}`);
    }
  }
  if (profile.maxBitrate !== null && file.bitrate !== null && file.bitrate > profile.maxBitrate) {
    videoOk = false;
    reasons.push(`bitrate ${file.bitrate} exceeds ${profile.maxBitrate}`);
  }

  let audioOk = true;
  if (audio && !has(profile.audioCodecs, audio.codec)) {
    audioOk = false;
    reasons.push(`audio codec ${audio.codec} not supported`);
  }
  if (audio && options.audioStreamIndex !== undefined && !isDefaultChoice(file.streams, audio)) {
    // Direct play cannot switch audio tracks in most players; remux with only the chosen track.
    if (containerOk && videoOk && audioOk) reasons.push('non-default audio track requested');
    audioOk = audioOk && false;
  }

  if (containerOk && videoOk && audioOk) {
    return {
      method: 'direct',
      video: 'copy',
      audio: audio ? 'copy' : 'none',
      videoStream: video,
      audioStream: audio,
      reasons: ['direct play'],
    };
  }
  if (videoOk) {
    return {
      method: 'remux',
      video: 'copy',
      audio: audio ? (has(profile.audioCodecs, audio.codec) ? 'copy' : 'transcode') : 'none',
      videoStream: video,
      audioStream: audio,
      reasons,
    };
  }
  return {
    method: 'transcode',
    video: 'transcode',
    audio: audio ? (has(profile.audioCodecs, audio.codec) ? 'copy' : 'transcode') : 'none',
    videoStream: video,
    audioStream: audio,
    reasons,
  };
}

const has = (list: string[], value: string) =>
  list.some((v) => v.toLowerCase() === value.toLowerCase());

function pickAudio(streams: DecisionStream[], index: number | undefined): DecisionStream | null {
  const audio = streams.filter((s) => s.type === 'audio');
  if (index !== undefined) return audio.find((s) => s.index === index) ?? null;
  return audio.find((s) => s.isDefault) ?? audio[0] ?? null;
}

function isDefaultChoice(streams: DecisionStream[], chosen: DecisionStream): boolean {
  return pickAudio(streams, undefined)?.index === chosen.index;
}
