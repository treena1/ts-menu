// Local dev server: serves docs/ and runs the real backend (backend/*.gs) through the
// Apps Script harness at /api, with data saved to tools/.dev-data/.
// Run: node tools/dev-server.mjs   then open http://localhost:8787  (TSMENU_PORT to change)
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname } from 'node:path';
import { createBackend } from './gas-harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const docs = join(here, '..', 'docs');
const dataDir = join(here, '.dev-data');
const port = Number(process.env.TSMENU_PORT) || 8787;

const backend = createBackend({
  dataFile: join(dataDir, 'sheet.json'),
  filesDir: join(dataDir, 'files'),
  properties: process.env.USDA_API_KEY ? { USDA_API_KEY: process.env.USDA_API_KEY } : {},
});

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/api') {
      let out;
      if (req.method === 'POST') {
        let body = '';
        for await (const chunk of req) body += chunk;
        out = backend.doPost(body);
      } else {
        out = backend.doGet(Object.fromEntries(url.searchParams));
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(out));
      console.log(req.method, url.searchParams.get('action') || '(post)', out.ok ? 'ok' : 'ERROR ' + out.error);
      return;
    }
    const path = normalize(url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname));
    const file = join(docs, path);
    if (!file.startsWith(docs)) throw Object.assign(new Error('nope'), { code: 'ENOENT' });
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  } catch (err) {
    res.writeHead(err.code === 'ENOENT' ? 404 : 500, { 'Content-Type': 'text/plain' });
    res.end(err.code === 'ENOENT' ? 'Not found' : String(err));
  }
}).listen(port, () => console.log(`Ts Menu dev server: http://localhost:${port}  (data in tools/.dev-data)`));
