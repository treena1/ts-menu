// Copies shared/core.js to the two places that run it:
//   backend/Core.gs  (Apps Script)   and   docs/js/core.js  (browser)
// Run after every edit to shared/core.js:  node tools/sync-shared.mjs
// Also rebuilds backend-bundle/Code.gs.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'shared', 'core.js'), 'utf8');
const banner = '// GENERATED from shared/core.js by tools/sync-shared.mjs. Do not edit here.\n';

for (const target of ['backend/Core.gs', 'docs/js/core.js']) {
  writeFileSync(join(root, target), banner + src);
  console.log('wrote', target);
}

await import('./bundle-backend.mjs');
