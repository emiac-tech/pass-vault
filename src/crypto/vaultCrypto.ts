// E-Vault Password Manager — client-side crypto module.
//
// Architecture:
//   - Master password -> PBKDF2 -> master key (AES-GCM, 256 bit).
//   - Each user has an RSA-OAEP-2048 keypair. Private key is wrapped with the master key.
//   - Each vault item has its own AES-GCM 256-bit item key.
//   - Owner's copy of the item key is wrapped with the master key (symmetric).
//   - Recipient's copy of the item key is wrapped with the recipient's RSA public key.
//
// Everything sensitive stays in the browser. The server only sees ciphertext blobs and wrapped keys.

export interface VaultSecretPayload {
  username?: string;
  password?: string;
  url?: string;
  notes?: string;
  totpSecret?: string;
  // SSH
  sshPrivateKey?: string;
  sshPassphrase?: string;
  // Database
  dbHost?: string;
  dbPort?: string;
  dbName?: string;
  // API key
  apiKey?: string;
  apiSecret?: string;
  // Generic
  customFields?: Record<string, string>;
  tags?: string[];
}

export interface EncryptedPayload {
  encryptedPayload: Record<string, string>;
  payloadIv: string;
  payloadTag: string;
}

export interface WrappedItemKey {
  encryptedItemKey: string;
  itemKeyIv: string;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const PBKDF2_ITERATIONS = 310_000;

// ---- helpers ----

export function randomSalt(byteLength = 16) {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

export function toBase64Url(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return window.btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

export function fromBase64Url(value: string) {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = window.atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function splitAesGcmResult(bytes: Uint8Array) {
  return { ciphertext: bytes.slice(0, -16), tag: bytes.slice(-16) };
}

function concatBytes(first: Uint8Array, second: Uint8Array) {
  const output = new Uint8Array(first.length + second.length);
  output.set(first);
  output.set(second, first.length);
  return output;
}

// ---- master key derivation ----

export async function deriveMasterKey(masterPassword: string, salt: string) {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(masterPassword),
    'PBKDF2',
    false,
    ['deriveKey'],
  );

  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: fromBase64Url(salt), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt', 'wrapKey', 'unwrapKey'],
  );
}

// ---- RSA keypair ----

export interface SerializedKeypair {
  publicKey: string;            // base64url SPKI
  encryptedPrivateKey: string;  // base64url ciphertext of PKCS8
  privateKeyIv: string;         // base64url IV used to wrap the private key
}

export async function generateUserKeypair(masterKey: CryptoKey): Promise<SerializedKeypair> {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['encrypt', 'decrypt'],
  );

  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey));
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const wrapped = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, masterKey, pkcs8),
  );

  return {
    publicKey: toBase64Url(spki),
    encryptedPrivateKey: toBase64Url(wrapped),
    privateKeyIv: toBase64Url(iv),
  };
}

export async function importPublicKey(publicKey: string) {
  return crypto.subtle.importKey(
    'spki',
    fromBase64Url(publicKey),
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    true,
    ['encrypt'],
  );
}

export async function unwrapPrivateKey(
  encryptedPrivateKey: string,
  privateKeyIv: string,
  masterKey: CryptoKey,
) {
  const pkcs8 = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64Url(privateKeyIv) },
    masterKey,
    fromBase64Url(encryptedPrivateKey),
  );

  return crypto.subtle.importKey(
    'pkcs8',
    pkcs8,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['decrypt'],
  );
}

// ---- organization recovery key (ORK) ----
//
// One org RSA keypair recovers any user's items. The public key makes a recovery
// copy of every item key; the private key is hybrid-wrapped (AES-GCM + RSA) to
// each super-admin's user public key, so a super-admin can recover it after unlock.

export interface OrgRecoveryKeypair {
  publicKey: string;        // base64url SPKI
  privateKey: CryptoKey;    // RSA-OAEP private key (extractable, decrypt)
}

export interface WrappedOrgPrivateKey {
  encryptedPrivateKey: string;  // AES-GCM ciphertext of the org PKCS8 private key
  privateKeyIv: string;         // IV for the AES-GCM wrap
  wrappedDek: string;           // the AES DEK, RSA-wrapped to a super-admin's public key
}

