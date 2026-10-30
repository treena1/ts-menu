// Home: rotating favorites collage, favorites spotlight, "What can I cook?" card.
import { store } from '../store.js';
import { C, esc, icon, photo, recipeCard } from '../ui.js';

function greeting() {
  const h = new Date().getHours();
  return h < 11 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

// Same order all day, a new one tomorrow.
function dailyShuffle(list) {
  let seed = Number(C.todayIso().replace(/-/g, ''));
  const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  return list.map((x) => [rand(), x]).sort((a, b) => a[0] - b[0]).map((p) => p[1]);
}

function suggestionRow(s) {
  const spoil = s.daysLeft != null && s.daysLeft <= 3
    ? ` · <span class="spoil">use ${esc(s.soonestName)} ${s.daysLeft <= 0 ? 'today' : 'within ' + s.daysLeft + 'd'}</span>` : '';
  return `<a class="suggest" href="#/recipe/${esc(s.recipeId)}">
    <span class="count ${s.missingCount ? '' : 'zero'}">${s.missingCount ? s.missingCount : icon('check', 'sm')}</span>
    <span class="grow"><b>${esc(s.name)}</b><br>
    <span class="small muted">${s.missingCount ? 'Need ' + esc(s.missing.join(', ')) : 'You have everything'}${spoil}</span></span>
  </a>`;
}

export function homeView(root) {
  let timer;
  const render = () => {
    clearInterval(timer);
    const st = store.state;
    const recipes = C.filterRecipes(st.recipes, {});
    const favs = dailyShuffle(recipes.filter((r) => r.IsFavorite));
    const withPhotos = favs.filter((r) => r.PhotoURL).slice(0, 6);
    const suggestions = C.suggestRecipes(st).slice(0, 3);
    const list = C.buildGroceryList(st, localStorage.getItem('tsmenu.store') || (st.stores[0] || {}).StoreID);
    const left = list.total - list.checked;

    let hero;
    if (withPhotos.length >= 3) {
      hero = `<div class="hero"><div class="collage">${withPhotos.slice(0, 3).map((r) => photo(r)).join('')}</div>`;
    } else if (withPhotos.length) {
      hero = `<div class="hero">${withPhotos.map((r, i) => `<div class="slide ${i ? '' : 'on'}"><img src="${esc(r.PhotoURL)}" alt=""></div>`).join('')}`;
    } else {
      hero = `<div class="hero plain"><div class="doodles">${icon('whisk')}${icon('carrot')}${icon('pot')}</div>`;
    }
    hero += `<div class="${withPhotos.length ? 'over' : ''}"><div class="small" style="font-weight:800">${greeting()}</div><h1>What's cooking?</h1></div></div>`;

    root.innerHTML = `
      ${hero}
      ${!recipes.length ? `<div class="card mustard"><h2>Start your cookbook</h2>
        <p>Add a recipe by hand or import one from a link.</p>
        <div class="row wrap"><a class="btn" href="#/new">${icon('edit', 'sm')} Write one</a><a class="btn olive" href="#/import">${icon('link', 'sm')} Import</a></div></div>` : ''}
      ${!st.pantry.length ? `<div class="card olive" style="margin-top:14px"><h2>Set up your basics</h2>
        <p>Tick the staples you always have (salt, oil…) so they never land on a grocery list.</p>
        <a class="btn olive" href="#/pantry/staples">Pick staples</a></div>` : ''}
      ${favs.length ? `<div class="section-title"><h2>Favorites</h2><a href="#/favorites" class="small" style="font-weight:800">See all</a></div>
        <div class="scroller">${favs.slice(0, 10).map(recipeCard).join('')}</div>` : ''}
      ${recipes.length ? `<div class="section-title"><h2>What can I cook?</h2><a href="#/cook" class="small" style="font-weight:800">See all</a></div>
        <div class="card terra">${suggestions.length ? suggestions.map(suggestionRow).join('')
          : '<p class="muted" style="margin:0">Add some ingredients to your recipes to get suggestions.</p>'}
          <p class="small muted" style="margin:10px 0 0">Based on what's in your <a href="#/pantry/stock">kitchen stock</a>.</p></div>` : ''}
      ${left ? `<a class="card" href="#/grocery" style="display:flex;gap:12px;align-items:center;margin-top:14px;color:inherit">
        ${icon('bag', 'lg')}<span class="grow"><b>${left} item${left > 1 ? 's' : ''} on your grocery list</b><br><span class="small muted">Tap to shop</span></span></a>` : ''}
    `;
    const slides = root.querySelectorAll('.hero .slide');
    if (slides.length > 1) {
      let i = 0;
      timer = setInterval(() => {
        slides[i].classList.remove('on');
        i = (i + 1) % slides.length;
        slides[i].classList.add('on');
      }, 5000);
    }
  };
  render();
  return { onState: render, cleanup: () => clearInterval(timer) };
}

export function cookView(root) {
  const render = () => {
    const all = C.suggestRecipes(store.state);
    root.innerHTML = `<div class="page-head"><a class="icon-btn" href="#/home" aria-label="Back">${icon('back')}</a><h1>What can I cook?</h1></div>
      <p class="muted">Fewest missing ingredients first, then whatever's closest to spoiling. Staples count as things you have.</p>
      ${all.length ? `<div class="card">${all.map(suggestionRow).join('')}</div>`
        : `<div class="empty">${icon('pot')}<p>No recipes with ingredients yet.</p></div>`}`;
  };
  render();
  return { onState: render };
}
