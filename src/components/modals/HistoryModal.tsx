import { useEffect, useState } from 'react';
import { passVaultApi, type ApiVaultItem } from '../../api/passVaultApi';
import { decryptVaultPayload } from '../../crypto/vaultCrypto';
import type { VaultContext } from '../../lib/appTypes';
import { getItemKey } from '../../lib/vaultHelpers';
import { ModalShell } from '../ui/ModalShell';

export function HistoryModal({ item, ctx, onClose }: { item: ApiVaultItem; ctx: VaultContext; onClose: () => void }) {
  const [versions, setVersions] = useState<Array<{ id: string; created_at: string; actor_name: string | null; preview: string }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const result = await passVaultApi.getVersions(item.id);
        const itemKey = await getItemKey(item, ctx);
        const decoded = await Promise.all(result.versions.map(async (version) => {
          try {
            const decrypted = await decryptVaultPayload(
              { encryptedPayload: version.encrypted_payload, payloadIv: version.payload_iv, payloadTag: version.payload_tag },
              itemKey,
            );
            return {
              id: version.id,
              created_at: version.created_at,
              actor_name: version.actor_name,
              preview: decrypted.username ?? decrypted.notes?.slice(0, 60) ?? '—',
            };
          } catch {
            return { id: version.id, created_at: version.created_at, actor_name: version.actor_name, preview: '(decryption failed)' };
          }
        }));
        setVersions(decoded);
      } finally {
        setLoading(false);
      }
    })();
  }, [item, ctx]);

  return (
    <ModalShell title={`History — ${item.title}`} onClose={onClose}>
      {loading ? <p className="muted">Loading…</p> : (
        <div className="table-card">
          {versions.map((version) => (
            <div className="table-row session-row" key={version.id}>
              <span>{version.actor_name ?? 'System'}</span>
              <span>{new Date(version.created_at).toLocaleString()}</span>
              <span>{version.preview}</span>
            </div>
          ))}
          {versions.length === 0 && <p className="muted" style={{ padding: '0.5rem' }}>No history yet — edit the item to start tracking.</p>}
        </div>
      )}
    </ModalShell>
  );
}
