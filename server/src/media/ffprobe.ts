import path from 'node:path';
import { execa } from 'execa';
import { z } from 'zod';

const RawStream = z.object({
  index: z.number().int(),
  codec_type: z.string(),
  codec_name: z.string().optional(),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
  channels: z.number().int().optional(),
  disposition: z.record(z.string(), z.number()).optional(),
  tags: z.record(z.string(), z.string()).optional(),
});

const RawProbe = z.object({
  format: z.object({
    format_name: z.string(),
    duration: z.string().optional(),
    bit_rate: z.string().optional(),
  }),
  streams: RawStream.array(),
});

export type StreamType = 'video' | 'audio' | 'subtitle';

export interface ProbedStream {
  index: number;
  type: StreamType;
  codec: string;
  language: string | null;
  title: string | null;
  isDefault: boolean;
  isForced: boolean;
  width: number | null;
  height: number | null;
  channels: number | null;
}

export interface ProbeResult {
  /** Canonical container: mkv, mp4, webm, avi, ts, wmv, flv, mpg, mov, or the raw format name. */
  container: string;
  durationMs: number;
  bitrate: number | null;
  streams: ProbedStream[];
  raw: unknown;
}

export class ProbeError extends Error {
  constructor(
    message: string,
    public readonly filePath: string,
  ) {
    super(message);
  }
}

// ffprobe reports demuxer names, several per file. Pick the canonical container the
// clients understand, using the file extension to break ties like "matroska,webm".
const CONTAINERS: Array<[string, string]> = [
  ['matroska', 'mkv'],
  ['webm', 'webm'],
  ['mp4', 'mp4'],
  ['mov', 'mov'],
  ['avi', 'avi'],
  ['mpegts', 'ts'],
  ['asf', 'wmv'],
  ['flv', 'flv'],
  ['mpeg', 'mpg'],
];

export function canonicalContainer(formatName: string, filePath: string): string {
  const names = formatName.split(',');
  const ext = path.extname(filePath).slice(1).toLowerCase();
  if (ext === 'webm' && names.includes('webm')) return 'webm';
  if ((ext === 'mov' || ext === 'm4v') && names.includes('mov'))
    return ext === 'mov' ? 'mov' : 'mp4';
  for (const [needle, canonical] of CONTAINERS) {
    if (names.includes(needle)) return canonical;
  }
  return names[0] ?? formatName;
}

/** Runs ffprobe on one file and returns a normalised description of its container and streams. */
export async function probeFile(ffprobePath: string, filePath: string): Promise<ProbeResult> {
  let stdout: string;
  try {
    ({ stdout } = await execa(
      ffprobePath,
      ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath],
      { timeout: 60_000 },
    ));
  } catch (error) {
    const message = error instanceof Error ? error.message.split('\n')[0] : String(error);
    throw new ProbeError(`ffprobe failed: ${message}`, filePath);
  }
  const parsed = RawProbe.safeParse(JSON.parse(stdout));
  if (!parsed.success)
    throw new ProbeError('ffprobe output was not in the expected shape', filePath);
  const { format, streams } = parsed.data;

  const mapped: ProbedStream[] = [];
  for (const s of streams) {
    if (s.codec_type !== 'video' && s.codec_type !== 'audio' && s.codec_type !== 'subtitle')
      continue;
    // Cover art is stored as an "attached picture" video stream; it is not playable video.
    if (s.codec_type === 'video' && s.disposition?.['attached_pic'] === 1) continue;
    mapped.push({
      index: s.index,
      type: s.codec_type,
      codec: s.codec_name ?? 'unknown',
      language: normaliseLanguage(s.tags?.['language']),
      title: s.tags?.['title'] ?? null,
      isDefault: s.disposition?.['default'] === 1,
      isForced: s.disposition?.['forced'] === 1,
      width: s.width ?? null,
      height: s.height ?? null,
      channels: s.channels ?? null,
    });
  }

  const durationSeconds = Number(format.duration ?? 0);
  const bitrate = format.bit_rate ? Number(format.bit_rate) : null;
  return {
    container: canonicalContainer(format.format_name, filePath),
    durationMs: Number.isFinite(durationSeconds) ? Math.round(durationSeconds * 1000) : 0,
    bitrate: bitrate && Number.isFinite(bitrate) ? bitrate : null,
    streams: mapped,
    raw: parsed.data,
  };
}

function normaliseLanguage(tag: string | undefined): string | null {
  if (!tag) return null;
  const lower = tag.toLowerCase();
  return lower === 'und' ? null : lower;
}
