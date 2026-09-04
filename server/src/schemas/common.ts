import { z } from 'zod';

export const Id = z.string().min(1).meta({ description: 'Opaque identifier' });

export const LibraryKind = z.enum(['movie', 'tv', 'anime']).meta({ id: 'LibraryKind' });
export type LibraryKind = z.infer<typeof LibraryKind>;

export const ItemKind = z.enum(['movie', 'show', 'season', 'episode']).meta({ id: 'ItemKind' });
export type ItemKind = z.infer<typeof ItemKind>;

export const Timestamp = z.string().datetime().meta({ description: 'ISO 8601 UTC timestamp' });

export const ErrorResponse = z
  .object({
    statusCode: z.number().int(),
    error: z.string(),
    message: z.string(),
  })
  .meta({ id: 'ErrorResponse' });

export const Page = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    items: item.array(),
    total: z.number().int().nonnegative(),
    offset: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
  });

export const PageQuery = z.object({
  offset: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().positive().max(200).default(50),
});
