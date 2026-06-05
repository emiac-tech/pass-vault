import { Router } from 'express';
import { z } from 'zod';
import { writeAuditLog } from '../audit.js';
import { query } from '../db.js';
import { asyncHandler, requireAuth } from '../middleware.js';

const router = Router();

const encryptedPayloadSchema = z.object({
  title: z.string().min(1),
  url: z.string().optional(),
  type: z.enum(['website_login', 'app_login', 'server_ssh', 'database', 'secure_note', 'api_key']).default('website_login'),
  folderId: z.string().uuid().optional().nullable(),
  encryptedPayload: z.record(z.string(), z.unknown()),
  payloadIv: z.string().min(8),
  payloadTag: z.string().min(8),
  ownerEncryptedItemKey: z.string().min(8),
  ownerItemKeyIv: z.string().min(8),
  tagIds: z.array(z.string().uuid()).optional(),
  notesPreview: z.string().max(120).optional(),
});

const updateVaultItemSchema = encryptedPayloadSchema.partial().extend({
  favorite: z.boolean().optional(),
});

function rowToVaultItem(row: Record<string, unknown>) {
  return {
    id: row.id,
    title: row.title,
    url: row.url,
    type: row.type,
    folderId: row.folder_id,
    ownerId: row.owner_id,
    permission: row.permission,
    encryptedPayload: row.encrypted_payload,
    payloadIv: row.payload_iv,
    payloadTag: row.payload_tag,
    encryptedItemKey: row.encrypted_item_key,
    itemKeyIv: row.item_key_iv,
    favorite: row.favorite,
    shareCount: Number(row.share_count ?? 0),
    notesPreview: row.notes_preview,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    tagIds: row.tag_ids ?? [],
  };
}

router.use(requireAuth);

router.get('/items', asyncHandler(async (request, response) => {
  const includeDeleted = request.query.includeDeleted === 'true';
  const sql = `
    WITH owned AS (
      SELECT vi.*, 'manage'::share_permission AS permission,
        vi.owner_encrypted_item_key AS encrypted_item_key,
        vi.owner_item_key_iv AS item_key_iv
      FROM vault_items vi
      WHERE vi.owner_id = $1 ${includeDeleted ? '' : 'AND vi.deleted_at IS NULL'}
    ),
    shared AS (
      SELECT vi.*, vs.permission,
        vs.recipient_encrypted_item_key AS encrypted_item_key,
        vs.recipient_item_key_iv AS item_key_iv
      FROM vault_items vi
      JOIN vault_shares vs ON vs.vault_item_id = vi.id
      WHERE vs.recipient_user_id = $1
        AND vi.deleted_at IS NULL
        AND vs.revoked_at IS NULL
        AND (vs.expires_at IS NULL OR vs.expires_at > now())
    ),
    combined AS (SELECT * FROM owned UNION ALL SELECT * FROM shared)
    SELECT c.*,
           COALESCE(array_agg(vit.tag_id) FILTER (WHERE vit.tag_id IS NOT NULL), '{}') AS tag_ids,
           (
             SELECT count(*)
             FROM vault_shares share_count_rows
             WHERE share_count_rows.vault_item_id = c.id
               AND share_count_rows.revoked_at IS NULL
               AND (share_count_rows.expires_at IS NULL OR share_count_rows.expires_at > now())
           ) AS share_count
    FROM combined c
    LEFT JOIN vault_item_tags vit ON vit.vault_item_id = c.id
    GROUP BY c.id, c.owner_id, c.folder_id, c.type, c.title, c.url,
             c.encrypted_payload, c.payload_iv, c.payload_tag,
             c.owner_encrypted_item_key, c.owner_item_key_iv,
             c.favorite, c.created_at, c.updated_at, c.deleted_at,
             c.notes_preview, c.permission, c.encrypted_item_key, c.item_key_iv
    ORDER BY c.updated_at DESC
  `;
  const result = await query<Record<string, unknown>>(sql, [request.user?.id]);
  response.json({ items: result.rows.map(rowToVaultItem) });
}));

