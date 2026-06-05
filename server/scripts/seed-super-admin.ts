import { randomBytes } from 'node:crypto';
import { writeAuditLog } from '../audit.js';
import { hashPassword } from '../crypto.js';
import { pool, query } from '../db.js';
import type { DbUser } from '../types.js';

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

async function main() {
  const email = requiredEnv('ADMIN_EMAIL').toLowerCase();
  const password = requiredEnv('ADMIN_PASSWORD');
  const name = process.env.ADMIN_NAME ?? 'Super Admin';
  const masterKeySalt = process.env.ADMIN_MASTER_KEY_SALT ?? randomBytes(16).toString('base64url');

  const hashed = await hashPassword(password);
  const result = await query<DbUser>(
    `INSERT INTO users (
      name, email, role, status, password_hash, password_salt, master_key_salt
    )
    VALUES ($1, $2, 'super_admin', 'active', $3, $4, $5)
    ON CONFLICT (email)
    DO UPDATE SET
      name = EXCLUDED.name,
      role = 'super_admin',
      status = 'active',
      password_hash = EXCLUDED.password_hash,
      password_salt = EXCLUDED.password_salt,
      master_key_salt = COALESCE(users.master_key_salt, EXCLUDED.master_key_salt),
      updated_at = now()
    RETURNING *`,
    [name, email, hashed.hash, hashed.salt, masterKeySalt],
  );

  const user = result.rows[0];
  await writeAuditLog({
    actorId: user.id,
    action: 'seeded_super_admin',
    targetType: 'user',
    targetId: user.id,
    risk: 'medium',
    metadata: { email: user.email },
  });

  console.log(`Seeded super admin: ${user.email}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
