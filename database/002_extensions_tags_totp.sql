-- Migration 002: tags, TOTP, password resets, refresh tokens, extension pairing, share groups.

-- Store the IV used to wrap the user's RSA private key with the master key.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS private_key_iv text,
  ADD COLUMN IF NOT EXISTS totp_secret text,
  ADD COLUMN IF NOT EXISTS totp_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS totp_backup_codes text[],
  ADD COLUMN IF NOT EXISTS avatar_color text;

-- Tags table — owner scoped.
CREATE TABLE IF NOT EXISTS vault_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text NOT NULL DEFAULT 'slate',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, name)
);

CREATE TABLE IF NOT EXISTS vault_item_tags (
  vault_item_id uuid NOT NULL REFERENCES vault_items(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES vault_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (vault_item_id, tag_id)
);

-- Password reset tokens.
CREATE TABLE IF NOT EXISTS password_resets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS password_resets_user_idx ON password_resets(user_id);

-- Extension pairing tokens (short-lived).
CREATE TABLE IF NOT EXISTS extension_pairing_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  device_name text,
  browser text,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Update extension_devices with token + revocation columns.
ALTER TABLE extension_devices
  ADD COLUMN IF NOT EXISTS token_hash text,
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz;

-- Pending vault items for invited users — owner stores them with no item key yet;
-- invited user re-keys on acceptance. Simplifies the invite flow.
CREATE TABLE IF NOT EXISTS pending_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vault_item_id uuid NOT NULL REFERENCES vault_items(id) ON DELETE CASCADE,
  invited_by uuid REFERENCES users(id) ON DELETE SET NULL,
  recipient_email text NOT NULL,
  permission share_permission NOT NULL DEFAULT 'view',
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Tag favorites column (lightweight quick filter).
ALTER TABLE vault_items
  ADD COLUMN IF NOT EXISTS notes_preview text;

-- Audit log target index for faster filtering.
CREATE INDEX IF NOT EXISTS audit_logs_actor_idx ON audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS audit_logs_target_idx ON audit_logs(target_type, target_id);
