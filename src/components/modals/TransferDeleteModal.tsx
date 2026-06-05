import { useState } from 'react';
import { passVaultApi, type ApiUser } from '../../api/passVaultApi';
import { ModalShell } from '../ui/ModalShell';

export function TransferDeleteModal({
  target, candidates, onClose, onDeleted,
}: {
  target: ApiUser & { lastActiveAt?: string };
  candidates: Array<ApiUser & { lastActiveAt?: string }>;
  onClose: () => void;
  onDeleted: (count: number) => void;
}) {
  const [transferTo, setTransferTo] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleDelete = async () => {
    setError('');
    setSubmitting(true);
    try {
      const result = await passVaultApi.deleteUser(target.id, transferTo);
      onDeleted(result.transferredItemCount);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalShell title={`Delete ${target.name}`} onClose={onClose}
      footer={
        <>
          <button className="ghost-button" onClick={onClose}>Cancel</button>
          <button className="danger-button" onClick={handleDelete} disabled={submitting || !transferTo}>{submitting ? 'Deleting…' : 'Delete & Transfer'}</button>
        </>
      }
    >
      {error && <p className="error-text">{error}</p>}
      <p className="muted">All vault items owned by this user must be transferred before deletion.</p>
      <label>
        Transfer ownership to
        <select className="text-input" value={transferTo} onChange={(e) => setTransferTo(e.target.value)}>
          <option value="">— Pick a user —</option>
          {candidates.filter((c) => c.status === 'active').map((candidate) => (
            <option key={candidate.id} value={candidate.id}>{candidate.name} ({candidate.email})</option>
          ))}
        </select>
      </label>
    </ModalShell>
  );
}
