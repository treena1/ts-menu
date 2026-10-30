// Ts Menu tests: shared core logic, plus the real backend running in the Apps Script
// harness. Run: node --test tools/
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createBackend } from './gas-harness.mjs';

const require = createRequire(import.meta.url);
const C = require('../shared/core.js');

// ---------- Units & formatting ----------

test('parses quantities in the forms recipes use', () => {
  assert.equal(C.parseQuantity('1 1/2'), 1.5);
  assert.equal(C.parseQuantity('1½'), 1.5);
  assert.equal(C.parseQuantity('½'), 0.5);
  assert.equal(C.parseQuantity('.25'), 0.25);
  assert.equal(C.parseQuantity('2-3'), 3);
  assert.equal(C.parseQuantity('a few'), null);
});

test('formats amounts in readable US customary units', () => {
  assert.equal(C.formatAmount(1.5, 'cup'), '1½ cups');
  assert.equal(C.formatAmount(1, 'cup'), '1 cup');
  assert.equal(C.formatAmount(6, 'tbsp'), '6 tbsp');
  assert.equal(C.formatAmount(12, 'tbsp'), '¾ cup');
  assert.equal(C.formatAmount(4.5, 'tsp'), '1½ tbsp');
  assert.equal(C.formatAmount(0.125, 'cup'), '2 tbsp');
  assert.equal(C.formatAmount(250, 'ml'), '1 cup');
  assert.equal(C.formatAmount(454, 'g'), '1 lb');
  assert.equal(C.formatAmount(3, 'clove'), '3 cloves');
  assert.equal(C.formatAmount(2, ''), '2');
});

test('converts through grams using GramsPerUnit', () => {
  const flour = { GramsPerUnit: 'cup=120' };
  assert.equal(C.convertQty(1, 'cup', 'g', flour), 120);
  assert.equal(C.round(C.convertQty(240, 'g', 'cup', flour), 3), 2);
  assert.equal(C.round(C.convertQty(1, 'tbsp', 'g', flour), 1), 7.5);
  assert.equal(C.convertQty(1, 'bunch', 'cup', flour), null);
});

// ---------- Step markers ----------

test('only bracketed amounts in steps scale', () => {
  assert.equal(C.scaleStepText('Add [1 cup] broth and 2 bay leaves', 2), 'Add 2 cups broth and 2 bay leaves');
  assert.equal(C.scaleStepText('Whisk [2] eggs', 1.5), 'Whisk 3 eggs');
  assert.equal(C.scaleStepText('Bake [optional]', 2), 'Bake [optional]');
});

test('suggests marks on import and rescales them to 2 servings', () => {
  const s = C.suggestMarks('Add 2 cups broth and 1/2 teaspoon salt; simmer 10 minutes.');
  assert.equal(s, 'Add [2 cups] broth and [½ tsp] salt; simmer 10 minutes.');
  assert.equal(C.rescaleMarkers(s, 0.5), 'Add [1 cup] broth and [¼ tsp] salt; simmer 10 minutes.');
});

test('converts Celsius oven temps to Fahrenheit', () => {
  assert.equal(C.convertTemps('Bake at 200°C (400°F).'), 'Bake at 400°F.');
  assert.equal(C.convertTemps('Heat to 180 °C.'), 'Heat to 350°F.');
  assert.equal(C.convertTemps('400°F (200°C)'), '400°F');
});

// ---------- Ingredient parsing ----------

test('parses ingredient lines', () => {
  assert.deepEqual(pick(C.parseIngredientLine('1 1/2 cups all-purpose flour, sifted')), { qty: 1.5, unit: 'cup', name: 'all-purpose flour', note: 'sifted' });
  assert.deepEqual(pick(C.parseIngredientLine('1 (15-ounce) can chickpeas, drained')), { qty: 1, unit: 'can', name: 'chickpeas', note: '15-ounce, drained' });
  assert.deepEqual(pick(C.parseIngredientLine('▢ 2 large eggs')), { qty: 2, unit: '', name: 'eggs', note: 'large' });
  assert.deepEqual(pick(C.parseIngredientLine('2 T olive oil')), { qty: 2, unit: 'tbsp', name: 'olive oil', note: '' });
  assert.deepEqual(pick(C.parseIngredientLine('Kosher salt, to taste')), { qty: null, unit: '', name: 'Kosher salt', note: 'to taste' });
  assert.deepEqual(pick(C.parseIngredientLine('3 cloves garlic, minced')), { qty: 3, unit: 'clove', name: 'garlic', note: 'minced' });
});

