// Service worker:
//  - Holds the in-memory master key after unlock (lost when SW unloads, by design).
//  - Holds the unwrapped RSA private key.
//  - Decrypts items on demand and replies to content scripts / popup.
//
// MV3 service workers can be torn down anytime. We accept that the user
// re-enters their master password if Chrome restarts.

import {
  deriveMasterKey, unwrapPrivateKey, unwrapItemKey, unwrapItemKeyWithPrivate,
  decryptVaultPayload, generateItemKey, encryptVaultPayload, wrapItemKey, fromBase64Url,
  importPublicKey, wrapItemKeyForRecipient,
} from './crypto.js';
import { api } from './api.js';

let masterKey = null;
let privateKey = null;
let cachedItems = [];
let cachedUser = null;
let cachedDecrypted = new Map(); // itemId -> { username, password, url, ... }
let unlockedAt = 0;
let itemsFetchedAt = 0;
let orgRecoveryPublicKey = null;

// How long a remembered username/fill step stays valid across the page navigation
// in a multi-step (email page -> password page) login flow.
const STEP_TTL_MS = 3 * 60 * 1000;

// Wrap an item key to the org recovery public key (fetched + cached once), so the
// item can be transferred by a super-admin. Returns undefined if recovery is off.
async function recoveryCopyFor(itemKey) {
  try {
    if (orgRecoveryPublicKey === null) {
      const result = await api.recoveryPublicKey();
      orgRecoveryPublicKey = result?.publicKey || '';
    }
    if (!orgRecoveryPublicKey) return undefined;
    const pub = await importPublicKey(orgRecoveryPublicKey);
    return await wrapItemKeyForRecipient(itemKey, pub);
  } catch {
    return undefined;
  }
}

function lock() {
  masterKey = null;
  privateKey = null;
  cachedDecrypted.clear();
  unlockedAt = 0;
  // Forget the stored password so it can't auto-unlock again until the user types it.
  try { chrome.storage.session.remove('vaultPassword'); } catch { /* ignore */ }
}

async function unlock(masterPassword) {
  const me = await api.me();
  cachedUser = me.user;
  if (!cachedUser?.master_key_salt) throw new Error('User has no master key salt — re-pair the extension.');
  const mk = await deriveMasterKey(masterPassword, cachedUser.master_key_salt);
  let pk = null;
  if (cachedUser.encrypted_private_key && cachedUser.private_key_iv) {
    try {
      pk = await unwrapPrivateKey(cachedUser.encrypted_private_key, cachedUser.private_key_iv, mk);
    } catch {
      throw new Error('Wrong master password.');
    }
  }
  masterKey = mk;
  privateKey = pk;
  unlockedAt = Date.now();
  // Persist in chrome.storage.session: in-memory, trusted-context only, and
  // automatically cleared when the browser is closed. This lets the vault stay
  // unlocked across MV3 service-worker restarts until the browser is shut down.
  try { await chrome.storage.session.set({ vaultPassword: masterPassword }); } catch { /* ignore */ }
  await refreshItems();
}

// Re-derive the keys after a service-worker restart (which wipes in-memory state)
// using the password kept in session storage — so the user isn't re-prompted
// until the browser itself is closed.
async function ensureUnlocked() {
  if (masterKey) return;
  let stored;
  try { stored = await chrome.storage.session.get('vaultPassword'); } catch { return; }
  if (stored?.vaultPassword) {
    try { await unlock(stored.vaultPassword); } catch { /* stale/invalid — stay locked */ }
  }
}

async function refreshItems() {
  if (!masterKey) return [];
  const result = await api.listItems();
  cachedItems = result.items;
  cachedDecrypted.clear();
  itemsFetchedAt = Date.now();
  await updateSavedIndex();
  return cachedItems;
}

// Re-fetch items if the cache is older than `ttl`, so changes made in the web app
// (e.g. moving an item to trash, edits) are reflected before we decide whether to
// offer a save/update prompt.
async function refreshIfStale(ttl = 60_000) {
  if (masterKey && Date.now() - itemsFetchedAt > ttl) {
    try { await refreshItems(); } catch { /* keep the existing cache on failure */ }
  }
}

