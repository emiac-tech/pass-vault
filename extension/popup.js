// E-Vault Password Manager extension popup.
// States: not-paired -> paired+locked -> unlocked -> item-list / item-detail / settings

const screen = document.getElementById('screen');
const settingsButton = document.getElementById('settings-button');
const themeButton = document.getElementById('theme-button');

// Environment presets — switch the extension between local dev and the deployed
// server with one click (instead of hand-editing both URL fields).
const ENVIRONMENTS = {
  // Local runs via Docker (single container): web app + API both on port 4000.
  local: { label: 'Local', apiBaseUrl: 'http://127.0.0.1:4000/api', webAppUrl: 'http://127.0.0.1:4000' },
  production: { label: 'Production', apiBaseUrl: 'https://e-vault-app.emiactech.com/api', webAppUrl: 'https://e-vault-app.emiactech.com' },
};

// ---------------------------------------------------------------------------
// Theme (mirrors the web app: persisted light/dark, default follows the OS).
// ---------------------------------------------------------------------------
const THEME_KEY = 'pass-vault-theme';
const SUN_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
const MOON_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';

function getStoredTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch { /* ignore */ }
  // Default to light when the user hasn't chosen a theme yet.
  return 'light';
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* ignore */ }
  if (themeButton) themeButton.innerHTML = theme === 'light' ? MOON_ICON : SUN_ICON;
}

applyTheme(getStoredTheme());
themeButton?.addEventListener('click', () => {
  const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
  applyTheme(next);
});

let currentScreen = 'loading';
let items = [];
let filter = '';
let cachedUser = null;
let activeTabName = 'passwords';

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else if (!response?.ok) reject(new Error(response?.error ?? 'Unknown extension error'));
      else resolve(response);
    });
  });
}

async function getActiveTabUrl() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      resolve(tab?.url ?? '');
    });
  });
}

function render(content) {
  screen.innerHTML = '';
  if (typeof content === 'string') screen.innerHTML = content;
  else screen.appendChild(content);
}

function itemTypeLabel(type = '') {
  return type.replaceAll('_', ' ');
}

function itemHost(item) {
  try { return new URL(item.url?.startsWith('http') ? item.url : `https://${item.url}`).hostname.replace(/^www\./, ''); } catch { return item.url ?? ''; }
}

// Use Google's favicon service so every item gets a real site icon.
// Falls back to the first letter of the title if the favicon fails to load.
function faviconUrl(item) {
  const host = itemHost(item);
  if (!host) return '';
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
}

function buildSiteIcon(item) {
  const wrap = element('span', { class: 'site-icon', 'data-state': 'loading' });
  const letter = (item.title || '?').slice(0, 1).toUpperCase();
  const fallback = document.createTextNode(letter);
  const url = faviconUrl(item);
  if (!url) { wrap.appendChild(fallback); wrap.removeAttribute('data-state'); return wrap; }
  const img = new Image();
  img.alt = '';
  img.referrerPolicy = 'no-referrer';
  img.onload = () => { wrap.innerHTML = ''; wrap.appendChild(img); wrap.removeAttribute('data-state'); };
  img.onerror = () => { wrap.innerHTML = ''; wrap.appendChild(fallback); wrap.removeAttribute('data-state'); };
  img.src = url;
  // Show letter immediately as the loading state so the row never looks empty.
  wrap.appendChild(fallback);
  return wrap;
}

// Inline vault SVG used on the unlock + empty screens.
function vaultIllustration(size = 44) {
  const wrap = element('span', { class: 'hero-illustration', 'aria-hidden': 'true' });
  wrap.innerHTML = `
    <svg viewBox="0 0 64 64" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
      <rect x="8" y="16" width="48" height="40" rx="6"/>
      <path d="M20 16V12a12 12 0 0 1 24 0v4"/>
      <circle cx="32" cy="34" r="5"/>
      <path d="M32 39v6"/>
    </svg>
  `;
  return wrap;
}

