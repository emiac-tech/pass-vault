import { query } from './db.js';

export async function writeAuditLog(input: {
  actorId?: string;
  action: string;
  targetType: string;
  targetId?: string;
  risk?: 'low' | 'medium' | 'high';
  metadata?: Record<string, unknown>;
}) {
  await query(
    `INSERT INTO audit_logs (actor_id, action, target_type, target_id, risk, metadata)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      input.actorId ?? null,
      input.action,
      input.targetType,
      input.targetId ?? null,
      input.risk ?? 'low',
      JSON.stringify(input.metadata ?? {}),
    ],
  );
}
