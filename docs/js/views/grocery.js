// Grocery list: computed on the phone from cached data, so it works offline.
// Checkmarks are queued and sync on reconnect. "Done shopping" checks items into stock.
import { store, write, queued } from '../store.js';
import { C, esc, icon, toast, showError, busy } from '../ui.js';

const STORE_KEY = 'tsmenu.store';

function currentStore() {
  const stores = store.state.stores;
  const saved = localStorage.getItem(STORE_KEY);
  return stores.some((s) => s.StoreID === saved) ? saved : (stores[0] || {}).StoreID;
}

function itemRow(it) {
  const sub = [it.haveNote ? `<span class="have">${esc(it.haveNote)}</span>` : '', it.recipes.length ? esc(it.recipes.join(', ')) : '']
    .filter(Boolean).join(' · ');
  return `<div class="gitem ${it.checked ? 'done' : ''}" data-key="${esc(it.key)}">
    <span class="box">${it.checked ? icon('check', 'sm') : ''}</span>
    <span class="grow"><span class="gname">${esc(it.name)}</span> ${it.amount ? `<span class="gamt">${esc(it.amount)}</span>` : ''}
      ${sub ? `<br><span class="gsub">${sub}</span>` : ''}</span>
    ${it.manual ? `<button class="icon-btn flat" data-del="${esc(it.key)}" aria-label="Remove">${icon('x', 'sm')}</button>` : ''}
  </div>`;
}

export function groceryView(root) {
  let adding = false;

  const render = () => {
    const st = store.state;
    const storeId = currentStore();
    const list = C.buildGroceryList(st, storeId);
    const byId = C.indexBy(st.recipes, 'RecipeID');
    const sel = st.selection.filter((s) => byId[s.RecipeID]);
    const keepForm = adding && root.querySelector('#m-name');
    const draft = keepForm ? ['name', 'qty', 'unit', 'cat'].map((k) => root.querySelector('#m-' + k).value) : null;

    root.innerHTML = `
      <div class="page-head"><h1>Grocery list</h1></div>
      <div class="seg">${st.stores.map((s) => `<button data-store="${esc(s.StoreID)}" class="${s.StoreID === storeId ? 'on' : ''}">${esc(s.Name)}</button>`).join('')}</div>
      ${sel.length ? `<div class="list-recipes">${sel.map((s) => `<span class="lr">
          <a href="#/recipe/${esc(s.RecipeID)}" style="color:inherit">${esc(byId[s.RecipeID].Name)}</a>
          <button data-serv="${esc(s.RecipeID)}" data-d="-1" aria-label="Fewer servings">${icon('minus')}</button>
          <b>${s.Servings}</b>
          <button data-serv="${esc(s.RecipeID)}" data-d="1" aria-label="More servings">${icon('plus')}</button>
          <button data-rm="${esc(s.RecipeID)}" aria-label="Remove recipe">${icon('x')}</button></span>`).join('')}</div>`
        : `<p class="muted">Add recipes from their page with <b>Add to list</b>, or add items below.</p>`}
      <div class="card" style="margin-top:14px">
        ${adding ? `<h3>Add an item</h3>
          <label class="field"><span>Item</span><input type="text" id="m-name" placeholder="Paper towels, oat milk…"></label>
          <div class="row">
            <label class="field" style="width:80px"><span>Qty</span><input type="text" inputmode="decimal" id="m-qty"></label>
            <label class="field" style="width:90px"><span>Unit</span><input type="text" id="m-unit" list="dl-units2" autocapitalize="off"></label>
            <label class="field grow"><span>Aisle</span><select id="m-cat">${C.CATEGORIES.map((c) => `<option>${esc(c)}</option>`).join('')}</select></label>
          </div>
          <datalist id="dl-units2">${C.COMMON_UNITS.filter(Boolean).map((u) => `<option value="${u}">`).join('')}</datalist>
          <div class="row"><button class="btn ghost sm" id="m-cancel">Cancel</button><span class="grow"></span><button class="btn sm" id="m-save">Add to list</button></div>`
        : `<button class="btn ghost block" id="m-open">${icon('plus', 'sm')} Add an item</button>`}
      </div>

      ${list.sections.map((sec) => {
        const items = sec.items.slice().sort((a, b) => a.checked - b.checked);
        return `<div class="aisle"><h3>${esc(sec.category)}</h3>${items.map(itemRow).join('')}</div>`;
      }).join('')}
      ${!list.total && sel.length ? `<div class="empty">${icon('check')}<p>You already have everything for these recipes.</p></div>` : ''}

      ${list.total || sel.length ? `<div class="sticky-foot">
        <button class="btn ghost" id="clear" style="background:var(--paper)">New list</button>
        <button class="btn olive" id="done" ${list.checked ? '' : 'disabled'}>${icon('check', 'sm')} Done shopping${list.checked ? ` (${list.checked})` : ''}</button>
      </div>` : ''}`;

    if (draft) ['name', 'qty', 'unit', 'cat'].forEach((k, i) => { root.querySelector('#m-' + k).value = draft[i]; });
  };

  root.addEventListener('click', (e) => {
    const t = e.target;
    const storeBtn = t.closest('[data-store]');
    if (storeBtn) { localStorage.setItem(STORE_KEY, storeBtn.dataset.store); render(); return; }

    const del = t.closest('[data-del]');
    if (del) {
      e.stopPropagation();
      write('deleteManualGroceryItem', { itemKey: del.dataset.del }).catch(showError);
      return;
    }
    const item = t.closest('.gitem');
    if (item) {
      const key = item.dataset.key;
      queued('setGroceryItemChecked', { itemKey: key, checked: !store.state.checks[key] });
      return;
    }
    const serv = t.closest('[data-serv]');
    if (serv) {
      const s = store.state.selection.find((x) => x.RecipeID === serv.dataset.serv);
      const next = Math.max(1, s.Servings + Number(serv.dataset.d));
      write('addToGroceryList', { recipeId: s.RecipeID, servings: next }).catch(showError);
      return;
    }
    const rm = t.closest('[data-rm]');
    if (rm) { write('removeFromGroceryList', { recipeId: rm.dataset.rm }).catch(showError); return; }

    if (t.closest('#m-open')) { adding = true; render(); root.querySelector('#m-name').focus(); return; }
    if (t.closest('#m-cancel')) { adding = false; render(); return; }
    const save = t.closest('#m-save');
    if (save) {
      const name = root.querySelector('#m-name').value.trim();
      if (!name) return;
      busy(save, async () => {
        try {
          adding = false;
          await write('addManualGroceryItem', { item: {
            Name: name, Quantity: root.querySelector('#m-qty').value, Unit: root.querySelector('#m-unit').value.trim(), Category: root.querySelector('#m-cat').value,
          } });
          toast('Added ' + name);
        } catch (err) { adding = true; showError(err); }
      });
      return;
    }
    if (t.closest('#done')) { location.hash = '#/checkin'; return; }
    const clear = t.closest('#clear');
    if (clear) {
      if (!confirm('Start a new list? This removes the recipes, extra items, and checkmarks. Nothing is added to stock.')) return;
      busy(clear, () => write('clearGroceryList').then(() => toast('Fresh list')).catch(showError));
    }
  });

  root.addEventListener('change', (e) => {
    if (e.target.id !== 'm-name') return;
    root.querySelector('#m-cat').value = C.guessCategory(e.target.value);
  });

  render();
  return { onState: render };
}

