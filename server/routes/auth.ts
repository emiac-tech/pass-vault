import { Router } from 'express';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { z } from 'zod';
import { writeAuditLog } from '../audit.js';
import { config } from '../config.js';
import { createOpaqueToken, hashPassword, hashToken, verifyPassword } from '../crypto.js';
import { query, withTransaction } from '../db.js';
import { asyncHandler, requireAuth } from '../middleware.js';
import { verifyTotp } from '../totp.js';
import type { DbUser } from '../types.js';

const router = Router();

const firstAdminSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(10),
  publicKey: z.string().optional(),
  encryptedPrivateKey: z.string().optional(),
  privateKeyIv: z.string().optional(),
  masterKeySalt: z.string().min(8),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  totpCode: z.string().min(6).max(8).optional(),
});

function signUser(user: DbUser) {
  const signOptions: SignOptions = {
    expiresIn: config.jwtExpiresIn as SignOptions['expiresIn'],
  };

  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
    },
    config.jwtSecret,
    signOptions,
  );
}

function publicUser(user: DbUser) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    publicKey: user.public_key,
    encryptedPrivateKey: user.encrypted_private_key,
    privateKeyIv: user.private_key_iv,
    masterKeySalt: user.master_key_salt,
    totpEnabled: user.totp_enabled ?? false,
  };
}

router.get('/bootstrap-status', asyncHandler(async (_request, response) => {
  const existing = await query<{ count: string }>('SELECT count(*) FROM users');
  response.json({ hasUsers: Number(existing.rows[0]?.count ?? 0) > 0 });
}));

router.post('/register-first-admin', asyncHandler(async (request, response) => {
  const body = firstAdminSchema.parse(request.body);
  const existing = await query<{ count: string }>('SELECT count(*) FROM users');

  if (Number(existing.rows[0]?.count ?? 0) > 0) {
    response.status(409).json({ error: 'First admin already exists' });
    return;
  }

  const password = await hashPassword(body.password);
  const result = await query<DbUser>(
    `INSERT INTO users (
      name, email, role, status, password_hash, password_salt,
      public_key, encrypted_private_key, private_key_iv, master_key_salt
    )
    VALUES ($1, $2, 'super_admin', 'active', $3, $4, $5, $6, $7, $8)
    RETURNING *`,
    [
      body.name,
      body.email.toLowerCase(),
      password.hash,
      password.salt,
      body.publicKey ?? null,
      body.encryptedPrivateKey ?? null,
      body.privateKeyIv ?? null,
      body.masterKeySalt,
    ],
  );

  const user = result.rows[0];
  await writeAuditLog({
    actorId: user.id,
    action: 'registered_first_admin',
    targetType: 'user',
    targetId: user.id,
    risk: 'medium',
  });

  response.status(201).json({ user: publicUser(user), token: signUser(user) });
}));

