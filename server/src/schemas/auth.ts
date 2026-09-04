import { z } from 'zod';
import { Id, Timestamp } from './common.js';

export const Pin = z
  .string()
  .regex(/^\d{4,6}$/, 'PIN must be 4 to 6 digits')
  .meta({ description: 'Numeric PIN, 4 to 6 digits' });

export const Profile = z
  .object({
    id: Id,
    name: z.string().min(1).max(40),
    isAdmin: z.boolean(),
    avatarColor: z.string().regex(/^#[0-9a-f]{6}$/i),
  })
  .meta({ id: 'Profile' });
export type Profile = z.infer<typeof Profile>;

export const SetupStatus = z
  .object({ needsSetup: z.boolean() })
  .meta({ id: 'SetupStatus', description: 'True until the first admin profile exists' });

export const SetupRequest = z
  .object({ name: z.string().min(1).max(40), pin: Pin })
  .meta({ id: 'SetupRequest' });

export const LoginRequest = z
  .object({
    profileId: Id,
    pin: Pin,
    deviceName: z.string().min(1).max(80),
  })
  .meta({ id: 'LoginRequest' });

export const LoginResponse = z
  .object({ token: z.string(), profile: Profile })
  .meta({ id: 'LoginResponse' });

export const Session = z
  .object({
    id: Id,
    deviceName: z.string(),
    createdAt: Timestamp,
    lastSeenAt: Timestamp,
    current: z.boolean(),
  })
  .meta({ id: 'Session' });