function renderTabs(active = activeTabName) {
  const tabs = element('nav', { class: 'tabs' });
  [
    ['passwords', 'Passwords'],
    ['folders', 'Folders'],
    ['generator', 'Generator'],
    ['settings', 'Settings'],
  ].forEach(([id, label]) => {
    const tab = element('button', { class: active === id ? 'active' : '', type: 'button' }, label);
    tab.addEventListener('click', () => {
      activeTabName = id;
      if (id === 'passwords' || id === 'folders') renderItemList(id);
      if (id === 'generator') renderGenerator();
      if (id === 'settings') renderSettings();
    });
    tabs.appendChild(tab);
  });
  return tabs;
}

function element(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') el.className = value;
    else if (key === 'html') el.innerHTML = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2).toLowerCase(), value);
    else el.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child == null) continue;
    el.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return el;
}

async function getWebAppOrigin() {
  const { webAppUrl } = await chrome.storage.local.get(['webAppUrl']);
  let base = (webAppUrl || 'https://e-vault-app.emiactech.com').replace(/\/+$/, '');
  // Migrate any stored URL from the retired domain to the new app domain.
  if (base.includes('passvault.103.180.163.41.sslip.io')) {
    base = base.replace('passvault.103.180.163.41.sslip.io', 'e-vault-app.emiactech.com');
    try { await chrome.storage.local.set({ webAppUrl: base }); } catch { /* ignore */ }
  }
  try { return new URL(base).origin; } catch { return 'https://e-vault-app.emiactech.com'; }
}

// Auto-connect: read the logged-in web app's session token from an open web app
// tab in this browser. No pairing code — if you're logged into the web app, the
// extension connects to the same account. The master key is NOT shared; the user
// still unlocks with their master password below (zero-knowledge preserved).
async function syncWebSession() {
  const origin = await getWebAppOrigin();
  let tabs = [];
  try { tabs = await chrome.tabs.query({ url: `${origin}/*` }); } catch { tabs = []; }
  for (const tab of tabs) {
    if (typeof tab.id !== 'number') continue;
    try {
      const [res] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => localStorage.getItem('pass-vault-session'),
      });
      if (!res?.result) continue;
      const parsed = JSON.parse(res.result);
      if (parsed?.token) {
        await chrome.storage.local.set({ accountToken: parsed.token, pairedUser: parsed.user });
        return parsed;
      }
    } catch { /* tab not scriptable or no session */ }
  }
  return null;
}

async function detectState() {
  let stored = await chrome.storage.local.get(['accountToken', 'pairedUser']);
  if (!stored.accountToken) {
    const synced = await syncWebSession();
    if (!synced) return renderConnect();
    stored = { accountToken: synced.token, pairedUser: synced.user };
  }
  cachedUser = stored.pairedUser;
  try {
    const state = await sendMessage({ type: 'state' });
    if (state.unlocked) {
      items = (await sendMessage({ type: 'list-items' })).items;
      return renderItemList();
    }
    return renderUnlock();
  } catch (err) {
    return renderError(err);
  }
}

function renderError(err) {
  currentScreen = 'error';
  render(element('div', { class: 'actions' },
    element('h2', {}, 'Something went wrong'),
    element('p', { class: 'error' }, err.message),
    element('button', { class: 'ghost', onclick: detectState }, 'Retry'),
  ));
}

function renderConnect() {
  currentScreen = 'connect';
  const wrap = element('div', { class: 'actions' });
  const card = element('div', { class: 'pair-card' });

  card.appendChild(vaultIllustration());
  card.appendChild(element('div', { class: 'hero-text' },
    element('span', { class: 'eyebrow' }, 'Connect'),
    element('h2', {}, 'Log into the web app'),
    element('p', {}, 'Open and log into the E-Vault Password Manager web app in this browser. The extension connects to the same account automatically — no pairing code needed.'),
  ));

  const open = element('button', { class: 'primary' }, 'Open E-Vault Password Manager web app');
  open.addEventListener('click', async () => {
    const origin = await getWebAppOrigin();
    await chrome.tabs.create({ url: origin });
  });

  const retry = element('button', { class: 'ghost' }, 'Retry connection');
  retry.addEventListener('click', detectState);

  card.appendChild(open);
  card.appendChild(retry);

  wrap.appendChild(card);
  wrap.appendChild(element('p', { class: 'footer-note' }, 'Tip: set the web app URL in Settings if you self-host.'));
  render(wrap);
}

