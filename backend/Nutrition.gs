/**
 * Ts Menu — nutrition from USDA FoodData Central, cached per ingredient forever.
 *
 * Set Script Property USDA_API_KEY (Project Settings > Script Properties). Until then
 * the shared DEMO_KEY is used, which works but is rate-limited.
 */

const USDA_SEARCH = 'https://api.nal.usda.gov/fdc/v1/foods/search';

// USDA nutrient numbers → our field names. Energy has several possible numbers.
const USDA_FIELDS = {
  '203': 'protein', '205': 'carbs', '204': 'fat', '291': 'fiber',
  '269': 'sugar', '269.3': 'sugar', '307': 'sodium', '303': 'iron',
};
const ENERGY_KCAL = ['208', '957', '958'];

function usdaKey_() {
  return PropertiesService.getScriptProperties().getProperty('USDA_API_KEY') || 'DEMO_KEY';
}

function usdaRequest_(query) {
  return {
    url: USDA_SEARCH + '?api_key=' + encodeURIComponent(usdaKey_()) +
      '&query=' + encodeURIComponent(query) +
      '&dataType=' + encodeURIComponent('Foundation,SR Legacy') + '&pageSize=12',
    muteHttpExceptions: true,
  };
}

/**
 * How well a USDA description fits an ingredient name. The last word is usually the
 * food itself ("baby spinach" is spinach), so it must appear in the description's
 * first part ("Spinach, baby, raw"); other shared words and "raw" help a little.
 */
// Processed forms that shouldn't win unless the ingredient asks for them.
const USDA_FORMS = ['juice', 'powder', 'dried', 'dehydrated', 'dry', 'frozen', 'cooked', 'boiled', 'roasted', 'fried', 'flour', 'concentrate', 'sweetened', 'pickled', 'extra light', 'peel', 'zest', 'rind'];

function scoreFood_(description, query) {
  const all = TsCore.ingredientKey(description).split(' ');
  const words = TsCore.ingredientKey(query).split(' ').filter(Boolean);
  const noun = words[words.length - 1];
  let score = all.indexOf(noun) >= 0 ? 4 : -4;
  words.forEach(function (w) {
    if (w === noun) return;
    score += all.indexOf(w) >= 0 ? 3 : -2; // "vegetable broth" must not become fish broth
  });
  if (/\braw\b/i.test(description)) score += 1;
  const q = ' ' + words.join(' ') + ' ';
  const d = ' ' + TsCore.ingredientKey(String(description).replace(/without [^,]+/gi, '')) + ' ';
  USDA_FORMS.forEach(function (f) {
    const k = ' ' + TsCore.ingredientKey(f) + ' ';
    if (d.indexOf(k) >= 0 && q.indexOf(k) < 0) score -= 1.5;
  });
  return score - 0.15 * all.length; // plainer entries beat long branded ones
}

function hasEnergy_(food) {
  return (food.foodNutrients || []).some(function (n) {
    const num = String(n.nutrientNumber);
    return ENERGY_KCAL.indexOf(num) >= 0 || num === '268';
  });
}

/** Picks the best food from a search response and pulls our 8 nutrients per 100 g. */
function parseUsdaResponse_(json, query) {
  const foods = (json && json.foods) || [];
  if (!foods.length) return { notFound: true, query: query };
  // Some Foundation entries carry no energy value at all; they'd read as 0 calories.
  const usable = foods.filter(hasEnergy_);
  let food = (usable[0] || foods[0]), best = -Infinity;
  (usable.length ? usable : foods).forEach(function (f) {
    const s = scoreFood_(f.description, query);
    if (s > best) { best = s; food = f; }
  });
  const out = { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sugar: 0, sodium: 0, iron: 0 };
  let kcal = null, kj = null;
  (food.foodNutrients || []).forEach(function (n) {
    const num = String(n.nutrientNumber || '');
    const val = Number(n.value) || 0;
    if (ENERGY_KCAL.indexOf(num) >= 0 && String(n.unitName).toUpperCase() === 'KCAL' && kcal == null) kcal = val;
    else if (num === '268') kj = val;
    else if (USDA_FIELDS[num] && !out['_' + USDA_FIELDS[num]]) {
      out[USDA_FIELDS[num]] = val;
      out['_' + USDA_FIELDS[num]] = true;
    }
  });
  out.calories = kcal != null ? kcal : kj != null ? kj / 4.184 : 0;
  Object.keys(out).forEach(function (k) {
    if (k[0] === '_') delete out[k]; else out[k] = TsCore.round(out[k], 2);
  });
  out.fdcId = food.fdcId;
  out.food = food.description;
  out.query = query;
  return out;
}

/**
 * Looks up nutrition for the given ingredient IDs that don't have it yet (or all of
 * them when force is set), in parallel. Writes results to the Ingredients tab.
 */
function fillNutrition_(ids, force, queries) {
  const rows = Db.read('Ingredients');
  const want = {};
  ids.forEach(function (id) { want[id] = true; });
  const todo = rows.filter(function (r) { return want[r.IngredientID] && (force || !r.NutritionPer100g); });
  if (!todo.length) return { fetched: 0, note: '' };
  const qs = todo.map(function (r) { return (queries && queries[r.IngredientID]) || r.Name; });
  const responses = UrlFetchApp.fetchAll(qs.map(usdaRequest_));
  let fetched = 0, note = '';
  todo.forEach(function (r, i) {
    const res = responses[i];
    const code = res.getResponseCode();
    if (code === 429) { note = 'USDA rate limit hit. Add your own USDA_API_KEY in Script Properties.'; return; }
    if (code !== 200) { note = 'USDA lookup failed (HTTP ' + code + ').'; return; }
    r.NutritionPer100g = JSON.stringify(parseUsdaResponse_(JSON.parse(res.getContentText()), qs[i]));
    fetched++;
  });
  if (fetched) Db.write('Ingredients', rows);
  return { fetched: fetched, note: note };
}

/** Spec signature: cached nutrition for one ingredient, fetching it the first time. */
function getNutrition(args) {
  const id = require_(args.ingredientId, 'ingredient id');
  fillNutrition_([id]);
  const ing = ingredientById_(id);
  if (!ing) throw new Error('Ingredient not found.');
  return TsCore.parseNutrition(ing.NutritionPer100g);
}

/** Fills any missing nutrition (for the given IDs, or every ingredient). */
function fetchMissingNutrition(args) {
  const ids = args.ingredientIds || Db.read('Ingredients').map(function (r) { return r.IngredientID; });
  const result = fillNutrition_(ids);
  return { fetched: result.fetched, note: result.note, state: loadState() };
}

/** Looks an ingredient up again, optionally with a better search term ("cilantro, raw"). */
function refreshNutrition(args) {
  const id = require_(args.id, 'ingredient id');
  const queries = {};
  if (args.query) queries[id] = String(args.query);
  const result = fillNutrition_([id], true, queries);
  return { fetched: result.fetched, note: result.note, state: loadState() };
}