/** "Done shopping": review checked items, set amounts and use-by dates, add to stock. */
export function checkinView(root) {
  const st = store.state;
  const storeId = currentStore();
  const items = C.buildGroceryList(st, storeId).sections.flatMap((s) => s.items).filter((i) => i.checked);
  const byId = C.indexBy(st.ingredients, 'IngredientID');
  const today = C.todayIso();
  if (!items.length) { location.replace('#/grocery'); return; }
  const stockItems = items.filter((i) => !i.manual);
  const manual = items.filter((i) => i.manual);

  root.innerHTML = `<div class="page-head"><a class="icon-btn" href="#/grocery" aria-label="Back">${icon('back')}</a><h1>Done shopping</h1></div>
    <p class="muted">These go into your kitchen stock. Adjust what you actually bought and when it should be used by.</p>
    ${stockItems.length ? `<div class="card">${stockItems.map((it, n) => {
      const ing = byId[it.ingredientId] || {};
      const useBy = C.addDays(today, ing.DefaultShelfLifeDays || C.defaultShelfLife(ing.Category));
      const q = it.qty == null ? '' : C.formatQuantity(it.qty);
      return `<div class="trow" data-n="${n}" style="flex-wrap:wrap">
        <label class="check grow"><input type="checkbox" data-k="add" checked> ${esc(it.name)}</label>
        <input class="qty" type="text" inputmode="decimal" data-k="qty" value="${esc(q)}" aria-label="Quantity">
        <input class="unit" type="text" data-k="unit" value="${esc(it.unit)}" aria-label="Unit" autocapitalize="off">
        <label class="small muted" style="width:100%;display:flex;align-items:center;gap:8px;font-weight:700">Use by
          <input class="date" type="date" data-k="useby" value="${useBy}"></label>
      </div>`;
    }).join('')}</div>` : ''}
    ${manual.length ? `<div class="card"><h3>Coming off the list</h3><p class="muted" style="margin:0">${esc(manual.map((m) => m.name).join(', '))}</p></div>` : ''}
    <div class="spacer"></div>
    <button class="btn olive block" id="confirm">${icon('check', 'sm')} Add to my kitchen</button>`;

  root.querySelector('#confirm').onclick = (e) => {
    const payload = stockItems.map((it, n) => {
      const row = root.querySelector(`[data-n="${n}"]`);
      const v = (k) => row.querySelector(`[data-k="${k}"]`);
      return { itemKey: it.key, addToStock: v('add').checked, Quantity: v('qty').value, Unit: v('unit').value.trim(), UseByDate: v('useby').value };
    }).concat(manual.map((m) => ({ itemKey: m.key })));
    busy(e.currentTarget, async () => {
      try {
        const res = await write('finishShopping', { items: payload, storeId });
        toast(res.addedToStock ? `Added ${res.addedToStock} item${res.addedToStock > 1 ? 's' : ''} to your kitchen` : 'List updated');
        location.replace('#/grocery');
      } catch (err) { showError(err); }
    });
  };
  return {};
}