function renderUnlock() {
  currentScreen = 'unlock';
  const wrap = element('div', { class: 'actions' });
  const card = element('div', { class: 'unlock-card' });

  card.appendChild(vaultIllustration());
  card.appendChild(element('div', { class: 'hero-text' },
    element('span', { class: 'eyebrow' }, 'Vault locked'),
    element('h2', {}, 'Unlock to continue'),
    element('p', {}, 'Your master password derives the local AES key. It never leaves this browser.'),
  ));

  if (cachedUser?.email) {
    const initial = (cachedUser.email || '?').charAt(0).toUpperCase();
    card.appendChild(element('div', { class: 'identity-chip' },
      element('span', { class: 'identity-avatar' }, initial),
      element('span', {}, cachedUser.email),
    ));
  }

  // Password input with show/hide toggle.
  const passwordInput = element('input', { type: 'password', placeholder: 'Master password' });
  const toggle = element('button', { type: 'button', class: 'input-affix', 'aria-label': 'Show password' }, '👁');
  toggle.addEventListener('click', () => {
    const isHidden = passwordInput.type === 'password';
    passwordInput.type = isHidden ? 'text' : 'password';
    toggle.textContent = isHidden ? '⊘' : '👁';
  });
  const passwordWrap = element('div', { class: 'input-wrap' }, passwordInput, toggle);
  card.appendChild(element('label', {}, 'Master password', passwordWrap));

  const error = element('div', {});
  const submit = element('button', { class: 'primary' }, 'Unlock Vault');

  const doUnlock = async () => {
    submit.disabled = true;
    submit.textContent = 'Unlocking…';
    error.innerHTML = '';
    try {
      await sendMessage({ type: 'unlock', masterPassword: passwordInput.value });
      items = (await sendMessage({ type: 'list-items' })).items;
      renderItemList();
    } catch (err) {
      error.innerHTML = `<div class="error">${err.message}</div>`;
      submit.disabled = false;
      submit.textContent = 'Unlock Vault';
    }
  };
  submit.addEventListener('click', doUnlock);
  passwordInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') doUnlock(); });
  card.appendChild(error);
  card.appendChild(submit);

  const switchAccount = element('button', { class: 'subtle', type: 'button' }, 'Disconnect');
  switchAccount.addEventListener('click', async () => {
    // Forget the synced web session (and any legacy token) without wiping the
    // user's saved settings (API/web URLs, theme). The account is whichever one
    // is logged into the web app — switch there to change it.
    await sendMessage({ type: 'lock' });
    await chrome.storage.local.remove(['accountToken', 'extensionToken', 'pairedUser', 'savedCredIndex', 'pvNeverSaveHosts']);
    detectState();
  });
  card.appendChild(switchAccount);

  wrap.appendChild(card);
  wrap.appendChild(element('p', { class: 'footer-note' }, 'Stays unlocked until you close the browser.'));
  render(wrap);
  // Focus without scrolling the popup — autofocus would scroll the input into
  // view and push the card up.
  passwordInput.focus({ preventScroll: true });
}

