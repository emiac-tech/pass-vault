import { Router } from 'express';
import { z } from 'zod';
import { writeAuditLog } from '../audit.js';
import { query } from '../db.js';
import { asyncHandler, requireAuth } from '../middleware.js';

const router = Router();

const folderSchema = z.object({
  name: z.string().min(1).max(64),
});

router.use(requireAuth);

router.get('/', asyncHandler(async (request, response) => {
  const result = await query<{ id: string; name: string; created_at: Date; item_count: string }>(
    `SELECT f.id, f.name, f.created_at,
            count(vi.id)::text AS item_count
     FROM vault_folders f
     LEFT JOIN vault_items vi
       ON vi.folder_id = f.id AND vi.deleted_at IS NULL
     WHERE f.owner_id = $1
     GROUP BY f.id
     ORDER BY f.name ASC`,
    [request.user?.id],
  );
  response.json({
    folders: result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      createdAt: row.created_at,
      itemCount: Number(row.item_count),
    })),
  });
}));

router.post('/', asyncHandler(async (request, response) => {
  const body = folderSchema.parse(request.body);
  const result = await query<{ id: string; name: string; created_at: Date }>(
    `INSERT INTO vault_folders (owner_id, name)
     VALUES ($1, $2)
     ON CONFLICT (owner_id, name)
     DO UPDATE SET name = EXCLUDED.name
     RETURNING id, name, created_at`,
    [request.user?.id, body.name],
  );
  await writeAuditLog({
    actorId: request.user?.id,
    action: 'created_folder',
    targetType: 'vault_folder',
    targetId: result.rows[0].id,
  });
  response.status(201).json({ folder: { ...result.rows[0], itemCount: 0 } });
}));

router.patch('/:id', asyncHandler(async (request, response) => {
  const body = folderSchema.parse(request.body);
  const result = await query<{ id: string; name: string }>(
    `UPDATE vault_folders SET name = $1
     WHERE id = $2 AND owner_id = $3
     RETURNING id, name`,
    [body.name, request.params.id, request.user?.id],
  );
  if (!result.rows[0]) {
    response.status(404).json({ error: 'Folder not found' });
    return;
  }
  await writeAuditLog({
    actorId: request.user?.id,
    action: 'renamed_folder',
    targetType: 'vault_folder',
    targetId: result.rows[0].id,
  });
  response.json({ folder: result.rows[0] });
}));

router.delete('/:id', asyncHandler(async (request, response) => {
  const result = await query(
    `DELETE FROM vault_folders WHERE id = $1 AND owner_id = $2 RETURNING id`,
    [request.params.id, request.user?.id],
  );
  if (!result.rows[0]) {
    response.status(404).json({ error: 'Folder not found' });
    return;
  }
  await writeAuditLog({
    actorId: request.user?.id,
    action: 'deleted_folder',
    targetType: 'vault_folder',
    targetId: String(request.params.id),
  });
  response.json({ deleted: true });
}));

export default router;
