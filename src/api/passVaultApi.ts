import type { EncryptedPayload, WrappedItemKey } from '../crypto/vaultCrypto';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:4000/api';

export interface ApiUser {
  id: string;
  name: string;
  email: string;
  role: 'super_admin' | 'admin' | 'manager' | 'user';
  status: 'active' | 'inactive' | 'invited';
  masterKeySalt?: string;
  publicKey?: string;
  encryptedPrivateKey?: string;
  privateKeyIv?: string;
  totpEnabled?: boolean;
}

export interface ApiDirectoryUser {
  id: string;
  name: string;
  email: string;
  publicKey: string | null;
  keyReady?: boolean;
}

export interface ApiVaultItem extends EncryptedPayload {
  id: string;
  title: string;
  url?: string;
  type: 'website_login' | 'app_login' | 'server_ssh' | 'database' | 'secure_note' | 'api_key';
  ownerId: string;
  folderId?: string | null;
  permission: 'use_only' | 'view' | 'edit' | 'manage';
  encryptedItemKey: string;
  itemKeyIv: string;
  recoveryWrappedItemKey?: string | null;
  ownerKeyWrap?: 'master' | 'rsa';
  favorite: boolean;
  shareCount?: number;
  notesPreview?: string | null;
  tagIds?: string[];
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface ApiFolder {
  id: string;
  name: string;
  itemCount: number;
  createdAt: string;
}

export interface ApiTag {
  id: string;
  name: string;
  color: string;
  usage_count?: number;
}

export interface ApiShare {
  id: string;
  vault_item_id: string;
  permission: 'use_only' | 'view' | 'edit' | 'manage';
  recipient_user_id: string | null;
  recipient_user_name: string | null;
  recipient_team_id: string | null;
  recipient_team_name: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface ApiAuditEvent {
  id: string;
  action: string;
  target_type: string;
  target_id: string | null;
  risk: 'low' | 'medium' | 'high';
  metadata: Record<string, unknown>;
  created_at: string;
  actor_name: string | null;
  actor_email: string | null;
}

export interface ApiSession {
  id: string;
  user_agent: string | null;
  ip_address: string | null;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
}

export interface ApiExtensionDevice {
  id: string;
  name: string;
  browser: string;
  last_seen_at: string | null;
  created_at: string;
  revoked_at: string | null;
}

export interface DashboardMetrics {
  passwords: number;
  folders: number;
  sharedByMe: number;
  sharedWithMe: number;
  expired: number;
  auditCount: number;
  totalItems: number;
  byType: Array<{ type: string; count: number }>;
  activity: Array<{ day: string; count: number }>;
}

export interface CreateVaultItemInput extends EncryptedPayload {
  title: string;
  url?: string;
  type?: ApiVaultItem['type'];
  folderId?: string | null;
  ownerEncryptedItemKey: string;
  ownerItemKeyIv: string;
  recoveryWrappedItemKey?: string;
  tagIds?: string[];
  notesPreview?: string;
}

export interface UpdateVaultItemInput extends Partial<EncryptedPayload> {
  title?: string;
  url?: string;
  type?: ApiVaultItem['type'];
  folderId?: string | null;
  ownerEncryptedItemKey?: string;
  ownerItemKeyIv?: string;
  recoveryWrappedItemKey?: string;
  favorite?: boolean;
  tagIds?: string[];
  notesPreview?: string;
}

export interface CreateShareInput extends WrappedItemKey {
  recipientUserId?: string;
  recipientTeamId?: string;
  permission: ApiVaultItem['permission'];
  expiresAt?: string;
}

export class PassVaultApi {
  private token?: string;

  constructor(token?: string) {
    this.token = token;
  }

  setToken(token?: string) {
    this.token = token;
  }

  // ---- auth ----
  bootstrapStatus() {
    return this.request<{ hasUsers: boolean }>('/auth/bootstrap-status');
  }

  registerFirstAdmin(input: {
    name: string;
    email: string;
    password: string;
    masterKeySalt: string;
    publicKey?: string;
    encryptedPrivateKey?: string;
    privateKeyIv?: string;
  }) {
    return this.request<{ user: ApiUser; token: string }>('/auth/register-first-admin', {
      method: 'POST',
      body: input,
    });
  }

