// One-off: set every demo user's ACCOUNT password and MASTER password to a known
// value, with full client-compatible crypto (PBKDF2 master key + RSA keypair +
// wrapped private key) so they can actually log in AND unlock their vault.
//
//   npx tsx server/scripts/reset-demo-passwords.ts
//
// Demo users own no vault items and are not share recipients, so re-keying their
// RSA keypair is safe (nothing to orphan).
import { randomBytes, webcrypto } from 'node:crypto';
import { hashPassword } from '../crypto.js';
import { pool, query } from '../db.js';

const { subtle } = webcrypto;
const NEW_PASSWORD = 'emiac1617';
const PBKDF2_ITERATIONS = 310_000;
const demoEmails = [
  'neha@emiactech.com',
  'kabir@emiactech.com',
  'meera@emiactech.com',
  'rohan@emiactech.com',
];

const encoder = new TextEncoder();
const b64url = (buf: ArrayBuffer | Uint8Array | Buffer) => Buffer.from(buf as Uint8Array).toString('base64url');

// Length-based allocation guarantees an ArrayBuffer (not ArrayBufferLike) backing,
// which webcrypto's BufferSource types require.
function randomU8(length: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(length));
  out.set(randomBytes(length));
  return out;
}

function toBytes(source: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(source.byteLength));
  out.set(source);
  return out;
}

async function deriveMasterKey(password: string, saltBytes: Uint8Array<ArrayBuffer>) {
  const baseKey = await subtle.importKey('raw', toBytes(encoder.encode(password)), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'PBKDF2', salt: saltBytes, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function buildMasterCrypto(password: string) {
  const saltBytes = randomU8(16);
  const masterKey = await deriveMasterKey(password, saltBytes);
  const pair = await subtle.generateKey(
    { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['encrypt', 'decrypt'],
  );
  const spki = new Uint8Array(await subtle.exportKey('spki', pair.publicKey));
  const pkcs8 = new Uint8Array(await subtle.exportKey('pkcs8', pair.privateKey));
  const iv = randomU8(12);
  const wrapped = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, masterKey, pkcs8));
  return {
    masterKeySalt: b64url(saltBytes),
    publicKey: b64url(spki),
    encryptedPrivateKey: b64url(wrapped),
    privateKeyIv: b64url(iv),
  };
}

async function main() {
  for (const email of demoEmails) {
    const account = await hashPassword(NEW_PASSWORD);
    const mc = await buildMasterCrypto(NEW_PASSWORD);
    const res = await query<{ email: string }>(
      `UPDATE users
         SET password_hash = $2, password_salt = $3,
             master_key_salt = $4, public_key = $5,
             encrypted_private_key = $6, private_key_iv = $7,
             updated_at = now()
       WHERE email = $1
       RETURNING email`,
      [email, account.hash, account.salt, mc.masterKeySalt, mc.publicKey, mc.encryptedPrivateKey, mc.privateKeyIv],
    );
    console.log(res.rows[0] ? `✓ ${email} → account + master password = ${NEW_PASSWORD}` : `(skip) ${email} not found`);
  }
  await pool.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
