/**
 * Ts Menu — recipe import from a URL.
 *
 * Reads the schema.org/Recipe JSON-LD most recipe sites embed. Never saves: it returns
 * a draft for the review screen, which saves through addRecipeManual.
 */

function importRecipeFromUrl(args) {
  const url = String(require_(args.url, 'url')).trim();
  if (!/^https?:\/\//i.test(url)) throw new Error('That doesn\'t look like a web address.');
  const res = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true,
    followRedirects: true,
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      'Accept': 'text/html,application/xhtml+xml',
    },
  });
  const code = res.getResponseCode();
  if (code >= 400) {
    return { found: false, error: 'The site answered with an error (HTTP ' + code + '). Paste the recipe text instead.' };
  }
  const node = TsCore.extractRecipeFromHtml(res.getContentText());
  if (!node) {
    return { found: false, error: 'No recipe data found on that page. Paste the recipe text instead.' };
  }
  const draft = TsCore.draftFromSchemaRecipe(node, url);
  const ingredients = Db.read('Ingredients');
  draft.ingredients.forEach(function (i) {
    const hit = TsCore.matchIngredient(i.Name, ingredients);
    if (hit) i.IngredientID = hit.IngredientID;
  });
  return { found: true, draft: draft };
}
