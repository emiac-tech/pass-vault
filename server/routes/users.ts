import { Router } from 'express';
import { z } from 'zod';
import { writeAuditLog } from '../audit.js';
import { config } from '../config.js';
import { createOpaqueToken, hashPassword, hashToken } from '../crypto.js';
import { query, withTransaction } from '../db.js';
import { buildInviteEmail, isMailConfigured, sendMail } from '../mailer.js';
import { asyncHandler, requireAuth, requireRoles } from '../middleware.js';
import type { DbUser, Role, UserStatus } from '../types.js';

const router = Router();

const adminRoles: Role[] = ['super_admin', 'admin'];

const inviteSchema = z.object({
  name: z.string().min(2).optional(),
  email: z.string().email(),
  role: z.enum(['admin', 'manager', 'user']).default('user'),
  managerId: z.string().uuid().optional(),
});

const statusSchema = z.object({
  status: z.enum(['active', 'inactive', 'invited']),
});

const roleSchema = z.object({
  role: z.enum(['super_admin', 'admin', 'manager', 'user']),
});

// Manual user creation: the admin's browser generates the new user's keypair from
// the chosen password (used as both account + master password) and sends the
// wrapped key material here. The server never sees the master key.
const createUserSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email(),
  role: z.enum(['admin', 'manager', 'user']).default('user'),
  password: z.string().min(8),
  publicKey: z.string().min(1),
  encryptedPrivateKey: z.string().min(1),
  privateKeyIv: z.string().min(1),
  masterKeySalt: z.string().min(1),
});

const deleteSchema = z.object({
  transferToUserId: z.string().uuid(),
});

function sanitizeUser(user: DbUser) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    publicKey: user.public_key,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
    lastActiveAt: user.last_active_at,
  };
}

router.use(requireAuth);

router.get('/', requireRoles('super_admin', 'admin', 'manager'), asyncHandler(async (request, response) => {
  // Admins, super admins, and managers see the user-management list.
  // Managers see their reports + themselves; admins see the whole org.
  const sql = request.user?.role === 'manager'
    ? `SELECT * FROM users WHERE manager_id = $1 OR id = $1 ORDER BY name ASC`
    : `SELECT * FROM users ORDER BY name ASC`;
  const values = request.user?.role === 'manager' ? [request.user.id] : [];
  const result = await query<DbUser>(sql, values);
  response.json({ users: result.rows.map(sanitizeUser) });
}));

// Lightweight directory for the share picker — returns just enough to wrap an item key.
router.get('/directory', asyncHandler(async (_request, response) => {
  const result = await query<DbUser>(
    `SELECT id, name, email, public_key, encrypted_private_key, private_key_iv, master_key_salt FROM users
     WHERE status = 'active'
     ORDER BY name ASC`,
  );
  response.json({
    users: result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      publicKey: row.public_key,
      keyReady: Boolean(row.public_key && row.encrypted_private_key && row.private_key_iv && row.master_key_salt),
    })),
  });
}));

router.post('/invite', requireRoles(...adminRoles), asyncHandler(async (request, response) => {
  const body = inviteSchema.parse(request.body);
  const token = createOpaqueToken();

  const existing = await query<DbUser>('SELECT * FROM users WHERE email = $1', [body.email.toLowerCase()]);
  if (existing.rows[0]?.status === 'active') {
    response.status(409).json({ error: 'User already exists' });
    return;
  }

  const result = await withTransaction(async (client) => {
    const userResult = await client.query<DbUser>(
      `INSERT INTO users (name, email, role, status, manager_id)
       VALUES ($1, $2, $3, 'invited', $4)
       ON CONFLICT (email)
       DO UPDATE SET role = EXCLUDED.role, status = 'invited', manager_id = EXCLUDED.manager_id, updated_at = now()
       RETURNING *`,
      [body.name ?? body.email.split('@')[0], body.email.toLowerCase(), body.role, body.managerId ?? null],
    );

    const invitationResult = await client.query(
      `INSERT INTO invitations (email, role, invited_by, token_hash, expires_at)
       VALUES ($1, $2, $3, $4, now() + interval '7 days')
       RETURNING id, email, role, expires_at, created_at`,
      [body.email.toLowerCase(), body.role, request.user?.id, hashToken(token)],
    );

    return { user: userResult.rows[0], invitation: invitationResult.rows[0] };
  });

  // Full link the invitee opens (hash route on the web app).
  const inviteUrl = `${config.publicAppUrl}/#/accept-invite/${encodeURIComponent(token)}`;

  // Email the invite if SMTP is configured. Never fail the invite if the email
  // can't be sent — the admin still gets the link back to share manually.
  let emailSent = false;
  let emailError: string | undefined;
  if (isMailConfigured()) {
    try {
      const mail = buildInviteEmail({
        email: body.email.toLowerCase(),
        role: body.role,
        inviteUrl,
      });
      await sendMail({ to: body.email.toLowerCase(), subject: mail.subject, html: mail.html, text: mail.text });
      emailSent = true;
    } catch (err) {
      emailError = err instanceof Error ? err.message : 'Failed to send invite email';
      console.error('[invite] email send failed:', emailError);
    }
  }

  await writeAuditLog({
    actorId: request.user?.id,
    action: 'invited_user',
    targetType: 'user',
    targetId: result.user.id,
    metadata: { email: result.user.email, role: result.user.role, emailSent },
  });

  response.status(201).json({
    user: sanitizeUser(result.user),
    invitation: result.invitation,
    inviteToken: token,
    inviteUrl,
    emailSent,
    emailError,
  });
}));

