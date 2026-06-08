// Browser extension pairing flow:
//   1. Web app: POST /api/extension/pair-code -> returns a short numeric code (5 min TTL).
//   2. Extension: POST /api/extension/redeem with the code + device info -> returns long-lived token.
//   3. Extension: uses Bearer <token> for subsequent API calls.

import { Router } from 'express';
import type { Request } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { writeAuditLog } from '../audit.js';
import { config } from '../config.js';
import { createOpaqueToken, hashToken } from '../crypto.js';
import { query } from '../db.js';
import { asyncHandler, requireAuth } from '../middleware.js';
import type { AuthUser } from '../types.js';

const router = Router();

function generateNumericCode(length = 8) {
  let code = '';
  for (let index = 0; index < length; index += 1) {
    code += Math.floor(Math.random() * 10).toString();
  }
  return code;
}

// Authenticated: ask the API for a pairing code.
router.post('/pair-code', requireAuth, asyncHandler(async (request, response) => {
  const code = generateNumericCode(8);
  await query(
    `INSERT INTO extension_pairing_codes (user_id, code_hash, expires_at)
     VALUES ($1, $2, now() + interval '5 minutes')`,
    [request.user?.id, hashToken(code)],
  );
  response.json({ code, expiresInSeconds: 300 });
}));

const redeemSchema = z.object({
  code: z.string().min(6).max(12),
  deviceName: z.string().min(1).max(64),
  browser: z.string().min(1).max(32),
});

const extensionItemSchema = z.object({
  title: z.string().min(1).max(160),
  url: z.string().optional(),
  type: z.enum(['website_login', 'app_login', 'server_ssh', 'database', 'secure_note', 'api_key']).default('website_login'),
  encrypted_payload: z.record(z.string(), z.unknown()),
  payload_iv: z.string().min(8),
  payload_tag: z.string().min(8),
  owner_encrypted_item_key: z.string().min(8),
  owner_item_key_iv: z.string().min(8),
  recovery_wrapped_item_key: z.string().optional(),
  notes_preview: z.string().max(120).optional(),
});

const extensionUpdateSchema = z.object({
  title: z.string().min(1).max(160).optional(),
  url: z.string().optional(),
  encrypted_payload: z.record(z.string(), z.unknown()),
  payload_iv: z.string().min(8),
  payload_tag: z.string().min(8),
  owner_encrypted_item_key: z.string().min(8),
  owner_item_key_iv: z.string().min(8),
  recovery_wrapped_item_key: z.string().optional(),
  notes_preview: z.string().max(120).optional(),
});

// Unauthenticated: redeem the pairing code.
router.post('/redeem', asyncHandler(async (request, response) => {
  const body = redeemSchema.parse(request.body);
  const codeRow = await query<{ id: string; user_id: string }>(
    `SELECT id, user_id FROM extension_pairing_codes
     WHERE code_hash = $1 AND consumed_at IS NULL AND expires_at > now()
     ORDER BY created_at DESC LIMIT 1`,
    [hashToken(body.code)],
  );
  if (!codeRow.rows[0]) {
    response.status(400).json({ error: 'Invalid or expired pairing code' });
    return;
  }
  const userId = codeRow.rows[0].user_id;
  const token = createOpaqueToken();
  const deviceResult = await query<{ id: string }>(
    `INSERT INTO extension_devices (user_id, name, browser, token_hash, last_seen_at)
     VALUES ($1, $2, $3, $4, now())
     RETURNING id`,
    [userId, body.deviceName, body.browser, hashToken(token)],
  );
  await query(
    `UPDATE extension_pairing_codes SET consumed_at = now() WHERE id = $1`,
    [codeRow.rows[0].id],
  );

  const user = await query<{ id: string; email: string; name: string; public_key: string | null; encrypted_private_key: string | null; private_key_iv: string | null; master_key_salt: string | null }>(
    `SELECT id, email, name, public_key, encrypted_private_key, private_key_iv, master_key_salt FROM users WHERE id = $1`,
    [userId],
  );
  await writeAuditLog({
    actorId: userId,
    action: 'paired_extension',
    targetType: 'extension_device',
    targetId: deviceResult.rows[0].id,
    risk: 'medium',
    metadata: { browser: body.browser, device: body.deviceName },
  });

  response.json({
    token,
    deviceId: deviceResult.rows[0].id,
    user: user.rows[0],
  });
}));