// Maintain a non-secret index of {host, username} for the save-prompt dedup.
// Stored in chrome.storage so the content script can check it even when this
// service worker (and the master key) have been torn down. Contains no passwords.
async function updateSavedIndex() {
  if (!masterKey) return;
  const index = [];
  for (const item of cachedItems) {
    if (!item.url || item.type === 'secure_note') continue;
    try {
      const decrypted = await decryptOne(item);
      const host = hostFromUrl(item.url);
      if (host) index.push({ host, username: String(decrypted.username || '').trim().toLowerCase() });
    } catch { /* skip items we can't decrypt */ }
  }
  try { await chrome.storage.local.set({ savedCredIndex: index }); } catch { /* ignore */ }
}

async function decryptOne(item) {
  if (cachedDecrypted.has(item.id)) return cachedDecrypted.get(item.id);
  let payload;
  try {
    let itemKey;
    // Owner copy is normally master-key wrapped, EXCEPT right after a recovery
    // transfer (owner_key_wrap='rsa') — then it's RSA-wrapped to this owner's key.
    if (item.owner_id === cachedUser.id && item.owner_key_wrap !== 'rsa') {
      itemKey = await unwrapItemKey(item.encrypted_item_key, item.item_key_iv, masterKey);
    } else {
      if (!privateKey) throw new Error('Cannot read this item — no RSA private key.');
      itemKey = await unwrapItemKeyWithPrivate(item.encrypted_item_key, privateKey);
    }
    payload = await decryptVaultPayload(item, itemKey);
  } catch (error) {
    const ciphertext = item.encrypted_payload?.ciphertext;
    if (ciphertext) {
      const decoded = new TextDecoder().decode(fromBase64Url(ciphertext));
      const trimmed = decoded.trim();
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        payload = JSON.parse(trimmed);
      }
    }
    if (!payload) {
      throw new Error(
        item.owner_id === cachedUser?.id
          ? 'Could not decrypt this credential. Unlock again or update the saved item.'
          : 'Could not decrypt this shared credential. Ask the owner to share it again after your vault keys are repaired.',
      );
    }
  }
  const result = {
    id: item.id,
    title: item.title,
    url: item.url,
    type: item.type,
    permission: item.permission,
    username: payload.username || '',
    password: payload.password || payload.apiKey || '',
    notes: payload.notes || '',
  };
  cachedDecrypted.set(item.id, result);
  return result;
}

// Find items whose URL matches the current origin.
function matchItemsFor(origin) {
  if (!origin) return [];
  const host = hostFromUrl(origin);
  return cachedItems
    .filter((item) => item.url && item.type !== 'secure_note')
    .filter((item) => hostsMatch(host, hostFromUrl(item.url)));
}

function hostFromUrl(value) {
  try {
    const parsed = new URL(String(value).startsWith('http') ? value : `https://${value}`);
    return parsed.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return String(value || '').replace(/^www\./, '').toLowerCase();
  }
}

function hostsMatch(first, second) {
  if (!first || !second) return false;
  return first === second || first.endsWith(`.${second}`) || second.endsWith(`.${first}`);
}

async function hasSavedCredential(credential) {
  const matches = matchItemsFor(credential.url);
  const username = String(credential.username || '').trim().toLowerCase();
  for (const item of matches) {
    try {
      const decrypted = await decryptOne(item);
      const savedUsername = String(decrypted.username || '').trim().toLowerCase();
      if (!username || !savedUsername || username === savedUsername) return true;
    } catch {
      if (!username) return true;
    }
  }
  return false;
}

