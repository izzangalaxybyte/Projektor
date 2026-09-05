import type { Profile } from '../api/client.js';

const KEY = 'projektor.auth';

interface Stored {
  token: string;
  profile: Profile;
}

type Listener = () => void;

/** Token and profile in localStorage, with change notifications for React. */
class AuthStore {
  private state: Stored | null = null;
  private readonly listeners = new Set<Listener>();

  constructor() {
    try {
      const raw = localStorage.getItem(KEY);
      this.state = raw ? (JSON.parse(raw) as Stored) : null;
    } catch {
      this.state = null;
    }
  }

  get token(): string | null {
    return this.state?.token ?? null;
  }
  get profile(): Profile | null {
    return this.state?.profile ?? null;
  }

  signIn(token: string, profile: Profile): void {
    this.state = { token, profile };
    try {
      localStorage.setItem(KEY, JSON.stringify(this.state));
    } catch {
      /* private mode */
    }
    this.emit();
  }

  signOut(): void {
    this.state = null;
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
    this.emit();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private emit(): void {
    for (const l of this.listeners) l();
  }
}

export const authStore = new AuthStore();
