import { Router } from 'express';
import { z } from 'zod';
import { writeAuditLog } from '../audit.js';
import { query } from '../db.js';
import { asyncHandler, requireAuth } from '../middleware.js';

const router = Router();

const tagSchema = z.object({
  name: z.string().min(1).max(32),
  color: z.string().min(1).max(16).optional(),
});

const assignSchema = z.object({
  tagIds: z.array(z.string().uuid()).default([]),
});

router.use(requireAuth);

router.get('/', asyncHandler(async (request, response) => {
  const result = await query(
    `SELECT t.id, t.name, t.color,
            count(vit.vault_item_id)::int AS usage_count
     FROM vault_tags t
     LEFT JOIN vault_item_tags vit ON vit.tag_id = t.id
     WHERE t.owner_id = $1
     GROUP BY t.id
     ORDER BY t.name ASC`,
    [request.user?.id],
  );
  response.json({ tags: result.rows });
}));

router.post('/', asyncHandler(async (request, response) => {
  const body = tagSchema.parse(request.body);
  const result = await query(
    `INSERT INTO vault_tags (owner_id, name, color)
     VALUES ($1, $2, $3)
     ON CONFLICT (owner_id, name) DO UPDATE SET color = EXCLUDED.color
     RETURNING id, name, color`,
    [request.user?.id, body.name, body.color ?? 'slate'],
  );
  await writeAuditLog({ actorId: request.user?.id, action: 'created_tag', targetType: 'vault_tag', targetId: String(result.rows[0].id) });
  response.status(201).json({ tag: result.rows[0] });
}));

router.delete('/:id', asyncHandler(async (request, response) => {
  const result = await query(
    `DELETE FROM vault_tags WHERE id = $1 AND owner_id = $2 RETURNING id`,
    [request.params.id, request.user?.id],
  );
  if (!result.rows[0]) {
    response.status(404).json({ error: 'Tag not found' });
    return;
  }
  await writeAuditLog({ actorId: request.user?.id, action: 'deleted_tag', targetType: 'vault_tag', targetId: String(request.params.id) });
  response.json({ deleted: true });
}));

// Assign / replace tags on an item.
router.put('/items/:itemId', asyncHandler(async (request, response) => {
  const body = assignSchema.parse(request.body);
  const itemId = String(request.params.itemId);

  const ownership = await query<{ id: string }>(
    `SELECT id FROM vault_items WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL`,
    [itemId, request.user?.id],
  );
  if (!ownership.rows[0]) {
    response.status(403).json({ error: 'Only the owner can tag this item' });
    return;
  }

  await query(`DELETE FROM vault_item_tags WHERE vault_item_id = $1`, [itemId]);
  for (const tagId of body.tagIds) {
    await query(
      `INSERT INTO vault_item_tags (vault_item_id, tag_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [itemId, tagId],
    );
  }
  response.json({ updated: true });
}));

export default router;
