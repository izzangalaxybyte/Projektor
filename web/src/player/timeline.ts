// Where a seek should go when the stream is a remux: an HLS EVENT playlist that ffmpeg is still
// writing and whose timeline starts at the position the session was opened at, not at zero.

export type SeekPlan = { kind: 'local'; ms: number } | { kind: 'restart'; ms: number };

export interface SeekInput {
  /** Absolute position in the file the viewer asked for. */
  targetMs: number;
  /** Absolute position the current session's timeline starts at (0 unless a remux was restarted). */
  offsetMs: number;
  /** How much of the session's timeline the player knows about so far (video.duration). */
  availableMs: number;
  method: 'direct' | 'remux' | 'transcode';
  /** The file's real length from ffprobe; 0 when unknown. */
  knownDurationMs: number;
}

/** A remux is complete once what it has written reaches the end of the file. */
const END_SLACK_MS = 2_000;
/** Seeking into the last moments of what has been written stalls; restart instead. */
const EDGE_SLACK_MS = 1_500;

export function planSeek(input: SeekInput): SeekPlan {
  const { offsetMs, availableMs, method, knownDurationMs } = input;
  const maxMs = knownDurationMs > 0 ? knownDurationMs - 500 : Number.POSITIVE_INFINITY;
  const target = Math.max(0, Math.min(input.targetMs, maxMs));
  if (method !== 'remux') return { kind: 'local', ms: target };
  const local = target - offsetMs;
  if (local < 0) return { kind: 'restart', ms: target };
  const complete = knownDurationMs > 0 && offsetMs + availableMs >= knownDurationMs - END_SLACK_MS;
  if (!complete && availableMs > 0 && local > availableMs - EDGE_SLACK_MS)
    return { kind: 'restart', ms: target };
  if (complete && local > availableMs - 500)
    return { kind: 'local', ms: Math.max(0, availableMs - 500) };
  return { kind: 'local', ms: local };
}
