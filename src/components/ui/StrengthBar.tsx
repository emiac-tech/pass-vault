import type { StrengthResult } from '../../crypto/vaultCrypto';

export function StrengthBar({ strength }: { strength: StrengthResult }) {
  const tone = strength.score >= 3 ? 'success' : strength.score === 2 ? 'warning' : 'danger';
  return (
    <div className="strength-bar">
      <div className={`fill ${tone}`} style={{ width: `${(strength.score / 4) * 100}%` }} />
      <small>{strength.label} · {Math.round(strength.entropy)} bits entropy</small>
    </div>
  );
}
