/**
 * Ts Menu — recipe reads and writes.
 */

/** filters: { mealType, tag, favorite, search } — vegetarian recipes only. */
function getRecipes(args) {
  const f = Object.assign({}, args || {}, { ingredients: loadIngredients_() });
  return TsCore.filterRecipes(loadRecipes_(), f);
}

/** One recipe with its ingredient names and per-serving nutrition. */
function getRecipe(args) {
  const id = require_(args.id, 'recipe id');
  const recipe = loadRecipes_().filter(function (r) { return r.RecipeID === id; })[0];
  if (!recipe) throw new Error('Recipe not found.');
  const ingredients = loadIngredients_();
  const byId = TsCore.indexBy(ingredients, 'IngredientID');
  recipe.ingredients.forEach(function (ri) { ri.Name = (byId[ri.IngredientID] || {}).Name || ''; });
  recipe.nutrition = TsCore.recipeNutrition(recipe, ingredients);
  return recipe;
}

function addRecipeManual(args) {
  const recipe = Object.assign({}, require_(args.recipe, 'recipe'));
  delete recipe.RecipeID;
  return saveRecipe_(recipe);
}

/** changes: any recipe fields; include `ingredients` to replace the ingredient list. */
function updateRecipe(args) {
  const id = require_(args.id, 'recipe id');
  return saveRecipe_(Object.assign({}, args.changes || {}, { RecipeID: id }));
}

/**
 * Creates or updates a recipe. Ingredients arrive as names (and maybe IDs); new names
 * become Ingredients rows. A photoSourceUrl (from import) is re-hosted on Drive.
 */
function saveRecipe_(input) {
  const recipes = Db.read('Recipes');
  const existing = input.RecipeID ? recipes.filter(function (r) { return r.RecipeID === input.RecipeID; })[0] : null;
  if (input.RecipeID && !existing) throw new Error('Recipe not found.');
  const now = new Date().toISOString();
  const pick = function (key, fallback) {
    if (input[key] !== undefined) return input[key];
    return existing ? existing[key] : fallback;
  };

  const name = String(pick('Name', '') || '').trim();
  if (!name) throw new Error('A recipe needs a name.');
  const mealType = pick('MealType', 'dinner');
  const tags = pick('Tags', '');

  const row = {
    RecipeID: existing ? existing.RecipeID : Db.newId('R'),
    Name: name,
    MealType: TsCore.MEAL_TYPES.indexOf(mealType) >= 0 ? mealType : 'dinner',
    Tags: Array.isArray(tags) ? tags.join(', ') : String(tags || ''),
    PrepTimeMinutes: TsCore.num(pick('PrepTimeMinutes', '')) == null ? '' : TsCore.num(pick('PrepTimeMinutes', '')),
    CookTimeMinutes: TsCore.num(pick('CookTimeMinutes', '')) == null ? '' : TsCore.num(pick('CookTimeMinutes', '')),
    BaseServings: Number(pick('BaseServings', TsCore.BASE_SERVINGS)) || TsCore.BASE_SERVINGS,
    Steps: TsCore.splitSteps(pick('Steps', '')).join('\n'),
    SourceURL: pick('SourceURL', ''),
    PhotoURL: pick('PhotoURL', ''),
    IsVegetarian: !TsCore.isFalse(pick('IsVegetarian', true)),
    IsFavorite: TsCore.isTrue(pick('IsFavorite', false)),
    Comment: pick('Comment', ''),
    CreatedAt: existing ? existing.CreatedAt : now,
    UpdatedAt: now,
  };

  let photoWarning = '';
  if (input.photoSourceUrl && !row.PhotoURL) {
    try {
      row.PhotoURL = rehostImage_(input.photoSourceUrl, row.RecipeID);
    } catch (err) {
      photoWarning = 'Saved, but the photo could not be copied: ' + err.message;
    }
  }

  let ingredientIds = null;
  if (input.ingredients) {
    const resolved = resolveIngredients_(input.ingredients.filter(function (i) { return String(i.Name || '').trim() || i.IngredientID; }));
    ingredientIds = resolved.map(function (i) { return i.IngredientID; });
    Db.update('RecipeIngredients', function (rows) {
      const others = rows.filter(function (r) { return r.RecipeID !== row.RecipeID; });
      return others.concat(resolved.map(function (i, n) {
        const q = TsCore.num(i.QuantityAtBaseServings);
        return {
          RecipeID: row.RecipeID, IngredientID: i.IngredientID,
          QuantityAtBaseServings: q == null ? '' : q, Unit: TsCore.normalizeUnit(i.Unit),
          SortOrder: n + 1, Note: i.Note || '',
        };
      }));
    });
  }

  Db.write('Recipes', existing
    ? recipes.map(function (r) { return r.RecipeID === row.RecipeID ? row : r; })
    : recipes.concat([row]));

  // Fill nutrition for any new ingredients while we're here. Never fails the save.
  let nutritionNote = '';
  if (ingredientIds) {
    try { nutritionNote = fillNutrition_(ingredientIds).note; } catch (err) { nutritionNote = err.message; }
  }

  return { recipeId: row.RecipeID, warning: photoWarning, nutritionNote: nutritionNote, state: loadState() };
}