  login(email: string, password: string, totpCode?: string) {
    return this.request<{ user: ApiUser; token: string }>('/auth/login', {
      method: 'POST',
      body: { email, password, totpCode },
    });
  }

  me() {
    return this.request<{ user: ApiUser }>('/auth/me');
  }

  getInvite(token: string) {
    return this.request<{ invitation: { id: string; email: string; role: string; expires_at: string } }>(`/auth/invite/${encodeURIComponent(token)}`);
  }

  acceptInvite(input: {
    token: string;
    name: string;
    password: string;
    publicKey: string;
    encryptedPrivateKey: string;
    privateKeyIv: string;
    masterKeySalt: string;
  }) {
    return this.request<{ user: ApiUser; token: string }>('/auth/accept-invite', {
      method: 'POST',
      body: input,
    });
  }

  changeMasterPassword(input: {
    currentPassword: string;
    newPasswordSalt: string;
    newEncryptedPrivateKey: string;
    newPrivateKeyIv: string;
    rewrappedItemKeys: Array<{ itemId: string; ownerEncryptedItemKey: string; ownerItemKeyIv: string }>;
  }) {
    return this.request<{ updated: true }>('/auth/change-master-password', { method: 'POST', body: input });
  }

  repairKeypair(input: {
    publicKey: string;
    encryptedPrivateKey: string;
    privateKeyIv: string;
  }) {
    return this.request<{ user: ApiUser; revokedShareCount: number }>('/auth/repair-keypair', { method: 'POST', body: input });
  }

  changeAccountPassword(input: { currentPassword: string; newPassword: string }) {
    return this.request<{ updated: true }>('/auth/change-password', { method: 'POST', body: input });
  }

  logout() {
    return this.request<{ loggedOut: true }>('/auth/logout', { method: 'POST' });
  }

  // ---- users ----
  listUsers() {
    return this.request<{ users: Array<ApiUser & { lastActiveAt?: string }> }>('/users');
  }

  directory() {
    return this.request<{ users: ApiDirectoryUser[] }>('/users/directory');
  }

  inviteUser(input: { name?: string; email: string; role?: ApiUser['role']; managerId?: string }) {
    return this.request<{ user: ApiUser; inviteToken: string; inviteUrl: string; emailSent?: boolean; emailError?: string }>('/users/invite', {
      method: 'POST',
      body: input,
    });
  }
  createUser(input: {
    email: string;
    name?: string;
    role: 'admin' | 'manager' | 'user';
    password: string;
    publicKey: string;
    encryptedPrivateKey: string;
    privateKeyIv: string;
    masterKeySalt: string;
  }) {
    return this.request<{ user: ApiUser }>('/users/create', { method: 'POST', body: input });
  }

  updateUserStatus(userId: string, status: 'active' | 'inactive' | 'invited') {
    return this.request<{ user: ApiUser }>(`/users/${userId}/status`, { method: 'PATCH', body: { status } });
  }

  updateUserRole(userId: string, role: 'super_admin' | 'admin' | 'manager' | 'user') {
    return this.request<{ user: ApiUser }>(`/users/${userId}/role`, { method: 'PATCH', body: { role } });
  }

  deleteUser(userId: string, transferToUserId: string, rewrappedItems: Array<{ itemId: string; ownerEncryptedItemKey: string }> = []) {
    return this.request<{ transferredItemCount: number; securedItemCount: number; unrecoverableItemCount: number }>(`/users/${userId}`, {
      method: 'DELETE',
      body: { transferToUserId, rewrappedItems },
    });
  }

  transferUserItems(userId: string, transferToUserId: string, rewrappedItems: Array<{ itemId: string; ownerEncryptedItemKey: string }> = []) {
    return this.request<{ transferredItemCount: number; securedItemCount: number; unrecoverableItemCount: number }>(`/users/${userId}/transfer-items`, {
      method: 'POST',
      body: { transferToUserId, rewrappedItems },
    });
  }

  // ---- organization recovery key ----
  recoveryStatus() {
    return this.request<{ configured: boolean }>('/recovery/status');
  }

  recoveryPublicKey() {
    return this.request<{ publicKey: string | null }>('/recovery/public-key');
  }

