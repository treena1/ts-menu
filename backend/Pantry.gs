/**
 * Ts Menu — pantry staples, household stock, the ingredient master list, and stores.
 */

function getPantryStaples() {
  const byId = TsCore.indexBy(loadIngredients_(), 'IngredientID');
  return loadState().pantry.map(function (p) {
    return { IngredientID: p.IngredientID, Name: (byId[p.IngredientID] || {}).Name || '', AlwaysHave: p.AlwaysHave };
  });
}

/** list: [{ IngredientID? , Name, AlwaysHave }] — replaces the staples list. */
function updatePantryStaples(args) {
  const list = resolveIngredients_((args.list || []).filter(function (p) { return TsCore.isTrue(p.AlwaysHave); }));
  const seen = {};
  Db.write('PantryStaples', list.filter(function (p) {
    if (!p.IngredientID || seen[p.IngredientID]) return false;
    seen[p.IngredientID] = true;
    return true;
  }).map(function (p) { return { IngredientID: p.IngredientID, AlwaysHave: true }; }));
  return { state: loadState() };
}

function getHouseholdIngredients() {
  const byId = TsCore.indexBy(loadIngredients_(), 'IngredientID');
  return loadState().household.map(function (h) {
    return Object.assign({ Name: (byId[h.IngredientID] || {}).Name || '' }, h);
  });
}

/**
 * list: [{ IngredientID?, Name, Quantity, Unit, DateAdded?, UseByDate? }] — replaces
 * the stock list. A missing use-by date is filled from the ingredient's shelf life.
 */
function updateHouseholdIngredients(args) {
  const today = TsCore.todayIso();
  const resolved = resolveIngredients_(args.list || []);
  const byId = TsCore.indexBy(loadIngredients_(), 'IngredientID');
  Db.write('HouseholdIngredients', resolved.filter(function (h) { return h.IngredientID; }).map(function (h) {
    const ing = byId[h.IngredientID] || {};
    const added = h.DateAdded || today;
    const q = TsCore.num(h.Quantity);
    return {
      IngredientID: h.IngredientID,
      Quantity: q == null ? '' : q,
      Unit: TsCore.normalizeUnit(h.Unit),
      DateAdded: added,
      UseByDate: h.UseByDate || TsCore.addDays(added, ing.DefaultShelfLifeDays || TsCore.defaultShelfLife(ing.Category)),
    };
  }));
  return { state: loadState() };
}

/** ingredient: { IngredientID, Name?, Category?, GramsPerUnit?, DefaultShelfLifeDays? } */
function updateIngredient(args) {
  const input = require_(args.ingredient, 'ingredient');
  const id = require_(input.IngredientID, 'ingredient id');
  let found = false, renamed = false;
  Db.update('Ingredients', function (rows) {
    return rows.map(function (r) {
      if (r.IngredientID !== id) return r;
      found = true;
      const copy = Object.assign({}, r);
      ['Name', 'Category', 'GramsPerUnit', 'DefaultShelfLifeDays'].forEach(function (k) {
        if (input[k] !== undefined) copy[k] = input[k];
      });
      if (copy.Name !== r.Name) renamed = true;
      if (TsCore.CATEGORIES.indexOf(copy.Category) < 0) copy.Category = 'Other';
      copy.GramsPerUnit = TsCore.formatGramsPerUnit(TsCore.parseGramsPerUnit(copy.GramsPerUnit));
      return copy;
    });
  });
  if (!found) throw new Error('Ingredient not found.');
  // A rename usually means the USDA match was wrong too, so look it up again.
  if (renamed) {
    try { refreshNutrition({ id: id }); } catch (err) { /* keep the rename either way */ }
  }
  return { state: loadState() };
}

/** stores: [{ StoreID?, Name }] — replaces the store list. New stores get the default aisle order. */
function updateStores(args) {
  const input = (args.stores || []).filter(function (s) { return String(s.Name || '').trim(); });
  if (!input.length) throw new Error('Keep at least one store.');
  const stores = input.map(function (s) { return { StoreID: s.StoreID || Db.newId('S'), Name: String(s.Name).trim() }; });
  const ids = TsCore.indexBy(stores, 'StoreID');
  Db.write('Stores', stores);
  Db.update('StoreSectionOrder', function (rows) {
    const kept = rows.filter(function (r) { return ids[r.StoreID]; });
    stores.forEach(function (s) {
      if (kept.some(function (r) { return r.StoreID === s.StoreID; })) return;
      TsCore.CATEGORIES.forEach(function (c, i) { kept.push({ StoreID: s.StoreID, Category: c, SortOrder: i + 1 }); });
    });
    return kept;
  });
  return { state: loadState() };
}

/** args: { storeId, categories: ['Produce', 'Bakery', ...] in aisle-walk order } */
function updateSectionOrder(args) {
  const storeId = require_(args.storeId, 'store id');
  const cats = (args.categories || []).filter(function (c) { return TsCore.CATEGORIES.indexOf(c) >= 0; });
  TsCore.CATEGORIES.forEach(function (c) { if (cats.indexOf(c) < 0) cats.push(c); });
  Db.update('StoreSectionOrder', function (rows) {
    return rows.filter(function (r) { return String(r.StoreID) !== String(storeId); })
      .concat(cats.map(function (c, i) { return { StoreID: storeId, Category: c, SortOrder: i + 1 }; }));
  });
  return { state: loadState() };
}
