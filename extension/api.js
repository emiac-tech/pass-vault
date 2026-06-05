// Thin API client for the extension. The base URL is configurable via storage,
// defaulting to the same dev URL the web app uses.

const DEFAULT_BASE = 'https://passvault.103.180.163.41.sslip.io/api';

async function getBase() {
  const stored = await chrome.storage.local.get(['apiBaseUrl']);
  return stored.apiBaseUrl || DEFAULT_BASE;
}

async function getToken() {
  // Prefer the web app account session (auto-connect); fall back to a legacy
  // paired-device token if one still exists.
  const stored = await chrome.storage.local.get(['accountToken', 'extensionToken']);
  return stored.accountToken || stored.extensionToken || null;
}

async function request(path, { method = 'GET', body, anonymous = false } = {}) {
  const base = await getBase();
  const token = anonymous ? null : await getToken();
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!response.ok) throw new Error(data?.error || `Pass Vault ${response.status}`);
  return data;
}

export const api = {
  setBaseUrl: (url) => chrome.storage.local.set({ apiBaseUrl: url }),
  redeem: (code, deviceName, browser) =>
    request('/extension/redeem', { method: 'POST', body: { code, deviceName, browser }, anonymous: true }),
  me: () => request('/extension/me'),
  listItems: () => request('/extension/items'),
  createItem: (item) => request('/extension/items', { method: 'POST', body: item }),
  updateItem: (id, item) => request(`/extension/items/${id}`, { method: 'PATCH', body: item }),
};
