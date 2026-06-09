import { useEffect, useState, type FormEvent } from 'react';
import { Activity, Fingerprint, LockKeyhole, ShieldCheck, Users } from 'lucide-react';
import { passVaultApi } from '../../api/passVaultApi';
import type { AuthSession } from '../../lib/appTypes';
import { ThemeToggle } from '../ui/ThemeToggle';

export function AuthScreen({ onAuthenticated }: { onAuthenticated: (session: AuthSession) => void }) {
  const [hasUsers, setHasUsers] = useState<boolean | null>(null);
  const [email, setEmail] = useState('');
  const [accountPassword, setAccountPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [needsTotp, setNeedsTotp] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    passVaultApi.bootstrapStatus()
      .then((status) => setHasUsers(status.hasUsers))
      .catch(() => setError('API is not reachable. Make sure the backend is running.'));
  }, []);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      const session = await passVaultApi.login(email, accountPassword, needsTotp ? totpCode : undefined);
      onAuthenticated(session);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Authentication failed';
      if (message.toLowerCase().includes('2fa')) setNeedsTotp(true);
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="auth-shell">
      <div className="auth-theme-toggle"><ThemeToggle variant="icon" /></div>
      <section className="login-layout">
        <aside className="login-hero">
          <div className="login-orb"><LockKeyhole size={34} /></div>
          <p className="eyebrow">Enterprise Password Manager</p>
          <h1>Secure access starts here.</h1>
          <p>Login with your organization account first. Your encrypted vault stays sealed until the master password unlock step.</p>
          <div className="login-proof-grid">
            <span><ShieldCheck size={18} /> AES-256 + RSA-OAEP</span>
            <span><Users size={18} /> Role-based access</span>
            <span><Activity size={18} /> Audit-ready actions</span>
          </div>
        </aside>

        <div className="auth-card login-card">
          <div className="auth-heading">
            <div className="brand-icon"><LockKeyhole size={24} /></div>
            <div><p className="eyebrow">E-Vault Password Manager</p><h2>Login</h2></div>
          </div>
          <p className="auth-copy">Use your admin-provided account. Signup is disabled by design.</p>
          <form className="auth-form" onSubmit={handleSubmit}>
            <label>
              Email address
              <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="admin@company.com" required autoFocus />
            </label>
            <label>
              Account password
              <input value={accountPassword} onChange={(e) => setAccountPassword(e.target.value)} type="password" placeholder="Enter your password" required />
            </label>
            {needsTotp && (
              <label>
                Two-factor code
                <input value={totpCode} onChange={(e) => setTotpCode(e.target.value)} type="text" placeholder="123456" maxLength={8} autoFocus />
                <small>Enter the 6-digit code from your authenticator app, or a backup code.</small>
              </label>
            )}
            {hasUsers === false && !error && <p className="warning-text">No admin account exists yet. Run the backend seed script first.</p>}
            {error && <p className="error-text">{error}</p>}
            <button className="primary-button full-width" disabled={loading || hasUsers === null}>
              {loading ? 'Checking access...' : needsTotp ? 'Verify 2FA' : 'Continue'}
            </button>
          </form>
          <div className="login-footer-note">
            <Fingerprint size={16} />
            <span>Next step: master password vault unlock.</span>
          </div>
        </div>
      </section>
    </main>
  );
}
