// Runs the Apps Script backend (backend/*.gs) inside Node, against an in-memory
// spreadsheet, so the API can be tested and the app run locally without Google.
// Only the slice of each Apps Script service that the backend uses is emulated.
import vm from 'node:vm';
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---------- Spreadsheet ----------

class FakeRange {
  constructor(sheet, row, col, rows, cols) { Object.assign(this, { sheet, row, col, rows, cols }); }
  getValues() {
    const out = [];
    for (let r = 0; r < this.rows; r++) {
      const line = [];
      for (let c = 0; c < this.cols; c++) {
        const v = (this.sheet.cells[this.row - 1 + r] || [])[this.col - 1 + c];
        const blank = v === undefined || v === '';
        // Like Sheets: an empty cell under a checkbox rule reads as false
        line.push(blank ? (this.sheet.checkboxCols.has(this.col + c) ? false : '') : v);
      }
      out.push(line);
    }
    return out;
  }
  setValues(values) {
    if (values.length !== this.rows || values.some((l) => l.length !== this.cols)) throw new Error('setValues: size mismatch');
    if (this.row - 1 + this.rows > this.sheet.maxRows) throw new Error('Range out of bounds');
    values.forEach((line, r) => line.forEach((v, c) => this.sheet.set(this.row + r, this.col + c, v)));
    return this;
  }
  clearContent() {
    for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) this.sheet.set(this.row + r, this.col + c, '');
    return this;
  }
  setFontWeight() { return this; }
  setBackground() { return this; }
  setDataValidation(rule) {
    if (rule && rule.checkbox) for (let c = 0; c < this.cols; c++) this.sheet.checkboxCols.add(this.col + c);
    return this;
  }
}

class FakeSheet {
  constructor(name, cells) { this.name = name; this.cells = cells || []; this.checkboxCols = new Set(); this.maxRows = Math.max(1000, this.cells.length); }
  set(row, col, v) {
    if (typeof v === 'string' && v.startsWith("'")) v = v.slice(1); // Sheets' text marker
    while (this.cells.length < row) this.cells.push([]);
    this.cells[row - 1][col - 1] = v;
  }
  getName() { return this.name; }
  getLastRow() {
    for (let r = this.cells.length; r > 0; r--) if ((this.cells[r - 1] || []).some((v) => v !== '' && v !== undefined)) return r;
    return 0;
  }
  getLastColumn() { return this.cells.reduce((m, line) => Math.max(m, line.reduce((n, v, i) => (v !== '' && v !== undefined ? i + 1 : n), 0)), 0); }
  getMaxRows() { return this.maxRows; }
  insertRowsAfter(_after, n) { this.maxRows += n; }
  getRange(row, col, rows = 1, cols = 1) { return new FakeRange(this, row, col, rows, cols); }
  setFrozenRows() {}
}

class FakeSpreadsheet {
  constructor(data) {
    this.sheets = Object.entries(data || { Sheet1: [] }).map(([n, cells]) => new FakeSheet(n, cells));
  }
  getSheetByName(n) { return this.sheets.find((s) => s.name === n) || null; }
  insertSheet(n) { const s = new FakeSheet(n); this.sheets.push(s); return s; }
  getSheets() { return this.sheets.slice(); }
  deleteSheet(s) { this.sheets = this.sheets.filter((x) => x !== s); }
  getUrl() { return 'https://docs.google.com/spreadsheets/d/local-dev'; }
  toJSON() { return Object.fromEntries(this.sheets.map((s) => [s.name, s.cells])); }
}

// ---------- Network (synchronous, like UrlFetchApp) ----------

const FETCH_SCRIPT = `
let input = ''; process.stdin.on('data', d => input += d).on('end', async () => {
  const req = JSON.parse(input);
  try {
    const r = await fetch(req.url, { method: req.method || 'GET', headers: req.headers || {}, redirect: 'follow' });
    const buf = Buffer.from(await r.arrayBuffer());
    process.stdout.write(JSON.stringify({ code: r.status, contentType: r.headers.get('content-type') || '', body: buf.toString('base64') }));
  } catch (e) { process.stdout.write(JSON.stringify({ error: String(e) })); }
});`;

function realFetch(url, opts = {}) {
  const out = execFileSync(process.execPath, ['-e', FETCH_SCRIPT], { input: JSON.stringify({ url, headers: opts.headers }), maxBuffer: 50e6 });
  const res = JSON.parse(out.toString());
  if (res.error) throw new Error('Fetch failed: ' + res.error);
  return { code: res.code, contentType: res.contentType, bytes: Buffer.from(res.body, 'base64') };
}

function makeBlob(bytes, contentType, name) {
  const buf = Buffer.from(bytes);
  return {
    _bytes: buf, _type: contentType || 'application/octet-stream', _name: name || 'blob',
    getBytes() { return [...this._bytes]; }, getContentType() { return this._type; },
    getName() { return this._name; }, setName(n) { this._name = n; return this; },
    getDataAsString() { return this._bytes.toString('utf8'); },
  };
}