async function renderItemList(tabName = 'passwords') {
  activeTabName = tabName;
  currentScreen = 'list';
  const wrap = element('div', { class: 'vault-screen' });

  const searchBar = element('div', { class: 'search-bar' });
  const searchInput = element('input', { placeholder: 'Search items…' });
  searchInput.value = filter;
  searchInput.addEventListener('input', () => { filter = searchInput.value; updateList(); });
  searchBar.appendChild(element('span', { class: 'search-icon' }, '⌕'));
  searchBar.appendChild(searchInput);
  wrap.appendChild(searchBar);
  wrap.appendChild(renderTabs(tabName));

  const toolbar = element('div', { class: 'list-toolbar' },
    element('strong', {}, tabName === 'folders' ? 'Folders' : 'All Passwords'),
    element('div', { class: 'toolbar-icons' },
      element('button', { title: 'Refresh', onclick: async () => { await sendMessage({ type: 'refresh' }); items = (await sendMessage({ type: 'list-items' })).items; renderItemList(tabName); } }, '↻'),
      element('button', { title: 'Add from current site', onclick: () => showToast('Submit a login/signup form and E-Vault Password Manager will offer to save it.') }, '+'),
      element('button', { title: 'Filter' }, '⌯'),
    ),
  );
  wrap.appendChild(toolbar);

  const list = element('div', { class: 'item-list' });
  const tabUrl = await getActiveTabUrl();
  let matchIds = new Set();
  try {
    const matches = await sendMessage({ type: 'match', origin: tabUrl });
    matchIds = new Set(matches.items.map((item) => item.id));
  } catch { /* locked */ }

  function updateList() {
    list.innerHTML = '';
    const lowered = filter.toLowerCase();
    let sorted = items
      .filter((item) => item.title.toLowerCase().includes(lowered) || (item.url ?? '').toLowerCase().includes(lowered))
      .sort((a, b) => Number(matchIds.has(b.id)) - Number(matchIds.has(a.id)));
    if (tabName === 'folders') {
      const grouped = new Map();
      sorted.forEach((item) => grouped.set(itemTypeLabel(item.type), [...(grouped.get(itemTypeLabel(item.type)) ?? []), item]));
      sorted = Array.from(grouped.entries()).flatMap(([group, groupItems]) => [
        { id: `group-${group}`, group, count: groupItems.length },
        ...groupItems,
      ]);
    }
    if (matchIds.size > 0) {
      const heading = element('p', { class: 'match-note' }, `Matches for this site: ${matchIds.size}`);
      list.appendChild(heading);
    }
    for (const item of sorted) {
      if (item.group) {
        list.appendChild(element('div', { class: 'group-row' }, `${item.group} (${item.count})`));
        continue;
      }
      const isMatch = matchIds.has(item.id);
      list.appendChild(buildItemRow(item, isMatch));
    }
    if (sorted.length === 0) {
      const empty = element('div', { class: 'empty-state' });
      const art = element('span', { class: 'empty-art' });
      art.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>
        </svg>
      `;
      empty.appendChild(art);
      empty.appendChild(element('strong', {}, filter ? 'No matching items' : 'Vault is empty'));
      empty.appendChild(element('p', {}, filter ? 'Try a different search term, or clear filters.' : 'Add credentials from the web app or save them as you log into sites.'));
      list.appendChild(empty);
    }
  }
  updateList();
  wrap.appendChild(list);
  render(wrap);
}

// ---- Inline hover-actions on each row, à la Zoho Vault ----
//
// Layout: star · site-icon · title+meta · [hover actions] · type-chip · chevron
// Hover actions: copy username, autofill, copy password, share, more.

function buildItemRow(item, isMatch) {
  const subtitle = element('div', { class: 'meta' });
  if (item.username) {
    const copyBtn = element('button', {
      class: 'inline-copy',
      type: 'button',
      title: 'Copy username',
      'aria-label': 'Copy username',
    });
    copyBtn.innerHTML = `<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
    copyBtn.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      try {
        const response = await sendMessage({ type: 'decrypt', itemId: item.id });
        await navigator.clipboard.writeText(response.payload.username || '');
        showToast('Username copied');
      } catch (err) {
        showToast(err.message || 'Copy failed');
      }
    });
    subtitle.appendChild(copyBtn);
    subtitle.appendChild(document.createTextNode(item.username));
  } else {
    subtitle.appendChild(document.createTextNode(itemHost(item) || 'No URL'));
  }

  const row = element('div', { class: isMatch ? 'item-card match' : 'item-card' },
    element('button', { class: 'star', type: 'button', title: 'Favorite', 'aria-label': 'Favorite' }, '☆'),
    buildSiteIcon(item),
    element('div', { class: 'item-copy' },
      element('div', { class: 'title' }, item.title),
      subtitle,
    ),
    buildHoverActions(item),
  );

  // Persistent "Open & login" / chevron button. For website-type items with a
  // URL: opens the URL in a new tab and autofills. For others: opens the detail.
  const canLaunch = Boolean(item.url) && (item.type === 'website_login' || item.type === 'app_login');
  if (canLaunch) {
    const launch = element('button', {
      class: 'launch-button',
      type: 'button',
      title: 'Open site and log in',
      'aria-label': 'Open site and log in',
    });
    launch.innerHTML = `
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
        <polyline points="15 3 21 3 21 9"/>
        <line x1="10" y1="14" x2="21" y2="3"/>
      </svg>
    `;
    launch.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      try {
        await sendMessage({ type: 'open-and-login', itemId: item.id });
        showToast('Opening & filling…');
        setTimeout(() => window.close(), 400);
      } catch (err) {
        showToast(err.message || 'Could not open site');
      }
    });
    row.appendChild(launch);
  } else {
    row.appendChild(element('span', { class: 'chevron' }, '›'));
  }

  // Clicking the empty parts of the row opens detail.
  row.addEventListener('click', (event) => {
    if (event.target.closest('.row-actions, .star, .inline-copy, .launch-button')) return;
    renderItemDetail(item);
  });
  return row;
}