export async function generateOrgRecoveryKeypair(): Promise<OrgRecoveryKeypair> {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['encrypt', 'decrypt'],
  );
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey));
  return { publicKey: toBase64Url(spki), privateKey: pair.privateKey };
}

// Hybrid-wrap the org private key for one super-admin: AES-GCM encrypt the PKCS8,
// then RSA-wrap the AES DEK to that admin's public key (PKCS8 is too big for raw RSA).
export async function wrapOrgPrivateKeyForAdmin(
  orgPrivateKey: CryptoKey,
  adminPublicKey: string,
): Promise<WrappedOrgPrivateKey> {
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', orgPrivateKey));
  const dek = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, dek, pkcs8));

  const rawDek = new Uint8Array(await crypto.subtle.exportKey('raw', dek));
  const recipient = await importPublicKey(adminPublicKey);
  const wrappedDek = new Uint8Array(await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, recipient, rawDek));

  return {
    encryptedPrivateKey: toBase64Url(encrypted),
    privateKeyIv: toBase64Url(iv),
    wrappedDek: toBase64Url(wrappedDek),
  };
}

export async function unwrapOrgPrivateKey(
  wrapped: WrappedOrgPrivateKey,
  adminRsaPrivateKey: CryptoKey,
): Promise<CryptoKey> {
  const rawDek = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, adminRsaPrivateKey, fromBase64Url(wrapped.wrappedDek));
  const dek = await crypto.subtle.importKey('raw', rawDek, { name: 'AES-GCM' }, false, ['decrypt']);
  const pkcs8 = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64Url(wrapped.privateKeyIv) },
    dek,
    fromBase64Url(wrapped.encryptedPrivateKey),
  );
  // Extractable so a super-admin can re-grant the org key to another super-admin.
  return crypto.subtle.importKey('pkcs8', pkcs8, { name: 'RSA-OAEP', hash: 'SHA-256' }, true, ['decrypt']);
}

// ---- item keys ----

export async function generateItemKey() {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

export async function encryptVaultPayload(
  payload: VaultSecretPayload,
  itemKey: CryptoKey,
): Promise<EncryptedPayload> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    itemKey,
    encoder.encode(JSON.stringify(payload)),
  );

  const { ciphertext, tag } = splitAesGcmResult(new Uint8Array(encrypted));
  return {
    encryptedPayload: { ciphertext: toBase64Url(ciphertext) },
    payloadIv: toBase64Url(iv),
    payloadTag: toBase64Url(tag),
  };
}

export async function decryptVaultPayload(
  encrypted: EncryptedPayload,
  itemKey: CryptoKey,
): Promise<VaultSecretPayload> {
  const ciphertext = fromBase64Url(encrypted.encryptedPayload.ciphertext);
  const tag = fromBase64Url(encrypted.payloadTag);
  const combined = concatBytes(ciphertext, tag);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64Url(encrypted.payloadIv) },
    itemKey,
    combined,
  );

  return JSON.parse(decoder.decode(decrypted)) as VaultSecretPayload;
}

// ---- key wrapping (symmetric, owner's copy) ----

export async function wrapItemKey(itemKey: CryptoKey, wrappingKey: CryptoKey): Promise<WrappedItemKey> {
  const exported = await crypto.subtle.exportKey('raw', itemKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrappingKey, exported);
  return {
    encryptedItemKey: toBase64Url(new Uint8Array(encrypted)),
    itemKeyIv: toBase64Url(iv),
  };
}

export async function unwrapItemKey(wrapped: WrappedItemKey, wrappingKey: CryptoKey) {
  const rawKey = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64Url(wrapped.itemKeyIv) },
    wrappingKey,
    fromBase64Url(wrapped.encryptedItemKey),
  );

  return crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
}

// ---- key wrapping (asymmetric, recipient's copy) ----

export async function wrapItemKeyForRecipient(
  itemKey: CryptoKey,
  recipientPublicKey: CryptoKey,
): Promise<WrappedItemKey> {
  const raw = await crypto.subtle.exportKey('raw', itemKey);
  const encrypted = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, recipientPublicKey, raw);
  return {
    encryptedItemKey: toBase64Url(new Uint8Array(encrypted)),
    itemKeyIv: '', // RSA-OAEP does not use an IV; kept for schema compatibility.
  };
}

