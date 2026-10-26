import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { now, schema, type Db } from '../db/index.js';
import { generateToken, hashToken } from './tokens.js';

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
  async setup(name: string): Promise<AuthUser> {
    if (!this.needsSetup()) throw new AuthError(409, 'Setup has already been completed');
    return this.createUser(name, true);
  }

  async createUser(name: string, isAdmin: boolean): Promise<AuthUser> {
    const ts = now();
    const row: typeof schema.users.$inferInsert = {
      id: randomUUID(),
      name,
      // Profiles have no PIN; picking one signs in. The column stays for existing databases.
      pinHash: '',
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

  /** Issues a session token for a profile; there is no PIN, picking the profile is enough. */
  async login(profileId: string, deviceName: string): Promise<{ token: string; user: AuthUser }> {
    const user = this.db.select().from(schema.users).where(eq(schema.users.id, profileId)).get();
    if (!user) throw new AuthError(401, 'Unknown profile');
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
