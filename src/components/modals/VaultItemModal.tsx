import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Check, Copy, Eye, EyeOff, RefreshCw } from 'lucide-react';
import { passVaultApi, type ApiFolder, type ApiTag, type ApiVaultItem } from '../../api/passVaultApi';
import {
  encryptVaultPayload, generateItemKey, isPasswordBreached, scorePassword, wrapItemKey,
  type VaultSecretPayload,
} from '../../crypto/vaultCrypto';
import type { VaultContext } from '../../lib/appTypes';
import { decryptItemPayload, getItemKey } from '../../lib/vaultHelpers';
import { vaultItemTypeLabels, type VaultItemType } from '../../types';
import { Badge } from '../ui/Badge';
import { ModalShell } from '../ui/ModalShell';
import { StrengthBar } from '../ui/StrengthBar';
import { PasswordGeneratorModal } from './PasswordGeneratorModal';

export function VaultItemModal({
  mode, item, initialType, folders, tags, ctx, onClose, onSaved,
}: {
  mode: 'create' | 'edit' | 'view';
  item: ApiVaultItem | null;
  initialType?: VaultItemType;
  folders: ApiFolder[];
  tags: ApiTag[];
  ctx: VaultContext;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [type, setType] = useState<VaultItemType>(item?.type ?? initialType ?? 'website_login');
  const [title, setTitle] = useState(item?.title ?? '');
  const [url, setUrl] = useState(item?.url ?? '');
  const [folderId, setFolderId] = useState<string | null>(item?.folderId ?? null);
  const [selectedTags, setSelectedTags] = useState<string[]>(item?.tagIds ?? []);
  const [secret, setSecret] = useState<VaultSecretPayload>({});
  const [showPassword, setShowPassword] = useState(false);
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [breach, setBreach] = useState<{ breached: boolean; count: number } | null>(null);
  const [copied, setCopied] = useState<'password' | 'apiKey' | null>(null);

  const copyField = async (value: string, key: 'password' | 'apiKey') => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setTimeout(() => setCopied((current) => (current === key ? null : current)), 1500);
    } catch { /* clipboard blocked — ignore */ }
  };
  const isReadOnly = mode === 'view';
  const canRevealSecrets = !item || item.ownerId === ctx.user.id || item.permission !== 'use_only';

  // Decrypt existing payload on open.
  useEffect(() => {
    if (!item) return;
    (async () => {
      try {
        if (!canRevealSecrets) {
          setSecret({});
          return;
        }
        const payload = await decryptItemPayload(item, ctx);
        setSecret(payload);
      } catch (err) {
        setError(err instanceof Error ? `Could not decrypt this item: ${err.message}` : 'Could not decrypt this item');
      }
    })();
  }, [item, ctx, canRevealSecrets]);

  const strength = useMemo(() => scorePassword(secret.password ?? secret.apiKey ?? ''), [secret.password, secret.apiKey]);

  const checkBreach = async () => {
    const password = secret.password ?? secret.apiKey ?? '';
    if (!password) return;
    setBreach(await isPasswordBreached(password));
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (isReadOnly) return;
    setSubmitting(true);
    setError('');
    try {
      let itemKey = await generateItemKey();
      if (item) {
        try {
          itemKey = await getItemKey(item, ctx);
        } catch (err) {
          if (item.ownerId !== ctx.user.id) throw err;
        }
      }
      const encrypted = await encryptVaultPayload(secret, itemKey);
      const wrapped = await wrapItemKey(itemKey, ctx.masterKey);
      const previewSource = type === 'secure_note' ? (secret.notes ?? '') : (secret.username ?? '');
      const notesPreview = previewSource.slice(0, 80);
      if (mode === 'create') {
        await passVaultApi.createVaultItem({
          title, url: url || undefined, type, folderId,
          ...encrypted,
          ownerEncryptedItemKey: wrapped.encryptedItemKey,
          ownerItemKeyIv: wrapped.itemKeyIv,
          tagIds: selectedTags,
          notesPreview,
        });
        onSaved('Item created.');
      } else if (mode === 'edit' && item) {
        await passVaultApi.updateVaultItem(item.id, {
          title, url: url || undefined, type, folderId,
          ...encrypted,
          ownerEncryptedItemKey: wrapped.encryptedItemKey,
          ownerItemKeyIv: wrapped.itemKeyIv,
          tagIds: selectedTags,
          notesPreview,
        });
        onSaved('Item updated.');
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalShell
      title={mode === 'create' ? 'Add Vault Item' : mode === 'edit' ? `Edit ${item?.title}` : item?.title ?? 'Item'}
      onClose={onClose}
      wide
      footer={!isReadOnly ? (
        <>
          <button className="ghost-button" onClick={onClose}>Cancel</button>
          <button className="primary-button" onClick={handleSubmit} disabled={submitting || !title}>{submitting ? 'Saving…' : 'Save Item'}</button>
        </>
      ) : (
        <button className="ghost-button" onClick={onClose}>Close</button>
      )}
    >
      <form className="modal-form" onSubmit={handleSubmit}>
        {error && <p className="error-text">{error}</p>}
        {!canRevealSecrets && (
          <p className="muted">
            This credential was shared as one-click login only. The web app hides the raw secret; browser extension autofill can use it without revealing it.
          </p>
        )}
        <div className="form-grid">
          <label>
            Type
            <select className="text-input" value={type} onChange={(e) => setType(e.target.value as VaultItemType)} disabled={isReadOnly}>
              {(Object.keys(vaultItemTypeLabels) as VaultItemType[]).map((value) => (
                <option key={value} value={value}>{vaultItemTypeLabels[value]}</option>
              ))}
            </select>
          </label>
          <label>
            Title
            <input className="text-input" value={title} onChange={(e) => setTitle(e.target.value)} required disabled={isReadOnly} />
          </label>
        </div>

        {(type === 'website_login' || type === 'app_login') && (
          <>
            <label>URL <input className="text-input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com" disabled={isReadOnly} /></label>
            <label>Username <input className="text-input" value={secret.username ?? ''} onChange={(e) => setSecret({ ...secret, username: e.target.value })} disabled={isReadOnly} /></label>
            <label>Password
              <div className="input-with-actions">
                <input className="text-input" type={showPassword ? 'text' : 'password'} value={secret.password ?? ''} onChange={(e) => setSecret({ ...secret, password: e.target.value })} disabled={isReadOnly} />
                <button type="button" className="icon-button" onClick={() => setShowPassword((v) => !v)}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button>
                <button type="button" className={copied === 'password' ? 'icon-button copied' : 'icon-button'} title={copied === 'password' ? 'Copied!' : 'Copy password'} onClick={() => copyField(secret.password ?? '', 'password')}>{copied === 'password' ? <Check size={16} /> : <Copy size={16} />}</button>
                {!isReadOnly && <button type="button" className="ghost-button" onClick={() => setGeneratorOpen(true)}><RefreshCw size={14} /> Generate</button>}
              </div>
              <StrengthBar strength={strength} />
              <div style={{ display: 'flex', gap: '0.6rem', marginTop: '0.4rem', alignItems: 'center' }}>
                {!isReadOnly && <button type="button" className="ghost-button mini" onClick={checkBreach}>Check breach</button>}
                {breach && (breach.breached
                  ? <Badge tone="danger">Found in {breach.count.toLocaleString()} breaches</Badge>
                  : <Badge tone="success">Not in known breaches</Badge>
                )}
              </div>
            </label>
            <label>TOTP secret (optional)
              <input className="text-input" value={secret.totpSecret ?? ''} onChange={(e) => setSecret({ ...secret, totpSecret: e.target.value })} placeholder="base32 secret" disabled={isReadOnly} />
            </label>
          </>
        )}

        {type === 'server_ssh' && (
          <>
            <label>Username <input className="text-input" value={secret.username ?? ''} onChange={(e) => setSecret({ ...secret, username: e.target.value })} disabled={isReadOnly} /></label>
            <label>Host <input className="text-input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="server.example.com" disabled={isReadOnly} /></label>
            <label>Passphrase <input className="text-input" type="password" value={secret.sshPassphrase ?? ''} onChange={(e) => setSecret({ ...secret, sshPassphrase: e.target.value })} disabled={isReadOnly} /></label>
            <label>Private key
              <textarea className="text-input" rows={6} value={secret.sshPrivateKey ?? ''} onChange={(e) => setSecret({ ...secret, sshPrivateKey: e.target.value })} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" disabled={isReadOnly} />
            </label>
          </>
        )}

        {type === 'database' && (
          <>
            <label>Engine / URL <input className="text-input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="postgres://host:port/db" disabled={isReadOnly} /></label>
            <div className="form-grid">
              <label>Host <input className="text-input" value={secret.dbHost ?? ''} onChange={(e) => setSecret({ ...secret, dbHost: e.target.value })} disabled={isReadOnly} /></label>
              <label>Port <input className="text-input" value={secret.dbPort ?? ''} onChange={(e) => setSecret({ ...secret, dbPort: e.target.value })} disabled={isReadOnly} /></label>
            </div>
            <label>Database name <input className="text-input" value={secret.dbName ?? ''} onChange={(e) => setSecret({ ...secret, dbName: e.target.value })} disabled={isReadOnly} /></label>
            <label>Username <input className="text-input" value={secret.username ?? ''} onChange={(e) => setSecret({ ...secret, username: e.target.value })} disabled={isReadOnly} /></label>
            <label>Password
              <div className="input-with-actions">
                <input className="text-input" type={showPassword ? 'text' : 'password'} value={secret.password ?? ''} onChange={(e) => setSecret({ ...secret, password: e.target.value })} disabled={isReadOnly} />
                <button type="button" className="icon-button" onClick={() => setShowPassword((v) => !v)}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button>
                {!isReadOnly && <button type="button" className="ghost-button" onClick={() => setGeneratorOpen(true)}><RefreshCw size={14} /> Generate</button>}
              </div>
              <StrengthBar strength={strength} />
            </label>
          </>
        )}

        {type === 'api_key' && (
          <>
            <label>Provider URL <input className="text-input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://api.provider.com" disabled={isReadOnly} /></label>
            <label>API key
              <div className="input-with-actions">
                <input className="text-input" type={showPassword ? 'text' : 'password'} value={secret.apiKey ?? ''} onChange={(e) => setSecret({ ...secret, apiKey: e.target.value })} disabled={isReadOnly} />
                <button type="button" className="icon-button" onClick={() => setShowPassword((v) => !v)}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button>
                <button type="button" className={copied === 'apiKey' ? 'icon-button copied' : 'icon-button'} title={copied === 'apiKey' ? 'Copied!' : 'Copy API key'} onClick={() => copyField(secret.apiKey ?? '', 'apiKey')}>{copied === 'apiKey' ? <Check size={16} /> : <Copy size={16} />}</button>
                {!isReadOnly && <button type="button" className="ghost-button" onClick={() => setGeneratorOpen(true)}><RefreshCw size={14} /> Generate</button>}
              </div>
            </label>
            <label>API secret (optional)
              <input className="text-input" type={showPassword ? 'text' : 'password'} value={secret.apiSecret ?? ''} onChange={(e) => setSecret({ ...secret, apiSecret: e.target.value })} disabled={isReadOnly} />
            </label>
          </>
        )}

        {type === 'secure_note' && (
          <label>Note
            <textarea className="text-input" rows={10} value={secret.notes ?? ''} onChange={(e) => setSecret({ ...secret, notes: e.target.value })} disabled={isReadOnly} />
          </label>
        )}

        {type !== 'secure_note' && (
          <label>Notes
            <textarea className="text-input" rows={3} value={secret.notes ?? ''} onChange={(e) => setSecret({ ...secret, notes: e.target.value })} disabled={isReadOnly} />
          </label>
        )}

        <div className="form-grid">
          <label>
            Folder
            <select className="text-input" value={folderId ?? ''} onChange={(e) => setFolderId(e.target.value || null)} disabled={isReadOnly}>
              <option value="">— No folder —</option>
              {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
            </select>
          </label>
          <label>
            Tags
            <div className="chip-grid">
              {tags.map((tag) => (
                <button
                  type="button"
                  key={tag.id}
                  className={selectedTags.includes(tag.id) ? 'chip selected' : 'chip'}
                  onClick={() => setSelectedTags((current) => current.includes(tag.id) ? current.filter((t) => t !== tag.id) : [...current, tag.id])}
                  disabled={isReadOnly}
                >
                  {tag.name}
                </button>
              ))}
              {tags.length === 0 && <small className="muted">No tags yet. Create them in the Folders panel.</small>}
            </div>
          </label>
        </div>
      </form>

      {generatorOpen && (
        <PasswordGeneratorModal
          onClose={() => setGeneratorOpen(false)}
          onUse={(password) => {
            if (type === 'api_key') setSecret({ ...secret, apiKey: password });
            else setSecret({ ...secret, password });
            setGeneratorOpen(false);
          }}
        />
      )}
    </ModalShell>
  );
}
