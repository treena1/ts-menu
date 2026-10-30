// Recipe detail: photo, servings stepper, scaled ingredients & steps, nutrition,
// comment, add to grocery list, "Cooked it".
import { store, write } from '../store.js';
import { C, esc, icon, photo, minutes, toast, showError, busy, resizeImage, ACCENT } from '../ui.js';

const servingsFor = {};       // RecipeID → servings chosen this session
const nutritionTried = new Set();
const crossed = {};           // RecipeID → Set of ingredient rows tapped while cooking

function fmtNutrient(key, v) {
  if (key === 'calories') return Math.round(v);
  if (key === 'sodium') return Math.round(v) + 'mg';
  if (key === 'iron') return C.round(v, 1) + 'mg';
  return (v >= 10 ? Math.round(v) : C.round(v, 1)) + 'g';
}

export function detailView(root, [id]) {
  let commentDirty = false;

  const render = () => {
    const st = store.state;
    const r = st.recipes.find((x) => x.RecipeID === id);
    if (!r) {
      root.innerHTML = `<div class="empty">${icon('book')}<p>That recipe isn't here anymore.</p><a class="btn" href="#/recipes">All recipes</a></div>`;
      return;
    }
    const onList = st.selection.find((s) => s.RecipeID === id);
    const servings = servingsFor[id] || (onList ? onList.Servings : r.BaseServings || 2);
    const scale = C.scaleFactor(servings, r.BaseServings);
    const byId = C.indexBy(st.ingredients, 'IngredientID');
    const staples = C.staplesSet(st.pantry);
    const nut = C.recipeNutrition(r, st.ingredients);
    const done = crossed[id] || (crossed[id] = new Set());

    const ingredients = r.ingredients.map((ri, i) => {
      const ing = byId[ri.IngredientID] || {};
      const q = C.num(ri.QuantityAtBaseServings);
      const amt = q == null ? (ri.Unit || '') : C.formatAmount(q * scale, ri.Unit);
      return `<li data-row="${i}" class="${done.has(i) ? 'done' : ''}"><span class="amt">${esc(amt)}</span>
        <span class="grow">${esc(ing.Name || '?')}${ri.Note ? `<span class="muted">, ${esc(ri.Note)}</span>` : ''}
        ${staples[ri.IngredientID] ? ' <span class="pill olive">staple</span>' : ''}</span></li>`;
    }).join('');

    const steps = C.splitSteps(r.Steps).map((s) => `<li>${C.stepSegments(s, scale).map((seg) =>
      seg.text != null ? esc(seg.text) : `<span class="amt-mark">${esc(seg.amount)}</span>`).join('')}</li>`).join('');

    const missing = C.uniq(nut.missingNutrition.concat(nut.missingGrams));
    const comment = commentDirty ? root.querySelector('#comment').value : r.Comment;

    root.innerHTML = `
      <div class="detail-hero">${photo(r)}
        <div class="tools">
          <a class="icon-btn" href="#/recipes" aria-label="Back">${icon('back')}</a><span class="grow"></span>
          <label class="icon-btn" aria-label="Change photo" style="position:relative">${icon('camera')}<input type="file" accept="image/*" id="photo" style="position:absolute;inset:0;opacity:0"></label>
          <a class="icon-btn" href="#/edit/${esc(id)}" aria-label="Edit">${icon('edit')}</a>
          <button class="icon-btn ${r.IsFavorite ? 'on' : ''}" data-fav="${esc(id)}" aria-label="Favorite">${icon('star', r.IsFavorite ? 'fill' : '')}</button>
        </div>
      </div>
      <h1>${esc(r.Name)}</h1>
      <div class="meta-row">
        <span class="pill ${ACCENT[r.MealType]}">${esc(r.MealType)}</span>
        ${r.PrepTimeMinutes ? `<span>${icon('clock', 'sm')} Prep ${minutes(r.PrepTimeMinutes)}</span>` : ''}
        ${r.CookTimeMinutes ? `<span>${icon('pot', 'sm')} Cook ${minutes(r.CookTimeMinutes)}</span>` : ''}
        ${r.Tags.map((t) => `<span>#${esc(t)}</span>`).join('')}
      </div>

      <div class="card">
        <div class="row" style="justify-content:space-between;margin-bottom:6px">
          <h2 style="margin:0">Ingredients</h2>
          <div class="stepper"><button id="less" aria-label="Fewer servings">${icon('minus', 'sm')}</button>
            <output>${servings} serving${servings > 1 ? 's' : ''}</output>
            <button id="more" aria-label="More servings">${icon('plus', 'sm')}</button></div>
        </div>
        ${r.ingredients.length ? `<ul class="ing-list">${ingredients}</ul><p class="help">Tap an ingredient to cross it off while you cook.</p>` : '<p class="muted">No ingredients yet.</p>'}
      </div>

      <div class="card"><h2>Steps</h2>${steps ? `<ol class="steps">${steps}</ol>` : '<p class="muted">No steps yet.</p>'}</div>

      <div class="card">
        <h2>Nutrition <span class="small muted" style="font-family:var(--body)">per serving</span></h2>
        ${nut.counted ? `<div class="nutri">${C.NUTRIENTS.map((n) => `<div><b>${fmtNutrient(n.key, nut.perServing[n.key])}</b><span>${n.label}</span></div>`).join('')}</div>` : ''}
        ${missing.length ? `<p class="help" style="margin-top:10px">${nut.counted ? 'Not counted' : 'Not available yet'}: ${esc(missing.join(', '))}.
          ${nut.missingGrams.length ? 'Add gram conversions in <a href="#/pantry/ingredients">Pantry › Ingredients</a>.' : ''}</p>
          ${nut.missingNutrition.length ? '<button class="btn ghost sm" id="nutri">Look up nutrition</button>' : ''}` : ''}
      </div>

      <div class="card">
        <h2>Notes</h2>
        <textarea id="comment" placeholder="How did it go? Tweaks for next time…" style="min-height:90px">${esc(comment)}</textarea>
        <div class="row" style="margin-top:8px"><span class="grow"></span><button class="btn ghost sm" id="save-comment">Save note</button></div>
      </div>

      <div class="spacer"></div>
      <div class="actions">
        <button class="btn" id="add-list">${icon('bag', 'sm')} ${onList ? (onList.Servings === servings ? 'On your list' : 'Update list') : 'Add to list'}</button>
        <button class="btn olive" id="cooked">${icon('pot', 'sm')} Cooked it</button>
      </div>
      ${r.SourceURL ? `<p class="center small" style="margin-top:16px"><a href="${esc(r.SourceURL)}" target="_blank" rel="noopener">${icon('link', 'sm')} Original recipe</a></p>` : ''}
    `;

    const setServings = (n) => { servingsFor[id] = Math.max(1, Math.min(24, n)); render(); };
    root.querySelector('#less').onclick = () => setServings(servings - 1);
    root.querySelector('#more').onclick = () => setServings(servings + 1);
    root.querySelector('.ing-list')?.addEventListener('click', (e) => {
      const li = e.target.closest('[data-row]');
      if (!li) return;
      const i = Number(li.dataset.row);
      done.has(i) ? done.delete(i) : done.add(i);
      li.classList.toggle('done');
    });

    root.querySelector('#comment').addEventListener('input', () => { commentDirty = true; });
    root.querySelector('#save-comment').onclick = (e) => busy(e.currentTarget, async () => {
      try {
        await write('saveComment', { id, text: root.querySelector('#comment').value });
        r.Comment = root.querySelector('#comment').value;
        commentDirty = false;
        toast('Note saved');
      } catch (err) { showError(err); }
    });

    root.querySelector('#add-list').onclick = (e) => busy(e.currentTarget, async () => {
      try {
        await write('addToGroceryList', { recipeId: id, servings });
        toast(`Added for ${servings} serving${servings > 1 ? 's' : ''}`);
      } catch (err) { showError(err); }
    });

    root.querySelector('#cooked').onclick = (e) => {
      if (!confirm(`Take ${servings} serving${servings > 1 ? 's' : ''} worth of ingredients out of your kitchen stock?`)) return;
      busy(e.currentTarget, async () => {
        try {
          const res = await write('markRecipeCooked', { id, servings });
          let msg = 'Enjoy! Stock updated.';
          if (res.removed.length) msg += ' Used up: ' + res.removed.join(', ') + '.';
          if (res.skipped.length) msg += ' Check by hand: ' + res.skipped.join(', ') + '.';
          toast(msg);
        } catch (err) { showError(err); }
      });
    };

    root.querySelector('#photo').onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      toast('Uploading photo…');
      try {
        const data = await resizeImage(file);
        await write('uploadRecipePhoto', { recipeId: id, base64Image: data });
        toast('Photo saved');
      } catch (err) { showError(err); }
    };

    const lookup = async (quiet) => {
      try {
        const ids = r.ingredients.map((i) => i.IngredientID);
        const res = await write('fetchMissingNutrition', { ingredientIds: ids });
        if (!quiet) toast(res.note || (res.fetched ? 'Nutrition updated' : 'Nothing new found'));
      } catch (err) { if (!quiet) showError(err); }
    };
    const nb = root.querySelector('#nutri');
    if (nb) nb.onclick = (e) => busy(e.currentTarget, () => lookup(false));
    // Fill gaps quietly the first time the recipe is opened this session.
    if (nut.missingNutrition.length && store.online && !nutritionTried.has(id)) {
      nutritionTried.add(id);
      lookup(true);
    }
  };

  render();
  return { onState: render };
}
