import { hashPassword } from '../crypto.js';
import { pool, query } from '../db.js';
import type { DbUser, Role } from '../types.js';
import { webcrypto } from 'node:crypto';

const demoPassword = 'demo123456';

const demoUsers: Array<{ name: string; email: string; role: Role; status: 'active' | 'inactive' | 'invited' }> = [
  { name: 'Neha Verma', email: 'neha@emiactech.com', role: 'admin', status: 'active' },
  { name: 'Kabir Singh', email: 'kabir@emiactech.com', role: 'manager', status: 'active' },
  { name: 'Meera Iyer', email: 'meera@emiactech.com', role: 'user', status: 'active' },
  { name: 'Rohan Gupta', email: 'rohan@emiactech.com', role: 'user', status: 'inactive' },
];

const demoItems = [
  { title: 'AWS Console', username: 'cloud-admin', url: 'https://aws.amazon.com', folder: 'Cloud', type: 'website_login', tag: 'cloud', favorite: true },
  { title: 'GitHub Organization', username: 'devops-team', url: 'https://github.com', folder: 'Engineering', type: 'website_login', tag: 'engineering', favorite: true },
  { title: 'Stripe Dashboard', username: 'finance@emiactech.com', url: 'https://dashboard.stripe.com', folder: 'Finance', type: 'website_login', tag: 'finance', favorite: false },
  { title: 'Staging Database', username: 'readonly_user', url: 'postgres://staging.internal', folder: 'Databases', type: 'database', tag: 'database', favorite: false },
  { title: 'Production SSH', username: 'ubuntu', url: 'ssh://prod.emiactech.com', folder: 'Servers', type: 'server_ssh', tag: 'server', favorite: false },
  { title: 'OpenAI API Key', username: 'platform', url: 'https://platform.openai.com', folder: 'API Keys', type: 'api_key', tag: 'api', favorite: false },
] as const;

async function generateDemoPublicKey() {
  const pair = await webcrypto.subtle.generateKey(
    { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['encrypt', 'decrypt'],
  );
  const spki = new Uint8Array(await webcrypto.subtle.exportKey('spki', pair.publicKey));
  return Buffer.from(spki).toString('base64url');
}

async function ensurePublicKey(userId: string) {
  const publicKey = await generateDemoPublicKey();
  await query(
    `UPDATE users
     SET public_key = COALESCE(public_key, $2), updated_at = now()
     WHERE id = $1`,
    [userId, publicKey],
  );
}

async function upsertUser(input: { name: string; email: string; role: Role; status: 'active' | 'inactive' | 'invited' }) {
  const password = await hashPassword(demoPassword);
  const publicKey = await generateDemoPublicKey();
  const result = await query<DbUser>(
    `INSERT INTO users (name, email, role, status, password_hash, password_salt, master_key_salt, public_key, last_active_at)
     VALUES ($1, $2, $3, $4, $5, $6, encode(gen_random_bytes(16), 'base64'), $7, now() - interval '1 hour')
     ON CONFLICT (email)
     DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role, status = EXCLUDED.status,
       public_key = COALESCE(users.public_key, EXCLUDED.public_key), updated_at = now()
     RETURNING *`,
    [input.name, input.email, input.role, input.status, password.hash, password.salt, publicKey],
  );
  return result.rows[0];
}

async function upsertFolder(ownerId: string, name: string) {
  const result = await query<{ id: string }>(
    `INSERT INTO vault_folders (owner_id, name)
     VALUES ($1, $2)
     ON CONFLICT (owner_id, name) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [ownerId, name],
  );
  return result.rows[0].id;
}

async function upsertTag(ownerId: string, name: string) {
  const result = await query<{ id: string }>(
    `INSERT INTO vault_tags (owner_id, name, color)
     VALUES ($1, $2, 'cyan')
     ON CONFLICT (owner_id, name) DO UPDATE SET color = EXCLUDED.color
     RETURNING id`,
    [ownerId, name],
  );
  return result.rows[0].id;
}

async function upsertDemoItem(input: {
  ownerId: string;
  folderId: string;
  tagId: string;
  title: string;
  username: string;
  url: string;
  type: string;
  favorite: boolean;
}) {
  const existing = await query<{ id: string }>(
    `SELECT id FROM vault_items WHERE owner_id = $1 AND title = $2 LIMIT 1`,
    [input.ownerId, input.title],
  );

  const encryptedPayload = {
    ciphertext: Buffer.from(JSON.stringify({
      username: input.username,
      password: 'DemoOnly-EncryptedPlaceholder-123!',
      notes: 'Demo row inserted by seed:demo-data. Replace with real encrypted item from UI.',
    })).toString('base64url'),
  };

  const values = [
    input.ownerId,
    input.folderId,
    input.type,
    input.title,
    input.url,
    JSON.stringify(encryptedPayload),
    'demo-payload-iv-123',
    'demo-payload-tag-123',
    'demo-owner-item-key-123',
    'demo-owner-key-iv-123',
    input.favorite,
    `${input.username} · demo`,
  ];

  const itemResult = existing.rows[0]
    ? await query<{ id: string }>(
      `UPDATE vault_items SET
        folder_id = $2,
        type = $3::vault_item_type,
        url = $5,
        encrypted_payload = $6,
        payload_iv = $7,
        payload_tag = $8,
        owner_encrypted_item_key = $9,
        owner_item_key_iv = $10,
        favorite = $11,
        notes_preview = $12,
        deleted_at = null,
        updated_at = now()
       WHERE owner_id = $1 AND title = $4
       RETURNING id`,
      values,
    )
    : await query<{ id: string }>(
      `INSERT INTO vault_items (
        owner_id, folder_id, type, title, url, encrypted_payload, payload_iv, payload_tag,
        owner_encrypted_item_key, owner_item_key_iv, favorite, notes_preview
      )
      VALUES ($1, $2, $3::vault_item_type, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING id`,
      values,
    );

  await query(
    `INSERT INTO vault_item_tags (vault_item_id, tag_id)
     VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [itemResult.rows[0].id, input.tagId],
  );
}

async function main() {
  const admin = await query<DbUser>("SELECT * FROM users WHERE email = 'admin@emiactech.com' LIMIT 1");
  if (!admin.rows[0]) {
    throw new Error('Seed super admin first: ADMIN_EMAIL=admin@emiactech.com ADMIN_PASSWORD=... npm run seed:super-admin');
  }

  const adminUser = admin.rows[0];
  await ensurePublicKey(adminUser.id);
  const users = await Promise.all(demoUsers.map(upsertUser));
  const manager = users.find((user) => user.role === 'manager');
  if (manager) {
    await query(
      `UPDATE users SET manager_id = $1 WHERE email IN ('meera@emiactech.com', 'rohan@emiactech.com')`,
      [manager.id],
    );
  }

  for (const item of demoItems) {
    const folderId = await upsertFolder(adminUser.id, item.folder);
    const tagId = await upsertTag(adminUser.id, item.tag);
    await upsertDemoItem({
      ownerId: adminUser.id,
      folderId,
      tagId,
      title: item.title,
      username: item.username,
      url: item.url,
      type: item.type,
      favorite: item.favorite,
    });
  }

  await query(
    `INSERT INTO audit_logs (actor_id, action, target_type, risk, metadata)
     VALUES ($1, 'seeded_demo_data', 'demo', 'low', $2)`,
    [adminUser.id, JSON.stringify({ users: demoUsers.length, passwords: demoItems.length })],
  );

  console.log(`Seeded ${demoUsers.length} demo users and ${demoItems.length} demo passwords for ${adminUser.email}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
