import { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import type { ApiVaultItem } from '../../api/passVaultApi';
import { isPasswordBreached, scorePassword, type StrengthResult } from '../../crypto/vaultCrypto';
import type { VaultContext } from '../../lib/appTypes';
import { decryptItemPayload } from '../../lib/vaultHelpers';
import { encryptionFlow, securityControls } from '../../security';
import { Badge } from '../ui/Badge';

export function ReportsPanel({ items, ctx }: { items: ApiVaultItem[]; ctx: VaultContext }) {
  const [scanning, setScanning] = useState(false);
  const [results, setResults] = useState<Array<{ item: ApiVaultItem; strength: StrengthResult; breached: boolean; breachCount: number }>>([]);

  const runScan = async () => {
    setScanning(true);
    setResults([]);
    const owned = items.filter((item) => item.ownerId === ctx.user.id && !item.deletedAt && item.type !== 'secure_note');
    const collected: typeof results = [];
    for (const item of owned) {
      try {
        const payload = await decryptItemPayload(item, ctx);
        const password = payload.password ?? payload.apiKey ?? '';
        if (!password) continue;
        const strength = scorePassword(password);
        const breach = strength.score >= 2 ? await isPasswordBreached(password) : { breached: false, count: 0 };
        collected.push({ item, strength, breached: breach.breached, breachCount: breach.count });
      } catch { /* skip */ }
    }
    setResults(collected);
    setScanning(false);
  };

  return (
    <section className="security-layout">
      <article className="panel-card">
        <p className="eyebrow">AES-256 + RSA-OAEP</p>
        <h3>Encryption flow</h3>
        <div className="timeline security-flow">
          {encryptionFlow.map((step, index) => (
            <div className="timeline-row" key={step}>
              <span>{index + 1}</span>
              <p>{step}</p>
            </div>
          ))}
        </div>
        <div style={{ marginTop: '1rem' }}>
          <button className="primary-button" onClick={runScan} disabled={scanning}>
            {scanning ? 'Scanning…' : 'Run health scan'}
          </button>
        </div>
        {results.length > 0 && (
          <div className="report-summary">
            <p className="eyebrow">Findings</p>
            <ul>
              {results.filter((r) => r.strength.score <= 1 || r.breached).map((row) => (
                <li key={row.item.id}>
                  <strong>{row.item.title}</strong>
                  {row.breached && <Badge tone="danger">Breached × {row.breachCount}</Badge>}
                  {row.strength.score <= 1 && <Badge tone="warning">{row.strength.label}</Badge>}
                </li>
              ))}
              {results.every((r) => r.strength.score > 1 && !r.breached) && <li><Badge tone="success">All scanned items healthy.</Badge></li>}
            </ul>
          </div>
        )}
      </article>
      <article className="panel-card">
        <p className="eyebrow">Security Controls</p>
        <h3>Built-in guardrails</h3>
        <ul className="check-list">
          {securityControls.map((control) => <li key={control}><CheckCircle2 size={18} /> {control}</li>)}
        </ul>
      </article>
    </section>
  );
}
