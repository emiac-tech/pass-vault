import { useState } from 'react';
import { passVaultApi, type ApiUser } from '../../api/passVaultApi';
import {
  importPublicKey, unwrapItemKeyWithPrivate, unwrapOrgPrivateKey, wrapItemKeyForRecipient,
} from '../../crypto/vaultCrypto';
import type { VaultContext } from '../../lib/appTypes';
import { ModalShell } from '../ui/ModalShell';

interface DeleteResult {
  transferredItemCount: number;
  securedItemCount: number;
  unrecoverableItemCount: number;
}

// Re-wrap every recoverable item key of `fromUserId` to `toUserId` using the org
// recovery key. Returns the rewrapped owner copies (RSA-wrapped to the new owner).
// Returns [] if the super-admin has no recovery access — the server then moves
// ownership by id only and those items stay inaccessible (reported back as counts).
async function buildRewrappedItems(
  fromUserId: string,
  toUserId: string,
  ctx: VaultContext,
  setStatus: (message: string) => void,
): Promise<Array<{ itemId: string; ownerEncryptedItemKey: string }>> {
  if (!ctx.privateKey) return [];
  const { grant } = await passVaultApi.recoveryGrant().catch(() => ({ grant: null }));
  if (!grant) return [];

  setStatus('Unlocking organization recovery key…');
  const orgPrivateKey = await unwrapOrgPrivateKey(grant, ctx.privateKey);

  const { users } = await passVaultApi.recoveryUsers();
  const newOwner = users.find((u) => u.id === toUserId);
  if (!newOwner?.publicKey) throw new Error('The new owner has no encryption key yet — they must log in once first.');
  const newOwnerPublic = await importPublicKey(newOwner.publicKey);

  const { items } = await passVaultApi.recoveryUserItems(fromUserId);
  const out: Array<{ itemId: string; ownerEncryptedItemKey: string }> = [];
  let done = 0;
  for (const it of items) {
    done += 1;
    setStatus(`Re-encrypting credentials for the new owner… (${done}/${items.length})`);
    if (!it.recoveryWrappedItemKey) continue;
    try {
      const itemKey = await unwrapItemKeyWithPrivate(
        { encryptedItemKey: it.recoveryWrappedItemKey, itemKeyIv: '' },
        orgPrivateKey,
      );
      const wrapped = await wrapItemKeyForRecipient(itemKey, newOwnerPublic);
      out.push({ itemId: it.itemId, ownerEncryptedItemKey: wrapped.encryptedItemKey });
    } catch { /* skip items that won't re-wrap */ }
  }
  return out;
}

export function TransferDeleteModal({
  target, candidates, ctx, onClose, onDeleted,
}: {
  target: ApiUser & { lastActiveAt?: string };
  candidates: Array<ApiUser & { lastActiveAt?: string }>;
  ctx: VaultContext;
  onClose: () => void;
  onDeleted: (result: DeleteResult) => void;
}) {
  const [transferTo, setTransferTo] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  const handleDelete = async () => {
    setError('');
    setSubmitting(true);
    try {
      setStatus('Preparing transfer…');
      const rewrappedItems = await buildRewrappedItems(target.id, transferTo, ctx, setStatus);
      setStatus('Deleting user and transferring items…');
      const result = await passVaultApi.deleteUser(target.id, transferTo, rewrappedItems);
      onDeleted(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setSubmitting(false);
      setStatus('');
    }
  };

  const isSuperAdmin = ctx.user.role === 'super_admin';

  return (
    <ModalShell title={`Delete ${target.name}`} onClose={onClose}
      footer={
        <>
          <button className="ghost-button" onClick={onClose} disabled={submitting}>Cancel</button>
          <button className="danger-button" onClick={handleDelete} disabled={submitting || !transferTo}>
            {submitting ? 'Working…' : 'Delete & Transfer'}
          </button>
        </>
      }
    >
      {error && <p className="error-text">{error}</p>}
      <p className="muted">
        All vault items owned by this user are transferred to another user before deletion.
        {isSuperAdmin
          ? ' Their credentials are re-encrypted to the new owner using the organization recovery key, so the new owner can open them.'
          : ' Note: only a super-admin can re-encrypt the credentials so the new owner can read them.'}
      </p>
      <label>
        Transfer ownership to
        <select className="text-input" value={transferTo} onChange={(e) => setTransferTo(e.target.value)} disabled={submitting}>
          <option value="">— Pick a user —</option>
          {candidates.filter((c) => c.status === 'active').map((candidate) => (
            <option key={candidate.id} value={candidate.id}>{candidate.name} ({candidate.email})</option>
          ))}
        </select>
      </label>
      {status && <p className="muted" style={{ marginTop: '0.6rem' }}>{status}</p>}
    </ModalShell>
  );
}