function buildHoverActions(item) {
  const actions = element('div', { class: 'row-actions', title: 'Quick actions' });
  const stopBubble = (handler) => (event) => {
    event.preventDefault();
    event.stopPropagation();
    handler(event).catch?.((err) => showToast(err.message || 'Action failed'));
  };

  const button = (icon, label, handler) =>
    element('button', { class: 'row-action', type: 'button', title: label, onclick: stopBubble(handler) }, icon);

  actions.appendChild(button(svgIcon('copy'), 'Copy username', async () => {
    const payload = await decryptItem(item.id);
    await navigator.clipboard.writeText(payload.username || '');
    showToast('Username copied');
  }));

  actions.appendChild(button(svgIcon('login'), 'Autofill this tab', async () => {
    const payload = await decryptItem(item.id);
    await autofillActiveTab(payload);
    showToast('Autofilled');
  }));

  actions.appendChild(button(svgIcon('lock'), 'Copy password', async () => {
    const payload = await decryptItem(item.id);
    if (payload.permission === 'use_only') return showToast('Password view disabled (use-only)');
    await navigator.clipboard.writeText(payload.password || '');
    showToast('Password copied');
  }));

  actions.appendChild(button(svgIcon('share'), 'Open share', async () => {
    // Open the WEB APP (not the API server) to manage sharing for this item.
    const stored = await chrome.storage.local.get(['webAppUrl']);
    const base = (stored.webAppUrl || 'https://e-vault-app.emiactech.com').replace(/\/+$/, '');
    chrome.tabs.create({ url: `${base}/#/share/${item.id}` });
  }));

  actions.appendChild(button(svgIcon('dots'), 'More', async () => {
    renderItemDetail(item);
  }));
  return actions;
}

async function decryptItem(itemId) {
  const response = await sendMessage({ type: 'decrypt', itemId });
  return response.payload;
}

