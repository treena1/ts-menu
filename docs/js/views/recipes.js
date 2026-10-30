// Recipes catalog (search, meal type, tag, sort) and the Favorites shortlist.
import { store } from '../store.js';
import { C, esc, icon, recipeCard, sheet, ACCENT } from '../ui.js';

// Kept between visits so coming back from a recipe keeps your filters.
const filters = { search: '', mealType: '', tag: '', sort: 'meal' };

const SORTS = {
  meal: (a, b) => C.MEAL_TYPES.indexOf(a.MealType) - C.MEAL_TYPES.indexOf(b.MealType) || a.Name.localeCompare(b.Name),
  name: (a, b) => a.Name.localeCompare(b.Name),
  newest: (a, b) => String(b.CreatedAt).localeCompare(String(a.CreatedAt)),
  quickest: (a, b) => ((+a.PrepTimeMinutes || 0) + (+a.CookTimeMinutes || 0) || 9999) - ((+b.PrepTimeMinutes || 0) + (+b.CookTimeMinutes || 0) || 9999),
};

async function addMenu() {
  const choice = await sheet('Add a recipe', [
    { label: icon('edit', 'sm') + ' Write it myself', value: '#/new' },
    { label: icon('link', 'sm') + ' Import from a link or text', value: '#/import', cls: 'olive' },
  ]);
  if (choice) location.hash = choice;
}

export function recipesView(root) {
  const st = store.state;
  const tags = C.uniq(st.recipes.flatMap(C.tagsOf)).sort((a, b) => a.localeCompare(b));
  root.innerHTML = `
    <div class="page-head"><h1>Recipes</h1></div>
    <div class="search">${icon('search', 'sm')}<input type="search" id="q" placeholder="Search recipes or ingredients" value="${esc(filters.search)}"></div>
    <div class="spacer" style="height:10px"></div>
    <div class="chips" id="meal">
      <button class="chip ${filters.mealType ? '' : 'on'}" data-meal="">All</button>
      ${C.MEAL_TYPES.map((m) => `<button class="chip ${ACCENT[m]} ${filters.mealType === m ? 'on' : ''}" data-meal="${m}" style="text-transform:capitalize">${m}</button>`).join('')}
    </div>
    <div class="row" style="margin-bottom:14px">
      <select id="tag" class="grow" aria-label="Tag"><option value="">All tags & cuisines</option>
        ${tags.map((t) => `<option ${filters.tag === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
      <select id="sort" style="width:42%" aria-label="Sort">
        ${[['meal', 'By meal type'], ['name', 'A to Z'], ['newest', 'Newest'], ['quickest', 'Quickest']].map(([v, l]) =>
          `<option value="${v}" ${filters.sort === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
    </div>
    <div id="grid"></div>
    <button class="fab" id="add" aria-label="Add recipe">${icon('plus', 'lg')}</button>`;

  const grid = root.querySelector('#grid');
  const renderGrid = () => {
    const list = C.filterRecipes(store.state.recipes, { ...filters, ingredients: store.state.ingredients }).sort(SORTS[filters.sort]);
    if (!store.state.recipes.length) {
      grid.innerHTML = `<div class="empty">${icon('book')}<p>No recipes yet. Tap + to add your first one.</p></div>`;
    } else if (!list.length) {
      grid.innerHTML = `<div class="empty">${icon('search')}<p>Nothing matches. Try fewer filters.</p></div>`;
    } else {
      grid.innerHTML = `<p class="small muted">${list.length} recipe${list.length > 1 ? 's' : ''}</p><div class="grid">${list.map(recipeCard).join('')}</div>`;
    }
  };

  root.querySelector('#q').addEventListener('input', (e) => { filters.search = e.target.value; renderGrid(); });
  root.querySelector('#tag').addEventListener('change', (e) => { filters.tag = e.target.value; renderGrid(); });
  root.querySelector('#sort').addEventListener('change', (e) => { filters.sort = e.target.value; renderGrid(); });
  root.querySelector('#meal').addEventListener('click', (e) => {
    const b = e.target.closest('[data-meal]');
    if (!b) return;
    filters.mealType = b.dataset.meal;
    root.querySelectorAll('#meal .chip').forEach((c) => c.classList.toggle('on', c === b));
    renderGrid();
  });
  root.querySelector('#add').addEventListener('click', addMenu);
  renderGrid();
  return { onState: renderGrid };
}

export function favoritesView(root) {
  const render = () => {
    const favs = C.filterRecipes(store.state.recipes, { favorite: true }).sort(SORTS.meal);
    root.innerHTML = `<div class="page-head"><h1>Favorites</h1></div>
      ${favs.length ? `<div class="grid">${favs.map(recipeCard).join('')}</div>`
        : `<div class="empty">${icon('star')}<p>Tap the star on any recipe to keep it here.</p><a class="btn" href="#/recipes">Browse recipes</a></div>`}`;
  };
  render();
  return { onState: render };
}
