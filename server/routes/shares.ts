import { Router } from 'express';
import { z } from 'zod';
import { writeAuditLog } from '../audit.js';
import { query } from '../db.js';
import { asyncHandler, requireAuth } from '../middleware.js';

const router = Router();

const createShareSchema = z.object({
  recipientUserId: z.string().uuid().optional(),
  recipientTeamId: z.string().uuid().optional(),
  permission: z.enum(['use_only', 'view', 'edit', 'manage']).default('use_only'),
  recipientEncryptedItemKey: z.string().min(8),
  recipientItemKeyIv: z.string().default(''),
  expiresAt: z.string().datetime().optional(),
}).refine((value) => Boolean(value.recipientUserId) !== Boolean(value.recipientTeamId), {
  message: 'Provide exactly one recipient user or team',
});

async function canManageShare(itemId: string, userId: string) {
  const result = await query<{ allowed: boolean }>(
    `SELECT true AS allowed
     FROM vault_items
     WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL
     UNION
     SELECT true AS allowed
     FROM vault_shares
     WHERE vault_item_id = $1
       AND recipient_user_id = $2
       AND permission = 'manage'
       AND revoked_at IS NULL
       AND (expires_at IS NULL OR expires_at > now())
     LIMIT 1`,
    [itemId, userId],
  );
  return Boolean(result.rows[0]?.allowed);
}

router.use(requireAuth);

router.get('/items/:itemId/shares', asyncHandler(async (request, response) => {
  const itemId = String(request.params.itemId);
  const allowed = await canManageShare(itemId, request.user!.id);
  if (!allowed) {
    response.status(403).json({ error: 'Manage permission required' });
    return;
  }

  const result = await query(
    `SELECT
       vs.id,
       vs.vault_item_id,
       vs.permission,
       vs.recipient_user_id,
       u.name AS recipient_user_name,
       vs.recipient_team_id,
       t.name AS recipient_team_name,
       vs.expires_at,
       vs.revoked_at,
       vs.created_at
     FROM vault_shares vs
     LEFT JOIN users u ON u.id = vs.recipient_user_id
     LEFT JOIN teams t ON t.id = vs.recipient_team_id
    WHERE vs.vault_item_id = $1
     ORDER BY vs.created_at DESC`,
    [itemId],
  );

  response.json({ shares: result.rows });
}));

router.post('/items/:itemId/shares', asyncHandler(async (request, response) => {
  const body = createShareSchema.parse(request.body);
  const itemId = String(request.params.itemId);
  const allowed = await canManageShare(itemId, request.user!.id);
  if (!allowed) {
    response.status(403).json({ error: 'Manage permission required' });
    return;
  }

  if (body.recipientUserId) {
    const recipient = await query<{
      public_key: string | null;
      encrypted_private_key: string | null;
      private_key_iv: string | null;
      master_key_salt: string | null;
    }>(
      `SELECT public_key, encrypted_private_key, private_key_iv, master_key_salt
       FROM users
       WHERE id = $1 AND status = 'active'`,
      [body.recipientUserId],
    );
    const user = recipient.rows[0];
    if (!user?.public_key || !user.encrypted_private_key || !user.private_key_iv || !user.master_key_salt) {
      response.status(400).json({ error: 'Recipient must unlock their vault once to repair encryption keys before sharing.' });
      return;
    }
  }

  const values = [
    itemId,
    request.user?.id,
    body.recipientUserId ?? null,
    body.recipientTeamId ?? null,
    body.permission,
    body.recipientEncryptedItemKey,
    body.recipientItemKeyIv,
    body.expiresAt ?? null,
  ];

  const existing = await query(
    `UPDATE vault_shares
     SET permission = $5,
         recipient_encrypted_item_key = $6,
         recipient_item_key_iv = $7,
         expires_at = $8,
         shared_by = $2,
         created_at = now()
     WHERE vault_item_id = $1
       AND revoked_at IS NULL
       AND (
         ($3::uuid IS NOT NULL AND recipient_user_id = $3::uuid)
         OR ($4::uuid IS NOT NULL AND recipient_team_id = $4::uuid)
       )
     RETURNING id, vault_item_id, recipient_user_id, recipient_team_id, permission, expires_at, created_at`,
    values,
  );

  const result = existing.rows[0]
    ? existing
    : await query(
      `INSERT INTO vault_shares (
         vault_item_id, shared_by, recipient_user_id, recipient_team_id,
         permission, recipient_encrypted_item_key, recipient_item_key_iv, expires_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, vault_item_id, recipient_user_id, recipient_team_id, permission, expires_at, created_at`,
      values,
    );

  await writeAuditLog({
    actorId: request.user?.id,
    action: 'shared_vault_item',
    targetType: 'vault_item',
    targetId: itemId,
    risk: 'medium',
    metadata: { permission: body.permission, recipientUserId: body.recipientUserId, recipientTeamId: body.recipientTeamId },
  });

  response.status(201).json({ share: result.rows[0] });
}));

router.delete('/shares/:shareId', asyncHandler(async (request, response) => {
  const shareId = String(request.params.shareId);
  const share = await query<{ vault_item_id: string }>('SELECT vault_item_id FROM vault_shares WHERE id = $1', [
    shareId,
  ]);

  if (!share.rows[0]) {
    response.status(404).json({ error: 'Share not found' });
    return;
  }

  const allowed = await canManageShare(share.rows[0].vault_item_id, request.user!.id);
  if (!allowed) {
    response.status(403).json({ error: 'Manage permission required' });
    return;
  }

  await query('UPDATE vault_shares SET revoked_at = now() WHERE id = $1', [shareId]);
  await writeAuditLog({
    actorId: request.user?.id,
    action: 'revoked_vault_share',
    targetType: 'vault_share',
    targetId: shareId,
    risk: 'medium',
  });

  response.json({ revoked: true });
}));

export default router;
