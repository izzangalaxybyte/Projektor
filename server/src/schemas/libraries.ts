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
    startedAt: Timestamp.nullable(),
  })
  .meta({ id: 'ScanStatus' });
