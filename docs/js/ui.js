// Shared UI bits: escaping, the doodle icon set, toasts, recipe cards, image resizing.

export const C = window.TsCore;

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// One doodle set: same 24px grid, same stroke, rounded ends, slightly loose curves.
const ICONS = {
  home: '<path d="M3.5 11.2 12 4l8.6 7.1"/><path d="M5.6 9.8v9.4c0 .5.4.9.9.9h3.7v-5.4h3.6v5.4h3.8c.5 0 .9-.4.9-.9V9.6"/>',
  book: '<path d="M4 5.2c2.7-1.3 5.4-1.1 8 .8 2.6-1.9 5.3-2.1 8-.8v13.6c-2.7-1.2-5.4-1-8 .9-2.6-1.9-5.3-2.1-8-.9z"/><path d="M12 6v13.6"/>',
  star: '<path d="M12 3.6l2.5 5.3 5.7.7-4.2 3.9 1.1 5.7L12 16.4l-5.1 2.8 1.1-5.7-4.2-3.9 5.7-.7z"/>',
  bag: '<path d="M5.2 8.3h13.6l-1.1 11.2c-.1.7-.6 1.1-1.3 1.1H7.6c-.7 0-1.2-.4-1.3-1.1z"/><path d="M8.8 10.5V7.2a3.2 3.2 0 0 1 6.4 0v3.3"/>',
  jar: '<path d="M7 7.5h10v11.7c0 .8-.6 1.4-1.4 1.4H8.4c-.8 0-1.4-.6-1.4-1.4z"/><path d="M6.5 4.2h11v3.3h-11z"/><path d="M9.5 12.5h5"/>',
  plus: '<path d="M12 5.2v13.4M5.3 12.1h13.4"/>',
  minus: '<path d="M5.3 12h13.4"/>',
  back: '<path d="M14.8 5.5 8.3 12l6.6 6.4"/>',
  edit: '<path d="M15.6 4.9l3.4 3.4L9 18.4l-4.3 1 1-4.3z"/><path d="M13.6 7l3.4 3.4"/>',
  trash: '<path d="M5 7h14"/><path d="M9.5 7V4.8h5V7"/><path d="M6.7 7l.9 12.2c0 .6.5 1 1.1 1h6.6c.6 0 1.1-.4 1.1-1L17.3 7"/>',
  camera: '<path d="M4 8.5c0-.8.6-1.4 1.4-1.4h2.4l1.6-2.3h5.2l1.6 2.3h2.4c.8 0 1.4.6 1.4 1.4v9.3c0 .8-.6 1.4-1.4 1.4H5.4c-.8 0-1.4-.6-1.4-1.4z"/><circle cx="12" cy="13" r="3.4"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.2 1.2"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.2-1.2"/>',
  clock: '<circle cx="12" cy="12" r="8.2"/><path d="M12 7.4V12l3.1 2"/>',
  check: '<path d="M5.2 12.6l4.2 4.1 9.4-9.6"/>',
  x: '<path d="M6.2 6.2l11.6 11.6M17.8 6.2 6.2 17.8"/>',
  whisk: '<path d="M12.5 13.2 19.6 20"/><path d="M12.3 13.4c-3.6 1-7.3-2.8-8-6.2C3.7 4 6.6 3.4 9 4.6c3 1.5 5.4 5.6 3.3 8.8z"/><path d="M12.3 13.4C9.6 11.8 7 8.7 6.5 5.2"/><path d="M12.3 13.4c-1.6-2.9-2.2-6-1.5-8.2"/>',
  carrot: '<path d="M14.2 9.6 5 19.2c-.4.4 0 1 .5.7l9.7-5.9c1.8-1.1 1.9-3.3.5-4.6-1-.9-2.4-.8-3.2.2z"/><path d="M15.5 8.4c.3-1.8 1.4-3.4 3-4.2M16.5 9.4c1.4-.8 3-.9 4.4-.4M15.4 8.2c-.6-1.3-.4-2.9.4-4"/><path d="M9 15.2l1.3 1.2M11.2 12.9l1.2 1"/>',
  pot: '<path d="M4 10.5h16"/><path d="M5.5 10.5v6.3c0 1.6 1.3 2.9 2.9 2.9h7.2c1.6 0 2.9-1.3 2.9-2.9v-6.3"/><path d="M2.7 12.2h2.8M18.5 12.2h2.8"/><path d="M9.3 7.6c-.6-.9.6-1.7 0-2.6M12.2 7.6c-.6-.9.6-1.7 0-2.6M15.1 7.6c-.6-.9.6-1.7 0-2.6"/>',
  leaf: '<path d="M5 19c0-8 5-13.5 14-14 .4 8.8-5.2 14-14 14z"/><path d="M5 19c3-4 6-6.5 9.5-8.3"/>',
  plate: '<circle cx="12" cy="12" r="7.6"/><circle cx="12" cy="12" r="3.9"/>',
  search: '<circle cx="10.8" cy="10.8" r="6"/><path d="M15.3 15.4 20 20"/>',
  refresh: '<path d="M19 12a7 7 0 1 1-2.1-5"/><path d="M19.2 4.4v3.9h-3.9"/>',
  cloudoff: '<path d="M7.2 18.2h9.4a3.6 3.6 0 0 0 .6-7.1 5.5 5.5 0 0 0-10.4-1A4 4 0 0 0 7.2 18.2z"/><path d="M4 4l16 16"/>',
  up: '<path d="M6 14.5 12 8.6l6 5.9"/>',
  down: '<path d="M6 9.5l6 5.9 6-5.9"/>',
};

