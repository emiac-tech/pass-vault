import { useState } from 'react';
import { passVaultApi, type ApiFolder } from '../../api/passVaultApi';
import { encryptVaultPayload, generateItemKey, wrapItemKey, type VaultSecretPayload } from '../../crypto/vaultCrypto';
import type { VaultContext } from '../../lib/appTypes';
import { parseCsv } from '../../lib/files';
import { ModalShell } from '../ui/ModalShell';

export function ImportModal({
  folders, ctx, onClose, onImported,
}: {
  folders: ApiFolder[];
  ctx: VaultContext;
  onClose: () => void;
  onImported: (count: number) => void;
}) {
  const [csvText, setCsvText] = useState('');
  const [folderId, setFolderId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleImport = async () => {
    setSubmitting(true);
    setError('');
    try {
      const rows = parseCsv(csvText);
      let count = 0;
      for (const row of rows) {
        const itemKey = await generateItemKey();
        const payload: VaultSecretPayload = {
          username: row.username ?? row.user ?? '',
          password: row.password ?? row.pass ?? '',
          notes: row.notes ?? '',
        };
        const encrypted = await encryptVaultPayload(payload, itemKey);
        const wrapped = await wrapItemKey(itemKey, ctx.masterKey);
        await passVaultApi.createVaultItem({
          title: row.title || row.name || row.url || 'Imported item',
          url: row.url ?? undefined,
          type: 'website_login',
          folderId,
          ...encrypted,
          ownerEncryptedItemKey: wrapped.encryptedItemKey,
          ownerItemKeyIv: wrapped.itemKeyIv,
        });
        count += 1;
      }
      onImported(count);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalShell title="Import items (CSV)" onClose={onClose}
      footer={
        <>
          <button className="ghost-button" onClick={onClose}>Cancel</button>
          <button className="primary-button" onClick={handleImport} disabled={submitting || !csvText.trim()}>{submitting ? 'Importing…' : 'Import'}</button>
        </>
      }
    >
      {error && <p className="error-text">{error}</p>}
      <p className="muted">Header row required. Recognized columns: <code>title, url, username, password, notes</code>. Paste CSV or drag a file:</p>
      <input type="file" accept=".csv,text/csv" onChange={async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        setCsvText(await file.text());
      }} />
      <textarea className="text-input" rows={10} value={csvText} onChange={(e) => setCsvText(e.target.value)} placeholder="title,url,username,password,notes" />
      <label>
        Import into folder
        <select className="text-input" value={folderId ?? ''} onChange={(e) => setFolderId(e.target.value || null)}>
          <option value="">— No folder —</option>
          {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
        </select>
      </label>
    </ModalShell>
  );
}
