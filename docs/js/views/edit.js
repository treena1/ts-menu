// Add / edit a recipe, and the import flow (URL or pasted text → review → save).
// The review screen is the edit form with an "original recipe serves N" field:
// everything is entered at the original yield and converted to 2 servings on save.
import { store, write } from '../store.js';
import { C, esc, icon, toast, showError, busy, resizeImage, datalists } from '../ui.js';

let pendingDraft = null;

function blankRow() { return { Name: '', IngredientID: '', Quantity: '', Unit: '', Note: '' }; }

// 0.5 shows as "½"; odd values like 0.15 keep their decimals rather than being rounded.
function showQty(q) {
  const n = C.num(q);
  if (n == null) return '';
  const f = C.formatQuantity(n);
  return Math.abs(C.parseQuantity(f) - n) < 0.005 ? f : String(C.round(n, 3));
}

function modelFromRecipe(r, st) {
  const byId = C.indexBy(st.ingredients, 'IngredientID');
  return {
    Name: r.Name, MealType: r.MealType, Tags: r.Tags.join(', '),
    PrepTimeMinutes: r.PrepTimeMinutes, CookTimeMinutes: r.CookTimeMinutes,
    Steps: C.splitSteps(r.Steps).join('\n'), SourceURL: r.SourceURL, IsVegetarian: r.IsVegetarian,
    Comment: r.Comment, PhotoURL: r.PhotoURL, originalYield: r.BaseServings || 2,
    ingredients: r.ingredients.map((ri) => {
      const name = (byId[ri.IngredientID] || {}).Name || '';
      return { Name: name, _origName: name, IngredientID: ri.IngredientID, Quantity: showQty(ri.QuantityAtBaseServings), Unit: ri.Unit, Note: ri.Note };
    }),
  };
}

function modelFromDraft(d) {
  return {
    ...d, Tags: (d.Tags || []).join(', '),
    ingredients: (d.ingredients || []).map((i) => ({ ...i, _origName: i.Name, Quantity: showQty(i.Quantity) })),
  };
}

