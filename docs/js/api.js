// Talks to the Apps Script backend. Reads are GETs; writes are POSTs sent as text/plain
// so the browser skips the CORS preflight Apps Script can't answer.
import { getApiUrl } from './config.js';

export class OfflineError extends Error {
  constructor() { super("You're offline. Try again when you're connected."); this.offline = true; }
}

async function send(url, init) {
  let res;
  try {
    res = await fetch(url, init);
  } catch (err) {
    throw new OfflineError();
  }
  let body;
  try { body = await res.json(); } catch (err) { throw new Error('The server sent something unexpected (HTTP ' + res.status + ').'); }
  if (!body.ok) throw new Error(body.error || 'Something went wrong.');
  return body.data;
}

function base() {
  const url = getApiUrl();
  if (!url) throw new Error('Not connected yet. Paste your Web App URL in Pantry > App.');
  return url;
}

export function get(action, args) {
  const q = 'action=' + encodeURIComponent(action) + (args ? '&args=' + encodeURIComponent(JSON.stringify(args)) : '');
  const url = base();
  return send(url + (url.includes('?') ? '&' : '?') + q, { method: 'GET' });
}

export function post(action, args) {
  return send(base(), {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, args: args || {} }),
  });
}
