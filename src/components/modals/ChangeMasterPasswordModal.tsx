import { useState } from 'react';
import { passVaultApi, type ApiVaultItem } from '../../api/passVaultApi';
import {
  deriveMasterKey, randomSalt, scorePassword, toBase64Url, unwrapItemKey, unwrapPrivateKey, wrapItemKey,
} from '../../crypto/vaultCrypto';
import type { VaultContext } from '../../lib/appTypes';
import { ModalShell } from '../ui/ModalShell';
import { StrengthBar } from '../ui/StrengthBar';

export function ChangeMasterPasswordModal({
  ctx, items, onClose, onChanged,
}: {
  ctx: VaultContext;
  items: ApiVaultItem[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [currentAccount, setCurrentAccount] = useState('');
  const [currentMaster, setCurrentMaster] = useState('');
  const [newMaster, setNewMaster] = useState('');
  const [confirmMaster, setConfirmMaster] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState(0);

  const handleChange = async () => {
    setError('');
    setSubmitting(true);
    try {
      if (newMaster.length < 12) throw new Error('New master password must be at least 12 characters');
      if (newMaster !== confirmMaster) throw new Error('Master passwords do not match');

      // 1) Derive old master key (from existing salt) and confirm it matches.
      const oldSalt = ctx.user.masterKeySalt;
      if (!oldSalt) throw new Error('Master salt missing — cannot verify current password');
      const oldMasterKey = await deriveMasterKey(currentMaster, oldSalt);

      // 2) Generate a new salt, derive new master key.
      const newSalt = randomSalt();
      const newMasterKey = await deriveMasterKey(newMaster, newSalt);

      // 3) Re-wrap the RSA private key with the new master key.
      if (!ctx.user.encryptedPrivateKey || !ctx.user.privateKeyIv) throw new Error('Missing RSA keypair — cannot re-wrap');
      const privateKey = await unwrapPrivateKey(ctx.user.encryptedPrivateKey, ctx.user.privateKeyIv, oldMasterKey);
      const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', privateKey));
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const newWrappedPrivate = new Uint8Array(
        await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, newMasterKey, pkcs8),
      );

      // 4) Re-wrap each owned item key.
      const ownedItems = items.filter((item) => item.ownerId === ctx.user.id);
      const rewrapped: Array<{ itemId: string; ownerEncryptedItemKey: string; ownerItemKeyIv: string }> = [];
      let done = 0;
      for (const item of ownedItems) {
        const itemKey = await unwrapItemKey({ encryptedItemKey: item.encryptedItemKey, itemKeyIv: item.itemKeyIv }, oldMasterKey);
        const wrapped = await wrapItemKey(itemKey, newMasterKey);
        rewrapped.push({ itemId: item.id, ownerEncryptedItemKey: wrapped.encryptedItemKey, ownerItemKeyIv: wrapped.itemKeyIv });
        done += 1;
        setProgress(Math.round((done / Math.max(1, ownedItems.length)) * 100));
      }

      // 5) Submit atomic re-key.
      await passVaultApi.changeMasterPassword({
        currentPassword: currentAccount,
        newPasswordSalt: newSalt,
        newEncryptedPrivateKey: toBase64Url(newWrappedPrivate),
        newPrivateKeyIv: toBase64Url(iv),
        rewrappedItemKeys: rewrapped,
      });
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Master password change failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalShell title="Change Master Password" onClose={onClose} wide
      footer={
        <>
          <button className="ghost-button" onClick={onClose}>Cancel</button>
          <button className="primary-button" onClick={handleChange} disabled={submitting}>{submitting ? `Re-encrypting… ${progress}%` : 'Change Master Password'}</button>
        </>
      }
    >
      <p className="warning-text">
        This re-encrypts your RSA private key and every owned item key with the new master password.
        You will be signed out at the end and must log in again.
      </p>
      {error && <p className="error-text">{error}</p>}
      <label>Account password (for re-auth) <input className="text-input" type="password" value={currentAccount} onChange={(e) => setCurrentAccount(e.target.value)} /></label>
      <label>Current master password <input className="text-input" type="password" value={currentMaster} onChange={(e) => setCurrentMaster(e.target.value)} /></label>
      <label>New master password <input className="text-input" type="password" value={newMaster} onChange={(e) => setNewMaster(e.target.value)} /></label>
      <label>Confirm new master password <input className="text-input" type="password" value={confirmMaster} onChange={(e) => setConfirmMaster(e.target.value)} /></label>
      <StrengthBar strength={scorePassword(newMaster)} />
    </ModalShell>
  );
}
