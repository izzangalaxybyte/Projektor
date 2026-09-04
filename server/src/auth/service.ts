import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { now, schema, type Db } from '../db/index.js';
import { hashPin, verifyPin } from './pin.js';
import { generateToken, hashToken } from './tokens.js';

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_MS = 15 * 60 * 1000;
const LAST_SEEN_REFRESH_MS = 60 * 1000;

const AVATAR_COLORS = [
  '#e57373',
  '#64b5f6',
  '#81c784',
  '#ffb74d',
  '#ba68c8',
  '#4db6ac',
  '#f06292',
  '#a1887f',
];

export interface AuthUser {
  id: string;
  name: string;
  isAdmin: boolean;
  avatarColor: string;
}

export interface AuthSession {
  id: string;
  userId: string;
  deviceName: string;
  createdAt: string;
  lastSeenAt: string;
}

export class AuthError extends Error {
  constructor(
    public readonly statusCode: 401 | 409 | 423,
    message: string,
  ) {
    super(message);
  }
}

const toUser = (row: typeof schema.users.$inferSelect): AuthUser => ({
  id: row.id,
  name: row.name,
  isAdmin: row.isAdmin,
  avatarColor: row.avatarColor,
});

export class AuthService {
  constructor(private readonly db: Db) {}

  needsSetup(): boolean {
    return this.db.select({ id: schema.users.id }).from(schema.users).limit(1).all().length === 0;
  }

  /** Creates the first admin profile. Refuses once any user exists. */
  async setup(name: string, pin: string): Promise<AuthUser> {
    if (!this.needsSetup()) throw new AuthError(409, 'Setup has already been completed');
    return this.createUser(name, pin, true);
  }

  async createUser(name: string, pin: string, isAdmin: boolean): Promise<AuthUser> {
    const ts = now();
    const row: typeof schema.users.$inferInsert = {
      id: randomUUID(),
      name,
      pinHash: await hashPin(pin),
      isAdmin,
      avatarColor: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)]!,
      createdAt: ts,
      updatedAt: ts,
    };
    this.db.insert(schema.users).values(row).run();
    return toUser({ ...row, isAdmin, failedAttempts: 0, lockedUntil: null });
  }

  listProfiles(): AuthUser[] {
    return this.db.select().from(schema.users).orderBy(schema.users.createdAt).all().map(toUser);
  }

  /**
   * Verifies a PIN and issues a session token. Wrong PINs increment a per-user counter; after
   * MAX_FAILED_ATTEMPTS the profile is locked for LOCKOUT_MS regardless of the PIN supplied.
   */
  async login(
    profileId: string,
    pin: string,
    deviceName: string,
  ): Promise<{ token: string; user: AuthUser }> {
    const user = this.db.select().from(schema.users).where(eq(schema.users.id, profileId)).get();
    if (!user) {
      // Burn comparable time so a missing profile is not distinguishable by latency.
      await verifyPin(
        '$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        pin,
      );
      throw new AuthError(401, 'Invalid profile or PIN');
    }
    if (user.lockedUntil && Date.parse(user.lockedUntil) > Date.now()) {
      throw new AuthError(
        423,
        'Profile is locked after too many failed attempts. Try again later.',
      );
    }
    const ok = await verifyPin(user.pinHash, pin);
    if (!ok) {
      const failed = user.failedAttempts + 1;
      const lock = failed >= MAX_FAILED_ATTEMPTS;
      this.db
        .update(schema.users)
        .set({
          failedAttempts: lock ? 0 : failed,
          lockedUntil: lock ? new Date(Date.now() + LOCKOUT_MS).toISOString() : null,
          updatedAt: now(),
        })
        .where(eq(schema.users.id, user.id))
        .run();
      throw new AuthError(
        lock ? 423 : 401,
        lock
          ? 'Profile is locked after too many failed attempts. Try again later.'
          : 'Invalid profile or PIN',
      );
    }
    if (user.failedAttempts !== 0 || user.lockedUntil) {
      this.db
        .update(schema.users)
        .set({ failedAttempts: 0, lockedUntil: null, updatedAt: now() })
        .where(eq(schema.users.id, user.id))
        .run();
    }
    const token = generateToken();
    const ts = now();
    this.db
      .insert(schema.sessions)
      .values({
        id: randomUUID(),
        userId: user.id,
        tokenHash: hashToken(token),
        deviceName,
        createdAt: ts,
        lastSeenAt: ts,
      })
      .run();
    return { token, user: toUser(user) };
  }

  /** Resolves a bearer token to its user and session, refreshing lastSeenAt at most once a minute. */
  authenticate(token: string): { user: AuthUser; session: AuthSession } | null {
    const row = this.db
      .select({ session: schema.sessions, user: schema.users })
      .from(schema.sessions)
      .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
      .where(eq(schema.sessions.tokenHash, hashToken(token)))
      .get();
    if (!row) return null;
    if (Date.now() - Date.parse(row.session.lastSeenAt) > LAST_SEEN_REFRESH_MS) {
      this.db
        .update(schema.sessions)
        .set({ lastSeenAt: now() })
        .where(eq(schema.sessions.id, row.session.id))
        .run();
    }
    const { tokenHash: _omit, ...session } = row.session;
    return { user: toUser(row.user), session };
  }

  listSessions(userId: string): AuthSession[] {
    return this.db
      .select({
        id: schema.sessions.id,
        userId: schema.sessions.userId,
        deviceName: schema.sessions.deviceName,
        createdAt: schema.sessions.createdAt,
        lastSeenAt: schema.sessions.lastSeenAt,
      })
      .from(schema.sessions)
      .where(eq(schema.sessions.userId, userId))
      .orderBy(schema.sessions.lastSeenAt)
      .all();
  }

  /** Deletes one of the user's sessions. Returns false if it did not exist or belongs to someone else. */
  revokeSession(userId: string, sessionId: string): boolean {
    const result = this.db
      .delete(schema.sessions)
      .where(and(eq(schema.sessions.id, sessionId), eq(schema.sessions.userId, userId)))
      .run();
    return result.changes > 0;
  }
}