// Launch a vault item's URL in a new tab, then inject the credentials once
// the tab finishes loading. Used by the "open & login" button in the popup.
async function openAndLogin(itemId) {
  if (!masterKey) throw new Error('Vault locked');
  const item = cachedItems.find((c) => c.id === itemId);
  if (!item) throw new Error('Item not found');
  if (!item.url) throw new Error('This item has no URL.');
  const payload = await decryptOne(item);
  const rawUrl = String(item.url).trim();
  const target = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;

  const newTab = await chrome.tabs.create({ url: target, active: true });
  const tabId = newTab.id;
  if (typeof tabId !== 'number') return { tab: newTab };

  // Wait up to 20s for the tab to finish loading, then attempt autofill.
  const loaded = await new Promise((resolve) => {
    const timeout = setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); resolve(false); }, 20_000);
    const listener = (updatedTabId, info) => {
      if (updatedTabId !== tabId) return;
      if (info.status === 'complete') {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve(true);
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
  if (!loaded) return { tab: newTab };

  // Give SPAs a beat to render their login form.
  await new Promise((resolve) => setTimeout(resolve, 600));

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (username, password) => {
        const setValue = (field, value) => {
          if (!field) return false;
          field.focus();
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
          if (setter) setter.call(field, value ?? '');
          else field.value = value ?? '';
          field.dispatchEvent(new Event('input', { bubbles: true }));
          field.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        };
        const findUsername = () => {
          // Keyword-based (no blanket input[type=text]) — matches the content script.
          const sel = 'input[type="email"], input[type="tel"], input[autocomplete="username"], input[autocomplete="email"], input[name*="user" i], input[id*="user" i], input[class*="user" i], input[placeholder*="user" i], input[name*="email" i], input[id*="email" i], input[class*="email" i], input[placeholder*="email" i], input[name*="login" i], input[id*="login" i], input[class*="login" i], input[name="id" i], input[id="id" i], input[name*="userid" i], input[name*="loginid" i], input[name*="user_id" i], input[name*="login_id" i]';
          return Array.from(document.querySelectorAll(sel)).find((field) => field.offsetParent !== null && !field.disabled && !field.readOnly);
        };
        const passwordField = Array.from(document.querySelectorAll('input[type="password"]')).find((field) => field.offsetParent !== null && !field.disabled && !field.readOnly);
        setValue(findUsername(), username);
        setValue(passwordField, password);
      },
      args: [payload.username || '', payload.password || ''],
    });
  } catch (err) {
    // Page may have CSP/sandbox restrictions. We still opened the tab.
    return { tab: newTab, autofillError: String(err?.message || err) };
  }
  return { tab: newTab };
}

async function saveCapturedCredential(credential) {
  if (!masterKey) throw new Error('Vault locked');
  if (await hasSavedCredential(credential)) {
    throw new Error('This credential is already saved.');
  }
  const title = credential.title || (() => {
    try { return new URL(credential.url).hostname; } catch { return 'New Login'; }
  })();
  const itemKey = await generateItemKey();
  const encrypted = await encryptVaultPayload({
    username: credential.username || '',
    password: credential.password || '',
    url: credential.url || '',
    notes: 'Saved from E-Vault Password Manager browser extension.',
  }, itemKey);
  const wrapped = await wrapItemKey(itemKey, masterKey);
  const recovery_wrapped_item_key = await recoveryCopyFor(itemKey);
  const result = await api.createItem({
    title,
    url: credential.url || '',
    type: 'website_login',
    ...encrypted,
    ...wrapped,
    recovery_wrapped_item_key,
    notes_preview: credential.username || 'Saved from browser',
  });
  await refreshItems();
  return result.item;
}

function normUser(value) {
  return String(value || '').trim().toLowerCase();
}

// Classify a captured login against the user's OWNED saved items on the same host:
//   new             — host not saved
//   saved           — same host + username + password already saved (no prompt)
//   update-password — same host + username, different password (offer update)
//   new-username    — same host, different username (offer save-new or update-existing)
// Sites the user opted out of saving (via the "Don't ask for this site" checkbox).
// Non-secret host list in chrome.storage.local; cleared on disconnect (per user).
async function isHostIgnored(host) {
  try {
    const { pvNeverSaveHosts } = await chrome.storage.local.get(['pvNeverSaveHosts']);
    return Array.isArray(pvNeverSaveHosts) && pvNeverSaveHosts.includes(host);
  } catch { return false; }
}

