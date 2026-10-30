/**
 * Ts Menu — shared core logic.
 *
 * Pure functions over plain data: units, quantities, serving scaling, step markers,
 * grocery-list math, "What can I cook?" ranking, nutrition totals, and recipe parsing.
 *
 * One source, three runtimes. Edit THIS file only, then run `node tools/sync-shared.mjs`
 * to copy it to backend/Core.gs (Apps Script) and docs/js/core.js (browser).
 *
 * Data uses the Sheet's column names (RecipeID, QuantityAtBaseServings, ...), so rows can
 * pass between the backend and the browser unchanged.
 */
var TsCore = (function () {
  'use strict';

  // ---------- Constants ----------

  const BASE_SERVINGS = 2;

  const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack', 'drink'];

  const CATEGORIES = [
    'Produce', 'Dairy & Eggs', 'Bakery', 'Refrigerated-Protein', 'Frozen',
    'Pantry & Dry Goods', 'Spices & Seasonings', 'Baking', 'Beverages', 'Snacks', 'Other',
  ];

  const SHELF_LIFE_DAYS = {
    'Produce': 7, 'Dairy & Eggs': 14, 'Bakery': 5, 'Refrigerated-Protein': 10, 'Frozen': 90,
    'Pantry & Dry Goods': 365, 'Spices & Seasonings': 730, 'Baking': 365, 'Beverages': 30,
    'Snacks': 60, 'Other': 30,
  };

  const NUTRIENTS = [
    { key: 'calories', label: 'Calories', unit: 'kcal' },
    { key: 'protein', label: 'Protein', unit: 'g' },
    { key: 'carbs', label: 'Carbs', unit: 'g' },
    { key: 'fat', label: 'Fat', unit: 'g' },
    { key: 'fiber', label: 'Fiber', unit: 'g' },
    { key: 'sugar', label: 'Sugar', unit: 'g' },
    { key: 'sodium', label: 'Sodium', unit: 'mg' },
    { key: 'iron', label: 'Iron', unit: 'mg' },
  ];

  // ---------- Small helpers ----------

  function isTrue(v) { return v === true || v === 1 || v === 'TRUE' || v === 'true'; }
  function isFalse(v) { return v === false || v === 0 || v === 'FALSE' || v === 'false'; }

  function asArray(v) {
    if (v == null || v === '') return [];
    return Array.isArray(v) ? v : [v];
  }

  function uniq(list) {
    const seen = {};
    return list.filter(function (x) {
      const k = String(x).toLowerCase();
      if (seen[k]) return false;
      seen[k] = true;
      return true;
    });
  }

  function indexBy(list, key) {
    const out = {};
    (list || []).forEach(function (row) { out[row[key]] = row; });
    return out;
  }

  function round(n, places) {
    const f = Math.pow(10, places == null ? 2 : places);
    return Math.round(n * f) / f;
  }

  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  function titleCase(s) {
    return String(s).trim().replace(/\s+/g, ' ').replace(/\b([a-z])/g, function (m) { return m.toUpperCase(); });
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function todayIso(date) {
    const d = date || new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function addDays(iso, days) {
    const p = String(iso).split('-').map(Number);
    const d = new Date(p[0], p[1] - 1, p[2] + Number(days || 0));
    return todayIso(d);
  }

  function daysBetween(fromIso, toIso) {
    const a = String(fromIso).split('-').map(Number);
    const b = String(toIso).split('-').map(Number);
    return Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / 86400000);
  }

  // ---------- Text cleanup ----------

  const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', frac12: '½', frac14: '¼', frac34: '¾', deg: '°', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…' };

  function decodeEntities(s) {
    return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, function (m, code) {
      if (code[0] === '#') {
        const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return isNaN(n) ? m : String.fromCharCode(n);
      }
      const e = ENTITIES[code.toLowerCase()];
      return e == null ? m : e;
    });
  }

  function cleanText(s) {
    if (s == null) return '';
    let t = String(s).replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ');
    t = decodeEntities(decodeEntities(t)); // some sites double-encode
    return t.replace(/⁄/g, '/').replace(/[ \s]+/g, ' ').trim();
  }

  // ---------- Units ----------

  const VOLUME_ML = { tsp: 4.92892, tbsp: 14.7868, 'fl oz': 29.5735, cup: 236.588, pint: 473.176, quart: 946.353, gallon: 3785.41, ml: 1, l: 1000 };
  const WEIGHT_G = { oz: 28.3495, lb: 453.592, g: 1, kg: 1000 };

  const UNIT_GROUPS = {
    tsp: ['teaspoon', 'teaspoons', 'tsp', 'tsps'],
    tbsp: ['tablespoon', 'tablespoons', 'tbsp', 'tbsps', 'tbs', 'tbl', 'tblsp'],
    cup: ['cup', 'cups'],
    'fl oz': ['fluid ounce', 'fluid ounces', 'fl oz', 'fl. oz', 'fl.oz', 'floz'],
    pint: ['pint', 'pints', 'pt'],
    quart: ['quart', 'quarts', 'qt'],
    gallon: ['gallon', 'gallons', 'gal'],
    ml: ['milliliter', 'milliliters', 'millilitre', 'millilitres', 'ml'],
    l: ['liter', 'liters', 'litre', 'litres', 'l'],
    oz: ['ounce', 'ounces', 'oz'],
    lb: ['pound', 'pounds', 'lb', 'lbs'],
    g: ['gram', 'grams', 'g', 'gr'],
    kg: ['kilogram', 'kilograms', 'kg', 'kgs'],
    '': ['each', 'ea', 'whole', ''],
    clove: ['clove', 'cloves'],
    can: ['can', 'cans', 'tin', 'tins'],
    bunch: ['bunch', 'bunches'],
    pinch: ['pinch', 'pinches'],
    dash: ['dash', 'dashes'],
    slice: ['slice', 'slices'],
    piece: ['piece', 'pieces'],
    package: ['package', 'packages', 'pkg', 'packet', 'packets'],
    head: ['head', 'heads'],
    sprig: ['sprig', 'sprigs'],
    stalk: ['stalk', 'stalks', 'rib', 'ribs'],
    handful: ['handful', 'handfuls'],
    block: ['block', 'blocks'],
    jar: ['jar', 'jars'],
    bag: ['bag', 'bags'],
    bottle: ['bottle', 'bottles'],
    stick: ['stick', 'sticks'],
    sheet: ['sheet', 'sheets'],
  };

  const UNIT_ALIASES = {};
  Object.keys(UNIT_GROUPS).forEach(function (u) {
    UNIT_GROUPS[u].forEach(function (a) { UNIT_ALIASES[a] = u; });
  });

  // Longest first, so "fluid ounces" wins over "fl" and "tablespoons" over "tbs".
  const UNIT_WORDS = Object.keys(UNIT_ALIASES).filter(Boolean).sort(function (a, b) { return b.length - a.length; });

  const PLURALS = { cup: 'cups', pint: 'pints', quart: 'quarts', gallon: 'gallons', clove: 'cloves', can: 'cans', bunch: 'bunches', pinch: 'pinches', dash: 'dashes', slice: 'slices', piece: 'pieces', package: 'packages', head: 'heads', sprig: 'sprigs', stalk: 'stalks', handful: 'handfuls', block: 'blocks', jar: 'jars', bag: 'bags', bottle: 'bottles', stick: 'sticks', sheet: 'sheets' };

  // Units list for the edit form's autocomplete.
  const COMMON_UNITS = ['', 'tsp', 'tbsp', 'cup', 'oz', 'lb', 'fl oz', 'pint', 'quart', 'g', 'ml', 'clove', 'can', 'bunch', 'pinch', 'slice', 'package', 'head', 'sprig', 'stalk', 'block', 'jar', 'stick'];

  function normalizeUnit(unit) {
    if (unit == null) return '';
    let u = String(unit).trim();
    if (u === 'T' || u === 'Tb' || u === 'TB') return 'tbsp';
    if (u === 't') return 'tsp';
    u = u.toLowerCase().replace(/\.$/, '').replace(/\s+/g, ' ');
    return Object.prototype.hasOwnProperty.call(UNIT_ALIASES, u) ? UNIT_ALIASES[u] : u;
  }

  function unitKind(unit) {
    const u = normalizeUnit(unit);
    if (VOLUME_ML[u]) return 'volume';
    if (WEIGHT_G[u]) return 'weight';
    return 'count';
  }

  /**
   * Parses an ingredient's GramsPerUnit text into { unit: grams }.
   * Accepts "cup=120; each=50", "1 cup = 120g", or a JSON object.
   */
  function parseGramsPerUnit(text) {
    const out = {};
    if (!text) return out;
    if (typeof text === 'object') {
      Object.keys(text).forEach(function (k) {
        const g = Number(text[k]);
        if (g > 0) out[normalizeUnit(k)] = g;
      });
      return out;
    }
    const s = String(text).trim();
    if (s[0] === '{') {
      try { return parseGramsPerUnit(JSON.parse(s)); } catch (e) { /* fall through */ }
    }
    s.split(/[;,\n]+/).forEach(function (part) {
      const m = part.match(/^\s*([0-9.\/\s½⅓⅔¼¾⅛⅜⅝⅞]*?)\s*([a-zA-Z][a-zA-Z .]*?)?\s*[=:]\s*([0-9.]+)\s*(?:g|grams?)?\s*$/);
      if (!m) return;
      const per = m[1] && m[1].trim() ? parseQuantity(m[1]) : 1;
      const grams = Number(m[3]);
      if (!per || !(grams > 0)) return;
      out[normalizeUnit(m[2] || '')] = grams / per;
    });
    return out;
  }

  function formatGramsPerUnit(map) {
    return Object.keys(map).map(function (u) { return (u || 'each') + '=' + round(map[u], 2); }).join('; ');
  }

  /** Grams for a quantity of an ingredient, or null when there's no way to know. */
  function toGrams(qty, unit, ingredient) {
    if (qty == null || isNaN(qty)) return null;
    const u = normalizeUnit(unit);
    if (WEIGHT_G[u]) return qty * WEIGHT_G[u];
    const gpu = parseGramsPerUnit(ingredient && ingredient.GramsPerUnit);
    if (gpu[u] != null) return qty * gpu[u];
    if (VOLUME_ML[u]) {
      const vk = Object.keys(gpu).filter(function (k) { return VOLUME_ML[k]; })[0];
      if (vk) return qty * VOLUME_ML[u] * gpu[vk] / VOLUME_ML[vk];
    }
    return null;
  }

  /** Converts between units, going through grams if needed. Null if impossible. */
  function convertQty(qty, fromUnit, toUnit, ingredient) {
    if (qty == null || isNaN(qty)) return null;
    const f = normalizeUnit(fromUnit), t = normalizeUnit(toUnit);
    if (f === t) return qty;
    if (VOLUME_ML[f] && VOLUME_ML[t]) return qty * VOLUME_ML[f] / VOLUME_ML[t];
    if (WEIGHT_G[f] && WEIGHT_G[t]) return qty * WEIGHT_G[f] / WEIGHT_G[t];
    const g = toGrams(qty, f, ingredient);
    if (g == null) return null;
    const per = toGrams(1, t, ingredient);
    if (!per) return null;
    return g / per;
  }

  // ---------- Quantities ----------

  const UNICODE_FRACTIONS = { '½': 1 / 2, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 1 / 4, '¾': 3 / 4, '⅛': 1 / 8, '⅜': 3 / 8, '⅝': 5 / 8, '⅞': 7 / 8, '⅕': 1 / 5, '⅖': 2 / 5, '⅗': 3 / 5, '⅘': 4 / 5, '⅙': 1 / 6, '⅚': 5 / 6 };
  const FRAC_CHARS = Object.keys(UNICODE_FRACTIONS).join('');
  const NUM_SRC = '(?:\\d+\\s+\\d+\\s*\\/\\s*\\d+|\\d+\\s*[' + FRAC_CHARS + ']|\\d+\\s*\\/\\s*\\d+|\\d*\\.\\d+|\\d+|[' + FRAC_CHARS + '])';
  const QTY_SRC = NUM_SRC + '(?:\\s*(?:-|–|—|to)\\s*' + NUM_SRC + ')?';

  function parseNumberToken(tok) {
    const s = String(tok).trim();
    let m = s.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
    if (m) return Number(m[1]) + Number(m[2]) / Number(m[3]);
    m = s.match(new RegExp('^(\\d+)\\s*([' + FRAC_CHARS + '])$'));
    if (m) return Number(m[1]) + UNICODE_FRACTIONS[m[2]];
    m = s.match(/^(\d+)\s*\/\s*(\d+)$/);
    if (m) return Number(m[2]) ? Number(m[1]) / Number(m[2]) : null;
    if (UNICODE_FRACTIONS[s] != null) return UNICODE_FRACTIONS[s];
    const n = Number(s);
    return isNaN(n) ? null : n;
  }

  /** "1 1/2", "1½", "0.5", "2-3" (takes the larger end, safer for shopping). */
  function parseQuantity(str) {
    if (str == null || str === '') return null;
    if (typeof str === 'number') return isNaN(str) ? null : str;
    const s = String(str).replace(/⁄/g, '/').trim();
    const m = s.match(new RegExp('^(' + NUM_SRC + ')(?:\\s*(?:-|–|—|to)\\s*(' + NUM_SRC + '))?$'));
    if (!m) return null;
    const a = parseNumberToken(m[1]);
    const b = m[2] != null ? parseNumberToken(m[2]) : null;
    return b != null && a != null ? Math.max(a, b) : a;
  }

  /** Accepts numbers or text; blank and unparseable become null. */
  function num(v) {
    if (v === '' || v == null) return null;
    if (typeof v === 'number') return isNaN(v) ? null : v;
    return parseQuantity(v);
  }

  const FRACTION_GLYPHS = [[0, ''], [1 / 8, '⅛'], [1 / 4, '¼'], [1 / 3, '⅓'], [3 / 8, '⅜'], [1 / 2, '½'], [5 / 8, '⅝'], [2 / 3, '⅔'], [3 / 4, '¾'], [7 / 8, '⅞'], [1, '']];

  /** 1.5 → "1½", 0.333 → "⅓", 24.2 → "24". */
  function formatQuantity(n) {
    if (n == null || n === '' || isNaN(n)) return '';
    n = Number(n);
    if (n <= 0) return '0';
    if (n >= 20) return String(Math.round(n));
    if (n < 1 / 16) return String(round(n, 2));
    let whole = Math.floor(n);
    const frac = n - whole;
    let best = FRACTION_GLYPHS[0], bestDiff = Infinity;
    FRACTION_GLYPHS.forEach(function (f) {
      const d = Math.abs(frac - f[0]);
      if (d < bestDiff) { best = f; bestDiff = d; }
    });
    if (best[0] === 1) { whole += 1; best = FRACTION_GLYPHS[0]; }
    return (whole > 0 ? String(whole) : '') + best[1] || '0';
  }

  // Fractions worth switching units for: 12 tbsp reads better as ¾ cup, but 6 tbsp
  // doesn't read better as ⅜ cup.
  const CUP_FRACTIONS = [0, 1 / 4, 1 / 3, 1 / 2, 2 / 3, 3 / 4, 1];
  const SPOON_FRACTIONS = [0, 1 / 2, 1];

  function isNice(n, fractions) {
    const f = n - Math.floor(n);
    return (fractions || FRACTION_GLYPHS.map(function (g) { return g[0]; })).some(function (v) { return Math.abs(f - v) <= 0.03; });
  }

  function bestVolume(ml, original) {
    const cups = ml / VOLUME_ML.cup, tbsp = ml / VOLUME_ML.tbsp, tsp = ml / VOLUME_ML.tsp;
    const small = original === 'tsp' || original === 'tbsp';
    if (cups >= 0.25 - 1e-9 && (!small || isNice(cups, CUP_FRACTIONS))) return { qty: cups, unit: 'cup' };
    if (tbsp >= 1 - 1e-9 && (original !== 'tsp' || isNice(tbsp, SPOON_FRACTIONS))) return { qty: tbsp, unit: 'tbsp' };
    return { qty: tsp, unit: 'tsp' };
  }

  /** Picks a readable US customary unit: metric becomes US, 6 tsp becomes 2 tbsp, etc. */
  function humanizeAmount(qty, unit) {
    const u = normalizeUnit(unit);
    if (qty == null || isNaN(qty)) return { qty: null, unit: u };
    if (u === 'g' || u === 'kg') {
      const grams = qty * WEIGHT_G[u];
      const oz = grams / WEIGHT_G.oz;
      if (oz >= 16) return { qty: oz / 16, unit: 'lb' };
      if (oz >= 0.125) return { qty: oz, unit: 'oz' };
      return { qty: Math.max(1, Math.round(grams)), unit: 'g' };
    }
    if (u === 'oz' && qty >= 16 && isNice(qty / 16)) return { qty: qty / 16, unit: 'lb' };
    if (u === 'ml' || u === 'l' || u === 'tsp' || u === 'tbsp' || u === 'cup') {
      return bestVolume(qty * VOLUME_ML[u], u);
    }
    return { qty: qty, unit: u };
  }

  function unitLabel(unit, qty) {
    const u = normalizeUnit(unit);
    if (qty != null && qty > 1 + 1e-9 && PLURALS[u]) return PLURALS[u];
    if (UNIT_ALIASES[u] != null || u === '') return u;
    return String(unit).trim(); // unknown unit — show as typed
  }

  /** (1.5, "cup") → "1½ cups"; (null, "pinch") → "pinch". */
  function formatAmount(qty, unit) {
    const h = humanizeAmount(qty, unit);
    const q = formatQuantity(h.qty);
    // Pluralize from the rounded number shown, so 1.05 cups reads "1 cup".
    const label = unitLabel(h.qty == null ? unit : h.unit, h.qty == null ? null : parseQuantity(q));
    return (q + ' ' + label).trim();
  }

  // ---------- Serving scaling & step markers ----------

  function scaleFactor(servings, baseServings) {
    const base = Number(baseServings) || BASE_SERVINGS;
    const s = Number(servings) || base;
    return s / base;
  }

  /** Steps are stored one per line; leading "1." / "Step 2:" numbering is dropped. */
  function splitSteps(steps) {
    const lines = Array.isArray(steps) ? steps : String(steps || '').split(/\r?\n/);
    return lines
      .map(function (l) { return String(l).replace(/^\s*(?:step\s*)?\d+\s*[.):]\s*/i, '').trim(); })
      .filter(Boolean);
  }

  const MARK_RE_SRC = '\\[([^\\[\\]]+)\\]';

  /** "1 cup" → { qty: 1, unit: "cup" }. Null when the bracket isn't an amount. */
  function parseMarker(inner) {
    const m = String(inner).trim().match(new RegExp('^(' + QTY_SRC + ')\\s*(.*)$'));
    if (!m) return null;
    const qty = parseQuantity(m[1]);
    if (qty == null) return null;
    return { qty: qty, unit: m[2].trim() };
  }

  /** Splits one step into text and scaled-amount pieces, for highlighted rendering. */
  function stepSegments(stepText, scale) {
    const text = String(stepText || '');
    const segs = [];
    const re = new RegExp(MARK_RE_SRC, 'g');
    let last = 0, m;
    while ((m = re.exec(text))) {
      const mk = parseMarker(m[1]);
      if (!mk) continue;
      if (m.index > last) segs.push({ text: text.slice(last, m.index) });
      segs.push({ amount: formatAmount(mk.qty * scale, mk.unit), qty: mk.qty * scale, unit: mk.unit });
      last = re.lastIndex;
    }
    if (last < text.length) segs.push({ text: text.slice(last) });
    return segs;
  }

  function scaleStepText(stepText, scale) {
    return stepSegments(stepText, scale).map(function (s) { return s.text != null ? s.text : s.amount; }).join('');
  }

  /** Rewrites every marker multiplied by factor, keeping the brackets. Used on import. */
  function rescaleMarkers(text, factor) {
    return String(text || '').replace(new RegExp(MARK_RE_SRC, 'g'), function (whole, inner) {
      const mk = parseMarker(inner);
      if (!mk) return whole;
      return '[' + formatAmount(mk.qty * factor, mk.unit) + ']';
    });
  }

  // Units worth marking in step text. Bare numbers ("2 eggs") are too ambiguous to guess.
  const MARKABLE = UNIT_WORDS.filter(function (w) {
    const u = UNIT_ALIASES[w];
    return u !== '' && ['pinch', 'dash', 'piece', 'sheet', 'head'].indexOf(u) < 0 && w.length > 1;
  });
  const SUGGEST_RE_SRC = '(^|[^\\w\\[/.])(' + QTY_SRC + ')\\s*(' + MARKABLE.map(escapeRe).join('|') + ')(?![\\w])\\.?';

  /** Wraps quantity + unit phrases in [brackets] so they scale. The review screen confirms. */
  function suggestMarks(stepText) {
    return String(stepText || '').replace(new RegExp(SUGGEST_RE_SRC, 'gi'), function (whole, pre, q, u) {
      const qty = parseQuantity(q);
      if (qty == null) return whole;
      return pre + '[' + formatQuantity(qty) + ' ' + unitLabel(normalizeUnit(u), qty) + ']';
    });
  }

  // Oven dials go in 25° steps: 180°C → 350°F, 220°C → 425°F.
  function roundF(f) { return Math.round(f / 25) * 25; }

  /** °C → °F (display is US customary). Drops a C value already paired with an F one. */
  function convertTemps(text) {
    return String(text || '')
      .replace(/\s*\(\s*\d{2,3}\s*°\s*C\s*\)/g, '')
      .replace(/(\d{2,3})\s*°\s*C\s*(?:\/|or|\()\s*(\d{2,3})\s*°\s*F\s*\)?/g, '$2°F')
      .replace(/(\d{2,3})\s*(?:°\s*C|degrees\s*C(?:elsius)?)\b/gi, function (m, c) {
        return roundF(Number(c) * 9 / 5 + 32) + '°F';
      });
  }

  // ---------- Ingredient parsing & matching ----------

  const PREP_WORDS = ['chopped', 'diced', 'minced', 'sliced', 'grated', 'shredded', 'finely', 'roughly', 'coarsely', 'thinly', 'freshly', 'fresh', 'peeled', 'crushed', 'cubed', 'halved', 'quartered', 'melted', 'softened', 'packed', 'heaping', 'level', 'large', 'medium', 'small', 'extra-large', 'ripe', 'about', 'approximately'];

  function stripBullet(s) { return s.replace(/^[\s\-–•*▢□☐·]+/, '').trim(); }

  /** "1 1/2 cups all-purpose flour, sifted" → { qty: 1.5, unit: "cup", name: "all-purpose flour", note: "sifted" } */
  function parseIngredientLine(line) {
    let s = stripBullet(cleanText(line));
    const original = s;
    let qty = null, unit = '';
    const notes = [];

    const qm = s.match(new RegExp('^(' + QTY_SRC + ')\\s*'));
    if (qm) { qty = parseQuantity(qm[1]); s = s.slice(qm[0].length); }

    const pm = s.match(/^\(([^)]*)\)\s*/); // "1 (15-ounce) can chickpeas"
    if (pm) { notes.push(pm[1].trim()); s = s.slice(pm[0].length); }

    if (qty != null) {
      if (/^T\b/.test(s)) { unit = 'tbsp'; s = s.replace(/^T\.?\s*/, ''); } else {
        for (let i = 0; i < UNIT_WORDS.length; i++) {
          const w = UNIT_WORDS[i];
          const m = s.match(new RegExp('^' + escapeRe(w) + '(?![a-z])\\.?\\s*', 'i'));
          if (m) { unit = UNIT_ALIASES[w]; s = s.slice(m[0].length); break; }
        }
      }
      s = s.replace(/^of\s+/i, '');
    }

    s = s.replace(/,?\s*\b(to taste|as needed|optional|for serving|for garnish|or more)\b\.?/gi, function (m, p) {
      notes.push(p.toLowerCase());
      return '';
    });
    const ci = s.indexOf(',');
    if (ci >= 0) { notes.push(s.slice(ci + 1).trim()); s = s.slice(0, ci); }
    s = s.replace(/\s*\(([^)]*)\)\s*/g, function (m, p) { notes.push(p.trim()); return ' '; });

    const words = s.trim().split(/\s+/).filter(Boolean);
    const lead = [];
    while (words.length > 1 && PREP_WORDS.indexOf(words[0].toLowerCase().replace(/[^a-z-]/g, '')) >= 0) {
      lead.push(words.shift());
    }
    if (lead.length) notes.unshift(lead.join(' ').replace(/,$/, ''));

    return {
      qty: qty,
      unit: unit,
      name: words.join(' ').replace(/[.,;]+$/, '').trim(),
      note: notes.filter(Boolean).join(', '),
      original: original,
    };
  }

  function singular(w) {
    if (w.length <= 3) return w;
    if (/ies$/.test(w)) return w.slice(0, -3) + 'y';
    if (/(oes|ches|shes|xes|sses)$/.test(w)) return w.slice(0, -2);
    if (/[^s]s$/.test(w)) return w.slice(0, -1);
    return w;
  }

  /** Matching key: "Tomatoes" and "tomato" are the same ingredient. */
  function ingredientKey(name) {
    return String(name || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').trim().split(/\s+/).map(singular).join(' ');
  }

  function matchIngredient(name, ingredients) {
    const k = ingredientKey(name);
    if (!k) return null;
    const list = ingredients || [];
    for (let i = 0; i < list.length; i++) {
      if (ingredientKey(list[i].Name) === k) return list[i];
    }
    return null;
  }

  // Checked in order: specific phrases before broad words ("black pepper" is a spice,
  // "tomato paste" is pantry, plain "tomato" is produce).
  const CATEGORY_RULES = [
    ['Frozen', ['frozen']],
    ['Spices & Seasonings', ['salt', 'black pepper', 'peppercorn', 'cumin', 'paprika', 'oregano', 'cinnamon', 'chili powder', 'chilli powder', 'turmeric', 'coriander', 'garam masala', 'curry powder', 'red pepper flake', 'pepper flake', 'nutmeg', 'cayenne', 'bay leaf', 'dried thyme', 'dried basil', 'dried rosemary', 'italian seasoning', 'garlic powder', 'onion powder', 'cardamom', 'ground clove', 'whole clove', 'allspice', 'smoked paprika', 'za atar', 'sumac', 'seasoning', 'spice', 'mustard seed', 'fennel seed', 'sesame seed', 'nutritional yeast']],
    ['Baking', ['flour', 'sugar', 'baking soda', 'baking powder', 'yeast', 'vanilla', 'cocoa', 'chocolate chip', 'cornstarch', 'corn starch', 'powdered sugar', 'molasses', 'sprinkle']],
    ['Pantry & Dry Goods', ['tomato paste', 'tomato sauce', 'canned', 'crushed tomato', 'diced tomato', 'whole peeled tomato', 'broth', 'stock', 'bouillon', 'sauce', 'oil', 'vinegar', 'tamari', 'rice', 'pasta', 'noodle', 'spaghetti', 'penne', 'macaroni', 'orzo', 'lasagna', 'lentil', 'chickpea', 'garbanzo', 'bean', 'quinoa', 'oat', 'couscous', 'farro', 'barley', 'bulgur', 'polenta', 'cornmeal', 'peanut butter', 'almond butter', 'tahini', 'honey', 'maple syrup', 'syrup', 'almond', 'cashew', 'walnut', 'pecan', 'peanut', 'pistachio', 'pine nut', 'coconut milk', 'salsa', 'mustard', 'ketchup', 'mayo', 'mayonnaise', 'olive', 'caper', 'raisin', 'dried', 'panko', 'breadcrumb', 'bread crumb', 'jam', 'miso', 'sriracha', 'harissa', 'curry paste', 'chipotle']],
    ['Dairy & Eggs', ['milk', 'cheese', 'butter', 'yogurt', 'yoghurt', 'cream', 'egg', 'parmesan', 'mozzarella', 'feta', 'ricotta', 'cheddar', 'gruyere', 'halloumi', 'paneer', 'ghee', 'half and half', 'creme fraiche', 'mascarpone', 'burrata', 'goat cheese', 'kefir']],
    ['Refrigerated-Protein', ['tofu', 'tempeh', 'seitan', 'veggie burger', 'plant-based', 'plant based', 'vegan sausage', 'veggie sausage', 'meatless', 'impossible', 'beyond']],
    ['Bakery', ['bread', 'tortilla', 'pita', 'bun', 'baguette', 'naan', 'roll', 'bagel', 'croissant', 'english muffin', 'flatbread', 'sourdough', 'ciabatta', 'brioche']],
    ['Beverages', ['coffee', 'tea', 'juice', 'wine', 'sparkling', 'soda', 'kombucha', 'seltzer', 'beer', 'tonic']],
    ['Snacks', ['chip', 'cracker', 'pretzel', 'popcorn', 'granola bar', 'cookie']],
    ['Produce', ['onion', 'garlic', 'tomato', 'potato', 'carrot', 'celery', 'bell pepper', 'pepper', 'jalapeno', 'jalapeño', 'chile', 'chili', 'spinach', 'kale', 'lettuce', 'arugula', 'cilantro', 'parsley', 'basil', 'mint', 'dill', 'thyme', 'rosemary', 'sage', 'chive', 'lemon', 'lime', 'orange', 'apple', 'banana', 'berry', 'berries', 'grape', 'mango', 'pineapple', 'peach', 'pear', 'avocado', 'mushroom', 'zucchini', 'squash', 'pumpkin', 'broccoli', 'cauliflower', 'cabbage', 'cucumber', 'ginger', 'scallion', 'green onion', 'shallot', 'leek', 'corn', 'pea', 'green bean', 'asparagus', 'eggplant', 'beet', 'radish', 'sweet potato', 'yam', 'chard', 'bok choy', 'fennel', 'herb', 'sprout', 'microgreen', 'lemongrass', 'fruit', 'melon', 'cherry', 'plum', 'date', 'fig']],
  ];

  function guessCategory(name) {
    const n = ' ' + ingredientKey(name) + ' ';
    for (let i = 0; i < CATEGORY_RULES.length; i++) {
      const words = CATEGORY_RULES[i][1];
      for (let j = 0; j < words.length; j++) {
        const w = ingredientKey(words[j]);
        if (n.indexOf(' ' + w + ' ') >= 0 || n.indexOf(' ' + w) >= 0 && w.length > 4) return CATEGORY_RULES[i][0];
      }
    }
    return 'Other';
  }

  function defaultShelfLife(category) {
    return SHELF_LIFE_DAYS[category] || SHELF_LIFE_DAYS.Other;
  }

  // Starting conversions for common ingredients, so nutrition and stock math work without
  // typing grams for everything. Editable later on the Ingredients screen.
  const DEFAULT_GRAMS = {
    'all purpose flour': 'cup=120', 'flour': 'cup=120', 'whole wheat flour': 'cup=120', 'bread flour': 'cup=127',
    'sugar': 'cup=200', 'granulated sugar': 'cup=200', 'brown sugar': 'cup=213', 'powdered sugar': 'cup=120',
    'rice': 'cup=185', 'brown rice': 'cup=190', 'basmati rice': 'cup=185', 'quinoa': 'cup=170', 'oat': 'cup=80', 'rolled oat': 'cup=80',
    'lentil': 'cup=192', 'red lentil': 'cup=192', 'couscous': 'cup=173', 'pasta': 'cup=100',
    'water': 'cup=237', 'milk': 'cup=245', 'vegetable broth': 'cup=240', 'vegetable stock': 'cup=240', 'broth': 'cup=240',
    'butter': 'cup=227; stick=113', 'olive oil': 'cup=216', 'vegetable oil': 'cup=218', 'oil': 'cup=218', 'coconut oil': 'cup=218', 'sesame oil': 'cup=218',
    'onion': 'each=150; cup=160', 'red onion': 'each=150; cup=160', 'yellow onion': 'each=150; cup=160', 'shallot': 'each=40',
    'garlic': 'clove=5', 'garlic clove': 'each=5', 'egg': 'each=50', 'large egg': 'each=50',
    'tomato': 'each=120; cup=180', 'cherry tomato': 'cup=150', 'carrot': 'each=60; cup=128', 'celery': 'stalk=40; cup=100',
    'potato': 'each=210', 'sweet potato': 'each=130', 'bell pepper': 'each=120', 'red bell pepper': 'each=120', 'jalapeno': 'each=14',
    'zucchini': 'each=200', 'cucumber': 'each=300', 'avocado': 'each=150', 'lemon': 'each=58', 'lime': 'each=44', 'banana': 'each=118',
    'spinach': 'cup=30', 'baby spinach': 'cup=30', 'kale': 'cup=21; bunch=200', 'mushroom': 'cup=70', 'broccoli': 'cup=91; head=300', 'cauliflower': 'cup=107; head=575',
    'cilantro': 'cup=16; bunch=50', 'parsley': 'cup=60; bunch=60', 'basil': 'cup=24', 'green onion': 'each=15', 'scallion': 'each=15', 'ginger': 'tbsp=6',
    'cheddar cheese': 'cup=113', 'mozzarella': 'cup=113', 'parmesan': 'cup=100', 'parmesan cheese': 'cup=100', 'feta': 'cup=150', 'feta cheese': 'cup=150',
    'yogurt': 'cup=245', 'greek yogurt': 'cup=245', 'sour cream': 'cup=230', 'heavy cream': 'cup=238',
    'chickpea': 'can=250; cup=164', 'black bean': 'can=255; cup=172', 'kidney bean': 'can=255; cup=177', 'cannellini bean': 'can=255; cup=180',
    'coconut milk': 'can=400; cup=226', 'diced tomato': 'can=411; cup=240', 'crushed tomato': 'can=794; cup=242', 'tomato paste': 'tbsp=16; can=170',
    'honey': 'cup=340', 'maple syrup': 'cup=315', 'soy sauce': 'tbsp=16', 'peanut butter': 'tbsp=16', 'tahini': 'tbsp=15',
    'salt': 'tsp=6', 'kosher salt': 'tsp=3', 'black pepper': 'tsp=2.3', 'cumin': 'tsp=2', 'paprika': 'tsp=2.3', 'chili powder': 'tsp=2.7',
    'tofu': 'block=396; cup=250', 'firm tofu': 'block=396; cup=250', 'tortilla': 'each=45', 'flour tortilla': 'each=45', 'corn tortilla': 'each=26', 'bread': 'slice=30',
    'frozen pea': 'cup=134', 'pea': 'cup=145', 'corn': 'cup=154', 'frozen corn': 'cup=154', 'walnut': 'cup=117', 'almond': 'cup=143', 'cashew': 'cup=137',
  };

  function defaultGramsPerUnit(name) {
    const k = ingredientKey(name);
    if (DEFAULT_GRAMS[k]) return DEFAULT_GRAMS[k];
    // "fresh baby spinach" → try the last two words, then the last word.
    const words = k.split(' ');
    for (let n = Math.min(2, words.length - 1); n >= 1; n--) {
      const tail = words.slice(-n).join(' ');
      if (DEFAULT_GRAMS[tail]) return DEFAULT_GRAMS[tail];
    }
    return '';
  }

  /** A new Ingredients row with sensible defaults. The caller assigns the ID. */
  function newIngredientDefaults(name, category) {
    const cat = category && CATEGORIES.indexOf(category) >= 0 ? category : guessCategory(name);
    return {
      Name: String(name).trim(),
      Category: cat,
      NutritionPer100g: '',
      GramsPerUnit: defaultGramsPerUnit(name),
      DefaultShelfLifeDays: defaultShelfLife(cat),
    };
  }

  // ---------- Vegetarian check ----------

  const NON_VEG = ['chicken', 'beef', 'pork', 'bacon', 'ham', 'turkey', 'lamb', 'veal', 'mutton', 'goat meat', 'venison', 'duck', 'goose', 'fish', 'salmon', 'tuna', 'cod', 'tilapia', 'halibut', 'trout', 'shrimp', 'prawn', 'crab', 'lobster', 'anchovy', 'anchovies', 'sardine', 'clam', 'mussel', 'oyster', 'scallop', 'squid', 'calamari', 'octopus', 'gelatin', 'gelatine', 'lard', 'prosciutto', 'pancetta', 'sausage', 'chorizo', 'pepperoni', 'salami', 'meatball', 'steak', 'brisket', 'fish sauce', 'oyster sauce', 'worcestershire', 'bone broth', 'suet'];
  const VEG_QUALIFIER = /(vegan|veggie|vegetarian|plant[- ]based|meatless|beyond|impossible|faux|mock|soy|tofu|no[- ])\s*$/i;

  /** Non-veg words found in the given texts. Warns only — never blocks saving. */
  function findNonVeg(texts) {
    const found = [];
    texts.forEach(function (t) {
      const s = String(t || '').toLowerCase();
      NON_VEG.forEach(function (w) {
        const re = new RegExp('\\b' + escapeRe(w) + '(?:e?s)?\\b', 'g');
        let m;
        while ((m = re.exec(s))) {
          if (VEG_QUALIFIER.test(s.slice(Math.max(0, m.index - 16), m.index))) continue;
          if (found.indexOf(w) < 0) found.push(w);
        }
      });
    });
    return found;
  }

  // ---------- Recipe import (JSON-LD and pasted text) ----------

  function findRecipeNode(node) {
    if (!node || typeof node !== 'object') return null;
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        const f = findRecipeNode(node[i]);
        if (f) return f;
      }
      return null;
    }
    const types = asArray(node['@type']).map(function (t) { return String(t).toLowerCase(); });
    if (types.indexOf('recipe') >= 0) return node;
    return findRecipeNode(node['@graph']) || findRecipeNode(node.mainEntity) || null;
  }

  /** Finds the schema.org/Recipe object embedded in a page's JSON-LD, or null. */
  function extractRecipeFromHtml(html) {
    const re = /<script[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = re.exec(String(html || '')))) {
      const raw = m[1].trim().replace(/^<!\[CDATA\[|\]\]>$/g, '');
      let json = null;
      try { json = JSON.parse(raw); } catch (e) {
        try { json = JSON.parse(raw.replace(/[\u0000-\u001f]+/g, ' ')); } catch (e2) { json = null; }
      }
      const found = findRecipeNode(json);
      if (found) return found;
    }
    return null;
  }

  function flattenInstructions(x) {
    if (x == null) return [];
    if (typeof x === 'string') {
      const t = x.replace(/<\/(p|li)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n');
      return t.split(/\n+/).map(cleanText).filter(Boolean);
    }
    if (Array.isArray(x)) {
      return x.reduce(function (acc, item) { return acc.concat(flattenInstructions(item)); }, []);
    }
    if (typeof x === 'object') {
      if (x.itemListElement) return flattenInstructions(x.itemListElement);
      const t = cleanText(x.text || x.name || '');
      return t ? [t] : [];
    }
    return [];
  }

  function parseDuration(iso) {
    if (!iso) return '';
    const m = String(iso).match(/P(?:(\d+)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+)S)?)?/i);
    if (!m) return '';
    const mins = (Number(m[1]) || 0) * 1440 + (Number(m[2]) || 0) * 60 + (Number(m[3]) || 0) + Math.round((Number(m[4]) || 0) / 60);
    return mins > 0 ? Math.round(mins) : '';
  }

  function parseYield(y) {
    const vals = asArray(y);
    for (let i = 0; i < vals.length; i++) {
      if (typeof vals[i] === 'number' && vals[i] > 0) return vals[i];
      const m = String(vals[i]).match(/(\d+(?:\.\d+)?)/);
      if (m && Number(m[1]) > 0) return Number(m[1]);
    }
    return null;
  }

  function pickImage(img) {
    if (!img) return '';
    if (typeof img === 'string') return img;
    if (Array.isArray(img)) return pickImage(img[img.length > 1 && typeof img[0] === 'string' ? img.length - 1 : 0]);
    return img.url || img.contentUrl || '';
  }

  function guessMealType(category, name) {
    const t = (asArray(category).join(' ') + ' ' + (name || '')).toLowerCase();
    if (/breakfast|brunch|pancake|waffle|oatmeal|granola|muffin/.test(t)) return 'breakfast';
    if (/drink|beverage|cocktail|smoothie|latte|lemonade|tea\b/.test(t)) return 'drink';
    if (/snack|appetizer|dessert|dip\b|cookie|bar\b/.test(t)) return 'snack';
    if (/lunch|salad|sandwich|wrap/.test(t)) return 'lunch';
    return 'dinner';
  }

  function splitKeywords(k) {
    if (!k) return [];
    return (Array.isArray(k) ? k : String(k).split(',')).map(function (s) { return cleanText(s); }).filter(Boolean);
  }

  /**
   * Common shape for the import review screen. Quantities and step marks are at the
   * ORIGINAL yield; the review screen converts to 2 servings on save (finalizeDraft).
   */
  function buildDraft(parts) {
    const ingredients = (parts.ingredientLines || []).map(cleanText).filter(Boolean).map(function (line) {
      const p = parseIngredientLine(line);
      return { Name: p.name, Quantity: p.qty, Unit: p.unit, Note: p.note, original: line };
    });
    const steps = (parts.stepLines || []).map(function (s) { return suggestMarks(convertTemps(cleanText(s))); }).filter(Boolean);
    const name = cleanText(parts.name) || 'Untitled recipe';
    const tags = uniq(parts.tags || []).map(titleCase).filter(function (t) { return t.length <= 24; }).slice(0, 6);
    return {
      Name: name,
      MealType: parts.mealType || guessMealType(parts.category, name),
      Tags: tags,
      PrepTimeMinutes: parts.prep || '',
      CookTimeMinutes: parts.cook || '',
      SourceURL: parts.sourceUrl || '',
      photoSourceUrl: parts.image || '',
      IsVegetarian: true,
      originalYield: parts.yield || BASE_SERVINGS,
      ingredients: ingredients,
      Steps: steps.join('\n'),
      nonVegWarnings: findNonVeg([name].concat(ingredients.map(function (i) { return i.Name; }))),
    };
  }

  function draftFromSchemaRecipe(r, sourceUrl) {
    const prep = parseDuration(r.prepTime);
    let cook = parseDuration(r.cookTime);
    const total = parseDuration(r.totalTime);
    if (!cook && total) cook = Math.max(0, total - (prep || 0)) || '';
    const cuisine = asArray(r.recipeCuisine).map(cleanText);
    return buildDraft({
      name: r.name || r.headline,
      ingredientLines: asArray(r.recipeIngredient || r.ingredients),
      stepLines: flattenInstructions(r.recipeInstructions),
      yield: parseYield(r.recipeYield || r.yield),
      prep: prep,
      cook: cook,
      category: r.recipeCategory,
      tags: cuisine.concat(splitKeywords(r.keywords).slice(0, 3)),
      image: pickImage(r.image),
      sourceUrl: sourceUrl,
    });
  }

  /** Best-effort parse of pasted recipe text: title, ingredient lines, step lines. */
  function parseRecipeText(text) {
    const lines = String(text || '').split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
    if (!lines.length) return buildDraft({});
    const name = lines.shift();
    const ingHead = /^(ingredients?)\s*:?$/i;
    const stepHead = /^(instructions?|directions?|method|steps?|preparation)\s*:?$/i;
    const yieldRe = /^(?:serves|servings|yield|makes)\s*:?\s*(\d+)/i;
    const qtyStart = new RegExp('^[\\-–•*▢□☐·]?\\s*(' + QTY_SRC + ')\\s');
    const ingredientLines = [], stepLines = [];
    let mode = null, yieldN = null;
    lines.forEach(function (l) {
      const y = l.match(yieldRe);
      if (y) { yieldN = Number(y[1]); return; }
      if (ingHead.test(l)) { mode = 'ing'; return; }
      if (stepHead.test(l)) { mode = 'step'; return; }
      if (mode === 'ing') { ingredientLines.push(l); return; }
      if (mode === 'step') { stepLines.push(l); return; }
      // No headings: short lines starting with a quantity are ingredients.
      if (/^(?:step\s*)?\d+\s*[.)]\s+\S/i.test(l) || l.length > 70) stepLines.push(l);
      else if (qtyStart.test(l) || (!stepLines.length && l.length < 45)) ingredientLines.push(l);
      else stepLines.push(l);
    });
    return buildDraft({ name: name, ingredientLines: ingredientLines, stepLines: splitSteps(stepLines), yield: yieldN });
  }

  /**
   * Turns a reviewed draft into a recipe ready to save at 2 servings: ingredient
   * quantities and step marks are multiplied by 2 / originalYield.
   */
  function finalizeDraft(draft) {
    const yieldN = Number(draft.originalYield) || BASE_SERVINGS;
    const factor = BASE_SERVINGS / yieldN;
    return {
      Name: draft.Name,
      MealType: draft.MealType,
      Tags: draft.Tags,
      PrepTimeMinutes: draft.PrepTimeMinutes,
      CookTimeMinutes: draft.CookTimeMinutes,
      BaseServings: BASE_SERVINGS,
      // At factor 1 (normal edits) markers stay exactly as typed.
      Steps: splitSteps(draft.Steps).map(function (s) { return factor === 1 ? s : rescaleMarkers(s, factor); }).join('\n'),
      SourceURL: draft.SourceURL,
      photoSourceUrl: draft.photoSourceUrl,
      IsVegetarian: draft.IsVegetarian !== false,
      Comment: draft.Comment || '',
      ingredients: (draft.ingredients || []).map(function (i) {
        const q = num(i.Quantity);
        return { Name: i.Name, IngredientID: i.IngredientID || '', QuantityAtBaseServings: q == null ? '' : round(q * factor, 4), Unit: normalizeUnit(i.Unit), Note: i.Note || '' };
      }).filter(function (i) { return i.Name; }),
    };
  }

  // ---------- Recipes ----------

  function isVegetarian(r) { return !isFalse(r.IsVegetarian); }

  function tagsOf(r) {
    if (Array.isArray(r.Tags)) return r.Tags;
    return String(r.Tags || '').split(',').map(function (t) { return t.trim(); }).filter(Boolean);
  }

  /** filters: { mealType, tag, favorite, search, ingredients (for searching by ingredient) } */
  function filterRecipes(recipes, filters) {
    const f = filters || {};
    const ingById = indexBy(f.ingredients || [], 'IngredientID');
    const q = String(f.search || '').trim().toLowerCase();
    return (recipes || []).filter(function (r) {
      if (!isVegetarian(r)) return false;
      if (f.mealType && r.MealType !== f.mealType) return false;
      if (f.favorite && !isTrue(r.IsFavorite)) return false;
      const tags = tagsOf(r);
      if (f.tag && !tags.some(function (t) { return t.toLowerCase() === String(f.tag).toLowerCase(); })) return false;
      if (q) {
        const hay = [r.Name, tags.join(' ')].concat((r.ingredients || []).map(function (i) {
          return (ingById[i.IngredientID] || {}).Name || '';
        })).join(' ').toLowerCase();
        if (q.split(/\s+/).some(function (w) { return hay.indexOf(w) < 0; })) return false;
      }
      return true;
    });
  }

  function recipeNutrition(recipe, ingredients) {
    const ingById = Array.isArray(ingredients) ? indexBy(ingredients, 'IngredientID') : (ingredients || {});
    const totals = {};
    NUTRIENTS.forEach(function (n) { totals[n.key] = 0; });
    const missingNutrition = [], missingGrams = [];
    let counted = 0;
    (recipe.ingredients || []).forEach(function (ri) {
      const ing = ingById[ri.IngredientID];
      if (!ing) return;
      const q = num(ri.QuantityAtBaseServings);
      if (q == null) return; // "salt to taste" — too small to count
      const nut = parseNutrition(ing.NutritionPer100g);
      if (!nut || nut.notFound) { missingNutrition.push(ing.Name); return; }
      const g = toGrams(q, ri.Unit, ing);
      if (g == null) { missingGrams.push(ing.Name); return; }
      NUTRIENTS.forEach(function (n) { totals[n.key] += (Number(nut[n.key]) || 0) * g / 100; });
      counted++;
    });
    const base = Number(recipe.BaseServings) || BASE_SERVINGS;
    const perServing = {};
    NUTRIENTS.forEach(function (n) { perServing[n.key] = totals[n.key] / base; });
    return { perServing: perServing, counted: counted, missingNutrition: missingNutrition, missingGrams: missingGrams, complete: !missingNutrition.length && !missingGrams.length };
  }

  function parseNutrition(v) {
    if (!v) return null;
    if (typeof v === 'object') return v;
    try { return JSON.parse(v); } catch (e) { return null; }
  }

  function staplesSet(pantry) {
    const s = {};
    (pantry || []).forEach(function (p) { if (isTrue(p.AlwaysHave)) s[p.IngredientID] = true; });
    return s;
  }

  // ---------- Grocery list ----------

  function addToBuckets(buckets, qty, unit, ingredient, recipeName) {
    const u = normalizeUnit(unit);
    for (let i = 0; i < buckets.length; i++) {
      const b = buckets[i];
      if (qty == null) { addName(b, recipeName); return; }
      if (b.qty == null) { b.qty = qty; b.unit = u; addName(b, recipeName); return; }
      const c = convertQty(qty, u, b.unit, ingredient);
      if (c != null) { b.qty += c; addName(b, recipeName); return; }
    }
    buckets.push({ qty: qty, unit: u, recipes: recipeName ? [recipeName] : [] });
  }

  function addName(b, name) { if (name && b.recipes.indexOf(name) < 0) b.recipes.push(name); }

  function sectionOrderFor(sectionOrder, storeId) {
    const rows = (sectionOrder || []).filter(function (r) { return String(r.StoreID) === String(storeId); });
    rows.sort(function (a, b) { return Number(a.SortOrder) - Number(b.SortOrder); });
    const order = rows.map(function (r) { return r.Category; });
    CATEGORIES.forEach(function (c) { if (order.indexOf(c) < 0) order.push(c); });
    return order;
  }

  /**
   * Builds the shopping list.
   * data: { recipes (with .ingredients), ingredients, pantry, household, selection,
   *         manualItems, checks: { ItemKey: bool }, sectionOrder }
   * Returns { sections: [{ category, items }], total, checked }.
   */
  function buildGroceryList(data, storeId) {
    const ingById = indexBy(data.ingredients, 'IngredientID');
    const recipeById = indexBy(data.recipes, 'RecipeID');
    const staples = staplesSet(data.pantry);
    const checks = data.checks || {};
    const needs = {}, order = [];

    (data.selection || []).forEach(function (sel) {
      const r = recipeById[sel.RecipeID];
      if (!r) return;
      const scale = scaleFactor(sel.Servings, r.BaseServings);
      (r.ingredients || []).forEach(function (ri) {
        const id = ri.IngredientID;
        if (!ingById[id] || staples[id]) return;
        const q = num(ri.QuantityAtBaseServings);
        if (!needs[id]) { needs[id] = []; order.push(id); }
        addToBuckets(needs[id], q == null ? null : q * scale, ri.Unit, ingById[id], r.Name);
      });
    });

    const stockById = {};
    (data.household || []).forEach(function (h) {
      (stockById[h.IngredientID] = stockById[h.IngredientID] || []).push({ rem: num(h.Quantity), unit: normalizeUnit(h.Unit), orig: num(h.Quantity) });
    });

    const items = [];
    order.forEach(function (id) {
      const ing = ingById[id];
      const stock = stockById[id] || [];
      needs[id].forEach(function (b, bi) {
        let need = b.qty;
        const haveNotes = [];
        if (need == null) {
          if (stock.length) return; // any stock covers an unmeasured amount
        } else {
          stock.forEach(function (s) {
            if (need <= 1e-9) return;
            if (s.rem == null) { need = 0; return; } // "have some", amount unknown
            if (s.rem <= 1e-9) return;
            const avail = convertQty(s.rem, s.unit, b.unit, ing);
            if (avail == null) { haveNotes.push(formatAmount(s.orig, s.unit)); return; }
            const take = Math.min(avail, need);
            need -= take;
            s.rem -= convertQty(take, b.unit, s.unit, ing);
            haveNotes.push(formatAmount(s.orig, s.unit));
          });
          if (need <= 1e-6 || need / b.qty < 0.01) return; // covered by stock
        }
        const key = 'ING:' + id + (bi > 0 ? ':' + (b.unit || 'each') : '');
        items.push({
          key: key, ingredientId: id, name: ing.Name, qty: need, unit: b.unit,
          amount: need == null ? '' : formatAmount(need, b.unit),
          category: ing.Category || 'Other', recipes: b.recipes,
          haveNote: haveNotes.length ? 'have: ' + haveNotes.join(', ') : '',
          checked: isTrue(checks[key]), manual: false,
        });
      });
    });

    (data.manualItems || []).forEach(function (m) {
      const q = num(m.Quantity);
      items.push({
        key: m.ItemKey, ingredientId: '', name: m.Name, qty: q, unit: m.Unit || '',
        amount: q == null ? (m.Unit || '') : formatAmount(q, m.Unit), category: m.Category || 'Other',
        recipes: [], haveNote: '', checked: isTrue(checks[m.ItemKey]), manual: true,
      });
    });

    const cats = sectionOrderFor(data.sectionOrder, storeId);
    const byCat = {};
    items.forEach(function (it) {
      const c = cats.indexOf(it.category) >= 0 ? it.category : 'Other';
      (byCat[c] = byCat[c] || []).push(it);
    });
    const sections = cats.filter(function (c) { return byCat[c]; }).map(function (c) {
      byCat[c].sort(function (a, b) { return a.name.localeCompare(b.name); });
      return { category: c, items: byCat[c] };
    });
    return {
      sections: sections,
      total: items.length,
      checked: items.filter(function (i) { return i.checked; }).length,
    };
  }

  // ---------- Household stock ----------

  function byUseBy(a, b) {
    const x = a.UseByDate || '9999-99-99', y = b.UseByDate || '9999-99-99';
    return x < y ? -1 : x > y ? 1 : 0;
  }

  /**
   * "Cooked it": deducts a recipe's scaled quantities from stock, soonest use-by first.
   * Rows that hit zero are removed. Returns { household, removed, skipped }.
   */
  function deductForRecipe(household, recipe, servings, ingredients, pantry) {
    const ingById = indexBy(ingredients, 'IngredientID');
    const staples = staplesSet(pantry);
    const rows = (household || []).map(function (h) { return Object.assign({}, h, { _q: num(h.Quantity), _orig: num(h.Quantity) }); });
    const scale = scaleFactor(servings, recipe.BaseServings);
    const removed = [], skipped = [];

    (recipe.ingredients || []).forEach(function (ri) {
      const id = ri.IngredientID, ing = ingById[id];
      if (!ing || staples[id]) return;
      const q = num(ri.QuantityAtBaseServings);
      if (q == null) return;
      let remaining = q * scale;
      const mine = rows.filter(function (r) { return r.IngredientID === id && !r._gone; }).sort(byUseBy);
      if (!mine.length) return;
      let convertible = false;
      mine.forEach(function (r) {
        if (remaining <= 1e-9 || r._q == null) return;
        const avail = convertQty(r._q, r.Unit, ri.Unit, ing);
        if (avail == null) return;
        convertible = true;
        const take = Math.min(avail, remaining);
        remaining -= take;
        r._q -= convertQty(take, ri.Unit, r.Unit, ing);
        if (r._q <= 1e-6 || r._q / r._orig < 0.01) {
          r._gone = true;
          if (removed.indexOf(ing.Name) < 0) removed.push(ing.Name);
        }
      });
      const unknownOnly = mine.every(function (r) { return r._q == null; });
      if (!convertible && !unknownOnly) skipped.push(ing.Name);
    });

    const out = rows.filter(function (r) { return !r._gone; }).map(function (r) {
      const copy = Object.assign({}, r);
      copy.Quantity = r._q == null ? r.Quantity : round(r._q, 3);
      delete copy._q; delete copy._orig; delete copy._gone;
      return copy;
    });
    return { household: out, removed: removed, skipped: skipped };
  }

  /** Adds purchases to stock. Same ingredient + unit + use-by date merges into one row. */
  function mergeIntoStock(household, additions) {
    const rows = (household || []).map(function (h) { return Object.assign({}, h); });
    (additions || []).forEach(function (a) {
      const u = normalizeUnit(a.Unit), q = num(a.Quantity);
      const hit = rows.filter(function (r) {
        return r.IngredientID === a.IngredientID && normalizeUnit(r.Unit) === u && (r.UseByDate || '') === (a.UseByDate || '') && num(r.Quantity) != null;
      })[0];
      if (hit && q != null) hit.Quantity = round(num(hit.Quantity) + q, 3);
      else rows.push({ IngredientID: a.IngredientID, Quantity: q == null ? '' : round(q, 3), Unit: u, DateAdded: a.DateAdded || todayIso(), UseByDate: a.UseByDate || '' });
    });
    return rows;
  }

  // ---------- "What can I cook?" ----------

  /** Ranks vegetarian recipes by fewest missing non-staple ingredients, then soonest use-by. */
  function suggestRecipes(data, today) {
    const now = today || todayIso();
    const ingById = indexBy(data.ingredients, 'IngredientID');
    const staples = staplesSet(data.pantry);
    const have = {};
    (data.household || []).forEach(function (h) {
      const q = num(h.Quantity);
      if (q != null && q <= 0) return;
      const d = h.UseByDate || '';
      if (!(h.IngredientID in have) || (d && (!have[h.IngredientID] || d < have[h.IngredientID]))) have[h.IngredientID] = d;
    });
    const nameOf = function (id) { return (ingById[id] || {}).Name || '?'; };

    return (data.recipes || []).filter(isVegetarian).map(function (r) {
      const ids = uniq((r.ingredients || []).map(function (i) { return i.IngredientID; })).filter(function (id) { return !staples[id] && ingById[id]; });
      const missing = ids.filter(function (id) { return !(id in have); });
      const using = ids.filter(function (id) { return id in have; });
      let soonest = '', soonestId = '';
      using.forEach(function (id) { if (have[id] && (!soonest || have[id] < soonest)) { soonest = have[id]; soonestId = id; } });
      return {
        recipeId: r.RecipeID, name: r.Name, total: ids.length,
        missing: missing.map(nameOf), missingCount: missing.length, using: using.map(nameOf),
        soonestUseBy: soonest, soonestName: soonestId ? nameOf(soonestId) : '',
        daysLeft: soonest ? daysBetween(now, soonest) : null,
      };
    }).filter(function (s) { return s.total > 0; }).sort(function (a, b) {
      if (a.missingCount !== b.missingCount) return a.missingCount - b.missingCount;
      const x = a.soonestUseBy || '9999', y = b.soonestUseBy || '9999';
      if (x !== y) return x < y ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  return {
    BASE_SERVINGS: BASE_SERVINGS, MEAL_TYPES: MEAL_TYPES, CATEGORIES: CATEGORIES, NUTRIENTS: NUTRIENTS, COMMON_UNITS: COMMON_UNITS,
    isTrue: isTrue, isFalse: isFalse, asArray: asArray, uniq: uniq, indexBy: indexBy, round: round, titleCase: titleCase,
    todayIso: todayIso, addDays: addDays, daysBetween: daysBetween, cleanText: cleanText,
    normalizeUnit: normalizeUnit, unitKind: unitKind, parseGramsPerUnit: parseGramsPerUnit, formatGramsPerUnit: formatGramsPerUnit,
    toGrams: toGrams, convertQty: convertQty, parseQuantity: parseQuantity, num: num,
    formatQuantity: formatQuantity, humanizeAmount: humanizeAmount, formatAmount: formatAmount, unitLabel: unitLabel,
    scaleFactor: scaleFactor, splitSteps: splitSteps, parseMarker: parseMarker, stepSegments: stepSegments,
    scaleStepText: scaleStepText, rescaleMarkers: rescaleMarkers, suggestMarks: suggestMarks, convertTemps: convertTemps,
    parseIngredientLine: parseIngredientLine, ingredientKey: ingredientKey, matchIngredient: matchIngredient,
    guessCategory: guessCategory, defaultShelfLife: defaultShelfLife, defaultGramsPerUnit: defaultGramsPerUnit,
    newIngredientDefaults: newIngredientDefaults, findNonVeg: findNonVeg,
    extractRecipeFromHtml: extractRecipeFromHtml, draftFromSchemaRecipe: draftFromSchemaRecipe,
    parseRecipeText: parseRecipeText, finalizeDraft: finalizeDraft, parseDuration: parseDuration, parseYield: parseYield,
    isVegetarian: isVegetarian, tagsOf: tagsOf, filterRecipes: filterRecipes, recipeNutrition: recipeNutrition,
    parseNutrition: parseNutrition, staplesSet: staplesSet, buildGroceryList: buildGroceryList,
    deductForRecipe: deductForRecipe, mergeIntoStock: mergeIntoStock, suggestRecipes: suggestRecipes,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = TsCore;
