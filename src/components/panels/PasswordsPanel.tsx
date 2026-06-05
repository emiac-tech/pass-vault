import { useMemo, useState } from 'react';
import {
  Clipboard, ClipboardCheck, Copy, Download, Edit3, Eye, History, KeyRound, MoreHorizontal,
  Plus, Search, Share2, Tag, Trash2, Upload, Users,
} from 'lucide-react';
import type { ApiFolder, ApiTag, ApiVaultItem } from '../../api/passVaultApi';
import type { VaultContext } from '../../lib/appTypes';
import { itemIcons, permissionShortLabels } from '../../lib/constants';
import { decryptItemPayload } from '../../lib/vaultHelpers';
import { vaultItemTypeLabels, type VaultItemType } from '../../types';
import { Badge } from '../ui/Badge';
import { RowMenu } from '../ui/RowMenu';

export function PasswordsPanel(props: {
  items: ApiVaultItem[];
  counts: { all: number; favorites: number; 'shared-by-me': number; 'shared-with-me': number };
  folders: ApiFolder[];
  tags: ApiTag[];
  filter: 'all' | 'favorites' | 'shared-by-me' | 'shared-with-me' | 'trash';
  setFilter: (value: 'all' | 'favorites' | 'shared-by-me' | 'shared-with-me' | 'trash') => void;
  folderFilter: string | null;
  setFolderFilter: (value: string | null) => void;
  tagFilter: string | null;
  setTagFilter: (value: string | null) => void;
  typeFilter: VaultItemType | null;
  setTypeFilter: (value: VaultItemType | null) => void;
  query: string;
  setQuery: (value: string) => void;
  onCreate: (type: VaultItemType) => void;
  onEdit: (item: ApiVaultItem) => void;
  onView: (item: ApiVaultItem) => void;
  onShare: (item: ApiVaultItem) => void;
  onViewAccess: (item: ApiVaultItem) => void;
  onHistory: (item: ApiVaultItem) => void;
  onDelete: (item: ApiVaultItem) => void;
  onRestore: (item: ApiVaultItem) => void;
  onPurge: (item: ApiVaultItem) => void;
  onToggleFavorite: (item: ApiVaultItem) => void;
  onImport: () => void;
  onExport: () => void;
  ctx: VaultContext;
}) {
  const filterButtons = [
    { id: 'all' as const, label: 'All Items', icon: KeyRound },
    { id: 'favorites' as const, label: 'Favorites', icon: Tag },
    { id: 'shared-by-me' as const, label: 'Shared by Me', icon: Share2 },
    { id: 'shared-with-me' as const, label: 'Shared With Me', icon: Users },
    { id: 'trash' as const, label: 'Trash', icon: Trash2 },
  ];

  return (
    <section className="passwords-layout">
      <aside className="passwords-subnav">
        {filterButtons.map((button) => {
          const Icon = button.icon;
          const count = button.id === 'trash' ? undefined : props.counts[button.id];
          return (
            <button
              key={button.id}
              className={props.filter === button.id ? 'subnav-item active' : 'subnav-item'}
              onClick={() => { props.setFilter(button.id); props.setFolderFilter(null); props.setTagFilter(null); }}
            >
              <Icon size={17} />
              <span className="subnav-item-label">{button.label}</span>
              {count !== undefined && <span className="subnav-count">{count}</span>}
            </button>
          );
        })}
        <div className="subnav-section">
          <p>Type</p>
          {(Object.keys(vaultItemTypeLabels) as VaultItemType[]).map((type) => (
            <button
              key={type}
              className={props.typeFilter === type ? 'tag-button active' : 'tag-button'}
              onClick={() => props.setTypeFilter(props.typeFilter === type ? null : type)}
            >
              {vaultItemTypeLabels[type]}
            </button>
          ))}
        </div>
        <div className="subnav-section">
          <p>Folders</p>
          {props.folders.map((folder) => (
            <button
              key={folder.id}
              className={props.folderFilter === folder.id ? 'tag-button active' : 'tag-button'}
              onClick={() => props.setFolderFilter(props.folderFilter === folder.id ? null : folder.id)}
            >
              {folder.name} <small>({folder.itemCount})</small>
            </button>
          ))}
          {props.folders.length === 0 && <small className="muted">No folders yet.</small>}
        </div>
        <div className="subnav-section">
          <p>Tags</p>
          {props.tags.map((tag) => (
            <button
              key={tag.id}
              className={props.tagFilter === tag.id ? 'tag-pill active' : 'tag-pill'}
              onClick={() => props.setTagFilter(props.tagFilter === tag.id ? null : tag.id)}
            >
              {tag.name}
            </button>
          ))}
          {props.tags.length === 0 && <small className="muted">No tags yet.</small>}
        </div>
      </aside>
      <div className="panel-card passwords-main">
        <div className="panel-toolbar">
          <div>
            <p className="eyebrow">Credential Storage</p>
            <h3>{props.filter === 'trash' ? 'Trash' : 'Vault Items'}</h3>
          </div>
          <label className="search-box">
            <Search size={18} />
            <input value={props.query} onChange={(e) => props.setQuery(e.target.value)} placeholder="Search by title or URL…" />
          </label>
        </div>
        <div className="password-actions">
          <div className="dropdown">
            <button className="primary-button"><Plus size={17} /> Add Item</button>
            <div className="dropdown-menu">
              {(Object.keys(vaultItemTypeLabels) as VaultItemType[]).map((type) => {
                const Icon = itemIcons[type];
                return (
                  <button key={type} onClick={() => props.onCreate(type)}>
                    <Icon size={16} /> {vaultItemTypeLabels[type]}
                  </button>
                );
              })}
            </div>
          </div>
          <button className="ghost-button" onClick={props.onImport}><Upload size={17} /> Import</button>
          <button className="ghost-button" onClick={props.onExport}><Download size={17} /> Export</button>
        </div>
        <div className="table-card">
          <div className="table-row table-head password-row">
            <span>Name</span><span>Type</span><span>Folder</span><span>Owner</span><span>Access</span><span>Updated</span><span></span>
          </div>
          {props.items.map((item) => (
            <ItemRow key={item.id} item={item} folder={props.folders.find((f) => f.id === item.folderId) ?? null} ctx={props.ctx}
              isTrash={props.filter === 'trash'}
              onView={() => props.onView(item)}
              onEdit={() => props.onEdit(item)}
              onShare={() => props.onShare(item)}
              onViewAccess={() => props.onViewAccess(item)}
              onHistory={() => props.onHistory(item)}
              onDelete={() => props.onDelete(item)}
              onRestore={() => props.onRestore(item)}
              onPurge={() => props.onPurge(item)}
              onToggleFavorite={() => props.onToggleFavorite(item)}
            />
          ))}
          {props.items.length === 0 && <p className="muted" style={{ padding: '1rem' }}>No items match your filters.</p>}
        </div>
      </div>
    </section>
  );
}