router.post('/create', requireRoles(...adminRoles), asyncHandler(async (request, response) => {
  const body = createUserSchema.parse(request.body);
  const email = body.email.toLowerCase();

  const existing = await query<DbUser>('SELECT id, status FROM users WHERE email = $1', [email]);
  if (existing.rows[0]?.status === 'active') {
    response.status(409).json({ error: 'A user with this email already exists' });
    return;
  }

  const password = await hashPassword(body.password);
  const result = await query<DbUser>(
    `INSERT INTO users (
       name, email, role, status, password_hash, password_salt,
       public_key, encrypted_private_key, private_key_iv, master_key_salt, last_active_at
     )
     VALUES ($1, $2, $3, 'active', $4, $5, $6, $7, $8, $9, now())
     ON CONFLICT (email) DO UPDATE SET
       name = EXCLUDED.name, role = EXCLUDED.role, status = 'active',
       password_hash = EXCLUDED.password_hash, password_salt = EXCLUDED.password_salt,
       public_key = EXCLUDED.public_key, encrypted_private_key = EXCLUDED.encrypted_private_key,
       private_key_iv = EXCLUDED.private_key_iv, master_key_salt = EXCLUDED.master_key_salt,
       updated_at = now()
     RETURNING *`,
    [
      body.name ?? email.split('@')[0], email, body.role,
      password.hash, password.salt,
      body.publicKey, body.encryptedPrivateKey, body.privateKeyIv, body.masterKeySalt,
    ],
  );

  await writeAuditLog({
    actorId: request.user?.id,
    action: 'created_user',
    targetType: 'user',
    targetId: result.rows[0].id,
    metadata: { email, role: body.role },
  });

  response.status(201).json({ user: sanitizeUser(result.rows[0]) });
}));

router.patch('/:id/status', requireRoles(...adminRoles), asyncHandler(async (request, response) => {
  const body = statusSchema.parse(request.body);
  const userId = String(request.params.id);
  const result = await query<DbUser>(
    `UPDATE users SET status = $1, updated_at = now() WHERE id = $2 RETURNING *`,
    [body.status satisfies UserStatus, userId],
  );

  if (!result.rows[0]) {
    response.status(404).json({ error: 'User not found' });
    return;
  }

  // Deactivating kills their active sessions so they can't keep using a token
  // that was issued while they were active.
  if (body.status !== 'active') {
    await query(
      `UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId],
    );
  }

  await writeAuditLog({
    actorId: request.user?.id,
    action: `changed_user_status_to_${body.status}`,
    targetType: 'user',
    targetId: userId,
  });

  response.json({ user: sanitizeUser(result.rows[0]) });
}));

router.patch('/:id/role', requireRoles('super_admin'), asyncHandler(async (request, response) => {
  const body = roleSchema.parse(request.body);
  const userId = String(request.params.id);
  const result = await query<DbUser>(
    `UPDATE users SET role = $1, updated_at = now() WHERE id = $2 RETURNING *`,
    [body.role, userId],
  );

  if (!result.rows[0]) {
    response.status(404).json({ error: 'User not found' });
    return;
  }

  await writeAuditLog({
    actorId: request.user?.id,
    action: `changed_user_role_to_${body.role}`,
    targetType: 'user',
    targetId: userId,
    risk: 'medium',
  });

  response.json({ user: sanitizeUser(result.rows[0]) });
}));

router.delete('/:id', requireRoles(...adminRoles), asyncHandler(async (request, response) => {
  const body = deleteSchema.parse(request.body);
  const userId = String(request.params.id);
  if (userId === body.transferToUserId) {
    response.status(400).json({ error: 'Transfer target must be another user' });
    return;
  }

  const result = await withTransaction(async (client) => {
    const transferCount = await client.query<{ count: string }>(
      `SELECT count(*) FROM vault_items WHERE owner_id = $1 AND deleted_at IS NULL`,
      [userId],
    );

    await client.query(
      `UPDATE vault_items SET owner_id = $1, updated_at = now() WHERE owner_id = $2`,
      [body.transferToUserId, userId],
    );

    await client.query(
      `INSERT INTO password_transfer_logs (from_user_id, to_user_id, transferred_by, item_count)
       VALUES ($1, $2, $3, $4)`,
      [userId, body.transferToUserId, request.user?.id, Number(transferCount.rows[0]?.count ?? 0)],
    );

    const deleted = await client.query<DbUser>('DELETE FROM users WHERE id = $1 RETURNING *', [userId]);
    return { deletedUser: deleted.rows[0], itemCount: Number(transferCount.rows[0]?.count ?? 0) };
  });

  if (!result.deletedUser) {
    response.status(404).json({ error: 'User not found' });
    return;
  }

  await writeAuditLog({
    actorId: request.user?.id,
    action: 'deleted_user_and_transferred_vault_items',
    targetType: 'user',
    targetId: userId,
    risk: 'high',
    metadata: { transferToUserId: body.transferToUserId, itemCount: result.itemCount },
  });

  response.json({
    deletedUser: sanitizeUser(result.deletedUser),
    transferredToUserId: body.transferToUserId,
    transferredItemCount: result.itemCount,
  });
}));

export default router;
