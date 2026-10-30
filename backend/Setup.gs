/**
 * Ts Menu — one-time Google Sheet setup.
 *
 * Builds every tab the app needs, with headers, checkboxes, and dropdowns.
 * Safe to re-run: tabs that already exist keep their data. Only missing
 * tabs and missing header columns are added.
 *
 * Run: Extensions > Apps Script, paste this file, choose setupSheet, click Run.
 */

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack', 'drink'];

const CATEGORIES = [
  'Produce',
  'Dairy & Eggs',
  'Bakery',
  'Refrigerated-Protein',
  'Frozen',
  'Pantry & Dry Goods',
  'Spices & Seasonings',
  'Baking',
  'Beverages',
  'Snacks',
  'Other',
];

const STORES = ["Trader Joe's", 'Costco', 'Other'];

// Each tab: headers, plus which columns get checkboxes or dropdowns.
const SCHEMA = {
  Recipes: {
    headers: [
      'RecipeID', 'Name', 'MealType', 'Tags', 'PrepTimeMinutes', 'CookTimeMinutes',
      'BaseServings', 'Steps', 'SourceURL', 'PhotoURL', 'IsVegetarian', 'IsFavorite',
      'Comment', 'CreatedAt', 'UpdatedAt',
    ],
    checkboxes: ['IsVegetarian', 'IsFavorite'],
    dropdowns: { MealType: MEAL_TYPES },
  },
  RecipeIngredients: {
    headers: ['RecipeID', 'IngredientID', 'QuantityAtBaseServings', 'Unit', 'SortOrder', 'Note'],
  },
  Ingredients: {
    headers: [
      'IngredientID', 'Name', 'Category', 'NutritionPer100g', 'GramsPerUnit',
      'DefaultShelfLifeDays',
    ],
    dropdowns: { Category: CATEGORIES },
  },
  PantryStaples: {
    headers: ['IngredientID', 'AlwaysHave'],
    checkboxes: ['AlwaysHave'],
  },
  HouseholdIngredients: {
    headers: ['IngredientID', 'Quantity', 'Unit', 'DateAdded', 'UseByDate'],
  },
  Stores: {
    headers: ['StoreID', 'Name'],
  },
  StoreSectionOrder: {
    headers: ['StoreID', 'Category', 'SortOrder'],
    dropdowns: { Category: CATEGORIES },
  },
  ManualGroceryItems: {
    headers: ['ItemKey', 'Name', 'Quantity', 'Unit', 'Category'],
    dropdowns: { Category: CATEGORIES },
  },
  GroceryListState: {
    headers: ['ItemKey', 'CheckedOff'],
    checkboxes: ['CheckedOff'],
  },
  // Which recipes are on the current grocery list, and for how many servings.
  GrocerySelection: {
    headers: ['RecipeID', 'Servings'],
  },
};

function setupSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  Object.keys(SCHEMA).forEach(function (name) {
    const sheet = ss.getSheetByName(name) || ss.insertSheet(name);
    ensureHeaders_(sheet, SCHEMA[name].headers);
    applyValidation_(sheet, SCHEMA[name]);
  });

  seedStores_(ss.getSheetByName('Stores'));
  seedSectionOrder_(ss.getSheetByName('StoreSectionOrder'));
  removeDefaultSheet_(ss);

  SpreadsheetApp.flush();
  Logger.log('Ts Menu sheet is ready: ' + ss.getUrl());
}

// Writes any headers that are missing, appending new ones after existing columns.
function ensureHeaders_(sheet, headers) {
  const lastCol = sheet.getLastColumn();
  const existing = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  const missing = headers.filter(function (h) { return existing.indexOf(h) === -1; });
  if (missing.length === 0) return;

  const start = existing.filter(String).length + 1;
  sheet.getRange(1, start, 1, missing.length).setValues([missing]);

  const all = sheet.getRange(1, 1, 1, start + missing.length - 1);
  all.setFontWeight('bold').setBackground('#f3e9d8');
  sheet.setFrozenRows(1);
}

function applyValidation_(sheet, spec) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const rows = sheet.getMaxRows() - 1;

  // A checkbox validation rule (not insertCheckboxes) so empty rows stay empty
  // and appendRow keeps landing right after the last real row.
  (spec.checkboxes || []).forEach(function (col) {
    const idx = headers.indexOf(col) + 1;
    const rule = SpreadsheetApp.newDataValidation().requireCheckbox().build();
    sheet.getRange(2, idx, rows, 1).setDataValidation(rule);
  });

  Object.keys(spec.dropdowns || {}).forEach(function (col) {
    const idx = headers.indexOf(col) + 1;
    const rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(spec.dropdowns[col], true)
      .setAllowInvalid(false)
      .build();
    sheet.getRange(2, idx, rows, 1).setDataValidation(rule);
  });
}

function seedStores_(sheet) {
  if (sheet.getLastRow() > 1) return;
  const rows = STORES.map(function (name, i) { return ['S' + (i + 1), name]; });
  sheet.getRange(2, 1, rows.length, 2).setValues(rows);
}

// Placeholder aisle order (the category list order) for every store.
// Replace the Trader Joe's and Costco rows with the real layouts in Phase 2.
function seedSectionOrder_(sheet) {
  if (sheet.getLastRow() > 1) return;
  const rows = [];
  STORES.forEach(function (_, s) {
    CATEGORIES.forEach(function (cat, c) { rows.push(['S' + (s + 1), cat, c + 1]); });
  });
  sheet.getRange(2, 1, rows.length, 3).setValues(rows);
}

function removeDefaultSheet_(ss) {
  const blank = ss.getSheetByName('Sheet1');
  if (blank && blank.getLastRow() === 0 && ss.getSheets().length > 1) {
    ss.deleteSheet(blank);
  }
}
