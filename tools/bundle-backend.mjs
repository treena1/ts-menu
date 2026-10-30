// Combines backend/*.gs into one file to paste into Apps Script:
//   backend-bundle/Code.gs
// Run after any backend or shared/core.js change:  node tools/bundle-backend.mjs
// (sync-shared.mjs runs this for you.)
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'backend');

// Same order Apps Script would load them: Core first, then the rest.
const names = readdirSync(dir).filter((f) => f.endsWith('.gs')).sort((a, b) => (a === 'Core.gs' ? -1 : b === 'Core.gs' ? 1 : a.localeCompare(b)));

let out = '// GENERATED from backend/*.gs by tools/bundle-backend.mjs. Do not edit here.\n'
  + '// Paste this whole file into Apps Script as Code.gs.\n';
for (const f of names) {
  out += '\n// ==================== ' + f + ' ====================\n\n' + readFileSync(join(dir, f), 'utf8').replace(/\s*$/, '\n');
}

mkdirSync(join(root, 'backend-bundle'), { recursive: true });
writeFileSync(join(root, 'backend-bundle', 'Code.gs'), out);
console.log('wrote backend-bundle/Code.gs (' + names.length + ' files, ' + out.split('\n').length + ' lines)');
