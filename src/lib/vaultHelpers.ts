import type { ApiVaultItem } from '../api/passVaultApi';
import {
  decryptVaultPayload, fromBase64Url, unwrapItemKey, unwrapItemKeyWithPrivate,
  type VaultSecretPayload,
} from '../crypto/vaultCrypto';
import type { VaultContext } from './appTypes';

// Helper: unwrap the item key correctly for owner (AES with master key)
// vs recipient (RSA with private key).
export async function getItemKey(item: ApiVaultItem, ctx: VaultContext) {
  if (item.ownerId === ctx.user.id) {
    return unwrapItemKey({ encryptedItemKey: item.encryptedItemKey, itemKeyIv: item.itemKeyIv }, ctx.masterKey);
  }
  if (!ctx.privateKey) {
    throw new Error('RSA private key not unlocked — cannot read shared item.');
  }
  return unwrapItemKeyWithPrivate({ encryptedItemKey: item.encryptedItemKey, itemKeyIv: item.itemKeyIv }, ctx.privateKey);
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
