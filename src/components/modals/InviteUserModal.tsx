import { useState, type FormEvent } from 'react';
import { Check, Copy, Mail } from 'lucide-react';
import { passVaultApi } from '../../api/passVaultApi';
import { ModalShell } from '../ui/ModalShell';

export function InviteUserModal({ onClose, onInvited }: { onClose: () => void; onInvited: (link: string) => void }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<'admin' | 'manager' | 'user'>('user');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState(false);
  const [emailError, setEmailError] = useState<string | undefined>(undefined);
  const [sentTo, setSentTo] = useState('');

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const result = await passVaultApi.inviteUser({ email, name: name || undefined, role });
      const fullLink = `${window.location.origin}/#/accept-invite/${encodeURIComponent(result.inviteToken)}`;
      setInviteLink(fullLink);
      setEmailSent(Boolean(result.emailSent));
      setEmailError(result.emailError);
      setSentTo(email);
      onInvited(fullLink);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invite failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalShell title="Invite User" onClose={onClose}
      footer={inviteLink ? <button className="primary-button" onClick={onClose}>Done</button> : (
        <>
          <button className="ghost-button" onClick={onClose}>Cancel</button>
          <button className="primary-button" onClick={handleSubmit} disabled={submitting || !email}>{submitting ? 'Creating…' : 'Send Invite'}</button>
        </>
      )}
    >
      {error && <p className="error-text">{error}</p>}
      {inviteLink ? (
        <>
          {emailSent ? (
            <p className="success-text"><Check size={16} /> Invitation email sent to <strong>{sentTo}</strong>.</p>
          ) : (
            <p className="warning-text"><Mail size={16} /> Email not sent{emailError ? ` (${emailError})` : ' — SMTP not configured'}. Share this link manually:</p>
          )}
          <p className="muted">The invitation link (expires in 7 days):</p>
          <code className="codeblock selectable">{inviteLink}</code>
          <button className="ghost-button" onClick={() => navigator.clipboard.writeText(inviteLink)}><Copy size={14} /> Copy link</button>
        </>
      ) : (
        <form className="modal-form" onSubmit={handleSubmit}>
          <label>Email <input className="text-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
          <label>Name (optional) <input className="text-input" value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label>Role
            <select className="text-input" value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'manager' | 'user')}>
              <option value="user">User</option>
              <option value="manager">Manager</option>
              <option value="admin">Admin</option>
            </select>
          </label>
        </form>
      )}
    </ModalShell>
  );
}