export async function unwrapItemKeyWithPrivate(
  wrapped: WrappedItemKey,
  recipientPrivateKey: CryptoKey,
) {
  const raw = await crypto.subtle.decrypt(
    { name: 'RSA-OAEP' },
    recipientPrivateKey,
    fromBase64Url(wrapped.encryptedItemKey),
  );
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
}

// ---- password generator ----

export interface PasswordGenOptions {
  length: number;
  upper: boolean;
  lower: boolean;
  digits: boolean;
  symbols: boolean;
  excludeAmbiguous: boolean;
}

const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const UPPER_AMB = 'IO';
const LOWER = 'abcdefghijkmnpqrstuvwxyz';
const LOWER_AMB = 'lo';
const DIGITS = '23456789';
const DIGITS_AMB = '01';
const SYMBOLS = '!@#$%^&*()-_=+[]{};:,.<>?';

export function generatePassword(options: PasswordGenOptions) {
  let alphabet = '';
  if (options.upper) alphabet += UPPER + (options.excludeAmbiguous ? '' : UPPER_AMB);
  if (options.lower) alphabet += LOWER + (options.excludeAmbiguous ? '' : LOWER_AMB);
  if (options.digits) alphabet += DIGITS + (options.excludeAmbiguous ? '' : DIGITS_AMB);
  if (options.symbols) alphabet += SYMBOLS;
  if (!alphabet) alphabet = LOWER + DIGITS;

  const bytes = crypto.getRandomValues(new Uint32Array(options.length));
  let out = '';
  for (let index = 0; index < options.length; index += 1) {
    out += alphabet[bytes[index] % alphabet.length];
  }
  return out;
}

// ---- password strength (zxcvbn-lite scoring) ----

export interface StrengthResult {
  score: 0 | 1 | 2 | 3 | 4;
  label: 'Very Weak' | 'Weak' | 'Fair' | 'Good' | 'Strong';
  entropy: number;
  feedback: string[];
}

export function scorePassword(password: string): StrengthResult {
  if (!password) {
    return { score: 0, label: 'Very Weak', entropy: 0, feedback: ['Add a password.'] };
  }

  let pool = 0;
  if (/[a-z]/.test(password)) pool += 26;
  if (/[A-Z]/.test(password)) pool += 26;
  if (/[0-9]/.test(password)) pool += 10;
  if (/[^A-Za-z0-9]/.test(password)) pool += 33;
  if (pool === 0) pool = 26;

  const entropy = Math.log2(pool) * password.length;
  const feedback: string[] = [];
  if (password.length < 12) feedback.push('Use at least 12 characters.');
  if (!/[A-Z]/.test(password)) feedback.push('Add uppercase letters.');
  if (!/[0-9]/.test(password)) feedback.push('Add digits.');
  if (!/[^A-Za-z0-9]/.test(password)) feedback.push('Add symbols.');
  if (/(.)\1\1/.test(password)) feedback.push('Avoid repeating characters.');

  let score: StrengthResult['score'] = 0;
  if (entropy >= 28) score = 1;
  if (entropy >= 50) score = 2;
  if (entropy >= 70) score = 3;
  if (entropy >= 90) score = 4;
  const labels: Record<StrengthResult['score'], StrengthResult['label']> = {
    0: 'Very Weak',
    1: 'Weak',
    2: 'Fair',
    3: 'Good',
    4: 'Strong',
  };
  return { score, label: labels[score], entropy, feedback };
}

// ---- HIBP breach check (k-anonymity) ----

export async function isPasswordBreached(password: string): Promise<{ breached: boolean; count: number }> {
  const sha = await crypto.subtle.digest('SHA-1', encoder.encode(password));
  const hex = Array.from(new Uint8Array(sha))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
  const prefix = hex.slice(0, 5);
  const suffix = hex.slice(5);

  try {
    const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { 'Add-Padding': 'true' },
    });
    if (!response.ok) return { breached: false, count: 0 };
    const body = await response.text();
    for (const line of body.split('\n')) {
      const [hashSuffix, countStr] = line.split(':');
      if (hashSuffix?.trim() === suffix) {
        return { breached: true, count: Number(countStr) || 0 };
      }
    }
    return { breached: false, count: 0 };
  } catch {
    return { breached: false, count: 0 };
  }
}
