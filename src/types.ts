export type Role = 'super-admin' | 'admin' | 'manager' | 'user';
export type Permission = 'Use only' | 'View' | 'Edit' | 'Manage';
export type UserStatus = 'Active' | 'Inactive' | 'Invited';

export type VaultItemType = 'website_login' | 'app_login' | 'server_ssh' | 'database' | 'secure_note' | 'api_key';

export const vaultItemTypeLabels: Record<VaultItemType, string> = {
  website_login: 'Website Login',
  app_login: 'App Login',
  server_ssh: 'SSH Key',
  database: 'Database',
  secure_note: 'Secure Note',
  api_key: 'API Key',
};

export interface TeamMember {
  id: number;
  name: string;
  email: string;
  role: Role;
  status: UserStatus;
  ownedItems: number;
  lastActive: string;
}

export interface VaultItem {
  id: number;
  title: string;
  username: string;
  url: string;
  folder: string;
  owner: string;
  sharedWith: number;
  strength: 'Weak' | 'Good' | 'Strong';
  updatedAt: string;
}

export interface ShareGrant {
  id: number;
  item: string;
  recipient: string;
  permission: Permission;
  expires: string;
  source: 'Web app' | 'Extension';
}

export interface AuditEvent {
  id: number;
  actor: string;
  action: string;
  target: string;
  time: string;
  risk: 'Low' | 'Medium' | 'High';
}