router.post('/login', asyncHandler(async (request, response) => {
  const body = loginSchema.parse(request.body);
  const result = await query<DbUser>('SELECT * FROM users WHERE email = $1', [body.email.toLowerCase()]);
  const user = result.rows[0];

  if (!user || !user.password_hash || !user.password_salt) {
    response.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  if (user.status !== 'active') {
    response.status(403).json({ error: 'User is not active' });
    return;
  }

  const valid = await verifyPassword(body.password, user.password_salt, user.password_hash);
  if (!valid) {
    response.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  if (user.totp_enabled) {
    if (!body.totpCode) {
      response.status(401).json({ error: '2FA code required', needsTotp: true });
      return;
    }
    const totpValid = verifyTotp(user.totp_secret ?? '', body.totpCode) || (user.totp_backup_codes ?? []).includes(body.totpCode);
    if (!totpValid) {
      response.status(401).json({ error: 'Invalid 2FA code', needsTotp: true });
      return;
    }
  }

  const token = signUser(user);
  const sessionToken = createOpaqueToken();
  await query(
    `INSERT INTO sessions (user_id, token_hash, expires_at, ip_address, user_agent)
     VALUES ($1, $2, now() + interval '30 days', $3::inet, $4)`,
    [user.id, hashToken(sessionToken), (request.ip ?? null), request.header('user-agent') ?? null],
  );
  await query('UPDATE users SET last_active_at = now() WHERE id = $1', [user.id]);
  await writeAuditLog({ actorId: user.id, action: 'login', targetType: 'user', targetId: user.id });

  response.json({ user: publicUser(user), token });
}));

router.get('/me', requireAuth, asyncHandler(async (request, response) => {
  const result = await query<DbUser>('SELECT * FROM users WHERE id = $1', [request.user?.id]);
  const user = result.rows[0];
  if (!user) {
    response.status(404).json({ error: 'User not found' });
    return;
  }

  response.json({ user: publicUser(user) });
}));

// Look up an invitation (for the acceptance page to display context).
router.get('/invite/:token', asyncHandler(async (request, response) => {
  const token = String(request.params.token);
  const result = await query<{ id: string; email: string; role: string; expires_at: Date; accepted_at: Date | null }>(
    `SELECT id, email, role, expires_at, accepted_at FROM invitations
     WHERE token_hash = $1 AND expires_at > now() AND accepted_at IS NULL
     ORDER BY created_at DESC LIMIT 1`,
    [hashToken(token)],
  );
  const invitation = result.rows[0];
  if (!invitation) {
    response.status(404).json({ error: 'Invitation not found or expired' });
    return;
  }
  response.json({ invitation });
}));

const acceptInviteSchema = z.object({
  token: z.string().min(8),
  name: z.string().min(2),
  password: z.string().min(10),
  publicKey: z.string(),
  encryptedPrivateKey: z.string(),
  privateKeyIv: z.string(),
  masterKeySalt: z.string().min(8),
});

router.post('/accept-invite', asyncHandler(async (request, response) => {
  const body = acceptInviteSchema.parse(request.body);

  const result = await withTransaction(async (client) => {
    const inviteRow = await client.query<{ id: string; email: string; role: string; expires_at: Date }>(
      `SELECT id, email, role, expires_at FROM invitations
       WHERE token_hash = $1 AND accepted_at IS NULL AND expires_at > now()
       FOR UPDATE`,
      [hashToken(body.token)],
    );
    const invitation = inviteRow.rows[0];
    if (!invitation) throw new Error('Invitation not found or expired');

    const hashed = await hashPassword(body.password);
    const userResult = await client.query<DbUser>(
      `UPDATE users SET
         name = $1,
         password_hash = $2,
         password_salt = $3,
         public_key = $4,
         encrypted_private_key = $5,
         private_key_iv = $6,
         master_key_salt = $7,
         status = 'active',
         updated_at = now()
       WHERE email = $8
       RETURNING *`,
      [
        body.name,
        hashed.hash,
        hashed.salt,
        body.publicKey,
        body.encryptedPrivateKey,
        body.privateKeyIv,
        body.masterKeySalt,
        invitation.email,
      ],
    );
    if (!userResult.rows[0]) throw new Error('Invited user not found');

    await client.query(`UPDATE invitations SET accepted_at = now() WHERE id = $1`, [invitation.id]);
    return userResult.rows[0];
  }).catch((error: Error) => {
    response.status(400).json({ error: error.message });
    return null;
  });

  if (!result) return;

  await writeAuditLog({
    actorId: result.id,
    action: 'accepted_invitation',
    targetType: 'user',
    targetId: result.id,
    risk: 'medium',
  });

  response.json({ user: publicUser(result), token: signUser(result) });
}));

// Repair accounts created before client-side RSA private keys were required.
// The browser generates a fresh RSA keypair, wraps the private key with the
// current master key, and sends only the public/wrapped material here.
const repairKeypairSchema = z.object({
  publicKey: z.string().min(8),
  encryptedPrivateKey: z.string().min(8),
  privateKeyIv: z.string().min(8),
});

router.post('/repair-keypair', requireAuth, asyncHandler(async (request, response) => {
  const body = repairKeypairSchema.parse(request.body);
  const userRow = await query<DbUser>(`SELECT * FROM users WHERE id = $1`, [request.user?.id]);
  const user = userRow.rows[0];
  if (!user) {
    response.status(404).json({ error: 'User not found' });
    return;
  }
  if (!user.master_key_salt) {
    response.status(400).json({ error: 'Master key salt missing — cannot repair keypair safely' });
    return;
  }

  let revokedShareCount = 0;
  const updated = await withTransaction(async (client) => {
    const shareRows = await client.query<{ id: string }>(
      `UPDATE vault_shares
       SET revoked_at = now()
       WHERE recipient_user_id = $1
         AND revoked_at IS NULL
       RETURNING id`,
      [user.id],
    );
    revokedShareCount = shareRows.rowCount ?? 0;

    const result = await client.query<DbUser>(
      `UPDATE users SET
         public_key = $1,
         encrypted_private_key = $2,
         private_key_iv = $3,
         updated_at = now()
       WHERE id = $4
       RETURNING *`,
      [body.publicKey, body.encryptedPrivateKey, body.privateKeyIv, user.id],
    );
    return result.rows[0];
  });

  await writeAuditLog({
    actorId: user.id,
    action: 'repaired_user_keypair',
    targetType: 'user',
    targetId: user.id,
    risk: 'high',
    metadata: { revokedUnreadableShareCount: revokedShareCount },
  });

  response.json({ user: publicUser(updated), revokedShareCount });
}));

// Change master password — client re-wraps the private key and all owned item keys.
const masterChangeSchema = z.object({
  currentPassword: z.string().min(1),
  newPasswordSalt: z.string().min(8),
  newEncryptedPrivateKey: z.string().min(8),
  newPrivateKeyIv: z.string().min(8),
  rewrappedItemKeys: z.array(z.object({
    itemId: z.string().uuid(),
    ownerEncryptedItemKey: z.string().min(8),
    ownerItemKeyIv: z.string().min(8),
  })).default([]),
});

router.post('/change-master-password', requireAuth, asyncHandler(async (request, response) => {
  const body = masterChangeSchema.parse(request.body);
  const userRow = await query<DbUser>(`SELECT * FROM users WHERE id = $1`, [request.user?.id]);
  const user = userRow.rows[0];
  if (!user?.password_hash || !user.password_salt) {
    response.status(400).json({ error: 'User missing credentials' });
    return;
  }
  const valid = await verifyPassword(body.currentPassword, user.password_salt, user.password_hash);
  if (!valid) {
    response.status(401).json({ error: 'Current password incorrect' });
    return;
  }

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE users SET
         master_key_salt = $1,
         encrypted_private_key = $2,
         private_key_iv = $3,
         updated_at = now()
       WHERE id = $4`,
      [body.newPasswordSalt, body.newEncryptedPrivateKey, body.newPrivateKeyIv, user.id],
    );
    for (const item of body.rewrappedItemKeys) {
      await client.query(
        `UPDATE vault_items SET
           owner_encrypted_item_key = $1,
           owner_item_key_iv = $2,
           updated_at = now()
         WHERE id = $3 AND owner_id = $4`,
        [item.ownerEncryptedItemKey, item.ownerItemKeyIv, item.itemId, user.id],
      );
    }
  });

  await writeAuditLog({
    actorId: user.id,
    action: 'changed_master_password',
    targetType: 'user',
    targetId: user.id,
    risk: 'high',
    metadata: { rewrappedItemCount: body.rewrappedItemKeys.length },
  });

  response.json({ updated: true });
}));

// Change account password (used to log in). Different from master password.
const accountChangeSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(10),
});

router.post('/change-password', requireAuth, asyncHandler(async (request, response) => {
  const body = accountChangeSchema.parse(request.body);
  const userRow = await query<DbUser>(`SELECT * FROM users WHERE id = $1`, [request.user?.id]);
  const user = userRow.rows[0];
  if (!user?.password_hash || !user.password_salt) {
    response.status(400).json({ error: 'User missing credentials' });
    return;
  }
  const valid = await verifyPassword(body.currentPassword, user.password_salt, user.password_hash);
  if (!valid) {
    response.status(401).json({ error: 'Current password incorrect' });
    return;
  }
  const hashed = await hashPassword(body.newPassword);
  await query(
    `UPDATE users SET password_hash = $1, password_salt = $2, updated_at = now() WHERE id = $3`,
    [hashed.hash, hashed.salt, user.id],
  );
  await writeAuditLog({
    actorId: user.id,
    action: 'changed_account_password',
    targetType: 'user',
    targetId: user.id,
    risk: 'medium',
  });
  response.json({ updated: true });
}));

router.post('/logout', requireAuth, asyncHandler(async (request, response) => {
  await query(`UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [
    request.user?.id,
  ]);
  await writeAuditLog({ actorId: request.user?.id, action: 'logout', targetType: 'user', targetId: request.user?.id });
  response.json({ loggedOut: true });
}));

export default router;
