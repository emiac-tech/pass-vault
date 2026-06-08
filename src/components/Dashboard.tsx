import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, LockKeyhole, Plus, ShieldAlert, ShieldCheck } from 'lucide-react';
import {
  passVaultApi,
  type ApiDirectoryUser, type ApiFolder, type ApiTag, type ApiUser, type ApiVaultItem,
  type DashboardMetrics,
} from '../api/passVaultApi';
import type { AuthSession, Panel, Scope, VaultContext } from '../lib/appTypes';
import { panels, roleLabels, toDashboardRole } from '../lib/constants';
import { downloadFile } from '../lib/files';
import { exportVaultJson, getItemKey, wrapItemKeyForRecovery } from '../lib/vaultHelpers';
import { unwrapOrgPrivateKey, wrapItemKey, wrapOrgPrivateKeyForAdmin } from '../crypto/vaultCrypto';
import type { VaultItemType } from '../types';
import { ThemeToggle } from './ui/ThemeToggle';
import { OverviewPanel } from './panels/OverviewPanel';
import { PasswordsPanel } from './panels/PasswordsPanel';
import { FoldersPanel } from './panels/FoldersPanel';
import { UsersTable } from './panels/UsersTable';
import { UserPasswordStats, type UserStatRow } from './panels/UserPasswordStats';
import { AuditPanel } from './panels/AuditPanel';
import { ReportsPanel } from './panels/ReportsPanel';
import { SettingsPanel } from './panels/SettingsPanel';
import { VaultItemModal } from './modals/VaultItemModal';
import { ShareModal } from './modals/ShareModal';
import { AccessListModal } from './modals/AccessListModal';
import { InviteUserModal } from './modals/InviteUserModal';
import { CreateUserModal } from './modals/CreateUserModal';
import { FolderModal } from './modals/FolderModal';
import { TransferDeleteModal } from './modals/TransferDeleteModal';
import { HistoryModal } from './modals/HistoryModal';
import { ImportModal } from './modals/ImportModal';