async function autofillActiveTab(payload) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active tab');
  const { autoSubmit } = await chrome.storage.local.get(['autoSubmit']);
  const autoLogin = autoSubmit !== false; // default ON
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (username, password, autoLogin) => {
      const usernameField = document.querySelector(
        'input[type="email"], input[name*="user" i], input[name*="email" i], input[autocomplete*="username" i]',
      );
      const passwordField = document.querySelector('input[type="password"]');
      const setValue = (field, value) => {
        if (!field) return;
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(field, value);
        field.dispatchEvent(new Event('input', { bubbles: true }));
        field.dispatchEvent(new Event('change', { bubbles: true }));
      };
      setValue(usernameField, username);
      setValue(passwordField, password);

      // Auto-login: click the login / sign in / submit button after filling.
      if (!autoLogin || !passwordField) return;
      const POS = /\b(log[\s-]?in|sign[\s-]?in|log[\s-]?on|sign[\s-]?on|submit|continue|access)\b/i;
      const NEG = /\b(sign[\s-]?up|log[\s-]?out|sign[\s-]?out|register|create[\s-]?(an[\s-]?)?account|forgot|reset|cancel|back|help|demo|trial|guest)\b/i;
      const vis = (el) => { if (!el || el.disabled) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && el.offsetParent !== null; };
      const txt = (el) => (el.innerText || el.value || el.getAttribute('aria-label') || el.title || el.name || '').trim();
      const form = passwordField.closest('form');
      const pick = () => {
        if (form) {
          for (const el of form.querySelectorAll('button[type="submit"], input[type="submit"]')) {
            if (vis(el) && !NEG.test(txt(el))) return el;
          }
        }
        const scope = form || document;
        for (const el of scope.querySelectorAll('button, input[type="submit"], input[type="button"], a[role="button"], [role="button"]')) {
          if (!vis(el)) continue;
          const t = txt(el);
          if (!t || NEG.test(t)) continue;
          if (POS.test(t)) return el;
        }
        return null;
      };
      setTimeout(() => {
        const btn = pick();
        if (btn) { btn.click(); return; }
        if (form && typeof form.requestSubmit === 'function') form.requestSubmit();
        else if (form) form.submit();
      }, 300);
    },
    args: [payload.username || '', payload.password || '', autoLogin],
  });
}

// Tiny inline SVG icons so we don't ship raster assets.
function svgIcon(name) {
  const svgs = {
    copy: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    login: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>',
    lock: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
    share: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>',
    dots: '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
  };
  const span = document.createElement('span');
  span.innerHTML = svgs[name] || '';
  span.className = 'row-action-icon';
  return span;
}

async function renderItemDetail(item) {
  currentScreen = 'detail';
  try {
    const { payload } = await sendMessage({ type: 'decrypt', itemId: item.id });
    const wrap = element('div', { class: 'actions detail-screen' });
    wrap.appendChild(element('button', { class: 'subtle compact', onclick: () => renderItemList(activeTabName) }, '← Back'));

    const header = element('div', { class: 'detail-header', style: 'display:flex;gap:12px;align-items:center;' });
    header.appendChild(buildSiteIcon({ url: payload.url, title: payload.title }));
    header.appendChild(element('div', { style: 'min-width:0;' },
      element('h2', { style: 'font-size:18px;margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;' }, payload.title),
      element('p', { class: 'muted', style: 'font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;' }, payload.url ?? ''),
    ));
    wrap.appendChild(header);

    const useOnly = payload.permission === 'use_only';

    wrap.appendChild(element('div', { class: 'field-display' },
      element('span', { class: 'field-label' }, 'Username'),
      element('span', { class: 'field-value' }, payload.username || '—'),
    ));
    wrap.appendChild(element('div', { class: 'field-display mono' },
      element('span', { class: 'field-label' }, 'Password'),
      element('span', { class: 'field-value' }, useOnly ? '••••••••  (one-click login only)' : '••••••••••••'),
    ));

    const detailActions = element('div', { class: 'detail-actions' });
    const copyPass = element('button', { class: 'ghost' }, 'Copy password');
    copyPass.addEventListener('click', async () => {
      if (useOnly) return showToast('Password view disabled');
      await navigator.clipboard.writeText(payload.password);
      showToast('Password copied');
    });
    const copyUser = element('button', { class: 'ghost' }, 'Copy username');
    copyUser.addEventListener('click', async () => {
      await navigator.clipboard.writeText(payload.username);
      showToast('Username copied');
    });
    const fillBtn = element('button', { class: 'primary' }, 'Autofill this tab');
    fillBtn.addEventListener('click', async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return;
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (username, password) => {
          const usernameField = document.querySelector('input[type="email"], input[name*="user" i], input[name*="email" i], input[autocomplete*="username" i]');
          const passwordField = document.querySelector('input[type="password"]');
          const setValue = (field, value) => {
            if (!field) return;
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            setter.call(field, value);
            field.dispatchEvent(new Event('input', { bubbles: true }));
            field.dispatchEvent(new Event('change', { bubbles: true }));
          };
          setValue(usernameField, username);
          setValue(passwordField, password);
        },
        args: [payload.username, payload.password],
      });
      showToast('Autofilled');
    });
    detailActions.appendChild(copyUser);
    if (!useOnly) detailActions.appendChild(copyPass);
    wrap.appendChild(detailActions);
    wrap.appendChild(fillBtn);
    render(wrap);
  } catch (err) {
    renderError(err);
  }
}

