import { z } from 'zod';
import { Id, Timestamp } from './common.js';

export const RecordingState = z
  .enum(['scheduled', 'recording', 'done', 'failed'])
  .meta({ id: 'RecordingState' });
export type RecordingState = z.infer<typeof RecordingState>;

export const Recording = z
  .object({
    id: Id,
    channelId: z.string(),
    channelName: z.string(),
    channelLogoUrl: z.string().nullable(),
    title: z.string(),
    description: z.string().nullable(),
    programmeId: z.string().nullable(),
    startAt: Timestamp.meta({ description: 'Planned start' }),
    endAt: Timestamp.nullable().meta({
      description: 'Planned end including padding; null until stopped by hand',
    }),
    actualStartAt: Timestamp.nullable(),
    actualEndAt: Timestamp.nullable(),
    state: RecordingState,
    sizeBytes: z.number().int(),
    durationMs: z
      .number()
      .int()
      .nullable()
      .meta({ description: 'Measured once the recording is done' }),
    error: z.string().nullable(),
    createdAt: Timestamp,
  })
  .meta({ id: 'Recording' });
export type Recording = z.infer<typeof Recording>;

export const CreateRecordingRequest = z
  .object({
    channelId: z.string(),
    programmeId: z
      .string()
      .optional()
      .meta({
        description:
          'Record this guide programme: starts at its start (or now) and ends at its end plus padding',
      }),
    startAt: Timestamp.optional().meta({
      description: 'When to start; defaults to now (ignored with programmeId)',
    }),
    durationMinutes: z
      .number()
      .int()
      .positive()
      .max(24 * 60)
      .optional()
      .meta({ description: 'How long to record; omit for manual stop (ignored with programmeId)' }),
    title: z.string().min(1).max(200).optional(),
    paddingMs: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .meta({ description: 'Overrides RECORDING_PADDING_MS for a programme recording' }),
  })
  .meta({ id: 'CreateRecordingRequest' });
export type CreateRecordingRequest = z.infer<typeof CreateRecordingRequest>;

export const RecordingsQuery = z.object({
  state: RecordingState.optional(),
});