export function Dashboard({
  session, vault, onLogout, onUserUpdate, initialShareItemId = null,
}: {
  session: AuthSession;
  vault: { masterKey: CryptoKey; privateKey: CryptoKey | null };
  onLogout: () => void;
  onUserUpdate: (user: ApiUser) => void;
  initialShareItemId?: string | null;
}) {
  const currentRole = toDashboardRole(session.user.role);
  const [activePanel, setActivePanel] = useState<Panel>('dashboard');
  const [scope, setScope] = useState<Scope>('mine');
  const [query, setQuery] = useState('');

  const [items, setItems] = useState<ApiVaultItem[]>([]);
  const [folders, setFolders] = useState<ApiFolder[]>([]);
  const [tags, setTags] = useState<ApiTag[]>([]);
  const [directory, setDirectory] = useState<ApiDirectoryUser[]>([]);
  const [users, setUsers] = useState<Array<ApiUser & { lastActiveAt?: string }>>([]);
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [teamMetrics, setTeamMetrics] = useState<{ totalUsers: number; totalItems: number; activeShares: number; auditEventsToday: number } | null>(null);
  const [userStats, setUserStats] = useState<UserStatRow[]>([]);
  const [orgRecoveryPublicKey, setOrgRecoveryPublicKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ tone: 'success' | 'danger' | 'info'; message: string } | null>(null);

  // Modal state
  const [itemModal, setItemModal] = useState<{ mode: 'create' | 'edit' | 'view'; item: ApiVaultItem | null; type?: VaultItemType } | null>(null);
  const [shareModal, setShareModal] = useState<ApiVaultItem | null>(null);
  const [accessListModal, setAccessListModal] = useState<ApiVaultItem | null>(null);
  const [inviteModal, setInviteModal] = useState(false);
  const [createUserModal, setCreateUserModal] = useState(false);
  const [folderModal, setFolderModal] = useState<{ mode: 'create' | 'rename'; folder?: ApiFolder } | null>(null);
  const [transferTarget, setTransferTarget] = useState<{ user: ApiUser & { lastActiveAt?: string } } | null>(null);
  const [historyItem, setHistoryItem] = useState<ApiVaultItem | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  // Filter state
  const [filter, setFilter] = useState<'all' | 'favorites' | 'shared-by-me' | 'shared-with-me' | 'trash'>('all');
  const [folderFilter, setFolderFilter] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<VaultItemType | null>(null);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    try {
      const includeTrash = filter === 'trash';
      const [itemsR, foldersR, tagsR, dirR, metricsR, recoveryR] = await Promise.all([
        passVaultApi.listVaultItems(includeTrash),
        passVaultApi.listFolders(),
        passVaultApi.listTags(),
        passVaultApi.directory().catch(() => ({ users: [] })),
        passVaultApi.dashboardMetrics().catch(() => null),
        passVaultApi.recoveryPublicKey().catch(() => ({ publicKey: null })),
      ]);
      setItems(itemsR.items);
      setFolders(foldersR.folders);
      setTags(tagsR.tags);
      setDirectory(dirR.users);
      setMetrics(metricsR);
      setOrgRecoveryPublicKey(recoveryR.publicKey);
      if (currentRole !== 'user') {
        try {
          const usersR = await passVaultApi.listUsers();
          setUsers(usersR.users);
        } catch { /* ignore */ }
        try {
          setTeamMetrics(await passVaultApi.teamMetrics());
        } catch { /* ignore */ }
        try {
          setUserStats((await passVaultApi.userStats()).stats);
        } catch { /* ignore */ }
      }
    } catch (err) {
      setToast({ tone: 'danger', message: err instanceof Error ? err.message : 'Failed to load vault' });
    } finally {
      setLoading(false);
    }
  }, [currentRole, filter]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { refreshAll(); }, [refreshAll]);

  useEffect(() => {
    if (!toast) return;
    const handle = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(handle);
  }, [toast]);

  // Org-recovery self-heal: (a) add a recovery copy for owned items that lack one,
  // (b) after a transfer, re-wrap RSA-wrapped owner copies back to the master key
  // (owner_key_wrap='rsa' -> 'master'). Idempotent; runs whenever items change.
  const healingRef = useRef(false);
  useEffect(() => {
    if (healingRef.current) return;
    const owned = items.filter((i) => i.ownerId === session.user.id && !i.deletedAt);
    const needBackfill = orgRecoveryPublicKey ? owned.filter((i) => !i.recoveryWrappedItemKey) : [];
    const needRekey = owned.filter((i) => i.ownerKeyWrap === 'rsa');
    if (needBackfill.length === 0 && needRekey.length === 0) return;
    healingRef.current = true;
    (async () => {
      const healCtx: VaultContext = {
        user: session.user, masterKey: vault.masterKey, privateKey: vault.privateKey,
        orgRecoveryPublicKey, refresh: refreshAll,
      };
      try {
        if (needBackfill.length) {
          const entries: Array<{ itemId: string; recoveryWrappedItemKey: string }> = [];
          for (const item of needBackfill) {
            try {
              const itemKey = await getItemKey(item, healCtx);
              const rec = await wrapItemKeyForRecovery(itemKey, healCtx);
              if (rec) entries.push({ itemId: item.id, recoveryWrappedItemKey: rec });
            } catch { /* skip items we can't unwrap */ }
          }
          if (entries.length) await passVaultApi.recoveryBackfill(entries);
        }
        if (needRekey.length) {
          const entries: Array<{ itemId: string; ownerEncryptedItemKey: string; ownerItemKeyIv: string }> = [];
          for (const item of needRekey) {
            try {
              const itemKey = await getItemKey(item, healCtx);
              const wrapped = await wrapItemKey(itemKey, vault.masterKey);
              entries.push({ itemId: item.id, ownerEncryptedItemKey: wrapped.encryptedItemKey, ownerItemKeyIv: wrapped.itemKeyIv });
            } catch { /* skip */ }
          }
          if (entries.length) await passVaultApi.rekeyOwner(entries);
        }
        await refreshAll();
      } catch { /* self-heal is best-effort */ } finally {
        healingRef.current = false;
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, orgRecoveryPublicKey]);

  const showToast = (tone: 'success' | 'danger' | 'info', message: string) => setToast({ tone, message });

  // Deep link (#/share/:id from the extension): once the vault has loaded, open
  // the Manage Access modal for the target item, then clear the hash.
  const shareDeepLinkHandled = useRef(false);
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!initialShareItemId || shareDeepLinkHandled.current || loading) return;
    shareDeepLinkHandled.current = true;
    const target = items.find((item) => item.id === initialShareItemId);
    if (!target) {
      showToast('danger', 'That item was not found in your vault, or you do not have access to it.');
    } else if (target.ownerId !== session.user.id && target.permission !== 'manage') {
      showToast('danger', 'You do not have permission to manage sharing for this item.');
    } else {
      setActivePanel('passwords');
      setShareModal(target);
    }
    if (window.location.hash.startsWith('#/share/')) window.location.hash = '';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialShareItemId, items, loading]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Derived filtered items
  const filteredItems = useMemo(() => {
    const q = query.toLowerCase();
    return items.filter((item) => {
      if (filter === 'favorites' && !item.favorite) return false;
      if (filter === 'shared-by-me' && (item.ownerId !== session.user.id || (item.shareCount ?? 0) === 0)) return false;
      if (filter === 'shared-with-me' && item.ownerId === session.user.id) return false;
      if (filter === 'trash' && !item.deletedAt) return false;
      if (filter !== 'trash' && item.deletedAt) return false;
      if (folderFilter && item.folderId !== folderFilter) return false;
      if (tagFilter && !(item.tagIds ?? []).includes(tagFilter)) return false;
      if (typeFilter && item.type !== typeFilter) return false;
      if (q && !item.title.toLowerCase().includes(q) && !(item.url ?? '').toLowerCase().includes(q)) return false;
      return true;
    });
  }, [items, filter, folderFilter, tagFilter, typeFilter, query, session.user.id]);

  // Counts shown on the Passwords subnav filters (computed from the full list).
  const filterCounts = useMemo(() => {
    const live = items.filter((i) => !i.deletedAt);
    return {
      all: live.length,
      favorites: live.filter((i) => i.favorite).length,
      'shared-by-me': live.filter((i) => i.ownerId === session.user.id && (i.shareCount ?? 0) > 0).length,
      'shared-with-me': live.filter((i) => i.ownerId !== session.user.id).length,
    };
  }, [items, session.user.id]);

  const canManageUsers = currentRole !== 'user';

  // Change a user's role; when promoting to super-admin, also grant them the org
  // recovery key (best-effort — needs recovery configured + our private key).
  const handleChangeRole = useCallback(async (u: ApiUser, role: 'super_admin' | 'admin' | 'manager' | 'user') => {
    await passVaultApi.updateUserRole(u.id, role);
    if (role === 'super_admin') {
      try {
        const [{ grant }, { users: recUsers }] = await Promise.all([
          passVaultApi.recoveryGrant(),
          passVaultApi.recoveryUsers(),
        ]);
        const targetUser = recUsers.find((x) => x.id === u.id);
        if (grant && targetUser?.publicKey && vault.privateKey) {
          const orgPrivateKey = await unwrapOrgPrivateKey(grant, vault.privateKey);
          const wrapped = await wrapOrgPrivateKeyForAdmin(orgPrivateKey, targetUser.publicKey);
          await passVaultApi.recoveryGrantTo({ userId: u.id, ...wrapped });
        }
      } catch { /* recovery may be unconfigured; safe to ignore */ }
    }
    showToast('success', `Role changed to ${role}.`);
    refreshAll();
  }, [vault.privateKey, refreshAll]);

  const ctx: VaultContext = { user: session.user, masterKey: vault.masterKey, privateKey: vault.privateKey, orgRecoveryPublicKey, refresh: refreshAll };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-card">
          <div className="brand-icon"><LockKeyhole size={26} /></div>
          <div><p className="eyebrow">Secure Workforce Vault</p><h1>Pass Vault</h1></div>
        </div>
        <div className="current-role-card">
          <div className="signed-in-avatar">{(session.user.name || session.user.email || '?').charAt(0).toUpperCase()}</div>
          <div className="signed-in-meta">
            <p className="eyebrow">Signed in as</p>
            <strong>{session.user.name || 'Pass Vault user'}</strong>
            <span>{session.user.email}</span>
            <span className="role-pill">{roleLabels[currentRole]}</span>
          </div>
        </div>
        <nav className="nav-list">
          {panels.filter((panel) => panel.id !== 'users' || canManageUsers).map((panel) => {
            const Icon = panel.icon;
            return (
              <button
                className={panel.id === activePanel ? 'nav-item active' : 'nav-item'}
                key={panel.id}
                onClick={() => setActivePanel(panel.id)}
                aria-current={panel.id === activePanel ? 'page' : undefined}
              >
                <Icon size={18} />
                {panel.label}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          <span className="sidebar-footer-label">Appearance</span>
          <ThemeToggle />
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div>
            <p className="eyebrow">{roleLabels[currentRole]} Workspace</p>
            <h2>{({
              dashboard: 'Dashboard',
              passwords: 'Passwords',
              folders: 'Folders',
              users: 'Users',
              audit: 'Activity Trail',
              reports: 'Reports & Security',
              settings: 'Settings',
            } as const)[activePanel]}</h2>
          </div>
          <div className="topbar-actions">
            <div className="user-chip"><span>{session.user.name}</span><small>{session.user.email}</small></div>
            <button className="primary-button" onClick={() => setItemModal({ mode: 'create', item: null, type: 'website_login' })}><Plus size={17} /> Add Credential</button>
            <button className="ghost-button" onClick={onLogout}>Logout</button>
          </div>
        </header>

        {loading && <p className="muted">Loading vault…</p>}

        {activePanel === 'dashboard' && (
          <OverviewPanel
            role={currentRole}
            scope={scope}
            setScope={setScope}
            metrics={metrics}
            teamMetrics={teamMetrics}
            items={items}
            users={users}
            ctx={ctx}
            onNavigate={(panel, opts) => {
              if (opts?.filter) {
                setScope('mine');
                setFilter(opts.filter);
                setFolderFilter(null);
                setTagFilter(null);
                setTypeFilter(null);
              }
              setActivePanel(panel);
            }}
          />
        )}

        {activePanel === 'passwords' && (
          <PasswordsPanel
            items={filteredItems}
            counts={filterCounts}
            folders={folders}
            tags={tags}
            filter={filter}
            setFilter={setFilter}
            folderFilter={folderFilter}
            setFolderFilter={setFolderFilter}
            tagFilter={tagFilter}
            setTagFilter={setTagFilter}
            typeFilter={typeFilter}
            setTypeFilter={setTypeFilter}
            query={query}
            setQuery={setQuery}
            onCreate={(type) => setItemModal({ mode: 'create', item: null, type })}
            onEdit={(item) => setItemModal({ mode: 'edit', item })}
            onView={(item) => setItemModal({ mode: 'view', item })}
            onShare={(item) => setShareModal(item)}
            onViewAccess={(item) => setAccessListModal(item)}
            onHistory={(item) => setHistoryItem(item)}
            onDelete={async (item) => {
              if (!confirm(`Move "${item.title}" to trash?`)) return;
              await passVaultApi.deleteVaultItem(item.id);
              showToast('success', 'Item moved to trash.');
              refreshAll();
            }}
            onRestore={async (item) => {
              await passVaultApi.restoreVaultItem(item.id);
              showToast('success', 'Item restored.');
              refreshAll();
            }}
            onPurge={async (item) => {
              if (!confirm(`Permanently delete "${item.title}"? This cannot be undone.`)) return;
              await passVaultApi.purgeVaultItem(item.id);
              showToast('success', 'Item permanently deleted.');
              refreshAll();
            }}
            onToggleFavorite={async (item) => {
              await passVaultApi.updateVaultItem(item.id, { favorite: !item.favorite });
              refreshAll();
            }}
            onImport={() => setImportOpen(true)}
            onExport={async () => {
              const exported = await exportVaultJson(items, vault.masterKey);
              downloadFile('pass-vault-export.json', exported, 'application/json');
              showToast('success', 'Encrypted export downloaded.');
            }}
            ctx={ctx}
          />
        )}

        {activePanel === 'folders' && (
          <FoldersPanel
            folders={folders}
            tags={tags}
            onCreate={() => setFolderModal({ mode: 'create' })}
            onRename={(folder) => setFolderModal({ mode: 'rename', folder })}
            onDelete={async (folder) => {
              if (!confirm(`Delete folder "${folder.name}"? Items inside become unfiled.`)) return;
              await passVaultApi.deleteFolder(folder.id);
              showToast('success', 'Folder deleted.');
              refreshAll();
            }}
            onCreateTag={async (name) => {
              await passVaultApi.createTag(name);
              refreshAll();
            }}
            onDeleteTag={async (tag) => {
              if (!confirm(`Delete tag "${tag.name}"?`)) return;
              await passVaultApi.deleteTag(tag.id);
              refreshAll();
            }}
          />
        )}

        {activePanel === 'users' && canManageUsers && (
          <UsersTable
            users={users}
            currentUser={session.user}
            currentRole={currentRole}
            onInvite={() => setInviteModal(true)}
            onCreate={() => setCreateUserModal(true)}
            onActivate={async (u) => {
              await passVaultApi.updateUserStatus(u.id, u.status === 'inactive' ? 'active' : 'inactive');
              showToast('success', 'User status updated.');
              refreshAll();
            }}
            onDelete={(user) => setTransferTarget({ user })}
            onChangeRole={handleChangeRole}
          />
        )}

        {activePanel === 'audit' && <AuditPanel canExport={currentRole === 'super-admin' || currentRole === 'admin'} />}
        {activePanel === 'reports' && <ReportsPanel items={items} ctx={ctx} />}
        {activePanel === 'settings' && <SettingsPanel ctx={ctx} onUserUpdate={onUserUpdate} onLogout={onLogout} items={items} />}

        {canManageUsers && activePanel === 'dashboard' && scope === 'team' && users.length > 0 && (
          <UsersTable
            users={users}
            currentUser={session.user}
            currentRole={currentRole}
            onInvite={() => setInviteModal(true)}
            onCreate={() => setCreateUserModal(true)}
            onActivate={async (u) => {
              await passVaultApi.updateUserStatus(u.id, u.status === 'inactive' ? 'active' : 'inactive');
              showToast('success', 'User status updated.');
              refreshAll();
            }}
            onDelete={(user) => setTransferTarget({ user })}
            onChangeRole={handleChangeRole}
          />
        )}

        {canManageUsers && activePanel === 'dashboard' && scope === 'team' && (
          <UserPasswordStats stats={userStats} />
        )}
      </main>

      {toast && (
        <div className={`toast ${toast.tone}`}>
          {toast.tone === 'success' ? <Check size={16} /> : toast.tone === 'danger' ? <ShieldAlert size={16} /> : <ShieldCheck size={16} />}
          <span>{toast.message}</span>
        </div>
      )}

      {itemModal && (
        <VaultItemModal
          mode={itemModal.mode}
          item={itemModal.item}
          initialType={itemModal.type}
          folders={folders}
          tags={tags}
          ctx={ctx}
          onClose={() => setItemModal(null)}
          onSaved={(message) => { showToast('success', message); refreshAll(); }}
        />
      )}

      {shareModal && (
        <ShareModal
          item={shareModal}
          ctx={ctx}
          directory={directory.filter((u) => u.id !== session.user.id)}
          onClose={() => setShareModal(null)}
          onShared={() => { showToast('success', 'Share created.'); refreshAll(); }}
        />
      )}

      {accessListModal && (
        <AccessListModal
          item={accessListModal}
          onClose={() => setAccessListModal(null)}
        />
      )}

      {inviteModal && (
        <InviteUserModal
          onClose={() => setInviteModal(false)}
          onInvited={(link) => {
            showToast('success', `Invite created. Share link: ${link}`);
            setInviteModal(false);
            refreshAll();
          }}
        />
      )}

      {createUserModal && (
        <CreateUserModal
          onClose={() => setCreateUserModal(false)}
          onCreated={(email) => {
            showToast('success', `User ${email} created.`);
            setCreateUserModal(false);
            refreshAll();
          }}
        />
      )}

      {folderModal && (
        <FolderModal
          folder={folderModal.folder}
          onClose={() => setFolderModal(null)}
          onSaved={() => { showToast('success', 'Folder saved.'); setFolderModal(null); refreshAll(); }}
        />
      )}

      {transferTarget && (
        <TransferDeleteModal
          target={transferTarget.user}
          candidates={users.filter((u) => u.id !== transferTarget.user.id)}
          ctx={ctx}
          onClose={() => setTransferTarget(null)}
          onDeleted={(result) => {
            const warn = result.unrecoverableItemCount > 0
              ? ` (${result.unrecoverableItemCount} could not be made readable — no recovery copy)`
              : '';
            showToast(result.unrecoverableItemCount > 0 ? 'info' : 'success',
              `User deleted; ${result.securedItemCount}/${result.transferredItemCount} items transferred securely${warn}.`);
            setTransferTarget(null);
            refreshAll();
          }}
        />
      )}

      {historyItem && (
        <HistoryModal item={historyItem} ctx={ctx} onClose={() => setHistoryItem(null)} />
      )}

      {importOpen && (
        <ImportModal
          folders={folders}
          ctx={ctx}
          onClose={() => setImportOpen(false)}
          onImported={(count) => { showToast('success', `Imported ${count} items.`); setImportOpen(false); refreshAll(); }}
        />
      )}
    </div>
  );
}