function deleteRecipe(args) {
  const id = require_(args.id, 'recipe id');
  const recipe = Db.read('Recipes').filter(function (r) { return r.RecipeID === id; })[0];
  if (!recipe) throw new Error('Recipe not found.');
  if (recipe.PhotoURL) trashPhoto_(recipe.PhotoURL);
  Db.update('Recipes', function (rows) { return rows.filter(function (r) { return r.RecipeID !== id; }); });
  Db.update('RecipeIngredients', function (rows) { return rows.filter(function (r) { return r.RecipeID !== id; }); });
  Db.update('GrocerySelection', function (rows) { return rows.filter(function (r) { return r.RecipeID !== id; }); });
  return { state: loadState() };
}

function setRecipeField_(id, field, value) {
  let found = false;
  Db.update('Recipes', function (rows) {
    return rows.map(function (r) {
      if (r.RecipeID !== id) return r;
      found = true;
      const copy = Object.assign({}, r);
      copy[field] = typeof value === 'function' ? value(r[field]) : value;
      copy.UpdatedAt = new Date().toISOString();
      return copy;
    });
  });
  if (!found) throw new Error('Recipe not found.');
}

function toggleFavorite(args) {
  const id = require_(args.id, 'recipe id');
  setRecipeField_(id, 'IsFavorite', function (v) { return !TsCore.isTrue(v); });
  return { ok: true };
}

/** Idempotent version used by the offline queue. */
function setFavorite(args) {
  setRecipeField_(require_(args.id, 'recipe id'), 'IsFavorite', !!args.value);
  return { ok: true };
}

function saveComment(args) {
  setRecipeField_(require_(args.id, 'recipe id'), 'Comment', String(args.text || ''));
  return { ok: true };
}

/** args: { recipeId, base64Image (data URL or bare base64), mimeType? } */
function uploadRecipePhoto(args) {
  const id = require_(args.recipeId, 'recipe id');
  const recipe = Db.read('Recipes').filter(function (r) { return r.RecipeID === id; })[0];
  if (!recipe) throw new Error('Recipe not found.');
  let data = String(require_(args.base64Image, 'image'));
  let mime = args.mimeType || 'image/jpeg';
  const m = data.match(/^data:([^;]+);base64,(.*)$/);
  if (m) { mime = m[1]; data = m[2]; }
  const blob = Utilities.newBlob(Utilities.base64Decode(data), mime, id + '.jpg');
  const url = savePhotoBlob_(blob, id);
  if (recipe.PhotoURL) trashPhoto_(recipe.PhotoURL);
  setRecipeField_(id, 'PhotoURL', url);
  return { photoUrl: url, state: loadState() };
}

/** "Cooked it": deducts the scaled recipe from household stock. */
function markRecipeCooked(args) {
  const id = require_(args.id, 'recipe id');
  const recipe = loadRecipes_().filter(function (r) { return r.RecipeID === id; })[0];
  if (!recipe) throw new Error('Recipe not found.');
  const state = loadState();
  const result = TsCore.deductForRecipe(state.household, recipe, args.servings || recipe.BaseServings, state.ingredients, state.pantry);
  Db.write('HouseholdIngredients', result.household);
  return { removed: result.removed, skipped: result.skipped, state: loadState() };
}

function suggestRecipesApi(args) {
  const state = loadState();
  if (args && args.householdIngredients) state.household = args.householdIngredients;
  return TsCore.suggestRecipes(state);
}
