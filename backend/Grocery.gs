/**
 * Ts Menu — grocery list: recipe selection, checkmarks, manual items, "Done shopping".
 *
 * The list itself is computed (TsCore.buildGroceryList) from the selected recipes,
 * staples, stock, and manual items, so it's never stored, only its checkmarks are.
 */

function writeSelection_(selection) {
  const seen = {};
  Db.write('GrocerySelection', selection.filter(function (s) {
    if (!s.RecipeID || seen[s.RecipeID]) return false;
    seen[s.RecipeID] = true;
    return true;
  }).map(function (s) { return { RecipeID: s.RecipeID, Servings: Number(s.Servings) || TsCore.BASE_SERVINGS }; }));
}

/**
 * Spec signature. With recipeIds, replaces the selection first; without, uses the saved one.
 * args: { recipeIds?, servingsMap?: { RecipeID: servings }, storeId }
 */
function generateGroceryList(args) {
  if (args.recipeIds) {
    const servings = args.servingsMap || {};
    writeSelection_(args.recipeIds.map(function (id) { return { RecipeID: id, Servings: servings[id] }; }));
  }
  const state = loadState();
  const storeId = args.storeId || (state.stores[0] || {}).StoreID;
  return { list: TsCore.buildGroceryList(state, storeId), state: state };
}

/** Adds a recipe (or changes its servings if it's already on the list). */
function addToGroceryList(args) {
  const id = require_(args.recipeId, 'recipe id');
  const servings = Number(args.servings) || TsCore.BASE_SERVINGS;
  const sel = loadState().selection;
  const hit = sel.filter(function (s) { return s.RecipeID === id; })[0];
  if (hit) hit.Servings = servings; else sel.push({ RecipeID: id, Servings: servings });
  writeSelection_(sel);
  return { state: loadState() };
}

function removeFromGroceryList(args) {
  const id = require_(args.recipeId, 'recipe id');
  writeSelection_(loadState().selection.filter(function (s) { return s.RecipeID !== id; }));
  return { state: loadState() };
}

/** Starts a fresh list: no recipes, no manual items, no checkmarks. */
function clearGroceryList() {
  Db.write('GrocerySelection', []);
  Db.write('ManualGroceryItems', []);
  Db.write('GroceryListState', []);
  return { state: loadState() };
}

function writeCheck_(itemKey, checked) {
  Db.update('GroceryListState', function (rows) {
    const others = rows.filter(function (r) { return r.ItemKey !== itemKey; });
    return checked ? others.concat([{ ItemKey: itemKey, CheckedOff: true }]) : others;
  });
}

function toggleGroceryItemChecked(args) {
  const key = require_(args.itemKey, 'item key');
  const now = !loadChecks_()[key];
  writeCheck_(key, now);
  return { itemKey: key, checked: now };
}

/** Idempotent version used by the phone and its offline queue. */
function setGroceryItemChecked(args) {
  const key = require_(args.itemKey, 'item key');
  writeCheck_(key, !!args.checked);
  return { itemKey: key, checked: !!args.checked };
}

/**
 * Replays changes the phone made while offline, in order, under one lock.
 * ops: [{ action: 'setGroceryItemChecked' | 'setFavorite', args }]
 */
function applyQueuedChanges(args) {
  const allowed = { setGroceryItemChecked: setGroceryItemChecked, setFavorite: setFavorite };
  const results = (args.ops || []).map(function (op) {
    const fn = allowed[op.action];
    if (!fn) return { action: op.action, error: 'Not allowed offline.' };
    try { fn(op.args || {}); return { action: op.action, ok: true }; } catch (err) { return { action: op.action, error: err.message }; }
  });
  return { results: results, state: loadState() };
}

/** item: { Name, Quantity?, Unit?, Category? } — free-text items like paper towels. */
function addManualGroceryItem(args) {
  const item = require_(args.item, 'item');
  const name = String(item.Name || '').trim();
  if (!name) throw new Error('Give the item a name.');
  const q = TsCore.num(item.Quantity);
  const category = TsCore.CATEGORIES.indexOf(item.Category) >= 0 ? item.Category : TsCore.guessCategory(name);
  const row = { ItemKey: 'MAN:' + Db.newId(''), Name: name, Quantity: q == null ? '' : q, Unit: item.Unit || '', Category: category };
  Db.update('ManualGroceryItems', function (rows) { return rows.concat([row]); });
  return { itemKey: row.ItemKey, state: loadState() };
}

function deleteManualGroceryItem(args) {
  const key = require_(args.itemKey, 'item key');
  Db.update('ManualGroceryItems', function (rows) { return rows.filter(function (r) { return r.ItemKey !== key; }); });
  writeCheck_(key, false);
  return { state: loadState() };
}

/**
 * "Done shopping": adds the checked items to household stock in one batch, removes
 * checked manual items, and clears those checkmarks. Recipes stay on the list; their
 * bought ingredients drop off because they're now in stock.
 *
 * args: { items: [{ itemKey, Quantity?, Unit?, UseByDate?, addToStock? }] } as edited on
 * the review screen, or just { checkedItemKeys: [...] } to take the list's amounts.
 */
function finishShopping(args) {
  const state = loadState();
  const storeId = args.storeId || (state.stores[0] || {}).StoreID;
  const list = TsCore.buildGroceryList(state, storeId);
  const byKey = {};
  list.sections.forEach(function (s) { s.items.forEach(function (i) { byKey[i.key] = i; }); });
  const ingById = TsCore.indexBy(state.ingredients, 'IngredientID');
  const today = TsCore.todayIso();

  const requests = args.items || (args.checkedItemKeys || []).map(function (k) { return { itemKey: k }; });
  const additions = [], doneKeys = [], manualDone = [];
  requests.forEach(function (req) {
    const item = byKey[req.itemKey];
    if (!item) return;
    doneKeys.push(item.key);
    if (item.manual) { manualDone.push(item.key); return; }
    if (req.addToStock === false) return;
    const ing = ingById[item.ingredientId] || {};
    const qty = req.Quantity !== undefined ? TsCore.num(req.Quantity) : item.qty;
    additions.push({
      IngredientID: item.ingredientId,
      Quantity: qty,
      Unit: req.Unit !== undefined ? req.Unit : item.unit,
      DateAdded: today,
      UseByDate: req.UseByDate || TsCore.addDays(today, ing.DefaultShelfLifeDays || TsCore.defaultShelfLife(ing.Category)),
    });
  });

  Db.write('HouseholdIngredients', TsCore.mergeIntoStock(state.household, additions));
  if (manualDone.length) {
    Db.update('ManualGroceryItems', function (rows) { return rows.filter(function (r) { return manualDone.indexOf(r.ItemKey) < 0; }); });
  }
  Db.update('GroceryListState', function (rows) { return rows.filter(function (r) { return doneKeys.indexOf(r.ItemKey) < 0; }); });
  return { addedToStock: additions.length, state: loadState() };
}
