import { useMemo, useState } from 'react';
import {
  Ban, Check, ChevronDown, MailPlus, Search, Shield, ShieldCheck, Trash2, User, UserCog, UserPlus, Users,
} from 'lucide-react';
import type { ApiUser } from '../../api/passVaultApi';
import { roleLabels, toDashboardRole } from '../../lib/constants';
import type { Role } from '../../types';
import { Badge } from '../ui/Badge';
import { RowMenu } from '../ui/RowMenu';

type BackendRole = 'super_admin' | 'admin' | 'manager' | 'user';

const roleOptions: Array<{ value: BackendRole; label: string; icon: typeof Shield }> = [
  { value: 'super_admin', label: 'Super Admin', icon: ShieldCheck },
  { value: 'admin', label: 'Admin', icon: Shield },
  { value: 'manager', label: 'Manager', icon: UserCog },
  { value: 'user', label: 'User', icon: User },
];

export function UsersTable({
  users, currentUser, currentRole, onInvite, onCreate, onActivate, onDelete, onChangeRole,
}: {
  users: Array<ApiUser & { lastActiveAt?: string }>;
  currentUser: ApiUser;
  currentRole: Role;
  onInvite: () => void;
  onCreate: () => void;
  onActivate: (user: ApiUser) => void;
  onDelete: (user: ApiUser) => void;
  onChangeRole: (user: ApiUser, role: BackendRole) => void;
}) {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive' | 'invited'>('all');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users.filter((user) => {
      if (statusFilter !== 'all' && user.status !== statusFilter) return false;
      if (!q) return true;
      return (
        user.name.toLowerCase().includes(q) ||
        user.email.toLowerCase().includes(q) ||
        roleLabels[toDashboardRole(user.role)].toLowerCase().includes(q)
      );
    });
  }, [users, query, statusFilter]);

  return (
    <section className="panel-card users-panel" style={{ marginTop: '1.5rem' }}>
      <div className="panel-toolbar">
        <div><p className="eyebrow">Admin Control</p><h3>User Management</h3></div>
        <div className="toolbar-actions">
          <label className="search-box compact">
            <Search size={16} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, email, or role…"
            />
          </label>
          <select
            className="text-input compact"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="invited">Invited</option>
          </select>
          <button className="ghost-button" onClick={onCreate}><UserPlus size={16} /> Create User</button>
          <button className="primary-button" onClick={onInvite}><MailPlus size={16} /> Invite User</button>
        </div>
      </div>

      <div className="users-table-meta">
        <span>{filtered.length} {filtered.length === 1 ? 'user' : 'users'}{query || statusFilter !== 'all' ? ` (filtered from ${users.length})` : ''}</span>
      </div>

      <div className="table-card users-table">
        <div className="table-row table-head">
          <span>User</span>
          <span>Role</span>
          <span>Status</span>
          <span>Last Active</span>
          <span style={{ textAlign: 'right' }}>Actions</span>
        </div>
        <div className="users-table-body">
          {filtered.map((user) => (
            <div className="table-row" key={user.id}>
              <span style={{ display: 'flex', gap: '0.7rem', alignItems: 'center' }}>
                <span className="user-avatar">{(user.name || user.email || '?').charAt(0).toUpperCase()}</span>
                <span style={{ minWidth: 0 }}>
                  <strong>{user.name}</strong>
                  <small>{user.email}</small>
                </span>
              </span>
              <span>{roleLabels[toDashboardRole(user.role)]}</span>
              <span><Badge tone={user.status === 'active' ? 'success' : user.status === 'inactive' ? 'danger' : 'warning'}>{user.status}</Badge></span>
              <span>{user.lastActiveAt ? new Date(user.lastActiveAt).toLocaleString() : 'Never'}</span>
              <span className="action-cluster" style={{ justifyContent: 'flex-end' }}>
                <UserActionsCell
                  user={user}
                  isSelf={user.id === currentUser.id}
                  currentRole={currentRole}
                  onActivate={onActivate}
                  onDelete={onDelete}
                  onChangeRole={onChangeRole}
                />
              </span>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="empty-card" style={{ padding: '2rem 1rem' }}>
              <Users size={28} />
              <strong>No users match</strong>
              <p className="muted">Try a different search term or change the status filter.</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function UserActionsCell({
  user, isSelf, currentRole, onActivate, onDelete, onChangeRole,
}: {
  user: ApiUser & { lastActiveAt?: string };
  isSelf: boolean;
  currentRole: Role;
  onActivate: (user: ApiUser) => void;
  onDelete: (user: ApiUser) => void;
  onChangeRole: (user: ApiUser, role: BackendRole) => void;
}) {
  const [open, setOpen] = useState(false);
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null);

  if (isSelf) {
    return <span className="muted" style={{ fontSize: '0.78rem', margin: 0 }}>That's you</span>;
  }

  const canManageStatus = currentRole === 'super-admin' || currentRole === 'admin';
  const canManageRole = currentRole === 'super-admin';
  const canDelete = currentRole === 'super-admin' || currentRole === 'admin';

  if (!canManageStatus && !canManageRole && !canDelete) {
    return <span className="muted" style={{ fontSize: '0.78rem', margin: 0 }}>View only</span>;
  }

  const isActive = user.status === 'active';

  return (
    <>
      <button ref={setTrigger} className="mini-button" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
        Actions <ChevronDown size={14} />
      </button>
      {open && trigger && (
        <RowMenu anchor={trigger} onClose={() => setOpen(false)}>
          {canManageStatus && (
            isActive
              ? <button onClick={() => onActivate(user)}><Ban size={14} /> Revoke</button>
              : <button onClick={() => onActivate(user)}><Check size={14} /> Activate</button>
          )}
          {canManageRole && roleOptions
            .filter((option) => option.value !== user.role)
            .map((option) => {
              const Icon = option.icon;
              return (
                <button key={option.value} onClick={() => onChangeRole(user, option.value)}>
                  <Icon size={14} /> {option.label}
                </button>
              );
            })}
          {canDelete && <button onClick={() => onDelete(user)}><Trash2 size={14} /> Delete</button>}
        </RowMenu>
      )}
    </>
  );
}
