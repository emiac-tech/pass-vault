import { useEffect, useState, type FormEvent } from 'react';
import { Mail, UserPlus } from 'lucide-react';
import { passVaultApi } from '../../api/passVaultApi';
import { deriveMasterKey, generateUserKeypair, randomSalt } from '../../crypto/vaultCrypto';
import { sessionStorageKey } from '../../lib/appTypes';
import { ThemeToggle } from '../ui/ThemeToggle';

export function AcceptInviteScreen({ token, onDone }: { token: string; onDone: () => void }) {
  const [invitation, setInvitation] = useState<{ email: string; role: string } | null>(null);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [accountPassword, setAccountPassword] = useState('');
  const [masterPassword, setMasterPassword] = useState('');
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
      if (masterPassword.length < 12) throw new Error('Master password must be at least 12 characters.');
      const masterKeySalt = randomSalt();
      const masterKey = await deriveMasterKey(masterPassword, masterKeySalt);
      const keypair = await generateUserKeypair(masterKey);
      const result = await passVaultApi.acceptInvite({
        token,
        name,
        password: accountPassword,
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
          <p className="eyebrow">Welcome to Pass Vault</p>
          <h1>Set up your account.</h1>
          <p>You will create two passwords: an account password (to log in) and a master password (to unlock vault data). The master password never leaves your browser.</p>
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
                  Account password
                  <input value={accountPassword} onChange={(e) => setAccountPassword(e.target.value)} type="password" required minLength={10} placeholder="At least 10 characters" />
                </label>
                <label>
                  Master password
                  <input value={masterPassword} onChange={(e) => setMasterPassword(e.target.value)} type="password" required minLength={12} placeholder="At least 12 characters" />
                  <small>This unlocks your vault. We cannot recover it if you lose it.</small>
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