function pick(p) { return { qty: p.qty, unit: p.unit, name: p.name, note: p.note }; }

test('matches ingredients regardless of plural or case', () => {
  const list = [{ IngredientID: 'I1', Name: 'Tomato' }, { IngredientID: 'I2', Name: 'Black beans' }];
  assert.equal(C.matchIngredient('tomatoes', list).IngredientID, 'I1');
  assert.equal(C.matchIngredient('black bean', list).IngredientID, 'I2');
  assert.equal(C.matchIngredient('cherry tomatoes', list), null);
});

test('guesses categories', () => {
  assert.equal(C.guessCategory('garlic cloves'), 'Produce');
  assert.equal(C.guessCategory('black pepper'), 'Spices & Seasonings');
  assert.equal(C.guessCategory('tomato paste'), 'Pantry & Dry Goods');
  assert.equal(C.guessCategory('eggplant'), 'Produce');
  assert.equal(C.guessCategory('extra firm tofu'), 'Refrigerated-Protein');
  assert.equal(C.guessCategory('frozen peas'), 'Frozen');
  assert.equal(C.guessCategory('feta cheese'), 'Dairy & Eggs');
});

test('flags non-vegetarian ingredients but not veggie versions', () => {
  assert.deepEqual(C.findNonVeg(['veggie sausage', 'chicken broth', 'graham crackers', 'fish sauce']), ['chicken', 'fish', 'fish sauce']);
});

// ---------- Import ----------

const SAMPLE_PAGE = `<html><head>
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebPage","name":"x"},
{"@type":"Recipe","name":"Chickpea Curry &amp; Rice","recipeYield":["4","4 servings"],"prepTime":"PT10M","totalTime":"PT40M",
"recipeCuisine":"Indian","recipeCategory":"Main Course","keywords":"easy, one-pot",
"image":{"@type":"ImageObject","url":"https://example.com/curry.jpg"},
"recipeIngredient":["2 tablespoons olive oil","1 large onion, diced","2 (15 oz) cans chickpeas","1 cup coconut milk","Salt to taste"],
"recipeInstructions":[{"@type":"HowToSection","name":"Cook","itemListElement":[
{"@type":"HowToStep","text":"Heat 2 tablespoons oil in a pot at 180°C."},
{"@type":"HowToStep","text":"Add the onion and cook 5 minutes."},
{"@type":"HowToStep","text":"Stir in chickpeas and 1 cup coconut milk."}]}]}]}
</script></head><body></body></html>`;

test('extracts a JSON-LD recipe and converts it to 2 servings', () => {
  const node = C.extractRecipeFromHtml(SAMPLE_PAGE);
  assert.equal(node.name, 'Chickpea Curry &amp; Rice');
  const draft = C.draftFromSchemaRecipe(node, 'https://example.com/curry');
  assert.equal(draft.Name, 'Chickpea Curry & Rice');
  assert.equal(draft.originalYield, 4);
  assert.equal(draft.PrepTimeMinutes, 10);
  assert.equal(draft.CookTimeMinutes, 30);
  assert.equal(draft.MealType, 'dinner');
  assert.deepEqual(draft.Tags, ['Indian', 'Easy', 'One-Pot']);
  assert.equal(draft.photoSourceUrl, 'https://example.com/curry.jpg');
  assert.match(draft.Steps, /Heat \[2 tbsp\] oil in a pot at 350°F\./);
  const r = C.finalizeDraft(draft);
  assert.equal(r.BaseServings, 2);
  assert.equal(r.ingredients[0].QuantityAtBaseServings, 1); // 2 tbsp at 4 servings → 1 at 2
  assert.equal(r.ingredients[2].Unit, 'can');
  assert.equal(r.ingredients[4].QuantityAtBaseServings, '');
  assert.match(r.Steps, /Heat \[1 tbsp\] oil/);
  assert.match(r.Steps, /\[½ cup\] coconut milk/);
});

test('parses pasted recipe text', () => {
  const d = C.parseRecipeText('Quick Pasta\nServes 2\nIngredients\n8 oz spaghetti\n2 tbsp butter\nInstructions\n1. Boil 8 oz spaghetti.\n2. Toss with butter.');
  assert.equal(d.Name, 'Quick Pasta');
  assert.equal(d.originalYield, 2);
  assert.equal(d.ingredients.length, 2);
  assert.equal(d.Steps, 'Boil [8 oz] spaghetti.\nToss with butter.');
});

