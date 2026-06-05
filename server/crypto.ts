import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('base64url');
  const derivedKey = (await scrypt(password, salt, 64)) as Buffer;
  return {
    salt,
    hash: derivedKey.toString('base64url'),
  };
}

export async function verifyPassword(password: string, salt: string, expectedHash: string) {
  const derivedKey = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(expectedHash, 'base64url');
  if (derivedKey.length !== expected.length) return false;
  return timingSafeEqual(derivedKey, expected);
}

export function createOpaqueToken() {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string) {
  return createHash('sha256').update(token).digest('base64url');
}
