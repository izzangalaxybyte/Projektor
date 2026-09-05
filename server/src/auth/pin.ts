import argon2, { type HashOptions } from 'argon2';

// Argon2id with modest cost: PINs are short and we rate limit and lock out, so the hash
// mainly protects against offline attack on a leaked database.
const OPTIONS: HashOptions & { raw?: false } = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

export const hashPin = (pin: string): Promise<string> => argon2.hash(pin, OPTIONS);

export const verifyPin = (hash: string, pin: string): Promise<boolean> =>
  argon2.verify(hash, pin).catch(() => false);