// ---------- Grocery math ----------

function kitchen() {
  return {
    ingredients: [
      { IngredientID: 'flour', Name: 'Flour', Category: 'Baking', GramsPerUnit: 'cup=120' },
      { IngredientID: 'salt', Name: 'Salt', Category: 'Spices & Seasonings' },
      { IngredientID: 'broth', Name: 'Vegetable broth', Category: 'Pantry & Dry Goods', GramsPerUnit: 'cup=240' },
      { IngredientID: 'cil', Name: 'Cilantro', Category: 'Produce', GramsPerUnit: '' },
      { IngredientID: 'onion', Name: 'Onion', Category: 'Produce', GramsPerUnit: 'each=150' },
    ],
    recipes: [
      { RecipeID: 'A', Name: 'Soup', BaseServings: 2, IsVegetarian: true, ingredients: [
        { IngredientID: 'broth', QuantityAtBaseServings: 1.5, Unit: 'cup' },
        { IngredientID: 'salt', QuantityAtBaseServings: 1, Unit: 'tsp' },
        { IngredientID: 'cil', QuantityAtBaseServings: 0.25, Unit: 'cup' },
        { IngredientID: 'onion', QuantityAtBaseServings: 1, Unit: '' },
      ] },
      { RecipeID: 'B', Name: 'Bread', BaseServings: 2, IsVegetarian: true, ingredients: [
        { IngredientID: 'flour', QuantityAtBaseServings: 2, Unit: 'cup' },
        { IngredientID: 'broth', QuantityAtBaseServings: 8, Unit: 'tbsp' },
      ] },
    ],
    pantry: [{ IngredientID: 'salt', AlwaysHave: true }],
    household: [
      { IngredientID: 'broth', Quantity: 1, Unit: 'cup', UseByDate: '2026-10-20' },
      { IngredientID: 'cil', Quantity: 1, Unit: 'bunch', UseByDate: '2026-10-14' },
    ],
    selection: [{ RecipeID: 'A', Servings: 4 }, { RecipeID: 'B', Servings: 2 }],
    manualItems: [{ ItemKey: 'MAN:1', Name: 'Paper towels', Quantity: '', Unit: '', Category: 'Other' }],
    checks: { 'ING:flour': true },
    sectionOrder: [
      { StoreID: 'S1', Category: 'Produce', SortOrder: 2 },
      { StoreID: 'S1', Category: 'Baking', SortOrder: 1 },
    ],
  };
}

test('builds a grocery list: merge, scale, subtract staples and stock, sort by aisle', () => {
  const list = C.buildGroceryList(kitchen(), 'S1');
  const items = Object.fromEntries(list.sections.flatMap((s) => s.items).map((i) => [i.name, i]));
  assert.deepEqual(list.sections.map((s) => s.category), ['Baking', 'Produce', 'Pantry & Dry Goods', 'Other']);
  assert.equal(items.Salt, undefined, 'staples never appear');
  // 3 cups (soup ×2) + ½ cup (8 tbsp) − 1 cup in stock = 2½ cups
  assert.equal(items['Vegetable broth'].amount, '2½ cups');
  assert.equal(items['Vegetable broth'].haveNote, 'have: 1 cup');
  // bunch can't convert to cups: full amount plus a note
  assert.equal(items.Cilantro.amount, '½ cup');
  assert.equal(items.Cilantro.haveNote, 'have: 1 bunch');
  assert.equal(items.Onion.amount, '2');
  assert.equal(items.Flour.checked, true);
  assert.equal(items['Paper towels'].manual, true);
});

test('cooking deducts from stock and removes what runs out', () => {
  const k = kitchen();
  const res = C.deductForRecipe(k.household, k.recipes[0], 2, k.ingredients, k.pantry);
  assert.deepEqual(res.removed, ['Vegetable broth']);
  assert.deepEqual(res.skipped, ['Cilantro']);
  assert.equal(res.household.length, 1);
});

