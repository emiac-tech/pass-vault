import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../../lib/theme';

export function ThemeToggle({ variant = 'segmented' }: { variant?: 'segmented' | 'icon' }) {
  const [theme, setTheme] = useTheme();
  const isLight = theme === 'light';

  if (variant === 'icon') {
    return (
      <button
        type="button"
        className="icon-button theme-toggle-icon"
        onClick={() => setTheme(isLight ? 'dark' : 'light')}
        aria-label={isLight ? 'Switch to dark theme' : 'Switch to light theme'}
        title={isLight ? 'Switch to dark theme' : 'Switch to light theme'}
      >
        {isLight ? <Moon size={16} /> : <Sun size={16} />}
      </button>
    );
  }

  return (
    <div className="theme-toggle" role="group" aria-label="Color theme">
      <button
        type="button"
        className={!isLight ? 'theme-toggle-option active' : 'theme-toggle-option'}
        onClick={() => setTheme('dark')}
        aria-pressed={!isLight}
      >
        <Moon size={15} /> Dark
      </button>
      <button
        type="button"
        className={isLight ? 'theme-toggle-option active' : 'theme-toggle-option'}
        onClick={() => setTheme('light')}
        aria-pressed={isLight}
      >
        <Sun size={15} /> Light
      </button>
    </div>
  );
}
