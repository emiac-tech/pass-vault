import { useEffect, useState, type FormEvent } from 'react';
import { Eye, EyeOff, Mail, UserPlus } from 'lucide-react';
import { passVaultApi } from '../../api/passVaultApi';
import { deriveMasterKey, generateUserKeypair, randomSalt } from '../../crypto/vaultCrypto';
import { sessionStorageKey } from '../../lib/appTypes';
import { ThemeToggle } from '../ui/ThemeToggle';

const MIN_PASSWORD = 12;

export function AcceptInviteScreen({ token, onDone }: { token: string; onDone: () => void }) {
  const [invitation, setInvitation] = useState<{ email: string; role: string } | null>(null);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    passVaultApi.getInvite(token)
      .then(({ invitation }) => setInvitation({ email: invitation.email, role: invitation.role }))
      .catch((err) => setError(err instanceof Error ? err.message : 'Invitation invalid'));
  }, [token]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      if (!invitation) throw new Error('No invitation loaded');
      if (password.length < MIN_PASSWORD) throw new Error(`Password must be at least ${MIN_PASSWORD} characters.`);
      if (password !== confirmPassword) throw new Error('Passwords do not match.');
      // One password is used for BOTH login and unlocking the vault. The user can
      // change either independently later from Settings.
      const masterKeySalt = randomSalt();
      const masterKey = await deriveMasterKey(password, masterKeySalt);
      const keypair = await generateUserKeypair(masterKey);
      const result = await passVaultApi.acceptInvite({
        token,
        name,
        password,
        publicKey: keypair.publicKey,
        encryptedPrivateKey: keypair.encryptedPrivateKey,
        privateKeyIv: keypair.privateKeyIv,
        masterKeySalt,
      });
      passVaultApi.setToken(result.token);
      localStorage.setItem(sessionStorageKey, JSON.stringify(result));
      window.location.hash = '';
      onDone();
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to accept invitation');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="auth-shell">
      <div className="auth-theme-toggle"><ThemeToggle variant="icon" /></div>
      <section className="login-layout">
        <aside className="login-hero">
          <div className="login-orb"><UserPlus size={34} /></div>
          <p className="eyebrow">Welcome to E-Vault Password Manager</p>
          <h1>Set up your account.</h1>
          <p>Choose one password — it logs you in <em>and</em> unlocks your vault. It never leaves your browser, and you can change your master password anytime from Settings.</p>
        </aside>
        <div className="auth-card login-card">
          <div className="auth-heading">
            <div className="brand-icon"><Mail size={24} /></div>
            <div>
              <p className="eyebrow">Invitation</p>
              <h2>Accept Invite</h2>
            </div>
          </div>
          {error && <p className="error-text">{error}</p>}
          {invitation && (
            <>
              <p className="auth-copy">Invited as <strong>{invitation.email}</strong> ({invitation.role}).</p>
              <form className="auth-form" onSubmit={handleSubmit}>
                <label>
                  Full name
                  <input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} placeholder="Your full name" />
                </label>
                <label>
                  Password
                  <div className="auth-input-reveal">
                    <input value={password} onChange={(e) => setPassword(e.target.value)} type={showPassword ? 'text' : 'password'} required minLength={MIN_PASSWORD} placeholder="At least 12 characters" autoComplete="new-password" />
                    <button type="button" className="auth-reveal-btn" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? 'Hide password' : 'Show password'}>
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  <small>Used to log in and to unlock your vault. We cannot recover it if you lose it.</small>
                </label>
                <label>
                  Confirm password
                  <div className="auth-input-reveal">
                    <input value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} type={showPassword ? 'text' : 'password'} required minLength={MIN_PASSWORD} placeholder="Re-enter your password" autoComplete="new-password" />
                  </div>
                  {confirmPassword.length > 0 && confirmPassword !== password && <small className="field-error">Passwords do not match.</small>}
                </label>
                <button className="primary-button full-width" disabled={submitting}>{submitting ? 'Generating keys...' : 'Activate Account'}</button>
              </form>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
