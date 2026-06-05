import { useEffect, useState } from 'react';

export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'pass-vault-theme';

export function getStoredTheme(): Theme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch { /* ignore */ }
  // Fall back to the OS preference, defaulting to dark.
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches) {
    return 'light';
  }
  return 'dark';
}

export function applyTheme(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme);
  try { localStorage.setItem(STORAGE_KEY, theme); } catch { /* ignore */ }
}

// Applied once at module load so the very first paint matches the saved theme.
applyTheme(getStoredTheme());

/** Shared theme state hook — every consumer stays in sync via a storage event. */
export function useTheme(): [Theme, (next: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(() => getStoredTheme());

  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY && (event.newValue === 'light' || event.newValue === 'dark')) {
        setTheme(event.newValue);
      }
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);

  const update = (next: Theme) => {
    applyTheme(next);
    setTheme(next);
  };

  return [theme, update];
}
