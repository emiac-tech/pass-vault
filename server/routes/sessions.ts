import { Router } from 'express';
import { writeAuditLog } from '../audit.js';
import { query } from '../db.js';
import { asyncHandler, requireAuth } from '../middleware.js';

const router = Router();

router.use(requireAuth);

router.get('/', asyncHandler(async (request, response) => {
  const result = await query(
    `SELECT id, user_agent, ip_address::text, created_at, expires_at, revoked_at
     FROM sessions
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT 50`,
    [request.user?.id],
  );
  response.json({ sessions: result.rows });
}));

router.delete('/:id', asyncHandler(async (request, response) => {
  const result = await query(
    `UPDATE sessions SET revoked_at = now()
     WHERE id = $1 AND user_id = $2 RETURNING id`,
    [request.params.id, request.user?.id],
  );
  if (!result.rows[0]) {
    response.status(404).json({ error: 'Session not found' });
    return;
  }
  await writeAuditLog({
    actorId: request.user?.id,
    action: 'revoked_session',
    targetType: 'session',
    targetId: String(request.params.id),
    risk: 'medium',
  });
  response.json({ revoked: true });
}));

router.post('/revoke-all', asyncHandler(async (request, response) => {
  await query(`UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [
    request.user?.id,
  ]);
  await writeAuditLog({
    actorId: request.user?.id,
    action: 'revoked_all_sessions',
    targetType: 'session',
    risk: 'high',
  });
  response.json({ revokedAll: true });
}));

export default router;