function renderGenerator() {
  activeTabName = 'generator';
  const wrap = element('div', { class: 'vault-screen' });
  wrap.appendChild(element('div', { class: 'search-bar disabled' },
    element('span', { class: 'search-icon' }, '⌕'),
    element('input', { placeholder: 'Search', disabled: '' }),
  ));
  wrap.appendChild(renderTabs('generator'));

  const generate = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%^&*';
    const bytes = crypto.getRandomValues(new Uint8Array(20));
    return Array.from(bytes, (byte) => chars[byte % chars.length]).join('');
  };

  const card = element('div', { class: 'generator-card' });
  card.appendChild(element('span', { class: 'eyebrow' }, 'Password generator'));
  const display = element('code', {}, generate());
  card.appendChild(display);
  const actions = element('div', { class: 'detail-actions' },
    element('button', { class: 'ghost', onclick: () => { display.textContent = generate(); } }, '↻ Regenerate'),
    element('button', { class: 'primary', onclick: () => navigator.clipboard.writeText(display.textContent).then(() => showToast('Password copied')) }, 'Copy'),
  );
  card.appendChild(actions);
  card.appendChild(element('p', { class: 'muted', style: 'font-size:11.5px;text-align:center;' }, '20 characters · letters, numbers, symbols'));
  wrap.appendChild(card);
  render(wrap);
}

function showToast(message) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const toast = element('div', { class: 'toast' }, message);
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 1500);
}

settingsButton.addEventListener('click', renderSettings);

