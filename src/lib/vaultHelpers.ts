import type { ApiVaultItem } from '../api/passVaultApi';
import {
  decryptVaultPayload, fromBase64Url, importPublicKey, unwrapItemKey, unwrapItemKeyWithPrivate,
  wrapItemKeyForRecipient, type VaultSecretPayload,
} from '../crypto/vaultCrypto';
import type { VaultContext } from './appTypes';

// Helper: unwrap the item key correctly. The owner copy is normally AES-wrapped
// with the master key, EXCEPT right after a recovery-transfer when it's RSA-wrapped
// to the new owner's public key (ownerKeyWrap='rsa') — then use the private key,
// same as the shared-item path (self-heal flips it back to 'master' on next login).
export async function getItemKey(item: ApiVaultItem, ctx: VaultContext) {
  const ownerRsaWrapped = item.ownerKeyWrap === 'rsa';
  if (item.ownerId === ctx.user.id && !ownerRsaWrapped) {
    return unwrapItemKey({ encryptedItemKey: item.encryptedItemKey, itemKeyIv: item.itemKeyIv }, ctx.masterKey);
  }
  if (!ctx.privateKey) {
    throw new Error('RSA private key not unlocked — cannot read this item.');
  }
  return unwrapItemKeyWithPrivate({ encryptedItemKey: item.encryptedItemKey, itemKeyIv: item.itemKeyIv }, ctx.privateKey);
}

// Make a recovery copy of an item key (wrapped to the org recovery public key), when
// org recovery is configured. Returns undefined otherwise — items get their recovery
// copy later via self-heal once recovery is set up.
export async function wrapItemKeyForRecovery(itemKey: CryptoKey, ctx: VaultContext): Promise<string | undefined> {
  if (!ctx.orgRecoveryPublicKey) return undefined;
  const orgPublic = await importPublicKey(ctx.orgRecoveryPublicKey);
  const wrapped = await wrapItemKeyForRecipient(itemKey, orgPublic);
  return wrapped.encryptedItemKey;
}

export async function decryptItemPayload(item: ApiVaultItem, ctx: VaultContext) {
  try {
    const itemKey = await getItemKey(item, ctx);
    return await decryptVaultPayload(item, itemKey);
  } catch (error) {
    const ciphertext = item.encryptedPayload?.ciphertext;
    if (typeof ciphertext === 'string') {
      try {
        const decoded = new TextDecoder().decode(fromBase64Url(ciphertext)).trim();
        if (decoded.startsWith('{') || decoded.startsWith('[')) {
          return JSON.parse(decoded) as VaultSecretPayload;
        }
      } catch {
        // Keep the original crypto error below.
      }
    }
    throw error;
  }
}

export async function exportVaultJson(items: ApiVaultItem[], masterKey: CryptoKey): Promise<string> {
  const exported: Array<Record<string, unknown>> = [];
  for (const item of items) {
    try {
      const itemKey = await unwrapItemKey({ encryptedItemKey: item.encryptedItemKey, itemKeyIv: item.itemKeyIv }, masterKey);
      const payload = await decryptVaultPayload(item, itemKey);
      exported.push({
        title: item.title,
        url: item.url,
        type: item.type,
        secret: payload,
        createdAt: item.createdAt,
      });
    } catch { /* skip items we can't decrypt */ }
  }
  return JSON.stringify({ exportedAt: new Date().toISOString(), count: exported.length, items: exported }, null, 2);
}
