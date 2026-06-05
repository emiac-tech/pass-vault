import { useCallback, useEffect, useState } from 'react';
import { Key } from 'lucide-react';
import {
  passVaultApi, type ApiExtensionDevice, type ApiSession, type ApiUser, type ApiVaultItem,
} from '../../api/passVaultApi';
import type { VaultContext } from '../../lib/appTypes';
import { roleLabels, toDashboardRole } from '../../lib/constants';
import { Badge } from '../ui/Badge';
import { ChangeMasterPasswordModal } from '../modals/ChangeMasterPasswordModal';

export function SettingsPanel({
  ctx, onUserUpdate, onLogout, items,
}: {
  ctx: VaultContext;
  onUserUpdate: (user: ApiUser) => void;
  onLogout: () => void;
  items: ApiVaultItem[];
}) {
  const [sessions, setSessions] = useState<ApiSession[]>([]);
  const [devices, setDevices] = useState<ApiExtensionDevice[]>([]);
  const [totpEnabled, setTotpEnabled] = useState(Boolean(ctx.user.totpEnabled));
  const [totpSetup, setTotpSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);

  const [changeMasterOpen, setChangeMasterOpen] = useState(false);

  const refreshSettings = useCallback(async () => {
    const [s, d, t] = await Promise.all([
      passVaultApi.listSessions().catch(() => ({ sessions: [] })),
      passVaultApi.listExtensionDevices().catch(() => ({ devices: [] })),
      passVaultApi.totpStatus().catch(() => ({ enabled: false })),
    ]);
    setSessions(s.sessions);
    setDevices(d.devices);
    setTotpEnabled(t.enabled);
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { refreshSettings(); }, [refreshSettings]);

  const startTotpSetup = async () => {
    const result = await passVaultApi.totpSetup();
    setTotpSetup(result);
  };

  const enableTotp = async () => {
    if (!totpCode) return;
    const result = await passVaultApi.totpEnable(totpCode);
    setBackupCodes(result.backupCodes);
    setTotpSetup(null);
    setTotpCode('');
    setTotpEnabled(true);
    onUserUpdate({ ...ctx.user, totpEnabled: true });
  };

  const disableTotp = async () => {
    if (!totpCode) return;
    await passVaultApi.totpDisable(totpCode);
    setTotpCode('');
    setTotpEnabled(false);
    onUserUpdate({ ...ctx.user, totpEnabled: false });
  };

  return (
    <section className="panel-grid">
      <article className="panel-card">
        <p className="eyebrow">Profile</p>
        <h3>Account</h3>
        <div className="settings-list">
          <div><strong>Name</strong><span>{ctx.user.name}</span></div>
          <div><strong>Email</strong><span>{ctx.user.email}</span></div>
          <div><strong>Role</strong><span>{roleLabels[toDashboardRole(ctx.user.role)]}</span></div>
          <button className="ghost-button" onClick={() => setChangeMasterOpen(true)}><Key size={14} /> Change Master Password</button>
        </div>
      </article>

      <article className="panel-card">
        <p className="eyebrow">Two-Factor Authentication</p>
        <h3>{totpEnabled ? '2FA enabled' : 'Add a second factor'}</h3>
        {!totpEnabled && !totpSetup && (
          <button className="primary-button" onClick={startTotpSetup}>Start 2FA setup</button>
        )}
        {totpSetup && (
          <div className="totp-setup">
            <p className="muted">Add this secret to your authenticator (e.g. Google Authenticator, 1Password, Authy):</p>
            <code className="codeblock">{totpSetup.secret}</code>
            <p className="muted">Or scan this URI:</p>
            <code className="codeblock">{totpSetup.otpauthUrl}</code>
            <input className="text-input" value={totpCode} onChange={(e) => setTotpCode(e.target.value)} placeholder="Enter 6-digit code" maxLength={6} />
            <button className="primary-button" onClick={enableTotp}>Verify & Enable</button>
          </div>
        )}
        {totpEnabled && (
          <div className="totp-setup">
            <p className="muted">Enter your 2FA code to disable:</p>
            <input className="text-input" value={totpCode} onChange={(e) => setTotpCode(e.target.value)} placeholder="123456" maxLength={8} />
            <button className="danger-button" onClick={disableTotp}>Disable 2FA</button>
          </div>
        )}
        {backupCodes && (
          <div>
            <p className="eyebrow">Backup codes (save these — one-time use):</p>
            <div className="chip-grid">
              {backupCodes.map((code) => <span className="chip mono" key={code}>{code}</span>)}
            </div>
          </div>
        )}
      </article>

      <article className="panel-card">
        <p className="eyebrow">Sessions</p>
        <h3>Active sessions</h3>
        <div className="table-card">
          {sessions.map((session) => (
            <div className="table-row session-row" key={session.id}>
              <span><strong>{session.user_agent ?? 'Unknown client'}</strong><small>{session.ip_address ?? '—'}</small></span>
              <span>{new Date(session.created_at).toLocaleString()}</span>
              <span>{session.revoked_at ? <Badge tone="danger">Revoked</Badge> : <Badge tone="success">Active</Badge>}</span>
              <span>
                {!session.revoked_at && <button className="mini-button" onClick={() => passVaultApi.revokeSession(session.id).then(refreshSettings)}>Revoke</button>}
              </span>
            </div>
          ))}
        </div>
        <button className="danger-button" onClick={async () => { await passVaultApi.revokeAllSessions(); onLogout(); }}>
          Sign out everywhere
        </button>
      </article>

      <article className="panel-card">
        <p className="eyebrow">Browser Extension</p>
        <h3>Paired devices</h3>
        <div className="table-card">
          {devices.map((device) => (
            <div className="table-row session-row" key={device.id}>
              <span><strong>{device.name}</strong><small>{device.browser}</small></span>
              <span>Last seen: {device.last_seen_at ? new Date(device.last_seen_at).toLocaleString() : 'Never'}</span>
              <span><Badge tone="success">Active</Badge></span>
              <span><button className="mini-button" onClick={() => passVaultApi.revokeExtensionDevice(device.id).then(refreshSettings)}>Revoke</button></span>
            </div>
          ))}
          {devices.length === 0 && <p className="muted" style={{ padding: '0.5rem' }}>No paired devices yet.</p>}
        </div>
        <p className="muted" style={{ marginTop: '1rem' }}>
          The browser extension connects automatically when you're logged into Pass Vault in this browser — no pairing code needed. Just open the extension and unlock it with your master password.
        </p>
      </article>

      {changeMasterOpen && (
        <ChangeMasterPasswordModal
          ctx={ctx}
          items={items}
          onClose={() => setChangeMasterOpen(false)}
          onChanged={() => { setChangeMasterOpen(false); onLogout(); }}
        />
      )}
    </section>
  );
}
