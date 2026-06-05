import { existsSync } from 'node:fs';
import path from 'node:path';
import cors from 'cors';
import express from 'express';
import { config } from './config.js';
import { pool } from './db.js';
import auditRouter from './routes/audit.js';
import authRouter from './routes/auth.js';
import dashboardRouter from './routes/dashboard.js';
import extensionRouter from './routes/extension.js';
import foldersRouter from './routes/folders.js';
import sessionsRouter from './routes/sessions.js';
import sharesRouter from './routes/shares.js';
import tagsRouter from './routes/tags.js';
import totpRouter from './routes/totp.js';
import usersRouter from './routes/users.js';
import vaultRouter from './routes/vault.js';

const app = express();

app.set('trust proxy', true);

function isAllowedDevOrigin(origin: string) {
  if (config.nodeEnv !== 'development') return false;
  try {
    const parsed = new URL(origin);
    const isLocalHost = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
    const isVitePort = Number(parsed.port) >= 5173 && Number(parsed.port) <= 5180;
    return isLocalHost && isVitePort;
  } catch {
    return false;
  }
}

// True when the request's Origin matches the host it was served from — i.e. the
// web app talking to its own API (single-container deployment). The Vite script
// tag uses crossorigin, so even same-origin asset/API loads send an Origin header.
function isSameOrigin(origin: string, host?: string) {
  if (!host) return false;
  try { return new URL(origin).host === host; } catch { return false; }
}

// Per-request so we can compare the Origin against the request's own host.
app.use((request, response, next) => {
  cors({
    origin(origin, callback) {
      if (
        !origin
        || config.appOrigins.includes(origin)
        || isAllowedDevOrigin(origin)
        || isSameOrigin(origin, request.headers.host)
        || origin.startsWith('chrome-extension://')
        || origin.startsWith('moz-extension://')
      ) {
        callback(null, true);
        return;
      }
      // Deny gracefully (no CORS headers) instead of throwing a 500 — a thrown
      // error here would block the crossorigin app bundle and blank the page.
      callback(null, false);
    },
    credentials: true,
  })(request, response, next);
});
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', async (_request, response) => {
  const database = await pool.query('SELECT now() AS now');
  response.json({
    ok: true,
    service: 'pass-vault-api',
    databaseTime: database.rows[0].now,
  });
});

app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/vault', vaultRouter);
app.use('/api/vault', sharesRouter);
app.use('/api/audit', auditRouter);
app.use('/api/folders', foldersRouter);
app.use('/api/tags', tagsRouter);
app.use('/api/totp', totpRouter);
app.use('/api/sessions', sessionsRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/extension', extensionRouter);

// Single-container deployment: serve the built web app (dist/). The API stays
// under /api; every other path falls through to the SPA's index.html. Only
// enabled in production so the Vite dev server owns the frontend in development.
const webDir = path.resolve(process.cwd(), 'dist');
if (config.nodeEnv === 'production' && existsSync(webDir)) {
  app.use(express.static(webDir));
  app.use((request, response, next) => {
    if (request.method !== 'GET' || request.path.startsWith('/api')) {
      next();
      return;
    }
    response.sendFile(path.join(webDir, 'index.html'));
  });
}

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  if (error && typeof error === 'object' && 'issues' in error) {
    response.status(400).json({ error: 'Validation failed', details: error });
    return;
  }

  console.error(error);
  response.status(500).json({ error: 'Internal server error' });
});

app.listen(config.port, () => {
  console.log(`Pass Vault API listening on http://127.0.0.1:${config.port}`);
});