async function classifyCredential(credential) {
  await ensureUnlocked();
  await refreshIfStale();
  const host = hostFromUrl(credential.url || '');
  if (!host) return { kind: 'new' };
  if (await isHostIgnored(host)) return { kind: 'ignored' };
  const uname = normUser(credential.username);

  if (masterKey && cachedUser) {
    const owned = cachedItems.filter((item) =>
      item.url && item.type !== 'secure_note'
      && item.owner_id === cachedUser.id
      && hostsMatch(host, hostFromUrl(item.url)),
    );
    if (owned.length === 0) return { kind: 'new' };
    for (const item of owned) {
      let decrypted;
      try { decrypted = await decryptOne(item); } catch { continue; }
      if (uname && normUser(decrypted.username) === uname) {
        if ((decrypted.password || '') === (credential.password || '')) return { kind: 'saved' };
        return { kind: 'update-password', item: { id: item.id, title: item.title } };
      }
    }
    // Same domain, but no saved item with this username.
    const first = owned[0];
    return { kind: 'new-username', item: { id: first.id, title: first.title } };
  }

  // Locked: fall back to the host/username index (no password comparison possible).
  try {
    const { savedCredIndex } = await chrome.storage.local.get(['savedCredIndex']);
    const matches = (savedCredIndex || []).filter((e) => hostsMatch(host, e.host));
    if (matches.length === 0) return { kind: 'new' };
    if (!uname || matches.some((e) => e.username && e.username === uname)) return { kind: 'saved' };
    return { kind: 'new' };
  } catch {
    return { kind: 'new' };
  }
}

