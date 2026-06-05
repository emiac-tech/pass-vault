import { Router } from 'express';
import { query } from '../db.js';
import { asyncHandler, requireAuth, requireRoles } from '../middleware.js';

const router = Router();

router.use(requireAuth);

function buildFilter(request: { query: Record<string, unknown> }) {
  const limit = Math.min(Number(request.query.limit ?? 200), 1000);
  const risk = typeof request.query.risk === 'string' ? request.query.risk : null;
  const action = typeof request.query.action === 'string' ? request.query.action : null;
  const filters: string[] = [];
  const values: unknown[] = [];
  if (risk) {
    values.push(risk);
    filters.push(`al.risk = $${values.length}`);
  }
  if (action) {
    values.push(`%${action}%`);
    filters.push(`al.action ILIKE $${values.length}`);
  }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  return { where, values, limit };
}

router.get('/', requireRoles('super_admin', 'admin'), asyncHandler(async (request, response) => {
  const { where, values, limit } = buildFilter(request);
  const result = await query(
    `SELECT
       al.id, al.action, al.target_type, al.target_id, al.risk, al.metadata, al.created_at,
       u.name AS actor_name, u.email AS actor_email
     FROM audit_logs al
     LEFT JOIN users u ON u.id = al.actor_id
     ${where}
     ORDER BY al.created_at DESC
     LIMIT ${limit}`,
    values,
  );
  response.json({ events: result.rows });
}));

router.get('/export.csv', requireRoles('super_admin', 'admin'), asyncHandler(async (request, response) => {
  const { where, values } = buildFilter(request);
  const result = await query(
    `SELECT
       al.created_at, u.email AS actor_email, al.action,
       al.target_type, al.target_id, al.risk, al.metadata
     FROM audit_logs al
     LEFT JOIN users u ON u.id = al.actor_id
     ${where}
     ORDER BY al.created_at DESC
     LIMIT 5000`,
    values,
  );
  const escape = (value: unknown) => {
    const str = typeof value === 'string' ? value : JSON.stringify(value ?? '');
    return `"${str.replaceAll('"', '""')}"`;
  };
  const header = ['timestamp', 'actor', 'action', 'target_type', 'target_id', 'risk', 'metadata'].join(',');
  const rows = result.rows.map((row: Record<string, unknown>) =>
    [
      row.created_at,
      row.actor_email,
      row.action,
      row.target_type,
      row.target_id,
      row.risk,
      JSON.stringify(row.metadata ?? {}),
    ].map(escape).join(','),
  );
  response.setHeader('Content-Type', 'text/csv');
  response.setHeader('Content-Disposition', 'attachment; filename="pass-vault-audit.csv"');
  response.send([header, ...rows].join('\n'));
}));

// Personal activity feed — any user can read their own events.
router.get('/me', asyncHandler(async (request, response) => {
  const result = await query(
    `SELECT id, action, target_type, target_id, risk, metadata, created_at
     FROM audit_logs
     WHERE actor_id = $1
     ORDER BY created_at DESC
     LIMIT 100`,
    [request.user?.id],
  );
  response.json({ events: result.rows });
}));

export default router;