  recoveryUsers() {
    return this.request<{ users: Array<{ id: string; name: string; email: string; role: string; publicKey: string }> }>('/recovery/users');
  }

  recoveryGrant() {
    return this.request<{ grant: { encryptedPrivateKey: string; privateKeyIv: string; wrappedDek: string } | null }>('/recovery/grant');
  }

  recoverySetup(body: { publicKey: string; grants: Array<{ userId: string; encryptedPrivateKey: string; privateKeyIv: string; wrappedDek: string }> }) {
    return this.request<{ configured: boolean; grants: number }>('/recovery/setup', { method: 'POST', body });
  }

  recoveryGrantTo(body: { userId: string; encryptedPrivateKey: string; privateKeyIv: string; wrappedDek: string }) {
    return this.request<{ granted: boolean }>('/recovery/grant', { method: 'POST', body });
  }

  recoveryUserItems(userId: string) {
    return this.request<{ items: Array<{ itemId: string; title: string; recoveryWrappedItemKey: string | null }> }>(`/recovery/user/${userId}/items`);
  }

  recoveryBackfill(items: Array<{ itemId: string; recoveryWrappedItemKey: string }>) {
    return this.request<{ updated: number }>('/vault/items/recovery-backfill', { method: 'POST', body: { items } });
  }

  rekeyOwner(items: Array<{ itemId: string; ownerEncryptedItemKey: string; ownerItemKeyIv: string }>) {
    return this.request<{ updated: number }>('/vault/items/rekey-owner', { method: 'POST', body: { items } });
  }

  // ---- vault items ----
  listVaultItems(includeDeleted = false) {
    return this.request<{ items: ApiVaultItem[] }>(`/vault/items${includeDeleted ? '?includeDeleted=true' : ''}`);
  }

  getVaultItem(id: string) {
    return this.request<{ item: ApiVaultItem }>(`/vault/items/${id}`);
  }

  createVaultItem(input: CreateVaultItemInput) {
    return this.request<{ item: ApiVaultItem }>('/vault/items', { method: 'POST', body: input });
  }

  updateVaultItem(id: string, input: UpdateVaultItemInput) {
    return this.request<{ item: ApiVaultItem }>(`/vault/items/${id}`, { method: 'PATCH', body: input });
  }

  deleteVaultItem(id: string) {
    return this.request<{ deleted: true }>(`/vault/items/${id}`, { method: 'DELETE' });
  }

  restoreVaultItem(id: string) {
    return this.request<{ restored: true }>(`/vault/items/${id}/restore`, { method: 'POST' });
  }

  purgeVaultItem(id: string) {
    return this.request<{ purged: true }>(`/vault/items/${id}/permanent`, { method: 'DELETE' });
  }

  getVersions(id: string) {
    return this.request<{ versions: Array<{ id: string; encrypted_payload: Record<string, string>; payload_iv: string; payload_tag: string; created_at: string; actor_name: string | null }> }>(`/vault/items/${id}/versions`);
  }

  // ---- shares ----
  listShares(itemId: string) {
    return this.request<{ shares: ApiShare[] }>(`/vault/items/${itemId}/shares`);
  }

  shareVaultItem(itemId: string, input: CreateShareInput) {
    return this.request<{ share: ApiShare }>(`/vault/items/${itemId}/shares`, {
      method: 'POST',
      body: {
        recipientUserId: input.recipientUserId,
        recipientTeamId: input.recipientTeamId,
        permission: input.permission,
        recipientEncryptedItemKey: input.encryptedItemKey,
        recipientItemKeyIv: input.itemKeyIv,
        expiresAt: input.expiresAt,
      },
    });
  }

  revokeShare(shareId: string) {
    return this.request<{ revoked: true }>(`/vault/shares/${shareId}`, { method: 'DELETE' });
  }

  // ---- folders ----
  listFolders() {
    return this.request<{ folders: ApiFolder[] }>('/folders');
  }
  createFolder(name: string) {
    return this.request<{ folder: ApiFolder }>('/folders', { method: 'POST', body: { name } });
  }
  renameFolder(id: string, name: string) {
    return this.request<{ folder: ApiFolder }>(`/folders/${id}`, { method: 'PATCH', body: { name } });
  }
  deleteFolder(id: string) {
    return this.request<{ deleted: true }>(`/folders/${id}`, { method: 'DELETE' });
  }

