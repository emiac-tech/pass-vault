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
  // Org recovery public key (base64url SPKI), if configured — used to add a
  // recovery copy of each item key so a super-admin can transfer ownership.
  orgRecoveryPublicKey?: string | null;
  refresh: () => Promise<void>;
}
