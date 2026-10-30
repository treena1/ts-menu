/**
 * Ts Menu — loading the whole app state and shaping rows for the frontend.
 *
 * The frontend asks for everything at once (bootstrap) and caches it on the phone,
 * which is what makes offline browsing and the offline grocery list work. Most
 * writes answer with a fresh copy of the state so the phone never drifts.
 */

function loadRecipes_() {
  const byRecipe = {};
  Db.read('RecipeIngredients').forEach(function (ri) {
    (byRecipe[ri.RecipeID] = byRecipe[ri.RecipeID] || []).push({
      IngredientID: ri.IngredientID,
      QuantityAtBaseServings: ri.QuantityAtBaseServings === '' ? '' : Number(ri.QuantityAtBaseServings),
      Unit: ri.Unit || '',
      Note: ri.Note || '',
      SortOrder: Number(ri.SortOrder) || 0,
    });
  });
  return Db.read('Recipes').map(function (r) {
    const ings = (byRecipe[r.RecipeID] || []).sort(function (a, b) { return a.SortOrder - b.SortOrder; });
    return {
      RecipeID: r.RecipeID,
      Name: r.Name,
      MealType: r.MealType || 'dinner',
      Tags: TsCore.tagsOf(r),
      PrepTimeMinutes: r.PrepTimeMinutes === '' ? '' : Number(r.PrepTimeMinutes),
      CookTimeMinutes: r.CookTimeMinutes === '' ? '' : Number(r.CookTimeMinutes),
      BaseServings: Number(r.BaseServings) || TsCore.BASE_SERVINGS,
      Steps: String(r.Steps || ''),
      SourceURL: r.SourceURL || '',
      PhotoURL: r.PhotoURL || '',
      IsVegetarian: !TsCore.isFalse(r.IsVegetarian),
      IsFavorite: TsCore.isTrue(r.IsFavorite),
      Comment: r.Comment || '',
      CreatedAt: r.CreatedAt || '',
      UpdatedAt: r.UpdatedAt || '',
      ingredients: ings,
    };
  });
}

function loadIngredients_() {
  return Db.read('Ingredients').map(function (i) {
    return {
      IngredientID: i.IngredientID,
      Name: i.Name,
      Category: i.Category || 'Other',
      NutritionPer100g: TsCore.parseNutrition(i.NutritionPer100g),
      GramsPerUnit: String(i.GramsPerUnit || ''),
      DefaultShelfLifeDays: i.DefaultShelfLifeDays === '' ? TsCore.defaultShelfLife(i.Category) : Number(i.DefaultShelfLifeDays),
    };
  });
}

function loadChecks_() {
  const checks = {};
  Db.read('GroceryListState').forEach(function (c) { if (TsCore.isTrue(c.CheckedOff)) checks[c.ItemKey] = true; });
  return checks;
}

/** Everything the app needs, in one object. */
function loadState() {
  return {
    recipes: loadRecipes_(),
    ingredients: loadIngredients_(),
    pantry: Db.read('PantryStaples').map(function (p) { return { IngredientID: p.IngredientID, AlwaysHave: TsCore.isTrue(p.AlwaysHave) }; }),
    household: Db.read('HouseholdIngredients').map(function (h) {
      return { IngredientID: h.IngredientID, Quantity: h.Quantity === '' ? '' : Number(h.Quantity), Unit: h.Unit || '', DateAdded: h.DateAdded || '', UseByDate: h.UseByDate || '' };
    }),
    stores: Db.read('Stores'),
    sectionOrder: Db.read('StoreSectionOrder'),
    manualItems: Db.read('ManualGroceryItems'),
    checks: loadChecks_(),
    selection: Db.read('GrocerySelection').map(function (s) { return { RecipeID: s.RecipeID, Servings: Number(s.Servings) || TsCore.BASE_SERVINGS }; }),
    serverTime: new Date().toISOString(),
  };
}

/**
 * Turns names typed on the phone into IngredientIDs, adding new Ingredients rows
 * (with a guessed category, shelf life, and gram conversions) where needed.
 * items: [{ IngredientID?, Name, Category? }] — returns the same items with IDs set.
 */
function resolveIngredients_(items) {
  const all = Db.read('Ingredients');
  const byId = TsCore.indexBy(all, 'IngredientID');
  let added = false;
  const out = items.map(function (item) {
    const copy = Object.assign({}, item);
    if (copy.IngredientID && byId[copy.IngredientID]) return copy;
    const name = String(copy.Name || '').trim();
    if (!name) return copy;
    const hit = TsCore.matchIngredient(name, all);
    if (hit) { copy.IngredientID = hit.IngredientID; return copy; }
    const row = TsCore.newIngredientDefaults(name, copy.Category);
    row.IngredientID = Db.newId('I');
    all.push(row);
    byId[row.IngredientID] = row;
    copy.IngredientID = row.IngredientID;
    added = true;
    return copy;
  });
  if (added) Db.write('Ingredients', all);
  return out;
}

function ingredientById_(id) {
  return Db.read('Ingredients').filter(function (i) { return i.IngredientID === id; })[0] || null;
}
