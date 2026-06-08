// Pass Vault extension — client-side crypto. Mirrors src/crypto/vaultCrypto.ts.
// No bundler — pure JS for service worker + popup.

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const PBKDF2_ITERATIONS = 310_000;

export function toBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

export function fromBase64Url(value) {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function concatBytes(first, second) {
  const out = new Uint8Array(first.length + second.length);
  out.set(first);
  out.set(second, first.length);
  return out;
}

function splitAesGcm(bytes) {
  return { ciphertext: bytes.slice(0, -16), tag: bytes.slice(-16) };
}

export async function deriveMasterKey(masterPassword, salt) {
  const baseKey = await crypto.subtle.importKey('raw', encoder.encode(masterPassword), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: fromBase64Url(salt), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt', 'wrapKey', 'unwrapKey'],
  );
}

export async function unwrapPrivateKey(encryptedPrivateKey, privateKeyIv, masterKey) {
  const pkcs8 = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64Url(privateKeyIv) },
    masterKey,
    fromBase64Url(encryptedPrivateKey),
  );
  return crypto.subtle.importKey('pkcs8', pkcs8, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['decrypt']);
}

export async function unwrapItemKey(encryptedItemKey, itemKeyIv, masterKey) {
  const raw = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64Url(itemKeyIv) },
    masterKey,
    fromBase64Url(encryptedItemKey),
  );
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
}

export async function unwrapItemKeyWithPrivate(encryptedItemKey, privateKey) {
  const raw = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, privateKey, fromBase64Url(encryptedItemKey));
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
}

export async function decryptVaultPayload(item, itemKey) {
  const ciphertext = fromBase64Url(item.encrypted_payload.ciphertext);
  const tag = fromBase64Url(item.payload_tag);
  const combined = concatBytes(ciphertext, tag);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64Url(item.payload_iv) },
    itemKey,
    combined,
  );
  return JSON.parse(decoder.decode(decrypted));
}

export async function generateItemKey() {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

export async function encryptVaultPayload(payload, itemKey) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    itemKey,
    encoder.encode(JSON.stringify(payload)),
  ));
  const { ciphertext, tag } = splitAesGcm(encrypted);
  return {
    encrypted_payload: { ciphertext: toBase64Url(ciphertext) },
    payload_iv: toBase64Url(iv),
    payload_tag: toBase64Url(tag),
  };
}

export async function wrapItemKey(itemKey, wrappingKey) {
  const raw = await crypto.subtle.exportKey('raw', itemKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrappingKey, raw));
  return {
    owner_encrypted_item_key: toBase64Url(encrypted),
    owner_item_key_iv: toBase64Url(iv),
  };
}

export async function importPublicKey(publicKey) {
  return crypto.subtle.importKey('spki', fromBase64Url(publicKey), { name: 'RSA-OAEP', hash: 'SHA-256' }, true, ['encrypt']);
}

// Wrap an item key to a public key (RSA-OAEP). Used to add the org recovery copy.
export async function wrapItemKeyForRecipient(itemKey, recipientPublicKey) {
  const raw = await crypto.subtle.exportKey('raw', itemKey);
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, recipientPublicKey, raw));
  return toBase64Url(encrypted);
}

export function generatePassword(options = {}) {
  const { length = 20, upper = true, lower = true, digits = true, symbols = true, excludeAmbiguous = true } = options;
  const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ' + (excludeAmbiguous ? '' : 'IO');
  const LOWER = 'abcdefghijkmnpqrstuvwxyz' + (excludeAmbiguous ? '' : 'lo');
  const DIGITS = '23456789' + (excludeAmbiguous ? '' : '01');
  const SYMBOLS = '!@#$%^&*()-_=+[]{};:,.<>?';
  let alphabet = '';
  if (upper) alphabet += UPPER;
  if (lower) alphabet += LOWER;
  if (digits) alphabet += DIGITS;
  if (symbols) alphabet += SYMBOLS;
  if (!alphabet) alphabet = LOWER + DIGITS;
  const bytes = crypto.getRandomValues(new Uint32Array(length));
  let out = '';
  for (let i = 0; i < length; i += 1) out += alphabet[bytes[i] % alphabet.length];
  return out;
}
