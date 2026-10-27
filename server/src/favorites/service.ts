// Per-user favorite movies and shows.
import { and, desc, eq, inArray } from 'drizzle-orm';
import { now, schema, type Db } from '../db/index.js';

export class FavoriteError extends Error {
  constructor(
    public readonly statusCode: 404,
    message: string,
  ) {
    super(message);
  }
}

export class FavoritesService {
  constructor(private readonly db: Db) {}

  /** Adds or removes a favorite. Only movies and shows can be favorited. */
  set(userId: string, itemId: string, favorite: boolean): boolean {
    const kind = this.kindOf(itemId);
    const where = and(eq(schema.favorites.userId, userId), eq(schema.favorites.itemId, itemId));
    if (!favorite) {
      this.db.delete(schema.favorites).where(where).run();
      return false;
    }
    this.db
      .insert(schema.favorites)
      .values({ userId, itemId, itemKind: kind, createdAt: now() })
      .onConflictDoNothing()
      .run();
    return true;
  }

  /** Which of these ids the user has favorited, for list endpoints. */
  getMany(userId: string, itemIds: string[]): Set<string> {
    if (itemIds.length === 0) return new Set();
    return new Set(
      this.db
        .select({ itemId: schema.favorites.itemId })
        .from(schema.favorites)
        .where(and(eq(schema.favorites.userId, userId), inArray(schema.favorites.itemId, itemIds)))
        .all()
        .map((r) => r.itemId),
    );
  }

  /** Favorite ids, most recently added first. */
  list(userId: string): string[] {
    return this.db
      .select({ itemId: schema.favorites.itemId })
      .from(schema.favorites)
      .where(eq(schema.favorites.userId, userId))
      .orderBy(desc(schema.favorites.createdAt))
      .all()
      .map((r) => r.itemId);
  }

  private kindOf(itemId: string): 'movie' | 'show' {
    if (
      this.db
        .select({ id: schema.movies.id })
        .from(schema.movies)
        .where(eq(schema.movies.id, itemId))
        .get()
    )
      return 'movie';
    if (
      this.db
        .select({ id: schema.shows.id })
        .from(schema.shows)
        .where(eq(schema.shows.id, itemId))
        .get()
    )
      return 'show';
    throw new FavoriteError(404, 'Only movies and shows can be favorited');
  }
}
