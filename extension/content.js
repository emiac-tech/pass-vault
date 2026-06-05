// Content script:
//  - Adds Pass Vault inline icons beside username/password fields.
//  - Fills matched credentials without requiring the extension popup.
//  - Suggests saving credentials after login/signup submissions.

(function () {
  if (window.__passVaultInjected) return;
  window.__passVaultInjected = true;

  // Bump this when content.js changes so you can confirm in the page console
  // (F12) that the freshly-loaded code is running, not a stale injected copy.
  console.info('[Pass Vault] content script v6 — keyword-based username detection (no bare input[type=text])');

  const STYLE_ID = 'pass-vault-content-style';
  // Identify the username/email field by credential keywords in its attributes —
  // NOT by a blanket input[type="text"] (which matched search boxes, etc.). This
  // mirrors how Zoho Vault keys off name/id/class/type/placeholder/autocomplete.
  const USERNAME_SELECTOR = [
    'input[type="email"]',
    'input[type="tel"]',
    'input[autocomplete="username"]',
    'input[autocomplete="email"]',
    // keyword (user / username / email / login / id) across name, id, class, placeholder
    'input[name*="user" i]', 'input[id*="user" i]', 'input[class*="user" i]', 'input[placeholder*="user" i]',
    'input[name*="email" i]', 'input[id*="email" i]', 'input[class*="email" i]', 'input[placeholder*="email" i]',
    'input[name*="login" i]', 'input[id*="login" i]', 'input[class*="login" i]',
    'input[name="id" i]', 'input[id="id" i]', 'input[name*="userid" i]', 'input[name*="loginid" i]', 'input[name*="user_id" i]', 'input[name*="login_id" i]',
  ].join(',');
  const PASSWORD_SELECTOR = 'input[type="password"]';

  let matchCache = { origin: '', items: [], locked: false, loadedAt: 0 };
  const fieldDecorations = new Map();

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .pass-vault-field-button {
        position: absolute;
        z-index: 2147483647;
        width: 22px;
        height: 22px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 3px;
        border: 1px solid rgba(255, 255, 255, 0.9);
        border-radius: 6px;
        background: #ffffff;
        color: #2563eb;
        cursor: pointer;
        box-shadow: 0 4px 12px rgba(15, 23, 42, 0.28);
        transition: transform 0.12s ease, box-shadow 0.12s ease, background 0.12s ease;
      }
      .pass-vault-field-button svg { width: 14px; height: 14px; }
      .pass-vault-field-button.locked { color: #94a3b8; }
      .pass-vault-field-button.matched {
        background: linear-gradient(135deg, #2563eb, #6366f1);
        color: #ffffff;
      }
      .pass-vault-field-button:hover {
        transform: translateY(-1px) scale(1.04);
        box-shadow: 0 6px 16px rgba(37, 99, 235, 0.42);
      }
      .pass-vault-field-button .pv-count {
        position: absolute;
        top: -6px;
        right: -6px;
        min-width: 14px;
        height: 14px;
        padding: 0 4px;
        border-radius: 999px;
        background: #ef4444;
        color: #fff;
        font: 800 9px ui-sans-serif, system-ui, sans-serif;
        display: inline-grid;
        place-items: center;
        box-shadow: 0 0 0 2px #ffffff;
        line-height: 1;
      }
      .pass-vault-lock-badge {
        position: absolute;
        z-index: 2147483647;
        padding: 2px 7px;
        border-radius: 999px;
        background: linear-gradient(135deg, #38bdf8, #6366f1);
        color: #fff;
        font: 700 11px ui-sans-serif, system-ui, sans-serif;
        pointer-events: none;
        box-shadow: 0 3px 10px rgba(59, 130, 246, 0.35);
      }
      .pass-vault-picker, .pass-vault-save-prompt {
        position: fixed;
        z-index: 2147483647;
        width: 340px;
        overflow: hidden;
        border-radius: 14px;
        background: #0f172a;
        color: #f8fafc;
        font: 500 13px ui-sans-serif, system-ui, sans-serif;
        border: 1px solid rgba(148, 163, 184, 0.28);
        box-shadow: 0 22px 70px rgba(2, 6, 23, 0.55), 0 0 0 1px rgba(56, 189, 248, 0.18);
      }
      .pass-vault-picker { position: absolute; width: 290px; }
      .pass-vault-save-prompt {
        top: 20px;
        right: 20px;
        width: 360px;
        border-radius: 16px;
        animation: pass-vault-slide-in 0.25s cubic-bezier(0.2, 0.85, 0.25, 1);
      }
      @keyframes pass-vault-slide-in {
        from { opacity: 0; transform: translate3d(20px, -10px, 0); }
        to { opacity: 1; transform: translate3d(0, 0, 0); }
      }
      .pass-vault-picker-header {
        display: flex;
        align-items: center;
        gap: 9px;
        padding: 11px 13px;
        background: linear-gradient(135deg, #2563eb, #3b82f6);
        font-weight: 850;
      }
      .pass-vault-save-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 13px 14px;
        border-bottom: 1px solid rgba(148, 163, 184, 0.1);
      }
      .pass-vault-save-brand {
        display: flex;
        align-items: center;
        gap: 9px;
        font-weight: 800;
        font-size: 13px;
        letter-spacing: 0.01em;
        color: #e2e8f0;
      }
      .pass-vault-save-close {
        width: 24px; height: 24px;
        display: grid; place-items: center;
        border: 0; border-radius: 8px;
        background: rgba(148, 163, 184, 0.12);
        color: #cbd5e1;
        cursor: pointer;
        font-size: 11px;
        transition: background 0.15s ease, color 0.15s ease;
      }
      .pass-vault-save-close:hover { background: rgba(148, 163, 184, 0.22); color: #fff; }
      .pass-vault-save-title { font-size: 14.5px; font-weight: 800; color: #f8fafc; }
      .pass-vault-save-site {
        display: flex; align-items: center; gap: 11px;
        padding: 11px;
        border-radius: 12px;
        border: 1px solid rgba(148, 163, 184, 0.14);
        background: rgba(2, 6, 23, 0.45);
      }
      .pass-vault-save-favicon {
        flex: 0 0 auto;
        width: 36px; height: 36px;
        display: grid; place-items: center;
        border-radius: 9px;
        overflow: hidden;
        background: #fff;
      }
      .pass-vault-save-favicon img { width: 100%; height: 100%; object-fit: cover; }
      .pass-vault-save-favicon.fallback { background: rgba(56, 189, 248, 0.16); color: #7dd3fc; }
      .pass-vault-save-site-text { display: grid; gap: 2px; min-width: 0; }
      .pass-vault-save-site-text strong { color: #f8fafc; font-size: 13.5px; font-weight: 750; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .pass-vault-save-site-text span { color: #94a3b8; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .pass-vault-save-pass {
        display: flex; align-items: center; justify-content: space-between;
        padding: 10px 12px;
        border-radius: 11px;
        border: 1px solid rgba(148, 163, 184, 0.14);
        background: rgba(2, 6, 23, 0.45);
      }
      .pass-vault-save-dots { color: #cbd5e1; letter-spacing: 3px; font-size: 13px; }
      .pass-vault-save-label {
        color: #94a3b8;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        font-weight: 700;
      }
      .pass-vault-save-status { font-size: 12px; color: #94a3b8; }
      .pass-vault-save-status:empty { display: none; }
      .pass-vault-save-status.success { color: #86efac; }
      .pass-vault-save-status.error { color: #fca5a5; }
      .pass-vault-logo {
        display: inline-grid;
        place-items: center;
        width: 26px;
        height: 26px;
        border-radius: 8px;
        background: linear-gradient(135deg, #38bdf8, #6366f1);
        color: #fff;
        box-shadow: 0 4px 12px rgba(99, 102, 241, 0.45);
      }
      .pass-vault-picker-row {
        width: 100%;
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 10px;
        padding: 10px 12px;
        border: 0;
        border-top: 1px solid rgba(148, 163, 184, 0.12);
        background: #111827;
        color: #fff;
        text-align: left;
        cursor: pointer;
        font: inherit;
      }
      .pass-vault-picker-row:hover { background: #1f2937; }
      .pass-vault-picker-row strong { display: block; font-size: 13px; }
      .pass-vault-picker-row span { color: #94a3b8; font-size: 12px; }
      .pass-vault-save-body { padding: 14px; display: grid; gap: 12px; }
      .pass-vault-save-note { color: #cbd5e1; font-size: 12.5px; line-height: 1.4; }
      .pass-vault-save-actions { display: grid; grid-template-columns: 1fr 1.4fr; gap: 9px; margin-top: 2px; }
      .pass-vault-save-actions.stacked { grid-template-columns: 1fr; }
      .pass-vault-save-actions button {
        min-height: 40px;
        border-radius: 11px;
        border: 1px solid rgba(148, 163, 184, 0.22);
        background: rgba(148, 163, 184, 0.08);
        color: #e5e7eb;
        font: 750 12.5px ui-sans-serif, system-ui, sans-serif;
        cursor: pointer;
        transition: background 0.15s ease, transform 0.1s ease;
      }
      .pass-vault-save-actions button:hover { background: rgba(148, 163, 184, 0.16); }
      .pass-vault-save-actions button:active { transform: translateY(1px); }
      .pass-vault-save-actions .primary {
        border: 0;
        background: linear-gradient(135deg, #38bdf8, #6366f1);
        color: #fff;
        box-shadow: 0 8px 20px rgba(99, 102, 241, 0.4);
      }
      .pass-vault-save-actions .primary:hover { background: linear-gradient(135deg, #38bdf8, #6366f1); filter: brightness(1.05); }
    `;
    document.documentElement.appendChild(style);
  }

  function sendMessage(message) {
    return new Promise((resolve) => chrome.runtime.sendMessage(message, resolve));
  }

  function visible(field) {
    if (!field || field.disabled || field.readOnly) return false;
    const rect = field.getBoundingClientRect();
    return rect.width > 20 && rect.height > 16 && field.offsetParent !== null;
  }

  function usernameForPassword(passwordField) {
    const form = passwordField.closest('form') ?? document.body;
    const candidates = Array.from(form.querySelectorAll(USERNAME_SELECTOR)).filter(visible);
    let nearest = null;
    for (const candidate of candidates) {
      if (candidate === passwordField) break;
      nearest = candidate;
    }
    return nearest ?? candidates[0] ?? null;
  }

  function passwordForField(field) {
    if (field.matches(PASSWORD_SELECTOR)) return field;
    const form = field.closest('form') ?? document.body;
    return Array.from(form.querySelectorAll(PASSWORD_SELECTOR)).find(visible) ?? null;
  }

  function hasSubmitIntent(container) {
    if (!container) return false;
    const text = Array.from(container.querySelectorAll('button, [role="button"], input[type="submit"]'))
      .map((node) => (node.innerText || node.value || node.getAttribute('aria-label') || '').trim())
      .join(' ');
    return SUBMIT_LABELS.test(text);
  }

  function isAuthPasswordField(passwordField) {
    if (!visible(passwordField)) return false;
    const autocomplete = passwordField.getAttribute('autocomplete') || '';
    if (/current-password|new-password/i.test(autocomplete)) return true;
    if (usernameForPassword(passwordField)) return true;
    const form = passwordField.closest('form');
    if (form && hasSubmitIntent(form)) return true;
    return false;
  }

  function setValue(field, value) {
    if (!field) return;
    field.focus();
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(field, value ?? '');
    else field.value = value ?? '';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function getMatches() {
    if (matchCache.origin === location.origin && Date.now() - matchCache.loadedAt < 10_000) return matchCache;
    const response = await sendMessage({ type: 'match', origin: location.origin });
    matchCache = {
      origin: location.origin,
      items: response?.ok ? (response.items ?? []) : [],
      locked: response?.error === 'locked',
      loadedAt: Date.now(),
    };
    return matchCache;
  }

  function positionNearField(element, field, offsetRight = 8) {
    const rect = field.getBoundingClientRect();
    element.style.top = `${window.scrollY + rect.top + (rect.height - element.offsetHeight) / 2}px`;
    element.style.left = `${window.scrollX + rect.right - element.offsetWidth - offsetRight}px`;
  }

  function closePickers() {
    document.querySelectorAll('.pass-vault-picker').forEach((node) => node.remove());
  }

  function showPicker(anchor, items, onPick) {
    closePickers();
    const picker = document.createElement('div');
    picker.className = 'pass-vault-picker';
    picker.innerHTML = `
      <div class="pass-vault-picker-header"><span class="pass-vault-logo">PV</span><span>Pass Vault</span></div>
    `;
    const list = document.createElement('div');
    if (items.length === 0) {
      const row = document.createElement('div');
      row.className = 'pass-vault-picker-row';
      row.innerHTML = '<div><strong>No matching passwords</strong><span>Open extension or save this login first.</span></div>';
      list.appendChild(row);
    }
    for (const item of items) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'pass-vault-picker-row';
      const subtitle = item.username || item.url || 'Saved credential';
      row.innerHTML = `<div><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(subtitle)}</span></div><span>Fill</span>`;
      row.addEventListener('click', () => { closePickers(); onPick(item); });
      list.appendChild(row);
    }
    picker.appendChild(list);
    document.body.appendChild(picker);
    const rect = anchor.getBoundingClientRect();
    picker.style.top = `${window.scrollY + rect.bottom + 8}px`;
    picker.style.left = `${Math.min(window.scrollX + rect.left, window.scrollX + window.innerWidth - 310)}px`;
    setTimeout(() => document.addEventListener('click', closePickers, { once: true }), 50);
  }

  async function fillItem(item, field) {
    const response = await sendMessage({ type: 'decrypt', itemId: item.id });
    if (!response?.ok) throw new Error(response?.error || 'Could not decrypt credential');
    const passwordField = passwordForField(field);
    const usernameField = passwordField ? usernameForPassword(passwordField) : field;
    setValue(usernameField, response.payload.username);
    setValue(passwordField, response.payload.password);
  }

  async function handleFieldClick(field, button) {
    const state = await getMatches();
    if (state.locked) {
      showLockedBadge(field, 'Vault locked');
      return;
    }
    const items = state.items;
    if (items.length === 1) {
      await fillItem(items[0], field);
      showLockedBadge(field, 'Filled ✓');
      return;
    }
    showPicker(button, items, (item) => fillItem(item, field).then(() => showLockedBadge(field, 'Filled ✓')));
  }

  function showLockedBadge(field, text) {
    if (!visible(field)) return;
    const badge = document.createElement('span');
    badge.className = 'pass-vault-lock-badge';
    badge.textContent = text;
    document.body.appendChild(badge);
    positionNearField(badge, field, -2);
    setTimeout(() => badge.remove(), 1500);
  }

  // Vault SVG used for the in-field icon — sized to fit a 14px box.
  const VAULT_SVG = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="3"/>
      <circle cx="12" cy="12" r="3"/>
      <path d="M12 9v-1"/>
      <path d="M12 15v1"/>
    </svg>
  `;

  function applyFieldState(button, state) {
    button.classList.toggle('locked', state.locked);
    button.classList.toggle('matched', state.items.length > 0 && !state.locked);
    const existingBadge = button.querySelector('.pv-count');
    if (existingBadge) existingBadge.remove();
    if (state.items.length > 0 && !state.locked) {
      const badge = document.createElement('span');
      badge.className = 'pv-count';
      badge.textContent = String(state.items.length);
      button.appendChild(badge);
    }
    button.title = state.locked
      ? 'Pass Vault — vault locked. Click to open the extension.'
      : state.items.length > 0
        ? `Pass Vault — ${state.items.length} matching credential${state.items.length === 1 ? '' : 's'}.`
        : 'Pass Vault — no matches for this site. Open extension to pick another item.';
  }

  function decorateField(field) {
    if (!visible(field) || field.dataset.passVaultDecorated) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pass-vault-field-button';
    button.innerHTML = VAULT_SVG;
    document.body.appendChild(button);

    // Reserve room inside the input so the icon visually sits "inside" the box,
    // similar to Zoho's behavior.
    const previousPadding = field.style.paddingRight;
    field.style.paddingRight = 'calc(2.4em + 4px)';
    field.dataset.passVaultPriorPaddingRight = previousPadding;

    const reposition = () => {
      if (!document.body.contains(button) || !document.contains(field) || !visible(field)) {
        removeFieldDecoration(field);
        return;
      }
      // Push the icon slightly further left for password fields to clear native
      // browser reveal/passkey icons (Chrome adds ~30px on the right).
      const offset = field.matches(PASSWORD_SELECTOR) ? 32 : 6;
      positionNearField(button, field, offset);
    };
    const refreshState = async () => {
      const state = await getMatches();
      if (fieldDecorations.has(field)) applyFieldState(button, state);
    };

    requestAnimationFrame(reposition);
    window.addEventListener('scroll', reposition, { passive: true });
    window.addEventListener('resize', reposition);
    field.addEventListener('focus', reposition);

    // Initial state — locked / unmatched / matched.
    getMatches().then((state) => applyFieldState(button, state));
    // Refresh state when the user focuses the field.
    field.addEventListener('focus', refreshState);

    button.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      try {
        await handleFieldClick(field, button);
      } catch (error) {
        showLockedBadge(field, error.message || 'Failed');
      }
    });
    field.dataset.passVaultDecorated = 'true';
    fieldDecorations.set(field, { button, reposition, refreshState, previousPadding });
  }

  function removeFieldDecoration(field) {
    const decoration = fieldDecorations.get(field);
    if (!decoration) return;
    window.removeEventListener('scroll', decoration.reposition);
    window.removeEventListener('resize', decoration.reposition);
    field.removeEventListener('focus', decoration.reposition);
    field.removeEventListener('focus', decoration.refreshState);
    decoration.button.remove();
    field.style.paddingRight = decoration.previousPadding || '';
    delete field.dataset.passVaultDecorated;
    delete field.dataset.passVaultPriorPaddingRight;
    fieldDecorations.delete(field);
  }

  function cleanupFieldDecorations(activeFields) {
    for (const [field, decoration] of fieldDecorations.entries()) {
      if (activeFields.has(field) && document.contains(field) && visible(field)) {
        decoration.reposition();
      } else {
        removeFieldDecoration(field);
      }
    }
    if (fieldDecorations.size === 0) closePickers();
  }

  // ------------------------------------------------------------------------
  // Credential capture — works on classic <form>s AND modern SPA login forms
  // that submit via button click + AJAX, without a form element.
  // ------------------------------------------------------------------------

  // Track the most recent values typed in any login-looking fields. This way,
  // even if the form is removed from the DOM after submit, we still have the
  // credential to offer for saving.
  const lastTyped = { username: '', password: '', updatedAt: 0 };
  const SUBMIT_LABELS = /\b(sign[\s-]?in|sign[\s-]?up|log[\s-]?in|create account|register|continue|next|submit)\b/i;

  function readCredentialFromPage() {
    const passwordField = Array.from(document.querySelectorAll(PASSWORD_SELECTOR))
      .filter(visible)
      .filter(isAuthPasswordField)
      .find((field) => field.value && field.value.length >= 4);
    let username = lastTyped.username;
    let password = '';
    if (passwordField) {
      password = passwordField.value;
      const usernameField = usernameForPassword(passwordField);
      if (usernameField?.value) username = usernameField.value;
    } else if (lastTyped.password && Date.now() - lastTyped.updatedAt < 60_000) {
      // The form was wiped after submit; rely on the values we cached.
      password = lastTyped.password;
    }
    if (!password) return null;
    let title;
    try { title = new URL(location.origin).hostname.replace(/^www\./, ''); }
    catch { title = document.title || 'New Login'; }
    return { title, url: location.origin, username, password };
  }

  function trackTypedValues() {
    document.addEventListener('input', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      if (target.matches(PASSWORD_SELECTOR)) {
        lastTyped.password = target.value;
        lastTyped.updatedAt = Date.now();
      } else if (target.matches(USERNAME_SELECTOR)) {
        // Heuristic — only track if the input looks like an identifier.
        if (target.value.length > 2 && target.value.length < 256) {
          lastTyped.username = target.value;
          lastTyped.updatedAt = Date.now();
        }
      }
    }, true);
  }

  async function offerToSave(reason) {
    const credential = readCredentialFromPage();
    if (!credential) return;

    // Never on the Pass Vault app's own login.
    if (await isPassVaultOrigin()) return;

    // Ask the background to classify against saved items (handles same/different
    // username + password, owner-only updates, locked fallback).
    let cls = { kind: 'new' };
    try {
      const resp = await sendMessage({ type: 'classify-captured', credential });
      if (resp?.ok) cls = resp;
    } catch { /* default to a plain save prompt */ }
    if (cls.kind === 'saved') return;

    await sendMessage({ type: 'remember-captured', credential });
    showSavePrompt(credential, reason, cls);
  }

  function installFormCapture(form) {
    if (form.dataset.passVaultCaptureInstalled) return;
    form.dataset.passVaultCaptureInstalled = 'true';
    form.addEventListener('submit', () => {
      // Submit fires before navigation. Capture immediately, then show prompt
      // after a short delay (allows the page to settle if it redirects).
      const credential = readCredentialFromPage();
      if (credential) {
        sendMessage({ type: 'remember-captured', credential });
        // Try to surface the prompt now — works for SPAs that don't navigate.
        setTimeout(() => offerToSave('form-submit'), 400);
      }
    }, true);
  }

  function installButtonCapture() {
    // Catch clicks on any element whose label looks like a submit action.
    document.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target.closest('button, [role="button"], input[type="submit"]') : null;
      if (!target) return;
      const label = (target.innerText || target.value || target.getAttribute('aria-label') || '').trim();
      if (!SUBMIT_LABELS.test(label)) return;
      // Defer so the click handler can populate the page state first.
      setTimeout(() => offerToSave('button-click'), 600);
    }, true);
  }

  function installBlurCapture() {
    // If the user types into a password field and then defocuses without
    // submitting a form, we still want to capture (some sites only submit
    // via XHR with no obvious submit button).
    document.addEventListener('blur', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement) || !target.matches(PASSWORD_SELECTOR)) return;
      if (!target.value) return;
      // Wait for a likely XHR to land before offering, but don't block forever.
      setTimeout(() => offerToSave('blur'), 2000);
    }, true);
  }

  function showSavePrompt(credential, reason = 'submit', cls = { kind: 'new' }) {
    if (!credential?.password || !sameHost(credential.url, location.origin)) return;
    const existing = document.querySelector('.pass-vault-save-prompt');
    if (existing) existing.remove();

    const host = hostFromUrl(credential.url || '') || String(credential.title || '');
    const looksPublic = host.includes('.') && !/^\d{1,3}(\.\d{1,3}){3}$/.test(host) && host !== 'localhost' && !host.endsWith('.local');
    const globeSvg = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>';
    const favicon = looksPublic
      ? `<img src="https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64" alt="" referrerpolicy="no-referrer">`
      : '';

    // Title / note / buttons depend on how this login compares to what's saved.
    const itemId = cls.item?.id;
    let title = 'Save this login?';
    let note = '';
    let actions;
    if (cls.kind === 'update-password') {
      title = 'Update saved password?';
      note = 'This password is different from the one saved for this login.';
      actions = [
        { label: 'Not now', kind: 'dismiss' },
        { label: 'Update password', kind: 'update', primary: true },
      ];
    } else if (cls.kind === 'new-username') {
      note = `You already have a login saved for ${escapeHtml(host)}.`;
      actions = [
        { label: 'Save as new login', kind: 'save', primary: true },
        { label: 'Update existing login', kind: 'update' },
        { label: 'Not now', kind: 'dismiss' },
      ];
    } else {
      actions = [
        { label: 'Not now', kind: 'dismiss' },
        { label: 'Save password', kind: 'save', primary: true },
      ];
    }
    const stacked = actions.length > 2;
    const actionsHtml = actions.map((a, i) =>
      `<button type="button" data-idx="${i}"${a.primary ? ' class="primary"' : ''}>${a.label}</button>`,
    ).join('');

    const prompt = document.createElement('div');
    prompt.className = 'pass-vault-save-prompt';
    prompt.dataset.reason = reason;
    prompt.innerHTML = `
      <div class="pass-vault-save-header">
        <span class="pass-vault-save-brand">
          <span class="pass-vault-logo">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="10" width="16" height="11" rx="2.5"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>
          </span>
          <span>Pass Vault</span>
        </span>
        <button class="pass-vault-save-close" type="button" aria-label="Close">✕</button>
      </div>
      <div class="pass-vault-save-body">
        <div class="pass-vault-save-title">${title}</div>
        ${note ? `<div class="pass-vault-save-note">${note}</div>` : ''}
        <div class="pass-vault-save-site">
          <span class="pass-vault-save-favicon ${favicon ? '' : 'fallback'}">${favicon || globeSvg}</span>
          <span class="pass-vault-save-site-text">
            <strong>${escapeHtml(credential.title)}</strong>
            <span>${escapeHtml(credential.username || 'No username detected')}</span>
          </span>
        </div>
        <div class="pass-vault-save-pass">
          <span class="pass-vault-save-label">Password</span>
          <span class="pass-vault-save-dots">${'•'.repeat(Math.min(16, credential.password.length))}</span>
        </div>
        <div class="pass-vault-save-status"></div>
        <div class="pass-vault-save-actions${stacked ? ' stacked' : ''}">${actionsHtml}</div>
      </div>
    `;
    document.body.appendChild(prompt);

    // Swap to the globe fallback if the favicon can't load (CSP-safe; no inline handler).
    const faviconImg = prompt.querySelector('.pass-vault-save-favicon img');
    if (faviconImg) {
      faviconImg.addEventListener('error', () => {
        const holder = faviconImg.parentElement;
        if (holder) { holder.classList.add('fallback'); holder.innerHTML = globeSvg; }
      });
    }

    const status = prompt.querySelector('.pass-vault-save-status');
    const dismiss = async () => {
      await sendMessage({ type: 'discard-pending-capture' });
      prompt.remove();
    };
    prompt.querySelector('.pass-vault-save-close').addEventListener('click', dismiss);

    const runAction = async (action, button) => {
      if (action.kind === 'dismiss') { dismiss(); return; }
      const original = button.textContent;
      button.disabled = true;
      button.textContent = action.kind === 'update' ? 'Updating…' : 'Saving…';
      status.textContent = '';
      status.className = 'pass-vault-save-status';
      const response = action.kind === 'update'
        ? await sendMessage({ type: 'update-captured', itemId, credential })
        : await sendMessage({ type: 'save-captured', credential });
      if (response?.ok) {
        button.textContent = action.kind === 'update' ? 'Updated ✓' : 'Saved ✓';
        status.textContent = action.kind === 'update' ? 'Updated in your Pass Vault.' : 'Stored in your Pass Vault.';
        status.className = 'pass-vault-save-status success';
        setTimeout(() => prompt.remove(), 1100);
      } else {
        button.disabled = false;
        button.textContent = original;
        status.textContent = response?.error === 'Vault locked'
          ? 'Vault is locked — open the extension and unlock, then try again.'
          : (response?.error || 'Could not complete. Please try again.');
        status.className = 'pass-vault-save-status error';
      }
    };

    prompt.querySelectorAll('.pass-vault-save-actions button').forEach((button) => {
      const action = actions[Number(button.dataset.idx)];
      button.addEventListener('click', () => runAction(action, button));
    });

    // Auto-dismiss after 30s of inactivity so it doesn't linger forever.
    setTimeout(() => { if (document.body.contains(prompt) && !prompt.dataset.interacted) prompt.remove(); }, 30_000);
    prompt.addEventListener('mouseenter', () => { prompt.dataset.interacted = 'true'; });
  }

  // Backwards-compatible name used elsewhere in this file.
  async function maybeShowSavePrompt(preloaded) {
    const credential = preloaded ?? (await sendMessage({ type: 'get-pending-capture' }))?.credential;
    if (!credential) return;
    if (await isPassVaultOrigin()) return;
    let cls = { kind: 'new' };
    try {
      const resp = await sendMessage({ type: 'classify-captured', credential });
      if (resp?.ok) cls = resp;
    } catch { /* default */ }
    if (cls.kind === 'saved') return;
    showSavePrompt(credential, 'page-load', cls);
  }

  function sameHost(first, second) {
    return hostsMatch(hostFromUrl(first), hostFromUrl(second));
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

  function normalizeUsername(value) {
    return String(value || '').trim().toLowerCase();
  }

  function credentialAlreadySaved(credential, items) {
    const username = normalizeUsername(credential.username);
    return items.some((item) => {
      if (!sameHost(item.url || '', credential.url || '')) return false;
      const savedUsername = normalizeUsername(item.username);
      if (!username || !savedUsername) return true;
      return savedUsername === username;
    });
  }

  // Dedup against a local index of {host, username} that the background keeps in
  // chrome.storage (no passwords). This works even when the MV3 service worker has
  // been torn down (vault "locked"), which is why already-saved logins used to
  // re-prompt on every visit.
  // Never offer to save credentials for Pass Vault itself (the web app / API
  // origin) — that login isn't a vault item, so it would re-prompt forever.
  async function isPassVaultOrigin() {
    try {
      const { webAppUrl, apiBaseUrl } = await chrome.storage.local.get(['webAppUrl', 'apiBaseUrl']);
      const origins = [];
      for (const u of [webAppUrl || 'https://passvault.103.180.163.41.sslip.io', apiBaseUrl || 'https://passvault.103.180.163.41.sslip.io/api']) {
        try { origins.push(new URL(u).origin); } catch { /* ignore */ }
      }
      return origins.includes(location.origin);
    } catch {
      return false;
    }
  }

  async function isSavedLocally(credential) {
    try {
      const { savedCredIndex } = await chrome.storage.local.get(['savedCredIndex']);
      if (!Array.isArray(savedCredIndex) || savedCredIndex.length === 0) return false;
      const host = hostFromUrl(credential.url || '');
      const username = normalizeUsername(credential.username);
      return savedCredIndex.some((entry) => {
        if (!hostsMatch(host, entry.host)) return false;
        if (!username || !entry.username) return true;
        return entry.username === username;
      });
    } catch {
      return false;
    }
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[char]));
  }

  async function scan() {
    injectStyle();
    const passwordFields = Array.from(document.querySelectorAll(PASSWORD_SELECTOR)).filter(isAuthPasswordField);
    const fieldsToDecorate = new Set();
    for (const passwordField of passwordFields) {
      fieldsToDecorate.add(passwordField);
      const usernameField = usernameForPassword(passwordField);
      if (usernameField) fieldsToDecorate.add(usernameField);
      const form = passwordField.closest('form');
      if (form) installFormCapture(form);
    }
    cleanupFieldDecorations(fieldsToDecorate);
    for (const field of fieldsToDecorate) decorateField(field);
  }

  // Global hooks that work even on SPA login flows without <form> elements.
  trackTypedValues();
  installButtonCapture();
  installBlurCapture();

  scan();
  setTimeout(() => maybeShowSavePrompt(null), 800);

  // Trigger an offerToSave when the URL changes (SPA navigations) — typical
  // pattern is: user submits credentials → SPA pushes new route → page stays loaded.
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(() => offerToSave('spa-navigation'), 800);
    }
  }, 1500);

  const observer = new MutationObserver(() => scan());
  observer.observe(document.body, { childList: true, subtree: true });
})();