// Extension uses its own bearer token header. We accept it by checking extension_devices.
async function authenticateExtensionToken(token: string | undefined) {
  if (!token) return null;
  const result = await query<{ id: string; user_id: string }>(
    `SELECT id, user_id FROM extension_devices
     WHERE token_hash = $1 AND revoked_at IS NULL`,
    [hashToken(token)],
  );
  return result.rows[0] ?? null;
}

async function requireExtensionDevice(request: Request): Promise<{ id: string | null; user_id: string } | null> {
  const header = request.header('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
  if (!token) return null;
  let resolved: { id: string | null; user_id: string } | null = null;
  // 1) Legacy paired-device token.
  const device = await authenticateExtensionToken(token);
  if (device) {
    resolved = device;
  } else {
    // 2) Web app account session (JWT). Lets the extension auto-connect from the
    //    logged-in web app in the same browser — no pairing code needed.
    try {
      const payload = jwt.verify(token, config.jwtSecret) as AuthUser;
      if (payload?.id) resolved = { id: null, user_id: payload.id };
    } catch {
      // Not a valid account token either.
    }
  }
  if (!resolved) return null;
  // Block deactivated accounts from using the extension.
  const account = await query<{ status: string }>('SELECT status FROM users WHERE id = $1', [resolved.user_id]);
  if (account.rows[0]?.status !== 'active') return null;
  return resolved;
}

router.get('/me', asyncHandler(async (request, response) => {
  const device = await requireExtensionDevice(request);
  if (!device) {
    response.status(401).json({ error: 'Invalid extension token' });
    return;
  }
  if (device.id) {
    await query(`UPDATE extension_devices SET last_seen_at = now() WHERE id = $1`, [device.id]);
  }
  const user = await query(
    `SELECT id, email, name, public_key, encrypted_private_key, private_key_iv, master_key_salt
     FROM users WHERE id = $1`,
    [device.user_id],
  );
  response.json({ user: user.rows[0], deviceId: device.id });
}));

// Extension fetches items using its own token.
router.get('/items', asyncHandler(async (request, response) => {
  const device = await requireExtensionDevice(request);
  if (!device) {
    response.status(401).json({ error: 'Invalid extension token' });
    return;
  }
  const result = await query(
    `SELECT
       vi.id, vi.title, vi.url, vi.type, vi.owner_id,
       vi.encrypted_payload, vi.payload_iv, vi.payload_tag,
       vi.owner_encrypted_item_key AS encrypted_item_key,
       vi.owner_item_key_iv AS item_key_iv,
       vi.owner_key_wrap,
       'manage'::share_permission AS permission
     FROM vault_items vi
     WHERE vi.owner_id = $1 AND vi.deleted_at IS NULL
     UNION ALL
     SELECT
       vi.id, vi.title, vi.url, vi.type, vi.owner_id,
       vi.encrypted_payload, vi.payload_iv, vi.payload_tag,
       vs.recipient_encrypted_item_key AS encrypted_item_key,
       vs.recipient_item_key_iv AS item_key_iv,
       'rsa'::text AS owner_key_wrap,
       vs.permission
     FROM vault_items vi
     JOIN vault_shares vs ON vs.vault_item_id = vi.id
     JOIN users recipient ON recipient.id = vs.recipient_user_id
     WHERE vs.recipient_user_id = $1
       AND vi.deleted_at IS NULL AND vs.revoked_at IS NULL
       AND recipient.encrypted_private_key IS NOT NULL
       AND recipient.private_key_iv IS NOT NULL
       AND (vs.expires_at IS NULL OR vs.expires_at > now())`,
    [device.user_id],
  );
  response.json({ items: result.rows });
}));

router.post('/items', asyncHandler(async (request, response) => {
  const device = await requireExtensionDevice(request);
  if (!device) {
    response.status(401).json({ error: 'Invalid extension token' });
    return;
  }
  const body = extensionItemSchema.parse(request.body);
  const result = await query(
    `INSERT INTO vault_items (
       owner_id, type, title, url,
       encrypted_payload, payload_iv, payload_tag,
       owner_encrypted_item_key, owner_item_key_iv, recovery_wrapped_item_key, notes_preview
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id, title, url, type, owner_id,
       encrypted_payload, payload_iv, payload_tag,
       owner_encrypted_item_key AS encrypted_item_key,
       owner_item_key_iv AS item_key_iv,
       owner_key_wrap,
       'manage'::share_permission AS permission`,
    [
      device.user_id,
      body.type,
      body.title,
      body.url ?? null,
      JSON.stringify(body.encrypted_payload),
      body.payload_iv,
      body.payload_tag,
      body.owner_encrypted_item_key,
      body.owner_item_key_iv,
      body.recovery_wrapped_item_key ?? null,
      body.notes_preview ?? null,
    ],
  );

  await writeAuditLog({
    actorId: device.user_id,
    action: 'extension_saved_credential',
    targetType: 'vault_item',
    targetId: result.rows[0].id,
    risk: 'medium',
    metadata: { url: body.url, deviceId: device.id },
  });

  response.status(201).json({ item: result.rows[0] });
}));

// Update an existing credential from the extension (e.g. the password changed on
// a site you already have saved). Owner-only — the extension re-encrypts the
// payload locally, so the server only ever sees ciphertext + wrapped key.
router.patch('/items/:id', asyncHandler(async (request, response) => {
  const device = await requireExtensionDevice(request);
  if (!device) {
    response.status(401).json({ error: 'Invalid extension token' });
    return;
  }
  const itemId = String(request.params.id);
  const body = extensionUpdateSchema.parse(request.body);

  const current = await query<{ encrypted_payload: unknown; payload_iv: string; payload_tag: string }>(
    `SELECT encrypted_payload, payload_iv, payload_tag FROM vault_items
     WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL`,
    [itemId, device.user_id],
  );
  if (!current.rows[0]) {
    response.status(403).json({ error: 'Only the owner can update this item' });
    return;
  }

  // Snapshot the previous payload for version history.
  await query(
    `INSERT INTO vault_item_versions (vault_item_id, actor_id, encrypted_payload, payload_iv, payload_tag)
     VALUES ($1, $2, $3, $4, $5)`,
    [itemId, device.user_id, JSON.stringify(current.rows[0].encrypted_payload), current.rows[0].payload_iv, current.rows[0].payload_tag],
  );

  const result = await query(
    `UPDATE vault_items SET
       title = COALESCE($1, title),
       url = COALESCE($2, url),
       encrypted_payload = $3,
       payload_iv = $4,
       payload_tag = $5,
       owner_encrypted_item_key = $6,
       owner_item_key_iv = $7,
       recovery_wrapped_item_key = COALESCE($8, recovery_wrapped_item_key),
       notes_preview = COALESCE($9, notes_preview),
       updated_at = now()
     WHERE id = $10 AND owner_id = $11
     RETURNING id, title, url, type, owner_id,
       encrypted_payload, payload_iv, payload_tag,
       owner_encrypted_item_key AS encrypted_item_key,
       owner_item_key_iv AS item_key_iv,
       owner_key_wrap,
       'manage'::share_permission AS permission`,
    [
      body.title ?? null,
      body.url ?? null,
      JSON.stringify(body.encrypted_payload),
      body.payload_iv,
      body.payload_tag,
      body.owner_encrypted_item_key,
      body.owner_item_key_iv,
      body.recovery_wrapped_item_key ?? null,
      body.notes_preview ?? null,
      itemId,
      device.user_id,
    ],
  );

  await writeAuditLog({
    actorId: device.user_id,
    action: 'extension_updated_credential',
    targetType: 'vault_item',
    targetId: itemId,
    risk: 'medium',
    metadata: { url: body.url, deviceId: device.id },
  });

  response.json({ item: result.rows[0] });
}));

router.get('/devices', requireAuth, asyncHandler(async (request, response) => {
  const result = await query(
    `SELECT id, name, browser, last_seen_at, created_at, revoked_at
     FROM extension_devices
     WHERE user_id = $1 AND revoked_at IS NULL
     ORDER BY last_seen_at DESC NULLS LAST`,
    [request.user?.id],
  );
  response.json({ devices: result.rows });
}));

router.delete('/devices/:id', requireAuth, asyncHandler(async (request, response) => {
  const result = await query(
    `UPDATE extension_devices SET revoked_at = now()
     WHERE id = $1 AND user_id = $2 RETURNING id`,
    [request.params.id, request.user?.id],
  );
  if (!result.rows[0]) {
    response.status(404).json({ error: 'Device not found' });
    return;
  }
  await writeAuditLog({
    actorId: request.user?.id,
    action: 'revoked_extension_device',
    targetType: 'extension_device',
    targetId: String(request.params.id),
    risk: 'medium',
  });
  response.json({ revoked: true });
}));

export default router;