test('ranks "What can I cook?" by fewest missing, then soonest to spoil', () => {
  const k = kitchen();
  k.household.push({ IngredientID: 'onion', Quantity: 2, Unit: '', UseByDate: '2026-10-30' });
  const s = C.suggestRecipes(k, '2026-10-12');
  assert.equal(s[0].name, 'Soup');
  assert.equal(s[0].missingCount, 0);
  assert.equal(s[0].soonestName, 'Cilantro');
  assert.equal(s[0].daysLeft, 2);
  assert.deepEqual(s[1].missing, ['Flour']);
});

test('merges purchases into matching stock rows', () => {
  const rows = C.mergeIntoStock([{ IngredientID: 'x', Quantity: 1, Unit: 'cup', UseByDate: '2026-10-20' }], [
    { IngredientID: 'x', Quantity: 2, Unit: 'cups', UseByDate: '2026-10-20' },
    { IngredientID: 'x', Quantity: 1, Unit: 'cup', UseByDate: '2026-10-25' },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].Quantity, 3);
});

// ---------- Backend, end to end ----------

const USDA_ONION = { foods: [{ fdcId: 1, description: 'Onions, raw', foodNutrients: [
  { nutrientNumber: '208', unitName: 'KCAL', value: 40 }, { nutrientNumber: '203', unitName: 'G', value: 1.1 },
  { nutrientNumber: '205', unitName: 'G', value: 9.3 }, { nutrientNumber: '307', unitName: 'MG', value: 4 },
] }] };

function fakeNet(url) {
  if (url.includes('api.nal.usda.gov')) return { code: 200, contentType: 'application/json', text: JSON.stringify(/query=onion\b/i.test(url) ? USDA_ONION : { foods: [] }) };
  if (url === 'https://example.com/curry') return { code: 200, contentType: 'text/html', text: SAMPLE_PAGE };
  if (url.endsWith('.jpg')) return { code: 200, contentType: 'image/jpeg', bytes: Buffer.from([0xff, 0xd8, 0xff]) };
  return { code: 404, contentType: 'text/html', text: 'nope' };
}

test('backend: setup creates every tab with seeded stores', () => {
  const be = createBackend({ fetch: fakeNet });
  const names = be.ss.getSheets().map((s) => s.getName());
  for (const t of ['Recipes', 'RecipeIngredients', 'Ingredients', 'PantryStaples', 'HouseholdIngredients', 'Stores', 'StoreSectionOrder', 'ManualGroceryItems', 'GroceryListState', 'GrocerySelection']) {
    assert.ok(names.includes(t), t);
  }
  assert.ok(!names.includes('Sheet1'));
  const state = be.call('bootstrap', {}, 'GET');
  assert.deepEqual(state.stores.map((s) => s.Name), ["Trader Joe's", 'Costco', 'Other']);
  // Empty rows under checkbox columns read as false in Sheets; they must not become records
  assert.equal(state.recipes.length, 0);
  assert.equal(state.pantry.length, 0);
});

test('backend: single-file bundle is current and runs', () => {
  const { readFileSync, readdirSync } = require('node:fs');
  const { join } = require('node:path');
  const root = join(import.meta.dirname, '..');
  const bundle = readFileSync(join(root, 'backend-bundle', 'Code.gs'), 'utf8');
  for (const f of readdirSync(join(root, 'backend')).filter((n) => n.endsWith('.gs'))) {
    assert.ok(bundle.includes(readFileSync(join(root, 'backend', f), 'utf8').trimEnd()), f + ' changed; run node tools/bundle-backend.mjs');
  }
  const be = createBackend({ fetch: fakeNet, bundle: true });
  const saved = be.call('addRecipeManual', { recipe: { Name: 'Toast', MealType: 'breakfast', Steps: 'Toast it.', ingredients: [{ Name: 'Bread', QuantityAtBaseServings: 2, Unit: 'slices' }] } });
  assert.ok(saved.recipeId);
});

