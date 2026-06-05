import { useState, type FormEvent } from 'react';
import { passVaultApi } from '../../api/passVaultApi';
import { deriveMasterKey, generateUserKeypair, randomSalt } from '../../crypto/vaultCrypto';
import { ModalShell } from '../ui/ModalShell';

export function CreateUserModal({ onClose, onCreated }: { onClose: () => void; onCreated: (email: string) => void }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<'admin' | 'manager' | 'user'>('user');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    setSubmitting(true);
    try {
      // Generate the new user's keypair locally from the chosen password (used as
      // their master password). The server only ever receives the wrapped material.
      const masterKeySalt = randomSalt();
      const masterKey = await deriveMasterKey(password, masterKeySalt);
      const keypair = await generateUserKeypair(masterKey);
      await passVaultApi.createUser({
        email,
        name: name || undefined,
        role,
        password,
        publicKey: keypair.publicKey,
        encryptedPrivateKey: keypair.encryptedPrivateKey,
        privateKeyIv: keypair.privateKeyIv,
        masterKeySalt,
      });
      onCreated(email);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create user');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalShell
      title="Create User"
      onClose={onClose}
      footer={
        <>
          <button className="ghost-button" onClick={onClose}>Cancel</button>
          <button className="primary-button" onClick={handleSubmit} disabled={submitting || !email || !password}>{submitting ? 'Creating…' : 'Create User'}</button>
        </>
      }
    >
      {error && <p className="error-text">{error}</p>}
      <p className="muted">
        Create an active account directly. The password you set is used for both login and vault unlock —
        share it with the user so they can sign in (they can change it afterwards in Settings).
      </p>
      <form className="modal-form" onSubmit={handleSubmit}>
        <div className="form-grid">
          <label>Email <input className="text-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></label>
          <label>Name (optional) <input className="text-input" value={name} onChange={(e) => setName(e.target.value)} /></label>
        </div>
        <label>Role
          <select className="text-input" value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'manager' | 'user')}>
            <option value="user">User</option>
            <option value="manager">Manager</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <div className="form-grid">
          <label>Password <input className="text-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} placeholder="At least 8 characters" /></label>
          <label>Confirm password <input className="text-input" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required /></label>
        </div>
      </form>
    </ModalShell>
  );
}
