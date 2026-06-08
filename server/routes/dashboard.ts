import { Router } from 'express';
import { query } from '../db.js';
import { asyncHandler, requireAuth, requireRoles } from '../middleware.js';

const router = Router();

router.use(requireAuth);

// Aggregated metrics for the dashboard panel. All values are derived from real data.
router.get('/metrics', asyncHandler(async (request, response) => {
  const userId = request.user?.id;
  const [items, folders, shares, expired, weakItems, audits] = await Promise.all([
    query<{ count: string }>(
      `SELECT count(*) FROM vault_items WHERE owner_id = $1 AND deleted_at IS NULL`,
      [userId],
    ),
    query<{ count: string }>(
      `SELECT count(*) FROM vault_folders WHERE owner_id = $1`,
      [userId],
    ),
    query<{ shared_by_me: string; shared_with_me: string }>(
      `SELECT
         (SELECT count(*) FROM vault_shares vs
           JOIN vault_items vi ON vi.id = vs.vault_item_id
           WHERE vi.owner_id = $1 AND vs.revoked_at IS NULL) AS shared_by_me,
         (SELECT count(*) FROM vault_shares WHERE recipient_user_id = $1 AND revoked_at IS NULL) AS shared_with_me`,
      [userId],
    ),
    query<{ count: string }>(
      `SELECT count(*) FROM vault_items
       WHERE owner_id = $1 AND deleted_at IS NULL
         AND updated_at < now() - interval '180 days'`,
      [userId],
    ),
    query<{ count: string }>(
      `SELECT count(*) FROM vault_items
       WHERE owner_id = $1 AND deleted_at IS NULL
         AND (encrypted_payload->>'ciphertext') IS NOT NULL`,
      [userId],
    ),
    query<{ count: string }>(
      `SELECT count(*) FROM audit_logs WHERE actor_id = $1`,
      [userId],
    ),
  ]);

  // Category distribution from real item types.
  const byType = await query<{ type: string; count: string }>(
    `SELECT type, count(*)::text FROM vault_items
     WHERE owner_id = $1 AND deleted_at IS NULL
     GROUP BY type`,
    [userId],
  );

  // Activity over the last 14 days for sparkline.
  const activity = await query<{ day: string; count: string }>(
    `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day, count(*)::text
     FROM audit_logs
     WHERE actor_id = $1 AND created_at > now() - interval '14 days'
     GROUP BY 1 ORDER BY 1`,
    [userId],
  );

  response.json({
    passwords: Number(items.rows[0].count),
    folders: Number(folders.rows[0].count),
    sharedByMe: Number(shares.rows[0].shared_by_me),
    sharedWithMe: Number(shares.rows[0].shared_with_me),
    expired: Number(expired.rows[0].count),
    auditCount: Number(audits.rows[0].count),
    totalItems: Number(weakItems.rows[0].count),
    byType: byType.rows.map((row) => ({ type: row.type, count: Number(row.count) })),
    activity: activity.rows.map((row) => ({ day: row.day, count: Number(row.count) })),
  });
}));

// Team-wide metrics for admins/super admins.
router.get('/team-metrics', asyncHandler(async (_request, response) => {
  const [users, items, shares, audits] = await Promise.all([
    query<{ count: string }>(`SELECT count(*) FROM users`),
    query<{ count: string }>(`SELECT count(*) FROM vault_items WHERE deleted_at IS NULL`),
    query<{ count: string }>(`SELECT count(*) FROM vault_shares WHERE revoked_at IS NULL`),
    query<{ count: string }>(`SELECT count(*) FROM audit_logs WHERE created_at > now() - interval '24 hours'`),
  ]);
  response.json({
    totalUsers: Number(users.rows[0].count),
    totalItems: Number(items.rows[0].count),
    activeShares: Number(shares.rows[0].count),
    auditEventsToday: Number(audits.rows[0].count),
  });
}));

// Org-wide per-user breakdown: how many passwords each user has saved (owns) and
// how many they have actively shared. Counts only — never item contents. Admins only.
router.get('/user-stats', requireRoles('super_admin', 'admin'), asyncHandler(async (_request, response) => {
  const result = await query<Record<string, unknown>>(
    `SELECT u.id, u.name, u.email, u.role, u.status,
       (SELECT count(*) FROM vault_items vi WHERE vi.owner_id = u.id AND vi.deleted_at IS NULL) AS saved_count,
       (SELECT count(*) FROM vault_shares vs WHERE vs.shared_by = u.id AND vs.revoked_at IS NULL) AS shared_count
     FROM users u
     ORDER BY saved_count DESC, u.name ASC`,
  );
  response.json({
    stats: result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role,
      status: row.status,
      savedCount: Number(row.saved_count ?? 0),
      sharedCount: Number(row.shared_count ?? 0),
    })),
  });
}));

export default router;