export function editView(root, [id], path) {
  const st = store.state;
  const mode = path === '/review' ? 'review' : id ? 'edit' : 'new';
  const existing = id ? st.recipes.find((r) => r.RecipeID === id) : null;
  if (mode === 'edit' && !existing) { location.replace('#/recipes'); return; }
  if (mode === 'review' && !pendingDraft) { location.replace('#/import'); return; }

  const m = mode === 'edit' ? modelFromRecipe(existing, st)
    : mode === 'review' ? modelFromDraft(pendingDraft)
    : { Name: '', MealType: 'dinner', Tags: '', PrepTimeMinutes: '', CookTimeMinutes: '', Steps: '', SourceURL: '', IsVegetarian: true, Comment: '', originalYield: 2, ingredients: [] };
  if (!m.ingredients.length) m.ingredients.push(blankRow(), blankRow(), blankRow());
  let photoData = null;
  const shownPhoto = m.PhotoURL || m.photoSourceUrl || '';

  root.innerHTML = `
    ${datalists(st)}
    <div class="page-head"><a class="icon-btn" href="${mode === 'edit' ? '#/recipe/' + esc(id) : '#/recipes'}" aria-label="Back">${icon('back')}</a>
      <h1>${mode === 'edit' ? 'Edit recipe' : mode === 'review' ? 'Check the import' : 'New recipe'}</h1></div>
    ${mode === 'review' ? `<p class="muted">Look it over before saving. Imports aren't perfect on every site.</p>` : ''}
    <div id="warn"></div>
    <label class="photo-pick" id="pick">
      <div class="photo ${shownPhoto ? '' : 'ph mustard'}" id="pick-photo">${shownPhoto ? `<img src="${esc(shownPhoto)}" alt="">` : icon('camera')}</div>
      <span class="lbl">${icon('camera', 'sm')} ${shownPhoto ? 'Change photo' : 'Add photo'}</span>
      <input type="file" accept="image/*" id="photo">
    </label>
    <label class="field"><span>Name</span><input type="text" id="f-name" value="${esc(m.Name)}" placeholder="Lemony white bean soup" required></label>
    <div class="row">
      <label class="field grow"><span>Meal</span><select id="f-meal">${C.MEAL_TYPES.map((t) => `<option value="${t}" ${m.MealType === t ? 'selected' : ''}>${t[0].toUpperCase() + t.slice(1)}</option>`).join('')}</select></label>
      <label class="field" style="width:84px"><span>Prep min</span><input type="number" inputmode="numeric" id="f-prep" value="${esc(m.PrepTimeMinutes)}"></label>
      <label class="field" style="width:84px"><span>Cook min</span><input type="number" inputmode="numeric" id="f-cook" value="${esc(m.CookTimeMinutes)}"></label>
    </div>
    <label class="field"><span>Tags & cuisine</span><input type="text" id="f-tags" value="${esc(m.Tags)}" placeholder="Italian, quick, one-pot"></label>

    <div class="card">
      <h2>Ingredients</h2>
      ${mode === 'review'
        ? `<label class="field"><span>The original recipe serves</span><input type="number" inputmode="decimal" id="f-yield" value="${esc(m.originalYield)}" style="width:110px"></label>
           <p class="help" style="margin-top:-6px">Enter amounts as the original has them. They're converted to 2 servings when you save.</p>`
        : `<p class="help" style="margin-top:-4px">Amounts for <b>2 servings</b>. Fractions like 1 1/2 or ½ are fine.</p>`}
      <div class="ing-row small muted" style="font-weight:800;margin-top:8px"><span>Qty</span><span>Unit</span><span>Ingredient</span><span></span></div>
      <div id="rows"></div>
      <button class="btn ghost sm" id="add-row">${icon('plus', 'sm')} Ingredient</button>
    </div>

    <div class="card">
      <h2>Steps</h2>
      <textarea id="f-steps" placeholder="One step per line.&#10;Sauté the onion in [1 tbsp] olive oil.">${esc(m.Steps)}</textarea>
      <p class="help">One step per line. Put amounts in [brackets], like <b>[1 cup] broth</b>, and they'll scale with servings. Amounts without brackets stay as written.</p>
      <div class="preview" id="preview"></div>
    </div>

    <div class="card">
      <label class="field"><span>Source link</span><input type="url" id="f-src" value="${esc(m.SourceURL)}" placeholder="https://"></label>
      <label class="check"><input type="checkbox" id="f-veg" ${m.IsVegetarian !== false ? 'checked' : ''}> Vegetarian</label>
      <p class="help">Only vegetarian recipes show in the app.</p>
    </div>

    <div class="spacer"></div>
    <button class="btn block" id="save">${icon('check', 'sm')} Save recipe</button>
    ${mode === 'edit' ? `<div class="spacer"></div><button class="btn block danger" id="delete">${icon('trash', 'sm')} Delete recipe</button>` : ''}
  `;

  const $ = (s) => root.querySelector(s);
  const rowsEl = $('#rows');

  const sync = () => {
    rowsEl.querySelectorAll('[data-i]').forEach((row) => {
      const ing = m.ingredients[Number(row.dataset.i)];
      ['Quantity', 'Unit', 'Name', 'Note'].forEach((k) => { ing[k] = row.querySelector(`[data-k="${k}"]`).value; });
    });
  };

  const renderRows = () => {
    rowsEl.innerHTML = m.ingredients.map((i, n) => `<div class="ing-row" data-i="${n}">
      <input type="text" inputmode="decimal" data-k="Quantity" value="${esc(i.Quantity)}" aria-label="Quantity">
      <input type="text" data-k="Unit" list="dl-units" value="${esc(i.Unit)}" aria-label="Unit" autocapitalize="off">
      <input type="text" data-k="Name" list="dl-ingredients" value="${esc(i.Name)}" aria-label="Ingredient" placeholder="ingredient">
      <button class="icon-btn flat" data-del="${n}" aria-label="Remove">${icon('x', 'sm')}</button>
      <input type="text" class="note" data-k="Note" value="${esc(i.Note)}" placeholder="note (diced, drained…)" aria-label="Note">
      ${i.original ? `<div class="orig">Imported as: ${esc(i.original)}</div>` : ''}
    </div>`).join('');
  };

  const checkVeg = () => {
    sync();
    const found = C.findNonVeg([$('#f-name').value].concat(m.ingredients.map((i) => i.Name)));
    $('#warn').innerHTML = found.length
      ? `<div class="warn">Heads up: this mentions ${esc(found.join(', '))}. Double-check it's vegetarian before saving.</div>` : '';
  };

  const renderPreview = () => {
    const lines = C.splitSteps($('#f-steps').value);
    $('#preview').innerHTML = lines.length
      ? '<b class="small muted">Preview</b><ol class="steps" style="margin-top:8px">' + lines.map((s) => '<li>' + C.stepSegments(s, 1).map((seg) =>
        seg.text != null ? esc(seg.text) : `<span class="amt-mark">${esc(seg.amount)}</span>`).join('') + '</li>').join('') + '</ol>'
      : '<span class="small muted">Steps preview shows here.</span>';
  };

  renderRows();
  renderPreview();
  checkVeg();

  $('#add-row').onclick = () => { sync(); m.ingredients.push(blankRow()); renderRows(); rowsEl.querySelector('[data-i]:last-child [data-k=Quantity]').focus(); };
  rowsEl.addEventListener('click', (e) => {
    const d = e.target.closest('[data-del]');
    if (!d) return;
    sync();
    m.ingredients.splice(Number(d.dataset.del), 1);
    if (!m.ingredients.length) m.ingredients.push(blankRow());
    renderRows();
    checkVeg();
  });
  rowsEl.addEventListener('change', checkVeg);
  $('#f-name').addEventListener('change', checkVeg);
  $('#f-steps').addEventListener('input', renderPreview);

  $('#photo').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      photoData = await resizeImage(file);
      $('#pick-photo').className = 'photo';
      $('#pick-photo').innerHTML = `<img src="${photoData}" alt="">`;
    } catch (err) { showError(err); }
  };

  $('#save').onclick = (e) => {
    sync();
    const name = $('#f-name').value.trim();
    if (!name) { toast('Give the recipe a name', 'error'); $('#f-name').focus(); return; }
    const bad = m.ingredients.find((i) => i.Name.trim() && String(i.Quantity).trim() && C.parseQuantity(i.Quantity) == null);
    if (bad) { toast(`"${bad.Quantity}" isn't an amount I can read (${bad.Name})`, 'error'); return; }
    const draft = {
      Name: name, MealType: $('#f-meal').value,
      Tags: $('#f-tags').value.split(',').map((t) => t.trim()).filter(Boolean),
      PrepTimeMinutes: $('#f-prep').value, CookTimeMinutes: $('#f-cook').value,
      Steps: $('#f-steps').value, SourceURL: $('#f-src').value.trim(), IsVegetarian: $('#f-veg').checked,
      Comment: m.Comment || '', photoSourceUrl: photoData ? '' : (m.photoSourceUrl || ''),
      originalYield: mode === 'review' ? Number($('#f-yield').value) || 2 : 2,
      ingredients: m.ingredients.filter((i) => i.Name.trim()).map((i) => ({
        Name: i.Name.trim(), Quantity: i.Quantity, Unit: i.Unit.trim(), Note: i.Note.trim(),
        // A renamed row becomes a different ingredient.
        IngredientID: i.IngredientID && C.ingredientKey(i.Name) === C.ingredientKey(i._origName) ? i.IngredientID : '',
      })),
    };
    const recipe = C.finalizeDraft(draft);
    if (!recipe.photoSourceUrl) delete recipe.photoSourceUrl;
    const startHash = location.hash;
    busy(e.currentTarget, async () => {
      try {
        const res = mode === 'edit'
          ? await write('updateRecipe', { id, changes: recipe })
          : await write('addRecipeManual', { recipe });
        if (photoData) {
          toast('Saving photo…');
          await write('uploadRecipePhoto', { recipeId: res.recipeId, base64Image: photoData });
        }
        pendingDraft = null;
        toast(res.warning || 'Saved', res.warning ? 'error' : '');
        // Don't pull you back if you've moved on while it was saving.
        if (location.hash === startHash) location.replace('#/recipe/' + res.recipeId);
      } catch (err) { showError(err); }
    });
  };

  if (mode === 'edit') {
    $('#delete').onclick = (e) => {
      if (!confirm(`Delete "${existing.Name}"? This can't be undone.`)) return;
      busy(e.currentTarget, async () => {
        try {
          await write('deleteRecipe', { id });
          toast('Recipe deleted');
          location.replace('#/recipes');
        } catch (err) { showError(err); }
      });
    };
  }
  return {}; // a form: don't re-render underneath the person typing
}