// Tiny helper: shows the site's favicon if we have a public URL, otherwise
// falls back to the vault-item type icon. Local hosts and IPs skip the favicon
// service (it returns blurry placeholders for them).
function RowFavicon({ item }: { item: ApiVaultItem }) {
  const Icon = itemIcons[item.type];
  const [failed, setFailed] = useState(false);
  const host = useMemo(() => {
    if (!item.url) return null;
    try {
      return new URL(item.url.startsWith('http') ? item.url : `https://${item.url}`).hostname.replace(/^www\./, '');
    } catch { return null; }
  }, [item.url]);

  const looksLikePublicDomain = useMemo(() => {
    if (!host) return false;
    // Skip IPs (v4 + v6), localhost variants, and bare hostnames without a TLD.
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return false;          // IPv4
    if (host.includes(':')) return false;                                // IPv6 / port-only
    if (host === 'localhost') return false;
    if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.lan')) return false;
    if (!host.includes('.')) return false;                               // bare hostnames
    return true;
  }, [host]);

  if (!host || !looksLikePublicDomain || failed) {
    return (
      <span className="row-favicon" data-fallback="true">
        <Icon size={16} />
      </span>
    );
  }
  return (
    <span className="row-favicon">
      <img
        src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
    </span>
  );
}

function ItemRow({
  item, folder, ctx, isTrash, onView, onEdit, onShare, onViewAccess, onHistory, onDelete, onRestore, onPurge, onToggleFavorite,
}: {
  item: ApiVaultItem;
  folder: ApiFolder | null;
  ctx: VaultContext;
  isTrash: boolean;
  onView: () => void;
  onEdit: () => void;
  onShare: () => void;
  onViewAccess: () => void;
  onHistory: () => void;
  onDelete: () => void;
  onRestore: () => void;
  onPurge: () => void;
  onToggleFavorite: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'username' | 'password'>('idle');
  const [moreButton, setMoreButton] = useState<HTMLButtonElement | null>(null);
  const isOwner = item.ownerId === ctx.user.id;
  const canRevealSecrets = isOwner || item.permission !== 'use_only';
  const canManageAccess = isOwner || item.permission === 'manage';

  const copyField = async (field: 'username' | 'password') => {
    try {
      if (field === 'password' && !canRevealSecrets) {
        throw new Error('This share is one-click login only; password viewing is disabled.');
      }
      const payload = await decryptItemPayload(item, ctx);
      const value = field === 'username' ? payload.username : payload.password;
      await navigator.clipboard.writeText(value ?? '');
      setCopyState(field);
      setTimeout(() => setCopyState('idle'), 1500);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Copy failed');
    }
  };

  return (
    <div className="table-row password-row">
      <span style={{ display: 'flex', gap: '0.7rem', alignItems: 'center' }}>
        <RowFavicon item={item} />
        <span>
          <strong>{item.title}</strong>
          {item.url && <small>{item.url}</small>}
        </span>
      </span>
      <span><Badge tone="neutral">{vaultItemTypeLabels[item.type]}</Badge></span>
      <span>{folder?.name ?? '—'}</span>
      <span>{isOwner ? 'You' : 'Shared'}</span>
      <span>
        {canManageAccess ? (
          <button className="mini-button access-count-button" onClick={onViewAccess} title="View shared users">
            <Users size={14} /> {item.shareCount ?? 0}
          </button>
        ) : (
          <Badge tone={item.permission === 'use_only' ? 'warning' : 'neutral'}>{permissionShortLabels[item.permission]}</Badge>
        )}
      </span>
      <span>{new Date(item.updatedAt).toLocaleDateString()}</span>
      <span className="row-actions-cell">
        {!isTrash && item.type !== 'secure_note' && (
          <>
            <button className="icon-button" title="Copy username" onClick={() => copyField('username')}>
              {copyState === 'username' ? <ClipboardCheck size={16} /> : <Clipboard size={16} />}
            </button>
            <button className="icon-button" title={canRevealSecrets ? 'Copy password' : 'One-click login only'} onClick={() => copyField('password')} disabled={!canRevealSecrets}>
              {copyState === 'password' ? <ClipboardCheck size={16} /> : <Copy size={16} />}
            </button>
          </>
        )}
        <button ref={setMoreButton} className="icon-button more-button" onClick={() => setMenuOpen((open) => !open)} aria-label="Open actions menu">
          <MoreHorizontal size={18} />
        </button>
        {menuOpen && moreButton && (
          <RowMenu anchor={moreButton} onClose={() => setMenuOpen(false)}>
            <button onClick={onView}><Eye size={14} /> View</button>
            {isOwner && !isTrash && <button onClick={onEdit}><Edit3 size={14} /> Edit</button>}
            {canManageAccess && !isTrash && <button onClick={onShare}><Share2 size={14} /> Manage Access</button>}
            {isOwner && !isTrash && <button onClick={onHistory}><History size={14} /> History</button>}
            {isOwner && !isTrash && <button onClick={onToggleFavorite}><Tag size={14} /> {item.favorite ? 'Unfavorite' : 'Favorite'}</button>}
            {isOwner && !isTrash && <button onClick={onDelete}><Trash2 size={14} /> Move to Trash</button>}
            {isTrash && <button onClick={onRestore}><Upload size={14} /> Restore</button>}
            {isTrash && <button onClick={onPurge}><Trash2 size={14} /> Purge</button>}
          </RowMenu>
        )}
      </span>
    </div>
  );
}