export function icon(name, cls = '') {
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

/** Replaces <span data-icon="x"> placeholders (used in index.html). */
export function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => { el.outerHTML = icon(el.dataset.icon); });
}

// Accents rotate across meal types so no one color takes over.
export const ACCENT = { breakfast: 'mustard', lunch: 'olive', dinner: 'terra', snack: 'mustard', drink: 'olive' };
const PH_ICON = { breakfast: 'whisk', lunch: 'leaf', dinner: 'pot', snack: 'carrot', drink: 'plate' };

let toastTimer;
export function toast(msg, kind = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, kind === 'error' ? 4800 : 2600);
}

export function showError(err) { toast(err && err.message ? err.message : String(err), 'error'); }

export function minutes(n) {
  const m = Number(n) || 0;
  if (!m) return '';
  if (m < 60) return m + ' min';
  const h = Math.floor(m / 60), r = m % 60;
  return h + ' hr' + (r ? ' ' + r + ' min' : '');
}

export function totalTime(r) { return minutes((Number(r.PrepTimeMinutes) || 0) + (Number(r.CookTimeMinutes) || 0)); }

export function photo(r, extra = '') {
  if (r.PhotoURL) return `<div class="photo ${extra}"><img src="${esc(r.PhotoURL)}" alt="" loading="lazy"></div>`;
  const a = ACCENT[r.MealType] || 'terra';
  return `<div class="photo ph ${a} ${extra}">${icon(PH_ICON[r.MealType] || 'pot')}</div>`;
}

export function recipeCard(r) {
  const t = totalTime(r);
  return `<a class="rcard" href="#/recipe/${esc(r.RecipeID)}">
    ${photo(r)}
    <button class="icon-btn star ${r.IsFavorite ? 'on' : ''}" data-fav="${esc(r.RecipeID)}" aria-label="${r.IsFavorite ? 'Unfavorite' : 'Favorite'}">${icon('star', 'sm ' + (r.IsFavorite ? 'fill' : ''))}</button>
    <div class="body">
      <div class="name">${esc(r.Name)}</div>
      <div class="meta"><span class="pill ${ACCENT[r.MealType] || 'terra'}">${esc(r.MealType)}</span>${t ? `<span>${icon('clock', 'sm')}${esc(t)}</span>` : ''}</div>
    </div>
  </a>`;
}

/** Shrinks a photo before upload so it's quick over a phone connection. */
export function resizeImage(file, max = 1600, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("That photo couldn't be read.")); };
    img.src = url;
  });
}

/** Bottom action sheet. options: [{ label, cls, value }]; resolves the chosen value or null. */
export function sheet(title, options) {
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'sheet-back';
    back.innerHTML = `<div class="sheet"><h3>${esc(title)}</h3>${options.map((o, i) =>
      `<button class="btn block ${o.cls || ''}" data-i="${i}">${o.label}</button>`).join('')}
      <button class="btn block ghost" data-i="-1">Cancel</button></div>`;
    back.addEventListener('click', (e) => {
      const b = e.target.closest('[data-i]');
      if (!b && e.target !== back) return;
      const i = b ? Number(b.dataset.i) : -1;
      back.remove();
      resolve(i >= 0 ? options[i].value : null);
    });
    document.body.appendChild(back);
  });
}

/** Disables a button and shows a spinner while the promise runs. */
export async function busy(btn, fn) {
  const html = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spin"></span>';
  try { return await fn(); } finally { btn.disabled = false; btn.innerHTML = html; }
}

export function ingredientName(state, id) {
  return (state.ingredients.find((i) => i.IngredientID === id) || {}).Name || '';
}

export function daysBadge(useBy) {
  if (!useBy) return '';
  const d = C.daysBetween(C.todayIso(), useBy);
  const cls = d < 0 ? 'late' : d <= 2 ? 'soon' : '';
  const label = d < 0 ? `${-d}d past` : d === 0 ? 'today' : d === 1 ? '1 day' : d + ' days';
  return `<span class="days ${cls}">${label}</span>`;
}

export function datalists(state) {
  return `<datalist id="dl-ingredients">${state.ingredients.map((i) => `<option value="${esc(i.Name)}">`).join('')}</datalist>
    <datalist id="dl-units">${C.COMMON_UNITS.filter(Boolean).map((u) => `<option value="${esc(u)}">`).join('')}</datalist>`;
}
