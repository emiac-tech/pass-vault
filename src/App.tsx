import { useEffect, useRef, useState } from 'react';
import { passVaultApi, type ApiUser } from './api/passVaultApi';
import { generateUserKeypair, unwrapPrivateKey } from './crypto/vaultCrypto';
import { sessionStorageKey, type AuthSession } from './lib/appTypes';
import { clearVaultSession, IDLE_MS, loadVaultSession, saveVaultSession, touchVaultSession } from './lib/vaultSession';
import { AuthScreen } from './components/auth/AuthScreen';
import { MasterUnlockScreen } from './components/auth/MasterUnlockScreen';
import { AcceptInviteScreen } from './components/auth/AcceptInviteScreen';
import { Dashboard } from './components/Dashboard';

function App() {
  // Hash-based router: #/accept-invite/<token> for invitation acceptance.
  const [route, setRoute] = useState(() => window.location.hash);
  useEffect(() => {
    const handler = () => setRoute(window.location.hash);
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);

  const inviteMatch = route.match(/^#\/accept-invite\/(.+)$/);
  if (inviteMatch) {
    return <AcceptInviteScreen token={decodeURIComponent(inviteMatch[1])} onDone={() => (window.location.hash = '')} />;
  }

  // Deep link from the browser extension to manage sharing for a specific item.
  const shareMatch = route.match(/^#\/share\/(.+)$/);
  const initialShareItemId = shareMatch ? decodeURIComponent(shareMatch[1]) : null;

  return <Shell initialShareItemId={initialShareItemId} />;
}

function Shell({ initialShareItemId = null }: { initialShareItemId?: string | null }) {
  const [session, setSession] = useState<AuthSession | null>(() => {
    const saved = localStorage.getItem(sessionStorageKey);
    if (!saved) return null;
    try {
      const parsed = JSON.parse(saved) as AuthSession;
      passVaultApi.setToken(parsed.token);
      return parsed;
    } catch {
      localStorage.removeItem(sessionStorageKey);
      return null;
    }
  });
  const [vault, setVault] = useState<{ masterKey: CryptoKey; privateKey: CryptoKey | null } | null>(null);
  // While we check IndexedDB for a still-valid unlocked vault on first load, so we
  // don't flash the master-password screen before restoring it.
  const [restoring, setRestoring] = useState(Boolean(session));

  // Restore the unlocked vault across refreshes (within the idle window).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (session) {
        const restored = await loadVaultSession(session.user.id);
        if (!cancelled && restored) {
          if (!session.user.encryptedPrivateKey || !session.user.privateKeyIv) {
            const keypair = await generateUserKeypair(restored.masterKey);
            const repaired = await passVaultApi.repairKeypair({
              publicKey: keypair.publicKey,
              encryptedPrivateKey: keypair.encryptedPrivateKey,
              privateKeyIv: keypair.privateKeyIv,
            });
            const repairedVault = {
              masterKey: restored.masterKey,
              privateKey: await unwrapPrivateKey(keypair.encryptedPrivateKey, keypair.privateKeyIv, restored.masterKey),
            };
            const nextSession = { ...session, user: repaired.user };
            localStorage.setItem(sessionStorageKey, JSON.stringify(nextSession));
            setSession(nextSession);
            setVault(repairedVault);
            await saveVaultSession(session.user.id, repairedVault.masterKey, repairedVault.privateKey);
          } else {
            setVault(restored);
          }
          await touchVaultSession();
        }
      }
      if (!cancelled) setRestoring(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The API client fires this when our token is rejected (expired, deleted, or the
  // account was deactivated). Drop the session and fall back to the login screen.
  useEffect(() => {
    const onUnauthorized = () => {
      localStorage.removeItem(sessionStorageKey);
      passVaultApi.setToken(undefined);
      clearVaultSession();
      setSession(null);
      setVault(null);
    };
    window.addEventListener('pass-vault-unauthorized', onUnauthorized);
    return () => window.removeEventListener('pass-vault-unauthorized', onUnauthorized);
  }, []);

  // Auto-lock the vault after IDLE_MS of no activity (and keep the stored
  // last-activity fresh, throttled, so a refresh restores within the window).
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTouch = useRef(0);
  useEffect(() => {
    if (!session || !vault) return;
    const lock = () => { clearVaultSession(); setVault(null); };
    const onActivity = () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(lock, IDLE_MS);
      const now = Date.now();
      if (now - lastTouch.current > 60_000) { lastTouch.current = now; touchVaultSession(); }
    };
    const events: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'wheel', 'touchstart'];
    events.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    onActivity();
    return () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
      events.forEach((e) => window.removeEventListener(e, onActivity));
    };
  }, [session, vault]);

  const handleAuthenticated = (nextSession: AuthSession) => {
    passVaultApi.setToken(nextSession.token);
    localStorage.setItem(sessionStorageKey, JSON.stringify(nextSession));
    setSession(nextSession);
    setVault(null);
  };

  const handleLogout = async () => {
    try { await passVaultApi.logout(); } catch { /* ignore */ }
    localStorage.removeItem(sessionStorageKey);
    passVaultApi.setToken(undefined);
    clearVaultSession();
    setSession(null);
    setVault(null);
  };

  const handleUnlocked = (masterKey: CryptoKey, privateKey: CryptoKey | null, repairedUser?: ApiUser) => {
    if (session && repairedUser) {
      const next = { ...session, user: repairedUser };
      localStorage.setItem(sessionStorageKey, JSON.stringify(next));
      setSession(next);
    }
    setVault({ masterKey, privateKey });
    if (session) saveVaultSession(session.user.id, masterKey, privateKey);
  };

  if (!session) return <AuthScreen onAuthenticated={handleAuthenticated} />;
  if (restoring) {
    return <main className="auth-shell"><p className="muted">Unlocking your vault…</p></main>;
  }
  if (!vault) {
    return (
      <MasterUnlockScreen
        user={session.user}
        onBack={handleLogout}
        onUnlocked={handleUnlocked}
      />
    );
  }
  return (
    <Dashboard
      key={session.user.id}
      session={session}
      vault={vault}
      initialShareItemId={initialShareItemId}
      onLogout={handleLogout}
      onUserUpdate={(user) => {
        const next = { ...session, user };
        localStorage.setItem(sessionStorageKey, JSON.stringify(next));
        setSession(next);
      }}
    />
  );
}

export default App;
