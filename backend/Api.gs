/**
 * Ts Menu — Web App entry points.
 *
 * GET  ?action=<name>&args=<url-encoded JSON>         reads
 * POST body: {"action": "<name>", "args": {...}}       writes
 *
 * The frontend sends POSTs as Content-Type text/plain so the browser skips the CORS
 * preflight that Apps Script can't answer; the body is still JSON.
 *
 * Every response is {"ok": true, "data": ...} or {"ok": false, "error": "..."}.
 */

// Route tables are built per request: Apps Script loads files in order, so a top-level
// table could reference handlers from files that haven't loaded yet.
function reads_() {
  return {
    ping: function () { return { ok: true, time: new Date().toISOString() }; },
    bootstrap: function () { return loadState(); },
    getRecipes: getRecipes,
    getRecipe: getRecipe,
    getPantryStaples: getPantryStaples,
    getHouseholdIngredients: getHouseholdIngredients,
    suggestRecipes: suggestRecipesApi,
    parseRecipeText: function (a) { return TsCore.parseRecipeText(a.text); },
  };
}

function writes_() {
  return {
    // Recipes
    addRecipeManual: addRecipeManual,
    updateRecipe: updateRecipe,
    deleteRecipe: deleteRecipe,
    toggleFavorite: toggleFavorite,
    setFavorite: setFavorite,
    saveComment: saveComment,
    uploadRecipePhoto: uploadRecipePhoto,
    importRecipeFromUrl: importRecipeFromUrl,
    markRecipeCooked: markRecipeCooked,
    // Pantry, stock, ingredients, stores
    updatePantryStaples: updatePantryStaples,
    updateHouseholdIngredients: updateHouseholdIngredients,
    updateIngredient: updateIngredient,
    updateStores: updateStores,
    updateSectionOrder: updateSectionOrder,
    // Nutrition (writes, because results are cached on the sheet)
    getNutrition: getNutrition,
    fetchMissingNutrition: fetchMissingNutrition,
    refreshNutrition: refreshNutrition,
    // Grocery list
    generateGroceryList: generateGroceryList,
    addToGroceryList: addToGroceryList,
    removeFromGroceryList: removeFromGroceryList,
    clearGroceryList: clearGroceryList,
    toggleGroceryItemChecked: toggleGroceryItemChecked,
    setGroceryItemChecked: setGroceryItemChecked,
    applyQueuedChanges: applyQueuedChanges,
    addManualGroceryItem: addManualGroceryItem,
    deleteManualGroceryItem: deleteManualGroceryItem,
    finishShopping: finishShopping,
  };
}

function doGet(e) {
  const p = (e && e.parameter) || {};
  return respond_(function () {
    const fn = reads_()[p.action || 'ping'];
    if (!fn) throw new Error(writes_()[p.action] ? p.action + ' must be sent as a POST.' : 'Unknown action: ' + p.action);
    return fn(p.args ? JSON.parse(p.args) : {});
  });
}

function doPost(e) {
  return respond_(function () {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const fn = writes_()[body.action] || reads_()[body.action];
    if (!fn) throw new Error('Unknown action: ' + body.action);
    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      return fn(body.args || {});
    } finally {
      lock.releaseLock();
    }
  });
}

function respond_(fn) {
  let out;
  try {
    out = { ok: true, data: fn() };
  } catch (err) {
    console.error(err && err.stack || err);
    out = { ok: false, error: String(err && err.message || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function require_(value, name) {
  if (value === undefined || value === null || value === '') throw new Error('Missing ' + name + '.');
  return value;
}
