import { useCallback, useEffect, useState } from 'react';
import { passVaultApi, type ApiDirectoryUser, type ApiShare, type ApiVaultItem } from '../../api/passVaultApi';
import {
  encryptVaultPayload, generateItemKey, importPublicKey, wrapItemKey, wrapItemKeyForRecipient,
} from '../../crypto/vaultCrypto';
import type { VaultContext } from '../../lib/appTypes';
import { permissionDescriptions, permissionLabels } from '../../lib/constants';
import { decryptItemPayload, getItemKey, wrapItemKeyForRecovery } from '../../lib/vaultHelpers';
import { Badge } from '../ui/Badge';
import { ModalShell } from '../ui/ModalShell';

export function ShareModal({
  item, ctx, directory, onClose, onShared,
}: {
  item: ApiVaultItem;
  ctx: VaultContext;
  directory: ApiDirectoryUser[];
  onClose: () => void;
  onShared: () => void;
}) {
  const [recipientId, setRecipientId] = useState<string>('');
  const [permission, setPermission] = useState<ApiVaultItem['permission']>('use_only');
  const [expiresAt, setExpiresAt] = useState<string>('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [existingShares, setExistingShares] = useState<ApiShare[]>([]);
  const activeShares = existingShares.filter((share) => (
    !share.revoked_at && (!share.expires_at || new Date(share.expires_at) > new Date())
  ));

  const loadShares = useCallback(async () => {
    const result = await passVaultApi.listShares(item.id);
    setExistingShares(result.shares);
  }, [item.id]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadShares().catch(() => undefined); }, [loadShares]);

  const handleShare = async () => {
    setError('');
    setSubmitting(true);
    try {
      const recipient = directory.find((user) => user.id === recipientId);
      if (!recipient) throw new Error('Pick a recipient');
      if (!recipient.publicKey || recipient.keyReady === false) {
        throw new Error('Recipient must unlock their vault once to repair encryption keys before receiving shared credentials.');
      }
      let itemKey: CryptoKey;
      try {
        itemKey = await getItemKey(item, ctx);
      } catch (err) {
        if (item.ownerId !== ctx.user.id) throw err;
        const payload = await decryptItemPayload(item, ctx);
        itemKey = await generateItemKey();
        const encrypted = await encryptVaultPayload(payload, itemKey);
        const wrappedOwnerKey = await wrapItemKey(itemKey, ctx.masterKey);
        const recoveryWrappedItemKey = await wrapItemKeyForRecovery(itemKey, ctx);
        const previewSource = item.type === 'secure_note' ? (payload.notes ?? '') : (payload.username ?? '');
        await passVaultApi.updateVaultItem(item.id, {
          ...encrypted,
          ownerEncryptedItemKey: wrappedOwnerKey.encryptedItemKey,
          ownerItemKeyIv: wrappedOwnerKey.itemKeyIv,
          recoveryWrappedItemKey,
          notesPreview: previewSource.slice(0, 80),
        });
      }
      // 2) import the recipient's public key
      const recipientPublic = await importPublicKey(recipient.publicKey);
      // 3) wrap the item key with the recipient's public key
      const wrapped = await wrapItemKeyForRecipient(itemKey, recipientPublic);
      // 4) send to API
      await passVaultApi.shareVaultItem(item.id, {
        recipientUserId: recipient.id,
        permission,
        encryptedItemKey: wrapped.encryptedItemKey,
        itemKeyIv: wrapped.itemKeyIv,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
      });
      await loadShares();
      setRecipientId('');
      setPermission('use_only');
      setExpiresAt('');
      onShared();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Share failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalShell
      title={`Manage Access — "${item.title}"`}
      onClose={onClose}
      footer={
        <>
          <button className="ghost-button" onClick={onClose}>Cancel</button>
          <button className="primary-button" onClick={handleShare} disabled={submitting || !recipientId}>{submitting ? 'Sharing…' : 'Share'}</button>
        </>
      }
    >
      {error && <p className="error-text">{error}</p>}
      <div className="access-summary">
        <div>
          <p className="eyebrow">Shared with</p>
          <strong>{activeShares.length} user{activeShares.length === 1 ? '' : 's'}</strong>
        </div>
        <Badge tone="warning">One-click login supported</Badge>
      </div>
      <label>
        Recipient
        <select className="text-input" value={recipientId} onChange={(e) => setRecipientId(e.target.value)}>
          <option value="">— Pick a user —</option>
          {directory.map((user) => (
            <option key={user.id} value={user.id} disabled={!user.publicKey || user.keyReady === false}>
              {user.name} ({user.email}){!user.publicKey || user.keyReady === false ? ' — unlock vault once to repair keys' : ''}
            </option>
          ))}
        </select>
        {directory.length === 0 && <small className="muted">No active users available. Invite or activate a user first.</small>}
      </label>
      <label>
        Access mode
        <select className="text-input" value={permission} onChange={(e) => setPermission(e.target.value as ApiVaultItem['permission'])}>
          <option value="use_only">One-click login only (no password view)</option>
          <option value="view">Manage access: view password</option>
          <option value="edit">Manage access: view + edit</option>
          <option value="manage">Manage access: re-share + revoke</option>
        </select>
        <small className="muted">{permissionDescriptions[permission]}</small>
      </label>
      <label>
        Expires (optional)
        <input type="datetime-local" className="text-input" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
      </label>

      <h4 style={{ marginTop: '1rem' }}>Existing shares ({activeShares.length})</h4>
      <div className="table-card">
        {existingShares.map((share) => (
          <div className="table-row session-row" key={share.id}>
            <span>{share.recipient_user_name ?? share.recipient_team_name ?? '—'}</span>
            <span>
              <Badge tone={share.permission === 'use_only' ? 'warning' : share.permission === 'manage' ? 'success' : 'neutral'}>
                {permissionLabels[share.permission]}
              </Badge>
            </span>
            <span>{share.expires_at ? new Date(share.expires_at).toLocaleString() : 'No expiry'}</span>
            <span>
              {share.revoked_at
                ? <Badge tone="danger">Revoked</Badge>
                : share.expires_at && new Date(share.expires_at) <= new Date()
                  ? <Badge tone="warning">Expired</Badge>
                : <button className="mini-button" onClick={async () => { await passVaultApi.revokeShare(share.id); setExistingShares((curr) => curr.map((s) => s.id === share.id ? { ...s, revoked_at: new Date().toISOString() } : s)); }}>Revoke</button>
              }
            </span>
          </div>
        ))}
        {existingShares.length === 0 && <p className="muted" style={{ padding: '0.5rem' }}>No shares yet.</p>}
      </div>
    </ModalShell>
  );
}
