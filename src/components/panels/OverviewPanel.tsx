import { useEffect, useState } from 'react';
import {
  Activity, Folder, KeyRound, Share2, ShieldCheck, ShieldEllipsis, Users,
} from 'lucide-react';
import type { ApiUser, ApiVaultItem, DashboardMetrics } from '../../api/passVaultApi';
import { scorePassword } from '../../crypto/vaultCrypto';
import type { Scope, VaultContext } from '../../lib/appTypes';
import { decryptItemPayload } from '../../lib/vaultHelpers';
import { vaultItemTypeLabels, type Role, type VaultItemType } from '../../types';

export function OverviewPanel({
  role, scope, setScope, metrics, teamMetrics, items, users, ctx,
}: {
  role: Role;
  scope: Scope;
  setScope: (scope: Scope) => void;
  metrics: DashboardMetrics | null;
  teamMetrics: { totalUsers: number; totalItems: number; activeShares: number; auditEventsToday: number } | null;
  items: ApiVaultItem[];
  users: Array<ApiUser & { lastActiveAt?: string }>;
  ctx: VaultContext;
}) {
  const canViewTeam = role !== 'user';
  // My passwords = everything I can access = owned + shared with me (excludes trash).
  const myPasswords = items.filter((item) => !item.deletedAt).length;
  const stats = scope === 'team'
    ? [
      { label: 'Users', value: String(teamMetrics?.totalUsers ?? users.length), detail: 'All organization members', icon: Users },
      { label: 'Vault Items', value: String(teamMetrics?.totalItems ?? 0), detail: 'All passwords across users', icon: KeyRound },
      { label: 'Active Shares', value: String(teamMetrics?.activeShares ?? 0), detail: 'Live shares (not revoked)', icon: Share2 },
      { label: 'Audit Events (24h)', value: String(teamMetrics?.auditEventsToday ?? 0), detail: 'Tracked actions today', icon: Activity },
    ]
    : [
      { label: 'My Passwords', value: String(myPasswords), detail: 'Saved by me + shared with me', icon: KeyRound },
      { label: 'Folders', value: String(metrics?.folders ?? 0), detail: 'Personal organization', icon: Folder },
      { label: 'Shared by Me', value: String(metrics?.sharedByMe ?? 0), detail: 'Active outbound shares', icon: Share2 },
      { label: 'Aged Items', value: String(metrics?.expired ?? 0), detail: 'Older than 180 days', icon: ShieldCheck },
    ];

  return (
    <section className="dashboard-stack">
      <div className="dashboard-tabs">
        <button className={scope === 'mine' ? 'tab-button active' : 'tab-button'} onClick={() => setScope('mine')}>My Dashboard</button>
        {canViewTeam && <button className={scope === 'team' ? 'tab-button active' : 'tab-button'} onClick={() => setScope('team')}>Team Dashboard</button>}
      </div>
      <div className="dashboard-grid">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <article className="stat-card" key={stat.label}>
              <div className="stat-icon"><Icon size={22} /></div>
              <p>{stat.label}</p>
              <h3>{stat.value}</h3>
              <span>{stat.detail}</span>
            </article>
          );
        })}
        <HealthScoreCard items={items} ctx={ctx} />
        <CategoryDistributionCard metrics={metrics} />
        {scope === 'team' && canViewTeam && <ActivitySparkline metrics={metrics} />}
      </div>
    </section>
  );
}

