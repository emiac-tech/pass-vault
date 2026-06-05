import { Router } from 'express';
import { z } from 'zod';
import { writeAuditLog } from '../audit.js';
import { query } from '../db.js';
import { asyncHandler, requireAuth } from '../middleware.js';
import { generateBackupCodes, generateBase32Secret, otpAuthUrl, verifyTotp } from '../totp.js';

const router = Router();

const enableSchema = z.object({ code: z.string().min(6).max(6) });
const disableSchema = z.object({ code: z.string().min(6).max(8) });

router.use(requireAuth);

// Step 1: client requests a fresh secret to scan as a QR code.
router.post('/setup', asyncHandler(async (request, response) => {
  const secret = generateBase32Secret();
  const result = await query<{ email: string }>(
    `UPDATE users SET totp_secret = $1, totp_enabled = false WHERE id = $2 RETURNING email`,
    [secret, request.user?.id],
  );
  if (!result.rows[0]) {
    response.status(404).json({ error: 'User not found' });
    return;
  }
  response.json({
    secret,
    otpauthUrl: otpAuthUrl(result.rows[0].email, secret),
  });
}));

// Step 2: client confirms by submitting the current TOTP code.
router.post('/enable', asyncHandler(async (request, response) => {
  const body = enableSchema.parse(request.body);
  const userRow = await query<{ totp_secret: string | null }>(
    `SELECT totp_secret FROM users WHERE id = $1`,
    [request.user?.id],
  );
  const secret = userRow.rows[0]?.totp_secret;
  if (!secret) {
    response.status(400).json({ error: 'Call /totp/setup first' });
    return;
  }
  if (!verifyTotp(secret, body.code)) {
    response.status(400).json({ error: 'Invalid TOTP code' });
    return;
  }
  const backupCodes = generateBackupCodes();
  await query(
    `UPDATE users SET totp_enabled = true, totp_backup_codes = $1 WHERE id = $2`,
    [backupCodes, request.user?.id],
  );
  await writeAuditLog({
    actorId: request.user?.id,
    action: 'enabled_2fa',
    targetType: 'user',
    targetId: request.user?.id,
    risk: 'medium',
  });
  response.json({ enabled: true, backupCodes });
}));

router.post('/disable', asyncHandler(async (request, response) => {
  const body = disableSchema.parse(request.body);
  const userRow = await query<{ totp_secret: string | null; totp_backup_codes: string[] | null }>(
    `SELECT totp_secret, totp_backup_codes FROM users WHERE id = $1`,
    [request.user?.id],
  );
  const user = userRow.rows[0];
  if (!user?.totp_secret) {
    response.status(400).json({ error: '2FA not enabled' });
    return;
  }
  const valid = verifyTotp(user.totp_secret, body.code) || (user.totp_backup_codes ?? []).includes(body.code);
  if (!valid) {
    response.status(400).json({ error: 'Invalid TOTP or backup code' });
    return;
  }
  await query(
    `UPDATE users SET totp_enabled = false, totp_secret = NULL, totp_backup_codes = NULL WHERE id = $1`,
    [request.user?.id],
  );
  await writeAuditLog({
    actorId: request.user?.id,
    action: 'disabled_2fa',
    targetType: 'user',
    targetId: request.user?.id,
    risk: 'medium',
  });
  response.json({ disabled: true });
}));

router.get('/status', asyncHandler(async (request, response) => {
  const result = await query<{ totp_enabled: boolean }>(
    `SELECT totp_enabled FROM users WHERE id = $1`,
    [request.user?.id],
  );
  response.json({ enabled: Boolean(result.rows[0]?.totp_enabled) });
}));

export default router;
