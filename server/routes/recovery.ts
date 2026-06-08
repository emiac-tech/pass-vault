import { Router } from 'express';
import { z } from 'zod';
import { writeAuditLog } from '../audit.js';
import { query, withTransaction } from '../db.js';
import { asyncHandler, requireAuth, requireRoles } from '../middleware.js';

const router = Router();

router.use(requireAuth);

// Is the organization recovery key configured yet?
router.get('/status', asyncHandler(async (_request, response) => {
  const result = await query<{ count: string }>('SELECT count(*) FROM org_recovery_key');
  response.json({ configured: Number(result.rows[0]?.count ?? 0) > 0 });
}));

// The org public key — any unlocked client uses it to add a recovery copy of each item key.
router.get('/public-key', asyncHandler(async (_request, response) => {
  const result = await query<{ public_key: string }>('SELECT public_key FROM org_recovery_key ORDER BY created_at LIMIT 1');
  response.json({ publicKey: result.rows[0]?.public_key ?? null });
}));

// Active users with a public key — used by a super-admin client to (a) wrap the
// org private key to each super-admin during setup, and (b) get a transfer target's key.
router.get('/users', requireRoles('super_admin'), asyncHandler(async (_request, response) => {
  const result = await query<Record<string, unknown>>(
    `SELECT id, name, email, role, public_key
     FROM users
     WHERE status = 'active' AND public_key IS NOT NULL
     ORDER BY name`,
  );
  response.json({
    users: result.rows.map((row) => ({
      id: row.id, name: row.name, email: row.email, role: row.role, publicKey: row.public_key,
    })),
  });
}));

// This super-admin's hybrid-wrapped copy of the org private key (for performing a transfer).
router.get('/grant', requireRoles('super_admin'), asyncHandler(async (request, response) => {
  const result = await query<Record<string, unknown>>(
    `SELECT g.encrypted_private_key, g.private_key_iv, g.wrapped_dek
     FROM org_recovery_grants g
     JOIN org_recovery_key k ON k.id = g.recovery_key_id
     WHERE g.user_id = $1
     ORDER BY g.created_at DESC
     LIMIT 1`,
    [request.user?.id],
  );
  const row = result.rows[0];
  response.json({
    grant: row
      ? { encryptedPrivateKey: row.encrypted_private_key, privateKeyIv: row.private_key_iv, wrappedDek: row.wrapped_dek }
      : null,
  });
}));

const grantSchema = z.object({
  userId: z.string().uuid(),
  encryptedPrivateKey: z.string().min(8),
  privateKeyIv: z.string().min(8),
  wrappedDek: z.string().min(8),
});

const setupSchema = z.object({
  publicKey: z.string().min(8),
  grants: z.array(grantSchema).min(1),
});

// One-time setup: store the org public key + a wrapped private-key grant for each super-admin.
router.post('/setup', requireRoles('super_admin'), asyncHandler(async (request, response) => {
  const body = setupSchema.parse(request.body);
  const existing = await query<{ count: string }>('SELECT count(*) FROM org_recovery_key');
  if (Number(existing.rows[0]?.count ?? 0) > 0) {
    response.status(409).json({ error: 'Organization recovery is already configured' });
    return;
  }

  await withTransaction(async (client) => {
    const key = await client.query<{ id: string }>(
      'INSERT INTO org_recovery_key (public_key) VALUES ($1) RETURNING id',
      [body.publicKey],
    );
    const keyId = key.rows[0].id;
    for (const grant of body.grants) {
      await client.query(
        `INSERT INTO org_recovery_grants (recovery_key_id, user_id, encrypted_private_key, private_key_iv, wrapped_dek)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (recovery_key_id, user_id) DO NOTHING`,
        [keyId, grant.userId, grant.encryptedPrivateKey, grant.privateKeyIv, grant.wrappedDek],
      );
    }
  });

  await writeAuditLog({
    actorId: request.user?.id,
    action: 'configured_org_recovery_key',
    targetType: 'org_recovery_key',
    risk: 'high',
    metadata: { grantedTo: body.grants.length },
  });

  response.status(201).json({ configured: true, grants: body.grants.length });
}));

// Grant the org private key to another super-admin (e.g. on promotion).
router.post('/grant', requireRoles('super_admin'), asyncHandler(async (request, response) => {
  const body = grantSchema.parse(request.body);
  const key = await query<{ id: string }>('SELECT id FROM org_recovery_key ORDER BY created_at LIMIT 1');
  if (!key.rows[0]) {
    response.status(409).json({ error: 'Organization recovery is not configured yet' });
    return;
  }
  await query(
    `INSERT INTO org_recovery_grants (recovery_key_id, user_id, encrypted_private_key, private_key_iv, wrapped_dek)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (recovery_key_id, user_id)
     DO UPDATE SET encrypted_private_key = EXCLUDED.encrypted_private_key,
                   private_key_iv = EXCLUDED.private_key_iv,
                   wrapped_dek = EXCLUDED.wrapped_dek`,
    [key.rows[0].id, body.userId, body.encryptedPrivateKey, body.privateKeyIv, body.wrappedDek],
  );
  await writeAuditLog({
    actorId: request.user?.id,
    action: 'granted_org_recovery_key',
    targetType: 'user',
    targetId: body.userId,
    risk: 'high',
  });
  response.json({ granted: true });
}));

// A departing user's owned items + their recovery copies, so a super-admin's client can
// re-wrap each item key to the new owner during a transfer.
router.get('/user/:id/items', requireRoles('super_admin'), asyncHandler(async (request, response) => {
  const userId = String(request.params.id);
  const result = await query<Record<string, unknown>>(
    `SELECT id, title, recovery_wrapped_item_key
     FROM vault_items
     WHERE owner_id = $1 AND deleted_at IS NULL
     ORDER BY created_at`,
    [userId],
  );
  response.json({
    items: result.rows.map((row) => ({
      itemId: row.id,
      title: row.title,
      recoveryWrappedItemKey: row.recovery_wrapped_item_key ?? null,
    })),
  });
}));

export default router;
