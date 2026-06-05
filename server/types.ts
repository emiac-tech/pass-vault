import type { Request } from 'express';

export type Role = 'super_admin' | 'admin' | 'manager' | 'user';
export type UserStatus = 'active' | 'inactive' | 'invited';
export type SharePermission = 'use_only' | 'view' | 'edit' | 'manage';

export interface AuthUser {
  id: string;
  email: string;
  role: Role;
  status: UserStatus;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}

export interface DbUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: UserStatus;
  manager_id: string | null;
  password_hash: string | null;
  password_salt: string | null;
  public_key: string | null;
  encrypted_private_key: string | null;
  private_key_iv: string | null;
  master_key_salt: string | null;
  totp_secret: string | null;
  totp_enabled: boolean;
  totp_backup_codes: string[] | null;
  avatar_color: string | null;
  created_at: Date;
  updated_at: Date;
  last_active_at: Date | null;
}
