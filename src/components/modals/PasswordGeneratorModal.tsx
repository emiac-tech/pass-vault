import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { generatePassword, scorePassword, type PasswordGenOptions } from '../../crypto/vaultCrypto';
import { ModalShell } from '../ui/ModalShell';
import { StrengthBar } from '../ui/StrengthBar';

export function PasswordGeneratorModal({ onClose, onUse }: { onClose: () => void; onUse: (password: string) => void }) {
  const [options, setOptions] = useState<PasswordGenOptions>({ length: 20, upper: true, lower: true, digits: true, symbols: true, excludeAmbiguous: true });
  const [password, setPassword] = useState(() => generatePassword({ length: 20, upper: true, lower: true, digits: true, symbols: true, excludeAmbiguous: true }));

  const regenerate = (next: PasswordGenOptions = options) => setPassword(generatePassword(next));
  // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect
  useEffect(() => regenerate(options), [options]);

  const strength = scorePassword(password);

  return (
    <ModalShell title="Password Generator" onClose={onClose}
      footer={
        <>
          <button className="ghost-button" onClick={onClose}>Cancel</button>
          <button className="ghost-button" onClick={() => regenerate()}><RefreshCw size={14} /> Regenerate</button>
          <button className="primary-button" onClick={() => onUse(password)}>Use Password</button>
        </>
      }
    >
      <code className="codeblock huge selectable">{password}</code>
      <StrengthBar strength={strength} />
      <label>
        Length: {options.length}
        <input type="range" min={8} max={64} value={options.length} onChange={(e) => setOptions({ ...options, length: Number(e.target.value) })} />
      </label>
      <div className="form-grid">
        <label className="check"><input type="checkbox" checked={options.upper} onChange={(e) => setOptions({ ...options, upper: e.target.checked })} /> Uppercase</label>
        <label className="check"><input type="checkbox" checked={options.lower} onChange={(e) => setOptions({ ...options, lower: e.target.checked })} /> Lowercase</label>
        <label className="check"><input type="checkbox" checked={options.digits} onChange={(e) => setOptions({ ...options, digits: e.target.checked })} /> Numbers</label>
        <label className="check"><input type="checkbox" checked={options.symbols} onChange={(e) => setOptions({ ...options, symbols: e.target.checked })} /> Symbols</label>
        <label className="check"><input type="checkbox" checked={options.excludeAmbiguous} onChange={(e) => setOptions({ ...options, excludeAmbiguous: e.target.checked })} /> Avoid look-alike characters</label>
      </div>
    </ModalShell>
  );
}
