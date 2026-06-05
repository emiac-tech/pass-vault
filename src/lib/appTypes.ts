import type { ApiUser } from '../api/passVaultApi';

// ============================================================================
// App-wide UI types and shared keys
// ============================================================================

export type Panel = 'dashboard' | 'passwords' | 'folders' | 'users' | 'audit' | 'reports' | 'settings';
export type Scope = 'mine' | 'team';

export const sessionStorageKey = 'pass-vault-session';

export interface AuthSession {
  token: string;
  user: ApiUser;
}

export interface VaultContext {
  user: ApiUser;
  masterKey: CryptoKey;
  privateKey: CryptoKey | null;
  refresh: () => Promise<void>;
}
