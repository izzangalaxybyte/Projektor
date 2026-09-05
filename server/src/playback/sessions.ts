// Registry of HLS playback sessions. 1.13 attaches ffmpeg processes and segment serving.
import { randomUUID } from 'node:crypto';
import type { DeviceProfile } from '../schemas/index.js';
import type { Decision } from './decision.js';

export interface PlaybackSession {
  id: string;
  fileId: string;
  filePath: string;
  durationMs: number;
  profile: DeviceProfile;
  decision: Decision;
  startPositionMs: number;
  createdAt: number;
  lastAccessAt: number;
}

export class SessionRegistry {
  private readonly sessions = new Map<string, PlaybackSession>();

  create(input: Omit<PlaybackSession, 'id' | 'createdAt' | 'lastAccessAt'>): PlaybackSession {
    const now = Date.now();
    const session: PlaybackSession = {
      ...input,
      id: randomUUID(),
      createdAt: now,
      lastAccessAt: now,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  get(id: string): PlaybackSession | undefined {
    const s = this.sessions.get(id);
    if (s) s.lastAccessAt = Date.now();
    return s;
  }

  remove(id: string): void {
    this.sessions.delete(id);
  }

  list(): PlaybackSession[] {
    return [...this.sessions.values()];
  }
}
