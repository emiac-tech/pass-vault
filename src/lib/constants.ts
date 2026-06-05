import {
  Activity, BarChart3, Database, FileKey, Folder, Globe, KeyRound, LayoutDashboard,
  Server, Settings, Smartphone, StickyNote, Users,
} from 'lucide-react';
import type { ApiUser, ApiVaultItem } from '../api/passVaultApi';
import type { Role, VaultItemType } from '../types';
import type { Panel } from './appTypes';

// ============================================================================
// Shared UI constants
// ============================================================================

export const panels: Array<{ id: Panel; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'passwords', label: 'Passwords', icon: KeyRound },
  { id: 'folders', label: 'Folders', icon: Folder },
  { id: 'users', label: 'Users', icon: Users },
  { id: 'audit', label: 'Audit', icon: Activity },
  { id: 'reports', label: 'Reports', icon: BarChart3 },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export const itemIcons: Record<VaultItemType, typeof Globe> = {
  website_login: Globe,
  app_login: Smartphone,
  server_ssh: Server,
  database: Database,
  secure_note: StickyNote,
  api_key: FileKey,
};

export const roleLabels: Record<Role, string> = {
  'super-admin': 'Super Admin',
  admin: 'Admin',
  manager: 'Manager',
  user: 'User',
};

export const permissionLabels: Record<ApiVaultItem['permission'], string> = {
  use_only: 'One-click login only',
  view: 'View password',
  edit: 'View + edit',
  manage: 'Manage access',
};

// Compact labels for the cramped Passwords-table "Access" cell (the full labels
// wrap into a circle when the column is narrow on smaller screens).
export const permissionShortLabels: Record<ApiVaultItem['permission'], string> = {
  use_only: 'Use only',
  view: 'View',
  edit: 'Edit',
  manage: 'Manage',
};

export const permissionDescriptions: Record<ApiVaultItem['permission'], string> = {
  use_only: 'Recipient can launch/autofill from the extension but cannot view the raw password.',
  view: 'Recipient can reveal and copy the credential.',
  edit: 'Recipient can view and update the credential.',
  manage: 'Recipient can view, update, re-share, and revoke access.',
};

export function toDashboardRole(role: ApiUser['role']): Role {
  return ({ super_admin: 'super-admin', admin: 'admin', manager: 'manager', user: 'user' } as const)[role];
}
