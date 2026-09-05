import { z } from 'zod';
import { Id, LibraryKind, Timestamp } from './common.js';

export const Library = z
  .object({
    id: Id,
    name: z.string().min(1).max(80),
    kind: LibraryKind,
    paths: z.string().min(1).array().min(1),
    createdAt: Timestamp,
    lastScannedAt: Timestamp.nullable(),
  })
  .meta({ id: 'Library' });
export type Library = z.infer<typeof Library>;

export const CreateLibraryRequest = Library.pick({ name: true, kind: true, paths: true }).meta({
  id: 'CreateLibraryRequest',
});

export const ScanStatus = z
  .object({
    libraryId: Id,
    state: z.enum(['idle', 'running']),
    filesSeen: z.number().int().nonnegative(),
    filesChanged: z.number().int().nonnegative(),
    filesMissing: z.number().int().nonnegative(),
    filesProbed: z.number().int().nonnegative(),
    filesFailed: z
      .number()
      .int()
      .nonnegative()
      .meta({ description: 'Files ffprobe could not read' }),
    itemsLinked: z
      .number()
      .int()
      .nonnegative()
      .meta({ description: 'Files linked to a movie or episode this scan' }),
    itemsMatched: z
      .number()
      .int()
      .nonnegative()
      .meta({ description: 'Items matched to TMDB this scan' }),
    itemsUnmatched: z
      .number()
      .int()
      .nonnegative()
      .meta({ description: 'Items TMDB search could not match confidently' }),
    startedAt: Timestamp.nullable(),
  })
  .meta({ id: 'ScanStatus' });
