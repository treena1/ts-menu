/**
 * Ts Menu — tiny table layer over the Sheet.
 *
 * Each tab is a table: row 1 is headers, every other row is a record keyed by header
 * name. Reads are cached for the length of one request. Writes replace the whole
 * table, which is simple and fast enough for one person's recipes.
 */

const Db = (function () {
  const DATE_ONLY = { DateAdded: true, UseByDate: true };
  const cache = {};

  function sheet_(name) {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
    if (!sheet) throw new Error('Missing sheet tab "' + name + '". Run setupSheet() first.');
    return sheet;
  }

  function headers_(sheet) {
    const lastCol = sheet.getLastColumn();
    if (lastCol === 0) return [];
    return sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  }

  function fromCell_(header, value) {
    if (value instanceof Date) {
      if (DATE_ONLY[header]) return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      return value.toISOString();
    }
    return value;
  }

  function toCell_(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') return JSON.stringify(value);
    if (typeof value === 'string' && value[0] === '=') return "'" + value; // never a formula
    return value;
  }

  function load_(name) {
    if (cache[name]) return cache[name];
    const sheet = sheet_(name);
    const headers = headers_(sheet);
    const lastRow = sheet.getLastRow();
    const rows = [];
    if (lastRow > 1 && headers.length) {
      sheet.getRange(2, 1, lastRow - 1, headers.length).getValues().forEach(function (vals) {
        // An empty cell under a checkbox rule reads as false, so false counts as blank too
        if (vals.every(function (v) { return v === '' || v === null || v === false; })) return;
        const row = {};
        headers.forEach(function (h, i) { if (h) row[h] = fromCell_(h, vals[i]); });
        rows.push(row);
      });
    }
    cache[name] = { headers: headers, rows: rows };
    return cache[name];
  }

  /** All rows of a tab, as fresh copies. */
  function read(name) {
    return load_(name).rows.map(function (r) { return Object.assign({}, r); });
  }

  /** Replaces every data row of a tab. Columns not in the rows are left blank. */
  function write(name, rows) {
    const sheet = sheet_(name);
    const headers = load_(name).headers;
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, headers.length).clearContent();
    if (rows.length) {
      const needed = rows.length + 1;
      if (sheet.getMaxRows() < needed) sheet.insertRowsAfter(sheet.getMaxRows(), needed - sheet.getMaxRows());
      const values = rows.map(function (r) { return headers.map(function (h) { return toCell_(r[h]); }); });
      sheet.getRange(2, 1, rows.length, headers.length).setValues(values);
    }
    cache[name] = { headers: headers, rows: rows.map(function (r) { return Object.assign({}, r); }) };
  }

  /** Read, change, write back. fn receives the rows and returns the new rows. */
  function update(name, fn) {
    const next = fn(read(name));
    write(name, next);
    return next;
  }

  function newId(prefix) {
    return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  return { read: read, write: write, update: update, newId: newId };
})();