test('backend: full recipe → grocery → shopping → cooking flow', () => {
  const be = createBackend({ fetch: fakeNet });

  // Add a recipe with new ingredients; nutrition gets fetched on save.
  const saved = be.call('addRecipeManual', { recipe: {
    Name: 'Onion Soup', MealType: 'dinner', Tags: ['French', 'cozy'], PrepTimeMinutes: '10', CookTimeMinutes: 40,
    Steps: '1. Slice [2] onions.\n2. Simmer in [3 cups] broth.',
    ingredients: [
      { Name: 'Onion', QuantityAtBaseServings: 2, Unit: '' },
      { Name: 'Vegetable broth', QuantityAtBaseServings: 3, Unit: 'cups' },
      { Name: 'Salt', QuantityAtBaseServings: 1, Unit: 'tsp' },
    ],
  } });
  const id = saved.recipeId;
  let state = saved.state;
  assert.equal(state.recipes.length, 1);
  assert.equal(state.recipes[0].Steps, 'Slice [2] onions.\nSimmer in [3 cups] broth.');
  assert.deepEqual(state.recipes[0].Tags, ['French', 'cozy']);
  const onion = state.ingredients.find((i) => i.Name === 'Onion');
  assert.equal(onion.Category, 'Produce');
  assert.equal(onion.GramsPerUnit, 'each=150; cup=160');
  assert.equal(onion.NutritionPer100g.calories, 40);
  assert.equal(state.ingredients.find((i) => i.Name === 'Salt').NutritionPer100g.notFound, true);

  // Detail view nutrition: 2 onions = 300 g → 120 kcal for 2 servings → 60 per serving.
  const detail = be.call('getRecipe', { id }, 'GET');
  assert.equal(Math.round(detail.nutrition.perServing.calories), 60);

  // Favorite, comment, filters.
  be.call('toggleFavorite', { id });
  be.call('saveComment', { id, text: 'More thyme next time' });
  assert.equal(be.call('getRecipes', { favorite: true }, 'GET').length, 1);
  assert.equal(be.call('getRecipes', { search: 'broth' }, 'GET').length, 1);
  assert.equal(be.call('getRecipes', { mealType: 'lunch' }, 'GET').length, 0);

  // Staples and stock.
  const salt = state.ingredients.find((i) => i.Name === 'Salt');
  be.call('updatePantryStaples', { list: [{ IngredientID: salt.IngredientID, AlwaysHave: true }, { Name: 'Olive oil', AlwaysHave: true }] });
  state = be.call('updateHouseholdIngredients', { list: [{ Name: 'vegetable broth', Quantity: 2, Unit: 'cup' }] }).state;
  assert.equal(state.household[0].UseByDate.length, 10);
  assert.equal(state.ingredients.filter((i) => i.Name === 'Olive oil').length, 1);

  // Grocery list: 4 servings → 4 onions, 6 cups broth − 2 = 4 cups, no salt.
  be.call('addToGroceryList', { recipeId: id, servings: 4 });
  state = be.call('addManualGroceryItem', { item: { Name: 'Paper towels', Category: 'Other' } }).state;
  let list = be.call('generateGroceryList', { storeId: 'S1' }).list;
  const all = () => list.sections.flatMap((s) => s.items);
  assert.deepEqual(all().map((i) => (i.name + ' ' + i.amount).trim()).sort(), ['Onion 4', 'Paper towels', 'Vegetable broth 4 cups']);

  // Check things off (including via the offline queue), then finish shopping.
  const onionKey = all().find((i) => i.name === 'Onion').key;
  const towelKey = all().find((i) => i.manual).key;
  be.call('setGroceryItemChecked', { itemKey: onionKey, checked: true });
  be.call('applyQueuedChanges', { ops: [{ action: 'setGroceryItemChecked', args: { itemKey: towelKey, checked: true } }, { action: 'deleteRecipe', args: { id } }] });
  assert.equal(be.call('bootstrap', {}, 'GET').recipes.length, 1, 'queue refuses non-queueable actions');
  state = be.call('finishShopping', { items: [{ itemKey: onionKey, UseByDate: '2026-11-01' }, { itemKey: towelKey }] }).state;
  assert.equal(state.manualItems.length, 0);
  assert.deepEqual(state.checks, {});
  const stockOnion = state.household.find((h) => h.IngredientID === onion.IngredientID);
  assert.equal(stockOnion.Quantity, 4);
  assert.equal(stockOnion.UseByDate, '2026-11-01');
  list = be.call('generateGroceryList', { storeId: 'S1' }).list;
  assert.deepEqual(all().map((i) => i.name), ['Vegetable broth']);

  // Cook it at 2 servings: 2 onions and 3 cups broth come out of stock.
  const cooked = be.call('markRecipeCooked', { id, servings: 2 });
  assert.equal(cooked.state.household.find((h) => h.IngredientID === onion.IngredientID).Quantity, 2);
  assert.deepEqual(cooked.removed, ['Vegetable broth']);

  // Suggestions: now missing only broth.
  const sug = be.call('suggestRecipes', {}, 'GET');
  assert.deepEqual(sug[0].missing, ['Vegetable broth']);

  // Writes refuse GET.
  const r = be.doGet({ action: 'deleteRecipe', args: JSON.stringify({ id }) });
  assert.equal(r.ok, false);
  assert.match(r.error, /POST/);
});

