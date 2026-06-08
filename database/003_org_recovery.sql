-- Organization Recovery Key (ORK) — enables a super-admin to transfer any user's
-- credentials to another user such that the new owner can actually decrypt them.
--
-- Model (zero-knowledge preserved; re-wrapping happens client-side):
--   * One org RSA keypair. The public key is plaintext; clients use it to add a
--     "recovery copy" of every item key (item key wrapped to the org public key).
--   * The org PRIVATE key is hybrid-wrapped (AES-GCM + RSA) to EACH super-admin's
--     user public key, so any super-admin can recover it after unlocking.
--   * On transfer, the super-admin's browser unwraps the org private key, unwraps
--     each item's recovery copy, and re-wraps the item key to the new owner's RSA
--     public key (stored as the owner copy with owner_key_wrap = 'rsa').

CREATE TABLE IF NOT EXISTS org_recovery_key (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_key text NOT NULL,             -- base64url SPKI of the org RSA public key
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS org_recovery_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recovery_key_id uuid NOT NULL REFERENCES org_recovery_key(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  encrypted_private_key text NOT NULL,  -- AES-GCM ciphertext of the org PKCS8 private key
  private_key_iv text NOT NULL,         -- IV for the AES-GCM wrap
  wrapped_dek text NOT NULL,            -- the AES DEK, RSA-wrapped to this super-admin's public key
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (recovery_key_id, user_id)
);

CREATE INDEX IF NOT EXISTS org_recovery_grants_user_idx ON org_recovery_grants(user_id);

-- Per-item recovery copy + which key wrapping the owner copy currently uses.
ALTER TABLE vault_items ADD COLUMN IF NOT EXISTS recovery_wrapped_item_key text;
ALTER TABLE vault_items ADD COLUMN IF NOT EXISTS owner_key_wrap text NOT NULL DEFAULT 'master';
