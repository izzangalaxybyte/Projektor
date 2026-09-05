// Startup self-test for hardware encoding. VAAPI on Intel is the target; anything else falls
// back to libx264 with a clear log line so nobody wonders why the CPU is busy.
import { existsSync } from 'node:fs';
import { execa } from 'execa';
import type { FastifyBaseLogger } from 'fastify';
import type { Config } from '../config.js';
import type { HardwareEncoder } from './ffmpeg-args.js';

export interface HardwareReport {
  encoder: HardwareEncoder;
  /** Human-readable reason for the choice, logged at startup and exposed on /api/health. */
  reason: string;
}

/** Encodes one synthetic frame with h264_vaapi; success means decode/scale/encode will work. */
export async function detectHardware(
  config: Pick<Config, 'ffmpegPath' | 'vaapiDevice' | 'hardwareAccel'>,
  log?: FastifyBaseLogger,
): Promise<HardwareReport> {
  if (config.hardwareAccel === 'none') return report(null, 'HARDWARE_ACCEL=none', log);
  if (config.hardwareAccel === 'vaapi')
    return report('vaapi', 'HARDWARE_ACCEL=vaapi (forced, not tested)', log);
  if (!existsSync(config.vaapiDevice))
    return report(null, `${config.vaapiDevice} does not exist`, log);

  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-nostdin',
    '-init_hw_device',
    `vaapi=va:${config.vaapiDevice}`,
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=64x64:rate=1:duration=1',
    '-vf',
    'format=nv12,hwupload',
    '-c:v',
    'h264_vaapi',
    '-frames:v',
    '1',
    '-f',
    'null',
    '-',
  ];
  const result = await execa(config.ffmpegPath, args, {
    reject: false,
    timeout: 15_000,
    stdin: 'ignore',
  });
  if (result.exitCode === 0)
    return report('vaapi', `h264_vaapi self-test passed on ${config.vaapiDevice}`, log);
  const detail =
    (result.stderr || result.shortMessage || 'unknown error').trim().split('\n').pop() ??
    'unknown error';
  return report(null, `h264_vaapi self-test failed: ${detail}`, log);
}

function report(encoder: HardwareEncoder, reason: string, log?: FastifyBaseLogger): HardwareReport {
  const message = encoder ? 'hardware transcoding enabled' : 'software transcoding (libx264)';
  log?.[encoder ? 'info' : 'warn']({ encoder: encoder ?? 'libx264', reason }, message);
  return { encoder, reason };
}
