import { z } from 'zod';

export const SecretStatus = z
  .object({
    set: z.boolean(),
    hint: z
      .string()
      .nullable()
      .meta({ description: 'Last characters of the stored value, for recognition' }),
  })
  .meta({ id: 'SecretStatus' });

export const SettingsView = z
  .object({
    tmdbApiKey: SecretStatus,
    openSubtitlesApiKey: SecretStatus,
    openSubtitlesUsername: z.string().nullable(),
    openSubtitlesPassword: SecretStatus,
    iptvUrl: z
      .string()
      .meta({ description: "Xtream Codes server URL; defaults to the owner's provider" }),
    iptvUsername: z.string().nullable(),
    iptvPassword: SecretStatus,
  })
  .meta({ id: 'SettingsView' });

export const SettingsUpdate = z
  .object({
    tmdbApiKey: z
      .string()
      .nullable()
      .optional()
      .meta({ description: 'TMDB v3 API key or v4 read access token. Null clears it.' }),
    openSubtitlesApiKey: z.string().nullable().optional(),
    openSubtitlesUsername: z.string().nullable().optional(),
    openSubtitlesPassword: z.string().nullable().optional(),
    iptvUrl: z.string().nullable().optional(),
    iptvUsername: z.string().nullable().optional(),
    iptvPassword: z.string().nullable().optional(),
  })
  .meta({ id: 'SettingsUpdate', description: 'Only fields present are changed' });