function HealthScoreCard({ items, ctx }: { items: ApiVaultItem[]; ctx: VaultContext }) {
  // Decrypt each owned item's password, score it, and aggregate.
  const [report, setReport] = useState<{
    scanned: number;
    avgScore: number;
    weak: number;
    fair: number;
    strong: number;
    reused: number;
    healthy: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const owned = items.filter((item) => item.ownerId === ctx.user.id && !item.deletedAt && item.type !== 'secure_note');
      const scores: number[] = [];
      const passwords = new Map<string, number>();
      for (const item of owned.slice(0, 60)) {
        try {
          const payload = await decryptItemPayload(item, ctx);
          const password = payload.password ?? payload.apiKey ?? '';
          if (!password) continue;
          const score = scorePassword(password);
          scores.push(score.score);
          passwords.set(password, (passwords.get(password) ?? 0) + 1);
        } catch { /* skip */ }
      }
      const reused = Array.from(passwords.values()).filter((count) => count > 1).reduce((acc, count) => acc + count, 0);
      const weak = scores.filter((s) => s <= 1).length;
      const fair = scores.filter((s) => s === 2).length;
      const strong = scores.filter((s) => s >= 3).length;
      const scanned = scores.length;
      const healthy = Math.max(0, scanned - weak - reused);
      const avgScore = scanned ? (scores.reduce((a, b) => a + b, 0) / scanned) : 0;
      if (!cancelled) setReport({ scanned, avgScore, weak, fair, strong, reused, healthy });
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, ctx.masterKey, ctx.user.id]);

  const pct = report && report.scanned > 0 ? Math.round((report.avgScore / 4) * 100) : 0;
  const isEmpty = !report || report.scanned === 0;

  return (
    <article className="wide-card assessment-card">
      <div className="card-header">
        <div><p className="eyebrow">Password Assessment Score</p><h3>Vault health</h3></div>
        <ShieldEllipsis size={26} />
      </div>
      {isEmpty ? (
        <div className="empty-card">
          <ShieldCheck size={28} />
          <strong>No passwords to score yet.</strong>
          <p className="muted">Add a website login, app login, database, or API key and the health score will start tracking it.</p>
        </div>
      ) : (
        <div className="score-layout">
          <div className="score-donut" style={{ background: `radial-gradient(circle, var(--pv-surface-solid) 0 48%, transparent 49%), conic-gradient(#22d3ee 0 ${pct}%, rgba(148,163,184,0.18) ${pct}% 100%)` }}>{pct}%</div>
          <div className="score-rings">
            <div className="mini-ring danger"><strong>{report.weak}</strong><span>Weak</span></div>
            <div className="mini-ring warning"><strong>{report.fair}</strong><span>Fair</span></div>
            <div className="mini-ring success"><strong>{report.strong}</strong><span>Strong</span></div>
            <div className="mini-ring warning"><strong>{report.reused}</strong><span>Reused</span></div>
            <div className="mini-ring danger"><strong>0</strong><span>Breached</span></div>
            <div className="mini-ring success"><strong>{report.healthy}</strong><span>Healthy</span></div>
          </div>
        </div>
      )}
    </article>
  );
}

function CategoryDistributionCard({ metrics }: { metrics: DashboardMetrics | null }) {
  const buckets = metrics?.byType ?? [];
  const max = Math.max(1, ...buckets.map((b) => b.count));
  return (
    <article className="wide-card">
      <div className="card-header">
        <div><p className="eyebrow">Categories</p><h3>Items by type</h3></div>
        <span className="muted">{buckets.reduce((acc, bucket) => acc + bucket.count, 0)} total</span>
      </div>
      {buckets.length === 0 ? (
        <div className="empty-card">
          <Folder size={26} />
          <strong>Nothing here yet.</strong>
          <p className="muted">Add your first credential to see the distribution by type.</p>
        </div>
      ) : (
        <div className="bar-preview">
          {buckets.map((bucket) => (
            <div className="bar-column" key={bucket.type} title={`${bucket.count} items`}>
              <span style={{ height: `${Math.max(8, (bucket.count / max) * 100)}%` }} />
              <small>{vaultItemTypeLabels[bucket.type as VaultItemType] ?? bucket.type}</small>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

function ActivitySparkline({ metrics }: { metrics: DashboardMetrics | null }) {
  const points = metrics?.activity ?? [];
  const max = Math.max(1, ...points.map((p) => p.count));
  return (
    <article className="wide-card">
      <p className="eyebrow">Activity (14 days)</p>
      <div className="bar-preview">
        {points.map((point) => (
          <div className="bar-column" key={point.day}>
            <span style={{ height: `${Math.max(6, (point.count / max) * 100)}%` }} />
            <small>{point.day.slice(5)}</small>
          </div>
        ))}
      </div>
    </article>
  );
}