async function renderSettings() {
  activeTabName = 'settings';
  currentScreen = 'settings';
  const stored = await chrome.storage.local.get(['apiBaseUrl', 'webAppUrl', 'accountToken', 'pairedUser', 'autoSubmit']);
  const wrap = element('div', { class: 'vault-screen' });
  wrap.appendChild(element('div', { class: 'search-bar disabled' },
    element('span', { class: 'search-icon' }, '⌕'),
    element('input', { placeholder: 'Search', disabled: '' }),
  ));
  wrap.appendChild(renderTabs('settings'));

  const screen = element('div', { class: 'settings-screen' });

  if (stored.pairedUser?.email) {
    const profileSection = element('div', { class: 'settings-section' });
    profileSection.appendChild(element('h3', {}, 'Signed in'));
    profileSection.appendChild(element('div', { class: 'identity-chip', style: 'margin:0;' },
      element('span', { class: 'identity-avatar' }, (stored.pairedUser.email || '?').charAt(0).toUpperCase()),
      element('span', {}, stored.pairedUser.email),
    ));
    screen.appendChild(profileSection);
  }

  // Autofill preferences
  const prefSection = element('div', { class: 'settings-section' });
  prefSection.appendChild(element('h3', {}, 'Autofill'));
  prefSection.appendChild(element('p', { class: 'helper' }, 'After filling your username and password, automatically click the login / sign in button.'));
  const autoOn = stored.autoSubmit !== false; // default ON
  const autoRow = element('div', { class: 'env-switch' });
  const makeAutoBtn = (label, value) => {
    const btn = element('button', { class: autoOn === value ? 'env-option active' : 'env-option', type: 'button' }, label);
    btn.addEventListener('click', async () => {
      await chrome.storage.local.set({ autoSubmit: value });
      showToast(value ? 'Auto login enabled' : 'Auto login disabled');
      renderSettings();
    });
    return btn;
  };
  autoRow.appendChild(makeAutoBtn('On', true));
  autoRow.appendChild(makeAutoBtn('Off', false));
  prefSection.appendChild(element('label', {}, 'Auto login', autoRow));
  screen.appendChild(prefSection);

  // Server section
  const serverSection = element('div', { class: 'settings-section' });
  serverSection.appendChild(element('h3', {}, 'API server'));
  serverSection.appendChild(element('p', { class: 'helper' }, 'Pick the environment the extension talks to. Both URLs switch together.'));

  // Environment switcher — one click sets API + web URLs for Local or Production,
  // and forgets the old session (which belongs to the other environment).
  const currentApi = stored.apiBaseUrl ?? ENVIRONMENTS.production.apiBaseUrl;
  const activeEnv = Object.keys(ENVIRONMENTS).find((k) => ENVIRONMENTS[k].apiBaseUrl === currentApi) || null;
  const envRow = element('div', { class: 'env-switch' });
  for (const [key, env] of Object.entries(ENVIRONMENTS)) {
    const btn = element('button', { class: activeEnv === key ? 'env-option active' : 'env-option', type: 'button' }, env.label);
    btn.addEventListener('click', async () => {
      await chrome.storage.local.set({ apiBaseUrl: env.apiBaseUrl, webAppUrl: env.webAppUrl });
      await sendMessage({ type: 'lock' });
      await chrome.storage.local.remove(['accountToken', 'extensionToken', 'pairedUser', 'savedCredIndex', 'pvNeverSaveHosts']);
      showToast(`Switched to ${env.label}`);
      renderSettings();
    });
    envRow.appendChild(btn);
  }
  serverSection.appendChild(element('label', {}, 'Environment', envRow));

  const baseInput = element('input', { value: stored.apiBaseUrl ?? ENVIRONMENTS.production.apiBaseUrl });
  serverSection.appendChild(element('label', {}, 'API base URL', baseInput));
  const webInput = element('input', { value: stored.webAppUrl ?? ENVIRONMENTS.production.webAppUrl });
  serverSection.appendChild(element('label', {}, 'Web app URL', webInput));
  serverSection.appendChild(element('p', { class: 'helper' }, 'Or set custom URLs manually (e.g. if you self-host elsewhere).'));
  const save = element('button', { class: 'primary' }, 'Save changes');
  save.addEventListener('click', async () => {
    await chrome.storage.local.set({ apiBaseUrl: baseInput.value.trim(), webAppUrl: webInput.value.trim() });
    showToast('Settings saved');
  });
  serverSection.appendChild(save);
  screen.appendChild(serverSection);

  // Connection section
  const deviceSection = element('div', { class: 'settings-section' });
  deviceSection.appendChild(element('h3', {}, 'Connection'));
  if (stored.accountToken) {
    deviceSection.appendChild(element('p', { class: 'helper' }, 'Connected automatically to your logged-in E-Vault Password Manager web app. Disconnect to lock this extension and forget the session.'));
    const disconnect = element('button', { class: 'ghost' }, 'Disconnect & lock');
    disconnect.addEventListener('click', async () => {
      await sendMessage({ type: 'lock' });
      await chrome.storage.local.remove(['accountToken', 'extensionToken', 'pairedUser', 'savedCredIndex', 'pvNeverSaveHosts']);
      detectState();
    });
    deviceSection.appendChild(disconnect);
  } else {
    deviceSection.appendChild(element('p', { class: 'helper' }, 'Not connected. Log into the E-Vault Password Manager web app in this browser and the extension connects automatically.'));
    const reconnect = element('button', { class: 'primary' }, 'Connect now');
    reconnect.addEventListener('click', detectState);
    deviceSection.appendChild(reconnect);
  }
  screen.appendChild(deviceSection);

  wrap.appendChild(screen);
  render(wrap);
}

detectState();
