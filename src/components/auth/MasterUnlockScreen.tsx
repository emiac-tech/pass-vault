import { useState, type FormEvent } from 'react';
import { Fingerprint, ShieldCheck } from 'lucide-react';
import { passVaultApi } from '../../api/passVaultApi';
import type { ApiUser } from '../../api/passVaultApi';
import { deriveMasterKey, generateUserKeypair, unwrapPrivateKey } from '../../crypto/vaultCrypto';
import { ThemeToggle } from '../ui/ThemeToggle';

export function MasterUnlockScreen({
  user, onBack, onUnlocked,
}: {
  user: ApiUser;
  onBack: () => void;
  onUnlocked: (masterKey: CryptoKey, privateKey: CryptoKey | null, repairedUser?: ApiUser) => void;
}) {
  const [masterPassword, setMasterPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleUnlock = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (!user.masterKeySalt) throw new Error('Master key salt missing for this user. Reset required.');
      const masterKey = await deriveMasterKey(masterPassword, user.masterKeySalt);
      let privateKey: CryptoKey | null = null;
      let repairedUser: ApiUser | undefined;
      if (user.encryptedPrivateKey && user.privateKeyIv) {
        try {
          privateKey = await unwrapPrivateKey(user.encryptedPrivateKey, user.privateKeyIv, masterKey);
        } catch {
          throw new Error('Master password incorrect (cannot unwrap private key).');
        }
      } else {
        const keypair = await generateUserKeypair(masterKey);
        const repaired = await passVaultApi.repairKeypair({
          publicKey: keypair.publicKey,
          encryptedPrivateKey: keypair.encryptedPrivateKey,
          privateKeyIv: keypair.privateKeyIv,
        });
        repairedUser = repaired.user;
        privateKey = await unwrapPrivateKey(keypair.encryptedPrivateKey, keypair.privateKeyIv, masterKey);
      }
      onUnlocked(masterKey, privateKey, repairedUser);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Vault unlock failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="auth-shell">
      <div className="auth-theme-toggle"><ThemeToggle variant="icon" /></div>
      <section className="login-layout unlock-layout">
        <aside className="login-hero">
          <div className="login-orb"><Fingerprint size={34} /></div>
          <p className="eyebrow">Second Security Step</p>
          <h1>Unlock your encrypted vault.</h1>
          <p>Account login confirms who you are. The master password derives the local AES-256 key that opens vault data and decrypts your private key.</p>
        </aside>
        <div className="auth-card login-card">
          <div className="auth-heading">
            <div className="brand-icon"><ShieldCheck size={24} /></div>
            <div><p className="eyebrow">Master Password</p><h2>Vault Unlock</h2></div>
          </div>
          <p className="auth-copy">Logged in as <strong>{user.email}</strong>.</p>
          <form className="auth-form" onSubmit={handleUnlock}>
            <label>
              Master password
              <input value={masterPassword} onChange={(e) => setMasterPassword(e.target.value)} type="password" placeholder="Enter master password" required autoFocus />
              <small>The master password stays in the browser and is never sent to the backend.</small>
            </label>
            {error && <p className="error-text">{error}</p>}
            <button className="primary-button full-width" disabled={loading}>{loading ? 'Unlocking...' : 'Unlock Vault'}</button>
            <button className="ghost-button full-width" type="button" onClick={onBack}>Back to Login</button>
          </form>
        </div>
      </section>
    </main>
  );
}