async function updateCapturedCredential(itemId, credential) {
  if (!masterKey) throw new Error('Vault locked');
  const item = cachedItems.find((c) => c.id === itemId);
  if (!item) throw new Error('Item not found');
  if (item.owner_id !== cachedUser?.id) throw new Error('Only the owner can update this credential.');
  const itemKey = await unwrapItemKey(item.encrypted_item_key, item.item_key_iv, masterKey);
  let existing = {};
  try { existing = await decryptVaultPayload(item, itemKey); } catch { existing = {}; }
  const payload = {
    ...existing,
    username: credential.username || existing.username || '',
    password: credential.password || '',
    url: credential.url || existing.url || item.url || '',
  };
  const encrypted = await encryptVaultPayload(payload, itemKey);
  const wrapped = await wrapItemKey(itemKey, masterKey);
  const recovery_wrapped_item_key = await recoveryCopyFor(itemKey);
  const result = await api.updateItem(itemId, {
    title: item.title,
    url: credential.url || item.url || '',
    ...encrypted,
    ...wrapped,
    recovery_wrapped_item_key,
    notes_preview: String(credential.username || existing.username || 'Updated from browser').slice(0, 120),
  });
  await refreshItems();
  return result.item;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    try {
      // Restore the unlocked vault if the service worker was torn down but the
      // browser is still open (password kept in session storage).
      await ensureUnlocked();
      switch (message.type) {
        case 'state':
          unlockedAt = masterKey ? Date.now() : 0;
          sendResponse({ ok: true, unlocked: Boolean(masterKey), user: cachedUser, itemCount: cachedItems.length });
          break;
        case 'pair': {
          const result = await api.redeem(message.code, message.deviceName, message.browser);
          await chrome.storage.local.set({ extensionToken: result.token, pairedUser: result.user });
          sendResponse({ ok: true, user: result.user });
          break;
        }
        case 'unlock':
          await unlock(message.masterPassword);
          sendResponse({ ok: true });
          break;
        case 'lock':
          lock();
          sendResponse({ ok: true });
          break;
        case 'refresh':
          await refreshItems();
          sendResponse({ ok: true, items: cachedItems });
          break;
        case 'list-items':
          sendResponse({ ok: true, items: cachedItems, unlocked: Boolean(masterKey) });
          break;
        case 'match':
          if (!masterKey) { sendResponse({ ok: false, error: 'locked' }); break; }
          await refreshIfStale();
          const matches = matchItemsFor(message.origin);
          const matchedItems = await Promise.all(matches.map(async (item) => {
            try {
              const decrypted = await decryptOne(item);
              return {
                id: item.id,
                title: item.title,
                url: item.url,
                username: decrypted.username,
                permission: item.permission,
              };
            } catch {
              return {
                id: item.id,
                title: item.title,
                url: item.url,
                username: '',
                permission: item.permission,
              };
            }
          }));
          sendResponse({ ok: true, items: matchedItems });
          break;
        case 'decrypt': {
          if (!masterKey) throw new Error('Vault locked');
          const item = cachedItems.find((c) => c.id === message.itemId);
          if (!item) throw new Error('Item not found');
          const result = await decryptOne(item);
          sendResponse({ ok: true, payload: result });
          break;
        }
        case 'open-and-login': {
          const result = await openAndLogin(message.itemId);
          sendResponse({ ok: true, ...result });
          break;
        }
        case 'classify-captured': {
          const result = await classifyCredential(message.credential || {});
          sendResponse({ ok: true, ...result });
          break;
        }
        case 'save-captured': {
          const item = await saveCapturedCredential(message.credential || {});
          await chrome.storage.local.remove('pendingCredential');
          try { await chrome.storage.session.remove('pvUsernameStep'); } catch { /* ignore */ }
          sendResponse({ ok: true, item });
          break;
        }
        case 'update-captured': {
          const item = await updateCapturedCredential(message.itemId, message.credential || {});
          await chrome.storage.local.remove('pendingCredential');
          sendResponse({ ok: true, item });
          break;
        }
        case 'remember-captured': {
          await chrome.storage.local.set({ pendingCredential: { ...message.credential, savedAt: Date.now() } });
          sendResponse({ ok: true });
          break;
        }
        case 'get-pending-capture': {
          const stored = await chrome.storage.local.get(['pendingCredential']);
          const pending = stored.pendingCredential;
          if (!pending || Date.now() - pending.savedAt > 2 * 60 * 1000) {
            await chrome.storage.local.remove('pendingCredential');
            sendResponse({ ok: true, credential: null });
            break;
          }
          sendResponse({ ok: true, credential: pending });
          break;
        }
        case 'discard-pending-capture': {
          await chrome.storage.local.remove('pendingCredential');
          sendResponse({ ok: true });
          break;
        }
        // ---- multi-step login (username page -> password page) ----
        case 'remember-username-step': {
          try {
            await chrome.storage.session.set({ pvUsernameStep: { host: String(message.host || ''), username: String(message.username || ''), ts: Date.now() } });
          } catch { /* ignore */ }
          sendResponse({ ok: true });
          break;
        }
        case 'get-username-step': {
          let username = '';
          try {
            const { pvUsernameStep } = await chrome.storage.session.get('pvUsernameStep');
            if (pvUsernameStep && hostsMatch(String(message.host || ''), pvUsernameStep.host)
              && Date.now() - pvUsernameStep.ts < STEP_TTL_MS) {
              username = pvUsernameStep.username || '';
            }
          } catch { /* ignore */ }
          sendResponse({ ok: true, username });
          break;
        }
        case 'remember-fill-step': {
          try {
            await chrome.storage.session.set({ pvFillStep: { host: String(message.host || ''), itemId: String(message.itemId || ''), ts: Date.now() } });
          } catch { /* ignore */ }
          sendResponse({ ok: true });
          break;
        }
        case 'get-fill-step': {
          let itemId = '';
          try {
            const { pvFillStep } = await chrome.storage.session.get('pvFillStep');
            if (pvFillStep && hostsMatch(String(message.host || ''), pvFillStep.host)
              && Date.now() - pvFillStep.ts < STEP_TTL_MS) {
              itemId = pvFillStep.itemId || '';
            }
          } catch { /* ignore */ }
          sendResponse({ ok: true, itemId });
          break;
        }
        case 'clear-fill-step': {
          try { await chrome.storage.session.remove('pvFillStep'); } catch { /* ignore */ }
          sendResponse({ ok: true });
          break;
        }
        case 'never-save-host': {
          const host = String(message.host || '').trim().toLowerCase();
          if (host) {
            const { pvNeverSaveHosts } = await chrome.storage.local.get(['pvNeverSaveHosts']);
            const list = Array.isArray(pvNeverSaveHosts) ? pvNeverSaveHosts : [];
            if (!list.includes(host)) {
              list.push(host);
              await chrome.storage.local.set({ pvNeverSaveHosts: list });
            }
          }
          sendResponse({ ok: true });
          break;
        }
        default:
          sendResponse({ ok: false, error: `Unknown message type ${message.type}` });
      }
    } catch (err) {
      sendResponse({ ok: false, error: err.message });
    }
  })();
  return true;
});
