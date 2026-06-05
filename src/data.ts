import type { AuditEvent, Role, ShareGrant, TeamMember, VaultItem } from './types';

export const roleLabels: Record<Role, string> = {
  'super-admin': 'Super Admin',
  admin: 'Admin',
  manager: 'Manager',
  user: 'User',
};

export const roleDescriptions: Record<Role, string> = {
  'super-admin': 'Full platform visibility, admin control, security policies, and audit oversight.',
  admin: 'Manage users, invites, status changes, vault ownership transfers, and shared access.',
  manager: 'Manage assigned teams, approve access, and track shared credentials for their group.',
  user: 'Store passwords, unlock vault, use autofill, and share allowed credentials.',
};

export const teamMembers: TeamMember[] = [
  { id: 1, name: 'Aarav Sharma', email: 'aarav@passvault.local', role: 'super-admin', status: 'Active', ownedItems: 18, lastActive: '2 min ago' },
  { id: 2, name: 'Neha Verma', email: 'neha@passvault.local', role: 'admin', status: 'Active', ownedItems: 42, lastActive: '14 min ago' },
  { id: 3, name: 'Kabir Singh', email: 'kabir@passvault.local', role: 'manager', status: 'Active', ownedItems: 21, lastActive: '1 hr ago' },
  { id: 4, name: 'Meera Iyer', email: 'meera@passvault.local', role: 'user', status: 'Invited', ownedItems: 0, lastActive: 'Pending invite' },
  { id: 5, name: 'Rohan Gupta', email: 'rohan@passvault.local', role: 'user', status: 'Inactive', ownedItems: 9, lastActive: '12 days ago' },
];

export const vaultItems: VaultItem[] = [
  { id: 1, title: 'AWS Console', username: 'cloud-admin', url: 'aws.amazon.com', folder: 'Cloud', owner: 'Neha Verma', sharedWith: 4, strength: 'Strong', updatedAt: 'Today' },
  { id: 2, title: 'GitHub Organization', username: 'devops-team', url: 'github.com', folder: 'Engineering', owner: 'Kabir Singh', sharedWith: 8, strength: 'Strong', updatedAt: 'Yesterday' },
  { id: 3, title: 'Stripe Dashboard', username: 'finance@company.com', url: 'dashboard.stripe.com', folder: 'Finance', owner: 'Aarav Sharma', sharedWith: 2, strength: 'Good', updatedAt: '2 days ago' },
  { id: 4, title: 'Staging Database', username: 'readonly_user', url: 'db.internal.local', folder: 'Databases', owner: 'Neha Verma', sharedWith: 3, strength: 'Weak', updatedAt: '5 days ago' },
];

export const shareGrants: ShareGrant[] = [
  { id: 1, item: 'AWS Console', recipient: 'Cloud Team', permission: 'Use only', expires: 'Never', source: 'Extension' },
  { id: 2, item: 'GitHub Organization', recipient: 'Engineering Managers', permission: 'Manage', expires: '30 days', source: 'Web app' },
  { id: 3, item: 'Stripe Dashboard', recipient: 'Meera Iyer', permission: 'View', expires: '7 days', source: 'Extension' },
];

export const auditEvents: AuditEvent[] = [
  { id: 1, actor: 'Neha Verma', action: 'Shared credential', target: 'AWS Console', time: '5 min ago', risk: 'Medium' },
  { id: 2, actor: 'Aarav Sharma', action: 'Invited user', target: 'Meera Iyer', time: '32 min ago', risk: 'Low' },
  { id: 3, actor: 'System', action: 'Detected weak password', target: 'Staging Database', time: '1 hr ago', risk: 'High' },
  { id: 4, actor: 'Kabir Singh', action: 'Revoked access', target: 'GitHub Organization', time: '3 hrs ago', risk: 'Medium' },
];