router.get('/items/:id', asyncHandler(async (request, response) => {
  const itemId = String(request.params.id);
  const result = await query<Record<string, unknown>>(
    `SELECT vi.*,
       CASE WHEN vi.owner_id = $1 THEN 'manage'::share_permission ELSE vs.permission END AS permission,
       CASE WHEN vi.owner_id = $1 THEN vi.owner_encrypted_item_key ELSE vs.recipient_encrypted_item_key END AS encrypted_item_key,
       CASE WHEN vi.owner_id = $1 THEN vi.owner_item_key_iv ELSE vs.recipient_item_key_iv END AS item_key_iv,
       (
         SELECT count(*)
         FROM vault_shares share_count_rows
         WHERE share_count_rows.vault_item_id = vi.id
           AND share_count_rows.revoked_at IS NULL
           AND (share_count_rows.expires_at IS NULL OR share_count_rows.expires_at > now())
       ) AS share_count
     FROM vault_items vi
     LEFT JOIN vault_shares vs ON vs.vault_item_id = vi.id AND vs.recipient_user_id = $1 AND vs.revoked_at IS NULL
     WHERE vi.id = $2 AND vi.deleted_at IS NULL
       AND (vi.owner_id = $1 OR vs.recipient_user_id = $1)
     LIMIT 1`,
    [request.user?.id, itemId],
  );
  if (!result.rows[0]) {
    response.status(404).json({ error: 'Vault item not found' });
    return;
  }
  response.json({ item: rowToVaultItem(result.rows[0]) });
}));