  // ---- tags ----
  listTags() {
    return this.request<{ tags: ApiTag[] }>('/tags');
  }
  createTag(name: string, color?: string) {
    return this.request<{ tag: ApiTag }>('/tags', { method: 'POST', body: { name, color } });
  }
  deleteTag(id: string) {
    return this.request<{ deleted: true }>(`/tags/${id}`, { method: 'DELETE' });
  }
  setItemTags(itemId: string, tagIds: string[]) {
    return this.request<{ updated: true }>(`/tags/items/${itemId}`, { method: 'PUT', body: { tagIds } });
  }

  // ---- 2FA ----
  totpStatus() {
    return this.request<{ enabled: boolean }>('/totp/status');
  }
  totpSetup() {
    return this.request<{ secret: string; otpauthUrl: string }>('/totp/setup', { method: 'POST' });
  }
  totpEnable(code: string) {
    return this.request<{ enabled: true; backupCodes: string[] }>('/totp/enable', { method: 'POST', body: { code } });
  }
  totpDisable(code: string) {
    return this.request<{ disabled: true }>('/totp/disable', { method: 'POST', body: { code } });
  }

  // ---- sessions ----
  listSessions() {
    return this.request<{ sessions: ApiSession[] }>('/sessions');
  }
  revokeSession(id: string) {
    return this.request<{ revoked: true }>(`/sessions/${id}`, { method: 'DELETE' });
  }
  revokeAllSessions() {
    return this.request<{ revokedAll: true }>('/sessions/revoke-all', { method: 'POST' });
  }

  // ---- dashboard ----
  dashboardMetrics() {
    return this.request<DashboardMetrics>('/dashboard/metrics');
  }
  teamMetrics() {
    return this.request<{ totalUsers: number; totalItems: number; activeShares: number; auditEventsToday: number }>(
      '/dashboard/team-metrics',
    );
  }
  userStats() {
    return this.request<{ stats: Array<{ id: string; name: string; email: string; role: string; status: string; savedCount: number; sharedCount: number }> }>(
      '/dashboard/user-stats',
    );
  }
  // ---- audit ----
  listAudit(params: { risk?: string; action?: string; limit?: number } = {}) {
    const search = new URLSearchParams();
    if (params.risk) search.set('risk', params.risk);
    if (params.action) search.set('action', params.action);
    if (params.limit) search.set('limit', String(params.limit));
    const qs = search.toString();
    return this.request<{ events: ApiAuditEvent[] }>(`/audit${qs ? `?${qs}` : ''}`);
  }

  // ---- extension pairing ----
  createExtensionPairCode() {
    return this.request<{ code: string; expiresInSeconds: number }>('/extension/pair-code', { method: 'POST' });
  }
  listExtensionDevices() {
    return this.request<{ devices: ApiExtensionDevice[] }>('/extension/devices');
  }
  revokeExtensionDevice(id: string) {
    return this.request<{ revoked: true }>(`/extension/devices/${id}`, { method: 'DELETE' });
  }

  // ---- transport ----
  private async request<T>(path: string, options: { method?: string; body?: unknown } = {}) {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    if (response.status === 204) return undefined as unknown as T;

    const text = await response.text();
    let payload: unknown = null;
    if (text) {
      try { payload = JSON.parse(text); } catch { payload = { raw: text }; }
    }
    if (!response.ok) {
      const message = (payload && typeof payload === 'object' && 'error' in payload)
        ? String((payload as { error: unknown }).error)
        : 'E-Vault Password Manager API request failed';
      // Our token was rejected (expired, deleted, or the account was deactivated):
      // signal the app to log out. Plain "insufficient permissions" 403s are left
      // alone so a manager hitting an admin-only action isn't logged out.
      const tokenRejected = this.token && (
        response.status === 401 || (response.status === 403 && /deactiv|not active|no longer exists/i.test(message))
      );
      if (tokenRejected && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('pass-vault-unauthorized', { detail: message }));
      }
      const error = new Error(message) as Error & { details?: unknown; status?: number };
      error.details = payload;
      error.status = response.status;
      throw error;
    }

    return payload as T;
  }
}

export const passVaultApi = new PassVaultApi();
