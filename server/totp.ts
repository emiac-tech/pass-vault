// Self-contained TOTP (RFC 6238) helper — no external dependencies.
// 30-second window, SHA-1, 6 digits, base32 secrets — matches Google Authenticator / Authy.

import { createHmac, randomBytes } from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateBase32Secret(byteLength = 20) {
  const bytes = randomBytes(byteLength);
  let bits = '';
  for (const byte of bytes) bits += byte.toString(2).padStart(8, '0');
  let output = '';
  for (let index = 0; index < bits.length; index += 5) {
    const chunk = bits.slice(index, index + 5);
    if (chunk.length < 5) break;
    output += BASE32_ALPHABET[parseInt(chunk, 2)];
  }
  return output;
}

function base32ToBuffer(secret: string) {
  const cleaned = secret.replace(/=+$/g, '').toUpperCase();
  let bits = '';
  for (const char of cleaned) {
    const value = BASE32_ALPHABET.indexOf(char);
    if (value < 0) continue;
    bits += value.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(parseInt(bits.slice(index, index + 8), 2));
  }
  return Buffer.from(bytes);
}

function hotp(secret: string, counter: number) {
  const key = base32ToBuffer(secret);
  const counterBuffer = Buffer.alloc(8);
  // Write counter as 64-bit big-endian.
  for (let index = 7; index >= 0; index -= 1) {
    counterBuffer[index] = counter & 0xff;
    counter = Math.floor(counter / 256);
  }
  const hmac = createHmac('sha1', key).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (code % 1_000_000).toString().padStart(6, '0');
}

export function verifyTotp(secret: string, token: string, drift = 1) {
  if (!/^\d{6}$/.test(token)) return false;
  const currentStep = Math.floor(Date.now() / 1000 / 30);
  for (let offset = -drift; offset <= drift; offset += 1) {
    if (hotp(secret, currentStep + offset) === token) return true;
  }
  return false;
}

export function otpAuthUrl(label: string, secret: string, issuer = 'E-Vault Password Manager') {
  const encodedLabel = encodeURIComponent(`${issuer}:${label}`);
  const params = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: '6', period: '30' });
  return `otpauth://totp/${encodedLabel}?${params.toString()}`;
}

export function generateBackupCodes(count = 8) {
  const codes: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const bytes = randomBytes(4).toString('hex').toUpperCase();
    codes.push(`${bytes.slice(0, 4)}-${bytes.slice(4)}`);
  }
  return codes;
}
