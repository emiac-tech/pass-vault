import { KeyRound, Share2, Users } from 'lucide-react';
import { roleLabels, toDashboardRole } from '../../lib/constants';
import { Badge } from '../ui/Badge';

export interface UserStatRow {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  savedCount: number;
  sharedCount: number;
}

export function UserPasswordStats({ stats }: { stats: UserStatRow[] }) {
  const totalSaved = stats.reduce((acc, s) => acc + s.savedCount, 0);
  const totalShared = stats.reduce((acc, s) => acc + s.sharedCount, 0);

  return (
    <article className="panel-card user-stats-card">
      <div className="card-header">
        <div><p className="eyebrow">Team breakdown</p><h3>Passwords by user</h3></div>
        <span className="muted">{stats.length} users · {totalSaved} saved · {totalShared} shared</span>
      </div>

      {stats.length === 0 ? (
        <div className="empty-card">
          <Users size={26} />
          <strong>No users yet.</strong>
          <p className="muted">Invite teammates to see their saved and shared password counts here.</p>
        </div>
      ) : (
        <div className="user-stats-table" role="table">
          <div className="user-stats-row user-stats-head" role="row">
            <span role="columnheader">User</span>
            <span role="columnheader">Role</span>
            <span className="num" role="columnheader"><KeyRound size={14} /> Saved</span>
            <span className="num" role="columnheader"><Share2 size={14} /> Shared</span>
          </div>
          {stats.map((s) => {
            const role = toDashboardRole(s.role as never);
            const inactive = s.status !== 'active';
            return (
              <div className={inactive ? 'user-stats-row is-inactive' : 'user-stats-row'} role="row" key={s.id}>
                <div className="user-stats-id">
                  <span className="user-stats-avatar">{(s.name || s.email || '?').charAt(0).toUpperCase()}</span>
                  <div className="user-stats-who">
                    <strong>{s.name || '—'}</strong>
                    <span>{s.email}</span>
                  </div>
                </div>
                <span><Badge tone={role === 'super-admin' || role === 'admin' ? 'success' : 'neutral'}>{roleLabels[role] ?? s.role}</Badge></span>
                <span className="num">{s.savedCount}</span>
                <span className="num">{s.sharedCount}</span>
              </div>
            );
          })}
        </div>
      )}
    </article>
  );
}