test('backend: import from URL, save with re-hosted photo, upload, delete', () => {
  const be = createBackend({ fetch: fakeNet });
  const imp = be.call('importRecipeFromUrl', { url: 'https://example.com/curry' });
  assert.equal(imp.found, true);
  const recipe = C.finalizeDraft(imp.draft);
  const saved = be.call('addRecipeManual', { recipe });
  const r = saved.state.recipes[0];
  assert.match(r.PhotoURL, /^https:\/\/drive\.google\.com\/thumbnail\?id=/);
  assert.equal(r.SourceURL, 'https://example.com/curry');
  assert.equal(r.ingredients[0].QuantityAtBaseServings, 1);

  const up = be.call('uploadRecipePhoto', { recipeId: r.RecipeID, base64Image: 'data:image/jpeg;base64,/9j/AA==' });
  assert.notEqual(up.photoUrl, r.PhotoURL);
  const oldId = r.PhotoURL.match(/id=([\w-]+)/)[1];
  assert.equal(be.files[oldId].trashed, true, 'replaced photo goes to Drive trash');

  const miss = be.call('importRecipeFromUrl', { url: 'https://example.com/none' });
  assert.equal(miss.found, false);

  be.call('deleteRecipe', { id: r.RecipeID });
  assert.equal(be.call('bootstrap', {}, 'GET').recipes.length, 0);
});

test('backend: picks the right USDA food from search candidates', () => {
  const be = createBackend({ fetch: fakeNet });
  const kcal = (v) => [{ nutrientNumber: '208', unitName: 'KCAL', value: v }];
  const pickFor = (query, descs) => be.context.parseUsdaResponse_({
    foods: descs.map((d) => (typeof d === 'string' ? { description: d, foodNutrients: kcal(1) } : d)),
  }, query).food;
  assert.equal(pickFor('Baby spinach', ['Arugula, baby, raw', 'Spinach, raw', 'Spinach, frozen, chopped or leaf, unprepared']), 'Spinach, raw');
  assert.equal(pickFor('Vegetable broth', ['Fish broth', 'Soup, vegetable broth, ready to serve', 'Soup, beef broth']), 'Soup, vegetable broth, ready to serve');
  assert.equal(pickFor('Lemon', ['Lemon juice, raw', 'Lemons, raw, without peel', 'Lemon peel, raw']), 'Lemons, raw, without peel');
  assert.equal(pickFor('Olive oil', [{ description: 'Oil, olive, extra light', foodNutrients: [] }, 'Oil, olive, salad or cooking']), 'Oil, olive, salad or cooking');
  assert.equal(pickFor('Onion', ['Onions, raw', 'Onions, dehydrated flakes', 'Onion rings, breaded, frozen']), 'Onions, raw');
  assert.equal(pickFor('Cannellini beans', ['Beans, cannellini, dry', 'Beans, cannellini, canned, sodium added, drained and rinsed']), 'Beans, cannellini, canned, sodium added, drained and rinsed');
  assert.equal(pickFor('Garlic powder', ['Garlic, raw', 'Spices, garlic powder']), 'Spices, garlic powder');
});

test('backend: stores and aisle order', () => {
  const be = createBackend({ fetch: fakeNet });
  let state = be.call('updateStores', { stores: [{ StoreID: 'S1', Name: "Trader Joe's" }, { Name: 'Whole Foods' }] }).state;
  assert.equal(state.stores.length, 2);
  const wf = state.stores[1].StoreID;
  assert.equal(state.sectionOrder.filter((r) => r.StoreID === wf).length, 11);
  assert.equal(state.sectionOrder.filter((r) => r.StoreID === 'S2').length, 0, 'removed store loses its order');
  state = be.call('updateSectionOrder', { storeId: 'S1', categories: ['Bakery', 'Produce'] }).state;
  const order = state.sectionOrder.filter((r) => r.StoreID === 'S1').sort((a, b) => a.SortOrder - b.SortOrder).map((r) => r.Category);
  assert.deepEqual(order.slice(0, 3), ['Bakery', 'Produce', 'Dairy & Eggs']);
});
