CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('super_admin', 'admin', 'manager', 'user');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE user_status AS ENUM ('active', 'inactive', 'invited');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE vault_item_type AS ENUM ('website_login', 'app_login', 'server_ssh', 'database', 'secure_note', 'api_key');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE share_permission AS ENUM ('use_only', 'view', 'edit', 'manage');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  role user_role NOT NULL DEFAULT 'user',
  status user_status NOT NULL DEFAULT 'invited',
  manager_id uuid REFERENCES users(id) ON DELETE SET NULL,
  password_hash text,
  password_salt text,
  public_key text,
  encrypted_private_key text,
  master_key_salt text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_active_at timestamptz
);

CREATE TABLE IF NOT EXISTS teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  manager_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS team_members (
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, user_id)
);

CREATE TABLE IF NOT EXISTS invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  role user_role NOT NULL DEFAULT 'user',
  invited_by uuid REFERENCES users(id) ON DELETE SET NULL,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vault_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, name)
);

CREATE TABLE IF NOT EXISTS vault_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  folder_id uuid REFERENCES vault_folders(id) ON DELETE SET NULL,
  type vault_item_type NOT NULL DEFAULT 'website_login',
  title text NOT NULL,
  url text,
  encrypted_payload jsonb NOT NULL,
  payload_iv text NOT NULL,
  payload_tag text NOT NULL,
  owner_encrypted_item_key text NOT NULL,
  owner_item_key_iv text NOT NULL,
  favorite boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS vault_items_owner_idx ON vault_items(owner_id);
CREATE INDEX IF NOT EXISTS vault_items_title_idx ON vault_items USING gin (to_tsvector('english', title));

CREATE TABLE IF NOT EXISTS vault_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vault_item_id uuid NOT NULL REFERENCES vault_items(id) ON DELETE CASCADE,
  shared_by uuid REFERENCES users(id) ON DELETE SET NULL,
  recipient_user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  recipient_team_id uuid REFERENCES teams(id) ON DELETE CASCADE,
  permission share_permission NOT NULL DEFAULT 'use_only',
  recipient_encrypted_item_key text NOT NULL,
  recipient_item_key_iv text NOT NULL,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT one_share_recipient CHECK (
    (recipient_user_id IS NOT NULL AND recipient_team_id IS NULL)
    OR (recipient_user_id IS NULL AND recipient_team_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS vault_shares_item_idx ON vault_shares(vault_item_id);
CREATE INDEX IF NOT EXISTS vault_shares_recipient_user_idx ON vault_shares(recipient_user_id);

CREATE TABLE IF NOT EXISTS vault_item_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vault_item_id uuid NOT NULL REFERENCES vault_items(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  encrypted_payload jsonb NOT NULL,
  payload_iv text NOT NULL,
  payload_tag text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS password_transfer_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  to_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  transferred_by uuid REFERENCES users(id) ON DELETE SET NULL,
  item_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  user_agent text,
  ip_address inet,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE TABLE IF NOT EXISTS extension_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  browser text,
  public_key text,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id uuid,
  risk text NOT NULL DEFAULT 'low',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_logs_created_idx ON audit_logs(created_at DESC);
