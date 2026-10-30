// Where the Apps Script Web App lives.
//
// Leave DEFAULT_API_URL empty and paste the URL into Pantry > App on the phone instead:
// it's then stored only on the phone, not published in the public GitHub repo, which
// keeps the open endpoint unlisted. Running locally (tools/dev-server.mjs) uses /api.
const DEFAULT_API_URL = '';

const KEY = 'tsmenu.apiUrl';
const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);

export function getApiUrl() {
  return localStorage.getItem(KEY) || DEFAULT_API_URL || (isLocal ? '/api' : '');
}

export function setApiUrl(url) {
  if (url) localStorage.setItem(KEY, url.trim());
  else localStorage.removeItem(KEY);
}

export const APP_VERSION = '1.0.0';
