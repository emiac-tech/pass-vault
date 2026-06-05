# Pass Vault

Pass Vault is a Zoho Vault-style enterprise password manager — a web app, a backend API, a PostgreSQL schema, and a Chrome MV3 browser extension.

## What's included

**Web app (Vite + React + TypeScript):**
- Account login, master password vault unlock, invitation acceptance
- Dashboard with real metrics (counts, vault health score, category distribution, 14-day activity)
- Passwords panel with type filters (web login, app login, SSH, database, secure note, API key), folder/tag filters, favorites, shared by/with me, trash
- Vault item modals for all 6 types with inline password generator, strength meter, HIBP breach check
- Folders & Tags CRUD
- Sharing modal with RSA-OAEP recipient key wrapping, permission scopes, expiry
- Settings: profile, sessions revocation, 2FA TOTP enroll/disable, extension device pairing, master password change (re-keys all owned items)
- Reports panel with one-click health scan (breach + strength across all items)
- Audit panel with risk/action filters and CSV export (admin)
- Import (CSV) and export (encrypted JSON)
- User management (invite, activate/deactivate, role change, delete with required ownership transfer)

**Backend API (Express + TypeScript):**
- `auth`: bootstrap, login (with TOTP), me, invite acceptance, master + account password change, logout
- `users`: list, directory (for share picker), invite, status/role updates, delete with transfer
- `vault`: items CRUD with version history, restore, purge, single fetch
- `vault/shares`: list, create, revoke (RSA-wrapped per recipient)
- `folders`, `tags`: full CRUD, tag-to-item assignment
- `totp`: setup, enable, disable (RFC 6238, no dependency)
- `sessions`: list, revoke individual, revoke all
- `dashboard`: personal + team metrics
- `audit`: filtered list, personal feed, CSV export
- `extension`: pair-code, redeem, me, items, devices (list/revoke)

**Browser extension (Chrome Manifest V3):**
- Popup with pair code redemption, master unlock, item list, search, item detail, autofill action
- Background service worker holding master key + RSA private key (auto-locks after 30 min)
- Content script that detects password fields and injects a Pass Vault button with site-matched suggestions
- All decryption happens client-side; the API only sees encrypted blobs and wrapped keys

**Crypto model:**
- Master password → PBKDF2-SHA256, 310,000 iterations → 256-bit master key
- Each user has an RSA-OAEP 2048 keypair; private key wrapped with the master key
- Each vault item has a per-item AES-256-GCM key
- Owner copy: item key wrapped symmetrically with the master key
- Share copy: item key wrapped asymmetrically with the recipient's RSA public key
- Server never sees plaintext secrets or any unwrapped key

## Local setup

1. Copy environment config:

   ```sh
   cp .env.example .env
   ```
2. Start PostgreSQL:

   ```sh
   docker compose up -d postgres
   ```
3. Run migrations:

   ```sh
   npm run db:migrate
   ```
4. Seed the super admin:

   ```sh
   ADMIN_EMAIL=admin@local ADMIN_PASSWORD=changeMeNow12345 npm run seed:super-admin
   ```
5. Start API and web app:

   ```sh
   npm run dev:all
   ```

Open `http://localhost:5173` and log in with the seeded admin. Set up 2FA from Settings if you want it. Generate a pair code in Settings → Browser Extension to install the extension.

## Loading the browser extension

1. Open `chrome://extensions`
2. Enable Developer Mode
3. Click "Load unpacked" and pick the `extension/` directory
4. Click the Pass Vault icon, enter the pair code from the web app, then unlock with the same master password

The default API base URL is `http://127.0.0.1:4000/api`. Change it from the extension settings if you deploy elsewhere.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev:web` | Vite web app on port 5173 |
| `npm run dev:api` | Express API on port 4000 |
| `npm run dev:all` | Both, concurrently |
| `npm run db:migrate` | Apply SQL migrations from `database/` |
| `npm run seed:super-admin` | Create or update a local super admin |
| `npm run build` | Type-check and build production web assets |
| `npm run build:api` | Type-check and compile backend API |
| `npm run lint` | ESLint |

## API surface (high level)

```
POST   /api/auth/register-first-admin
POST   /api/auth/login                  (supports TOTP)
GET    /api/auth/me
GET    /api/auth/bootstrap-status
GET    /api/auth/invite/:token
POST   /api/auth/accept-invite
POST   /api/auth/change-master-password
POST   /api/auth/change-password
POST   /api/auth/logout

GET    /api/users
GET    /api/users/directory             (for share picker)
POST   /api/users/invite
PATCH  /api/users/:id/status
PATCH  /api/users/:id/role
DELETE /api/users/:id                   (requires transferToUserId)

GET    /api/vault/items
GET    /api/vault/items/:id
POST   /api/vault/items
PATCH  /api/vault/items/:id
DELETE /api/vault/items/:id             (soft delete)
POST   /api/vault/items/:id/restore
DELETE /api/vault/items/:id/permanent
GET    /api/vault/items/:id/versions

GET    /api/vault/items/:itemId/shares
POST   /api/vault/items/:itemId/shares
DELETE /api/vault/shares/:shareId

GET    /api/folders
POST   /api/folders
PATCH  /api/folders/:id
DELETE /api/folders/:id

GET    /api/tags
POST   /api/tags
DELETE /api/tags/:id
PUT    /api/tags/items/:itemId          (set tag assignments)

POST   /api/totp/setup
POST   /api/totp/enable
POST   /api/totp/disable
GET    /api/totp/status

GET    /api/sessions
DELETE /api/sessions/:id
POST   /api/sessions/revoke-all

GET    /api/dashboard/metrics
GET    /api/dashboard/team-metrics

GET    /api/audit
GET    /api/audit/me
GET    /api/audit/export.csv

POST   /api/extension/pair-code
POST   /api/extension/redeem            (anonymous, returns long-lived token)
GET    /api/extension/me
GET    /api/extension/items
GET    /api/extension/devices
DELETE /api/extension/devices/:id
```

## Security model

- Signup is closed; users are admin-invited only
- All credential payloads encrypted client-side with per-item AES-256-GCM keys
- The API stores ciphertext blobs, IVs, GCM tags, and wrapped key material only
- Cross-user shares use RSA-OAEP wrapping with each recipient's public key
- Master password change re-wraps the RSA private key and every owned item key in a single transaction
- TOTP is enforced at login when enabled, with one-time backup codes
- Audit log captures actor, action, target, risk, metadata for every state change
- User deletion requires explicit ownership transfer; orphaned items are prevented at the API