router.post('/items', asyncHandler(async (request, response) => {
  const body = encryptedPayloadSchema.parse(request.body);
  const result = await query<Record<string, unknown>>(
    `INSERT INTO vault_items (
      owner_id, folder_id, type, title, url,
      encrypted_payload, payload_iv, payload_tag,
      owner_encrypted_item_key, owner_item_key_iv, notes_preview
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    RETURNING *,
      'manage'::share_permission AS permission,
      owner_encrypted_item_key AS encrypted_item_key,
      owner_item_key_iv AS item_key_iv`,
    [
      request.user?.id,
      body.folderId ?? null,
      body.type,
      body.title,
      body.url ?? null,
      JSON.stringify(body.encryptedPayload),
      body.payloadIv,
      body.payloadTag,
      body.ownerEncryptedItemKey,
      body.ownerItemKeyIv,
      body.notesPreview ?? null,
    ],
  );

  if (body.tagIds?.length) {
    for (const tagId of body.tagIds) {
      await query(
        `INSERT INTO vault_item_tags (vault_item_id, tag_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [result.rows[0].id, tagId],
      );
    }
  }

  await writeAuditLog({
    actorId: request.user?.id,
    action: 'created_vault_item',
    targetType: 'vault_item',
    targetId: result.rows[0].id as string,
  });

  response.status(201).json({ item: rowToVaultItem({ ...result.rows[0], tag_ids: body.tagIds ?? [] }) });
}));

router.patch('/items/:id', asyncHandler(async (request, response) => {
  const body = updateVaultItemSchema.parse(request.body);
  const itemId = String(request.params.id);
  const ownership = await query<{ id: string }>(
    `SELECT id FROM vault_items WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL`,
    [itemId, request.user?.id],
  );

  if (!ownership.rows[0]) {
    response.status(403).json({ error: 'Only the owner can update this item' });
    return;
  }

  const current = await query<Record<string, unknown>>('SELECT * FROM vault_items WHERE id = $1', [itemId]);
  await query(
    `INSERT INTO vault_item_versions (vault_item_id, actor_id, encrypted_payload, payload_iv, payload_tag)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      itemId,
      request.user?.id,
      JSON.stringify(current.rows[0].encrypted_payload),
      current.rows[0].payload_iv,
      current.rows[0].payload_tag,
    ],
  );

  const result = await query<Record<string, unknown>>(
    `UPDATE vault_items SET
      folder_id = COALESCE($1, folder_id),
      type = COALESCE($2::vault_item_type, type),
      title = COALESCE($3, title),
      url = COALESCE($4, url),
      encrypted_payload = COALESCE($5, encrypted_payload),
      payload_iv = COALESCE($6, payload_iv),
      payload_tag = COALESCE($7, payload_tag),
      owner_encrypted_item_key = COALESCE($8, owner_encrypted_item_key),
      owner_item_key_iv = COALESCE($9, owner_item_key_iv),
      favorite = COALESCE($10, favorite),
      notes_preview = COALESCE($11, notes_preview),
      updated_at = now()
     WHERE id = $12
     RETURNING *,
       'manage'::share_permission AS permission,
       owner_encrypted_item_key AS encrypted_item_key,
       owner_item_key_iv AS item_key_iv`,
    [
      body.folderId ?? null,
      body.type ?? null,
      body.title ?? null,
      body.url ?? null,
      body.encryptedPayload ? JSON.stringify(body.encryptedPayload) : null,
      body.payloadIv ?? null,
      body.payloadTag ?? null,
      body.ownerEncryptedItemKey ?? null,
      body.ownerItemKeyIv ?? null,
      body.favorite ?? null,
      body.notesPreview ?? null,
      itemId,
    ],
  );

  if (body.tagIds) {
    await query(`DELETE FROM vault_item_tags WHERE vault_item_id = $1`, [itemId]);
    for (const tagId of body.tagIds) {
      await query(
        `INSERT INTO vault_item_tags (vault_item_id, tag_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [itemId, tagId],
      );
    }
  }

  await writeAuditLog({
    actorId: request.user?.id,
    action: 'updated_vault_item',
    targetType: 'vault_item',
    targetId: itemId,
  });

  response.json({ item: rowToVaultItem({ ...result.rows[0], tag_ids: body.tagIds ?? [] }) });
}));

router.delete('/items/:id', asyncHandler(async (request, response) => {
  const itemId = String(request.params.id);
  const result = await query<Record<string, unknown>>(
    `UPDATE vault_items SET deleted_at = now(), updated_at = now()
     WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL
     RETURNING id`,
    [itemId, request.user?.id],
  );

  if (!result.rows[0]) {
    response.status(404).json({ error: 'Vault item not found' });
    return;
  }

  await writeAuditLog({
    actorId: request.user?.id,
    action: 'deleted_vault_item',
    targetType: 'vault_item',
    targetId: itemId,
    risk: 'medium',
  });

  response.json({ deleted: true });
}));

router.post('/items/:id/restore', asyncHandler(async (request, response) => {
  const itemId = String(request.params.id);
  const result = await query<Record<string, unknown>>(
    `UPDATE vault_items SET deleted_at = NULL, updated_at = now()
     WHERE id = $1 AND owner_id = $2 AND deleted_at IS NOT NULL
     RETURNING id`,
    [itemId, request.user?.id],
  );
  if (!result.rows[0]) {
    response.status(404).json({ error: 'Trashed item not found' });
    return;
  }
  await writeAuditLog({
    actorId: request.user?.id,
    action: 'restored_vault_item',
    targetType: 'vault_item',
    targetId: itemId,
  });
  response.json({ restored: true });
}));

// Permanent purge (only from trash).
router.delete('/items/:id/permanent', asyncHandler(async (request, response) => {
  const itemId = String(request.params.id);
  const result = await query<Record<string, unknown>>(
    `DELETE FROM vault_items
     WHERE id = $1 AND owner_id = $2 AND deleted_at IS NOT NULL
     RETURNING id`,
    [itemId, request.user?.id],
  );
  if (!result.rows[0]) {
    response.status(404).json({ error: 'Trashed item not found' });
    return;
  }
  await writeAuditLog({
    actorId: request.user?.id,
    action: 'purged_vault_item',
    targetType: 'vault_item',
    targetId: itemId,
    risk: 'high',
  });
  response.json({ purged: true });
}));

router.get('/items/:id/versions', asyncHandler(async (request, response) => {
  const itemId = String(request.params.id);
  const ownership = await query<{ id: string }>(
    `SELECT id FROM vault_items WHERE id = $1 AND owner_id = $2`,
    [itemId, request.user?.id],
  );
  if (!ownership.rows[0]) {
    response.status(403).json({ error: 'Only the owner can read history' });
    return;
  }
  const result = await query(
    `SELECT v.id, v.encrypted_payload, v.payload_iv, v.payload_tag,
            v.created_at, u.name AS actor_name
     FROM vault_item_versions v
     LEFT JOIN users u ON u.id = v.actor_id
     WHERE v.vault_item_id = $1
     ORDER BY v.created_at DESC
     LIMIT 50`,
    [itemId],
  );
  response.json({ versions: result.rows });
}));

export default router;
