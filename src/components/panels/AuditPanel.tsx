import { useCallback, useEffect, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { passVaultApi, type ApiAuditEvent } from '../../api/passVaultApi';
import { Badge } from '../ui/Badge';

export function AuditPanel({ canExport }: { canExport: boolean }) {
  const [events, setEvents] = useState<ApiAuditEvent[]>([]);
  const [risk, setRisk] = useState<string>('');
  const [search, setSearch] = useState('');

  const fetchEvents = useCallback(async () => {
    try {
      const result = await passVaultApi.listAudit({ risk: risk || undefined, action: search || undefined });
      setEvents(result.events);
    } catch (err) {
      console.error(err);
    }
  }, [risk, search]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { fetchEvents(); }, [fetchEvents]);

  return (
    <section className="panel-card">
      <div className="panel-toolbar">
        <div><p className="eyebrow">Traceability</p><h3>Audit Logs</h3></div>
        <div className="toolbar-actions">
          <select className="text-input" value={risk} onChange={(e) => setRisk(e.target.value)}>
            <option value="">All risk levels</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
          <input className="text-input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Action contains…" />
          <button className="ghost-button" onClick={fetchEvents}><RefreshCw size={14} /> Refresh</button>
          {canExport && (
            <a className="ghost-button" href={`${import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:4000/api'}/audit/export.csv`} target="_blank" rel="noreferrer">
              <Download size={14} /> CSV
            </a>
          )}
        </div>
      </div>
      <div className="table-card audit-table">
        <div className="table-row table-head"><span>Actor</span><span>Action</span><span>Target</span><span>Time</span><span>Risk</span></div>
        {events.map((event) => (
          <div className="table-row" key={event.id}>
            <span><strong>{event.actor_name ?? 'System'}</strong><small>{event.actor_email}</small></span>
            <span>{event.action.replaceAll('_', ' ')}</span>
            <span>{event.target_type}{event.target_id ? `#${event.target_id.slice(0, 8)}` : ''}</span>
            <span>{new Date(event.created_at).toLocaleString()}</span>
            <span><Badge tone={event.risk === 'high' ? 'danger' : event.risk === 'medium' ? 'warning' : 'success'}>{event.risk}</Badge></span>
          </div>
        ))}
        {events.length === 0 && <p className="muted" style={{ padding: '1rem' }}>No events recorded.</p>}
      </div>
    </section>
  );
}
