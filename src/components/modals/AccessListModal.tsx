import { useEffect, useState } from 'react';
import { passVaultApi, type ApiShare, type ApiVaultItem } from '../../api/passVaultApi';
import { permissionLabels } from '../../lib/constants';
import { Badge } from '../ui/Badge';
import { ModalShell } from '../ui/ModalShell';

export function AccessListModal({ item, onClose }: { item: ApiVaultItem; onClose: () => void }) {
  const [shares, setShares] = useState<ApiShare[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revoking, setRevoking] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await passVaultApi.listShares(item.id);
        if (!cancelled) setShares(result.shares);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load shared users');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [item.id]);

  // Only currently-active shares — revoked/expired drop out of the list.
  const activeShares = shares.filter((share) => (
    !share.revoked_at && (!share.expires_at || new Date(share.expires_at) > new Date())
  ));

  const revoke = async (shareId: string) => {
    setError('');
    setRevoking(shareId);
    try {
      await passVaultApi.revokeShare(shareId);
      setShares((curr) => curr.map((s) => (s.id === shareId ? { ...s, revoked_at: new Date().toISOString() } : s)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not revoke access');
    } finally {
      setRevoking(null);
    }
  };

  return (
    <ModalShell
      title={`Shared Users — "${item.title}"`}
      onClose={onClose}
      footer={<button className="ghost-button" onClick={onClose}>Close</button>}
    >
      {error && <p className="error-text">{error}</p>}
      <div className="access-summary">
        <div>
          <p className="eyebrow">Currently shared with</p>
          <strong>{activeShares.length} user{activeShares.length === 1 ? '' : 's'}</strong>
        </div>
        <Badge tone={activeShares.length > 0 ? 'success' : 'neutral'}>{activeShares.length > 0 ? 'Active access' : 'No access'}</Badge>
      </div>
      {loading ? (
        <p className="muted">Loading shared users…</p>
      ) : activeShares.length === 0 ? (
        <p className="muted" style={{ padding: '0.75rem' }}>This password is not shared with anyone right now.</p>
      ) : (
        <div className="access-list">
          {activeShares.map((share) => {
            const name = share.recipient_user_name ?? share.recipient_team_name ?? '—';
            return (
              <div className="access-list-item" key={share.id}>
                <div className="access-list-user">
                  <span className="user-avatar">{name.charAt(0).toUpperCase()}</span>
                  <div style={{ minWidth: 0 }}>
                    <strong>{name}</strong>
                    <small>
                      {permissionLabels[share.permission]}
                      {share.expires_at ? ` · expires ${new Date(share.expires_at).toLocaleDateString()}` : ' · no expiry'}
                    </small>
                  </div>
                </div>
                <div className="access-list-actions">
                  <Badge tone={share.permission === 'use_only' ? 'warning' : share.permission === 'manage' ? 'success' : 'neutral'}>
                    {permissionLabels[share.permission]}
                  </Badge>
                  <button className="danger-button" onClick={() => revoke(share.id)} disabled={revoking === share.id}>
                    {revoking === share.id ? 'Revoking…' : 'Revoke'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </ModalShell>
  );
}
