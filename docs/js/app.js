// Ts Menu — app shell: hash router, tab bar, offline banner, service worker.
import { store, subscribe, refresh, queued } from './store.js';
import { hydrateIcons, icon, showError, C } from './ui.js';
import { getApiUrl } from './config.js';
import { homeView, cookView } from './views/home.js';
import { recipesView, favoritesView } from './views/recipes.js';
import { detailView } from './views/detail.js';
import { editView, importView } from './views/edit.js';
import { groceryView, checkinView } from './views/grocery.js';
import { pantryView } from './views/pantry.js';

const routes = [
  [/^\/home$/, homeView, 'home'],
  [/^\/cook$/, cookView, 'home'],
  [/^\/recipes$/, recipesView, 'recipes'],
  [/^\/favorites$/, favoritesView, 'favorites'],
  [/^\/recipe\/([^/]+)$/, detailView, 'recipes'],
  [/^\/new$/, editView, 'recipes'],
  [/^\/edit\/([^/]+)$/, editView, 'recipes'],
  [/^\/review$/, editView, 'recipes'],
  [/^\/import$/, importView, 'recipes'],
  [/^\/grocery$/, groceryView, 'grocery'],
  [/^\/checkin$/, checkinView, 'grocery'],
  [/^\/pantry(?:\/(\w+))?$/, pantryView, 'pantry'],
];

let root = document.getElementById('view');
let current = null;

function route() {
  const path = (location.hash || '#/home').slice(1);
  const match = routes.find(([re]) => re.test(path));
  if (!match) { location.replace('#/home'); return; }
  if (current && current.cleanup) current.cleanup();
  const [re, view, tab] = match;
  const params = path.match(re).slice(1);
  document.querySelectorAll('.tabbar a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
  window.scrollTo(0, 0);
  // A fresh element per page, so listeners from the previous page don't pile up.
  const fresh = root.cloneNode(false);
  root.replaceWith(fresh);
  root = fresh;
  if (!store.state && view !== pantryView) {
    root.innerHTML = needsData();
    current = { onState: route };
    return;
  }
  current = view(root, params, path) || {};
}

function needsData() {
  if (!getApiUrl()) {
    return `<div class="empty">${icon('jar')}<h2>Welcome to Ts Menu</h2>
      <p>Connect the app to your Google Sheet to get started.</p>
      <a class="btn" href="#/pantry/app">Connect</a></div>`;
  }
  if (store.loading) return '<div class="loading"><span class="spin"></span> Loading your recipes…</div>';
  return `<div class="empty">${icon('cloudoff')}<h2>Can't reach your sheet</h2>
    <p>Nothing is saved on this phone yet. Check your connection and try again.</p>
    <button class="btn" onclick="location.reload()">Try again</button></div>`;
}

function renderChrome() {
  const banner = document.getElementById('banner');
  const pending = store.queue.length;
  if (!store.online) {
    banner.hidden = false;
    banner.innerHTML = icon('cloudoff', 'sm') + ' Offline. Showing saved data' + (pending ? ` · ${pending} change${pending > 1 ? 's' : ''} to sync` : '');
  } else if (pending) {
    banner.hidden = false;
    banner.innerHTML = '<span class="spin"></span> Syncing ' + pending + ' change' + (pending > 1 ? 's' : '');
  } else {
    banner.hidden = true;
  }
  const badge = document.getElementById('grocery-badge');
  if (store.state) {
    const list = C.buildGroceryList(store.state, localStorage.getItem('tsmenu.store') || (store.state.stores[0] || {}).StoreID);
    const left = list.total - list.checked;
    badge.hidden = !left;
    badge.textContent = left;
  }
}

// Star buttons on any recipe card: optimistic and queued, so they work offline.
document.addEventListener('click', (e) => {
  const fav = e.target.closest('[data-fav]');
  if (!fav) return;
  e.preventDefault();
  e.stopPropagation();
  const r = store.state.recipes.find((x) => x.RecipeID === fav.dataset.fav);
  if (r) queued('setFavorite', { id: r.RecipeID, value: !r.IsFavorite });
});

subscribe(() => {
  renderChrome();
  if (current && current.onState) current.onState();
});

hydrateIcons();
window.addEventListener('hashchange', route);
route();
renderChrome();
if (getApiUrl()) refresh().catch((err) => { if (!err.offline || !store.state) showError(err); });

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