export function importView(root) {
  let tab = 'url';
  const render = (message = '') => {
    root.innerHTML = `<div class="page-head"><a class="icon-btn" href="#/recipes" aria-label="Back">${icon('back')}</a><h1>Import a recipe</h1></div>
      <div class="seg"><button data-tab="url" class="${tab === 'url' ? 'on' : ''}">From a link</button><button data-tab="text" class="${tab === 'text' ? 'on' : ''}">Paste text</button></div>
      ${message ? `<div class="warn">${esc(message)}</div>` : ''}
      ${tab === 'url' ? `
        <label class="field"><span>Recipe page link</span><input type="url" id="url" placeholder="https://…" autocapitalize="off"></label>
        <p class="help">Works with most recipe sites. You'll check everything before it's saved.</p>
        <div class="spacer"></div><button class="btn block" id="go">${icon('link', 'sm')} Fetch recipe</button>`
      : `
        <label class="field"><span>Recipe text</span><textarea id="text" style="min-height:260px" placeholder="Title on the first line&#10;Serves 4&#10;Ingredients&#10;1 cup rice&#10;…&#10;Instructions&#10;1. …"></textarea></label>
        <p class="help">Put the title first. "Ingredients" and "Instructions" headings help, but aren't required.</p>
        <div class="spacer"></div><button class="btn block olive" id="go">Read recipe</button>`}`;
    root.querySelector('.seg').onclick = (e) => { const b = e.target.closest('[data-tab]'); if (b) { tab = b.dataset.tab; render(); } };
    root.querySelector('#go').onclick = (e) => {
      if (tab === 'text') {
        const text = root.querySelector('#text').value;
        if (!text.trim()) return;
        const draft = C.parseRecipeText(text);
        draft.ingredients.forEach((i) => { const hit = C.matchIngredient(i.Name, store.state.ingredients); if (hit) i.IngredientID = hit.IngredientID; });
        pendingDraft = draft;
        location.hash = '#/review';
        return;
      }
      const url = root.querySelector('#url').value.trim();
      if (!url) return;
      busy(e.currentTarget, async () => {
        try {
          const res = await write('importRecipeFromUrl', { url });
          if (!res.found) { tab = 'text'; render(res.error); return; }
          pendingDraft = res.draft;
          location.hash = '#/review';
        } catch (err) { showError(err); }
      });
    };
  };
  render();
  return {};
}