function httpResponse(r) {
  return {
    getResponseCode: () => r.code,
    getContentText: () => Buffer.from(r.bytes).toString('utf8'),
    getBlob: () => makeBlob(r.bytes, (r.contentType || '').split(';')[0]),
    getHeaders: () => ({ 'Content-Type': r.contentType }),
  };
}

// ---------- Backend factory ----------

/**
 * options:
 *   dataFile   — JSON file to persist the fake spreadsheet (omit for memory only)
 *   filesDir   — where fake Drive files go (omit for memory only)
 *   fetch(url, opts) → { code, contentType, bytes|text } — override the network
 *   properties — initial Script Properties
 *   bundle     — load backend-bundle/Code.gs instead of the separate backend/*.gs files
 */
export function createBackend(options = {}) {
  const saved = options.dataFile && existsSync(options.dataFile) ? JSON.parse(readFileSync(options.dataFile, 'utf8')) : null;
  const ss = new FakeSpreadsheet(saved);
  const props = Object.assign({}, options.properties);
  const files = {};
  const doFetch = (url, opts) => {
    const r = (options.fetch || realFetch)(url, opts || {});
    if (r.text != null && !r.bytes) r.bytes = Buffer.from(r.text);
    return httpResponse(r);
  };

  const folder = (id) => ({
    getId: () => id,
    createFile(blob) {
      const fid = 'f' + randomUUID().slice(0, 8);
      files[fid] = { blob, trashed: false };
      if (options.filesDir) {
        mkdirSync(options.filesDir, { recursive: true });
        writeFileSync(join(options.filesDir, fid), blob._bytes);
      }
      return { getId: () => fid, setSharing() {}, setTrashed(t) { files[fid].trashed = t; } };
    },
  });

  const context = {
    console,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss,
      flush() {},
      newDataValidation() {
        let checkbox = false;
        const b = { requireCheckbox: () => { checkbox = true; return b; }, requireValueInList: () => b, setAllowInvalid: () => b, build: () => ({ checkbox }) };
        return b;
      },
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (s) => ({ content: s, setMimeType() { return this; }, getContent() { return this.content; } }),
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, tryLock: () => true, releaseLock() {} }) },
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); } }),
    },
    Session: { getScriptTimeZone: () => 'America/Chicago' },
    Logger: { log: () => {} },
    Utilities: {
      getUuid: () => randomUUID(),
      formatDate: (d, _tz, fmt) => {
        if (fmt !== 'yyyy-MM-dd') throw new Error('fake formatDate only knows yyyy-MM-dd');
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      },
      base64Decode: (s) => [...Buffer.from(s, 'base64')],
      newBlob: (bytes, type, name) => makeBlob(bytes, type, name),
    },
    UrlFetchApp: {
      fetch: (url, opts) => doFetch(url, opts),
      fetchAll: (reqs) => reqs.map((r) => doFetch(r.url, r)),
    },
    DriveApp: {
      Access: { ANYONE_WITH_LINK: 'ANYONE_WITH_LINK' },
      Permission: { VIEW: 'VIEW' },
      createFolder: () => folder('folder-local'),
      getFolderById: (id) => folder(id),
      getFileById: (id) => {
        if (!files[id]) throw new Error('No file ' + id);
        return { setTrashed: (t) => { files[id].trashed = t; } };
      },
    },
  };
  vm.createContext(context);

  // Same order Apps Script would load them: Core first, then the rest.
  if (options.bundle) {
    vm.runInContext(readFileSync(join(root, 'backend-bundle', 'Code.gs'), 'utf8'), context, { filename: 'backend-bundle/Code.gs' });
  } else {
    const dir = join(root, 'backend');
    const names = readdirSync(dir).filter((f) => f.endsWith('.gs')).sort((a, b) => (a === 'Core.gs' ? -1 : b === 'Core.gs' ? 1 : a.localeCompare(b)));
    for (const f of names) vm.runInContext(readFileSync(join(dir, f), 'utf8'), context, { filename: 'backend/' + f });
  }

  vm.runInContext('setupSheet()', context);

  if (options.dataFile) mkdirSync(dirname(options.dataFile), { recursive: true });
  const persist = () => { if (options.dataFile) writeFileSync(options.dataFile, JSON.stringify(ss)); };
  persist();

  const unwrap = (out) => JSON.parse(out.getContent());
  return {
    context, ss, files, props,
    doGet(parameter) { return unwrap(context.doGet({ parameter })); },
    doPost(contents) { const r = unwrap(context.doPost({ postData: { contents } })); persist(); return r; },
    /** Calls an action the way the phone would (GET for reads, POST for writes). */
    call(action, args = {}, method = 'POST') {
      const r = method === 'GET'
        ? this.doGet({ action, args: JSON.stringify(args) })
        : this.doPost(JSON.stringify({ action, args }));
      if (!r.ok) throw new Error(action + ': ' + r.error);
      return r.data;
    },
  };
}
