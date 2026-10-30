// Pantry & settings: kitchen stock (with use-by dates), basics checklist (staples),
// the ingredient list (categories, gram conversions, nutrition), stores & aisle order,
// and the connection to the Sheet.
import { store, write, refresh } from '../store.js';
import * as api from '../api.js';
import { getApiUrl, setApiUrl, APP_VERSION } from '../config.js';
import { C, esc, icon, toast, showError, busy, daysBadge, datalists } from '../ui.js';

const TABS = [['stock', 'Stock'], ['staples', 'Staples'], ['ingredients', 'Ingredients'], ['stores', 'Stores'], ['app', 'App']];

const COMMON_STAPLES = ['Salt', 'Black pepper', 'Olive oil', 'Vegetable oil', 'Sugar', 'Brown sugar', 'All-purpose flour',
  'Baking soda', 'Baking powder', 'Vanilla extract', 'Cornstarch', 'Garlic powder', 'Onion powder', 'Ground cumin', 'Paprika',
  'Smoked paprika', 'Chili powder', 'Dried oregano', 'Italian seasoning', 'Ground cinnamon', 'Red pepper flakes', 'Bay leaves',
  'Soy sauce', 'White vinegar', 'Apple cider vinegar', 'Honey', 'Maple syrup', 'Rice', 'Water'];

export function pantryView(root, [tabParam]) {
  const tab = TABS.some(([t]) => t === tabParam) ? tabParam : (store.state ? 'stock' : 'app');
  if (!store.state && tab !== 'app') { location.replace('#/pantry/app'); return; }
  const head = () => `<div class="page-head"><h1>Pantry</h1></div>
    <div class="seg">${TABS.map(([t, l]) => `<a href="#/pantry/${t}" class="${t === tab ? 'on' : ''}">${l}</a>`).join('')}</div>`;
  const views = { stock: stockTab, staples: staplesTab, ingredients: ingredientsTab, stores: storesTab, app: appTab };
  return views[tab](root, head);
}

// ---------- Stock ----------

function stockTab(root, head) {
  const nameOf = (id) => (store.state.ingredients.find((i) => i.IngredientID === id) || {}).Name || '?';

  const render = () => {
    const st = store.state;
    const keep = root.querySelector('#s-name') ? ['name', 'qty', 'unit', 'useby'].map((k) => root.querySelector('#s-' + k).value) : null;
    const rows = st.household.map((h, i) => ({ ...h, i, Name: nameOf(h.IngredientID) }))
      .sort((a, b) => (a.UseByDate || '9999').localeCompare(b.UseByDate || '9999') || a.Name.localeCompare(b.Name));
    root.innerHTML = `${head()}${datalists(st)}
      <p class="muted">What's in your kitchen right now. Grocery lists subtract it, and "What can I cook?" uses it (soonest to spoil first).</p>
      <div class="card">
        ${rows.length ? rows.map((h) => `<div class="trow" data-i="${h.i}">
          <span class="grow"><b>${esc(h.Name)}</b></span>
          <input class="qty" type="text" inputmode="decimal" data-k="Quantity" value="${esc(h.Quantity === '' ? '' : C.formatQuantity(h.Quantity))}" aria-label="Quantity" placeholder="some">
          <input class="unit" type="text" data-k="Unit" value="${esc(h.Unit)}" list="dl-units" aria-label="Unit" autocapitalize="off">
          ${daysBadge(h.UseByDate)}
          <button class="icon-btn flat" data-del="${h.i}" aria-label="Remove">${icon('trash', 'sm')}</button>
        </div>`).join('') : `<div class="empty" style="padding:16px">${icon('jar')}<p>Nothing tracked yet.</p></div>`}
      </div>
      <div class="card"><h3>Add to stock</h3>
        <label class="field"><span>Ingredient</span><input type="text" id="s-name" list="dl-ingredients" placeholder="spinach"></label>
        <div class="row">
          <label class="field" style="width:76px"><span>Qty</span><input type="text" inputmode="decimal" id="s-qty" placeholder="some"></label>
          <label class="field" style="width:90px"><span>Unit</span><input type="text" id="s-unit" list="dl-units" autocapitalize="off"></label>
          <label class="field grow"><span>Use by</span><input type="date" id="s-useby"></label>
        </div>
        <p class="help" style="margin-top:-6px">Leave the date empty to use the ingredient's usual shelf life. Leave qty empty for "I have some".</p>
        <button class="btn olive block" id="s-add">${icon('plus', 'sm')} Add</button>
      </div>`;
    if (keep) ['name', 'qty', 'unit', 'useby'].forEach((k, n) => { root.querySelector('#s-' + k).value = keep[n]; });
  };

  const save = (list) => write('updateHouseholdIngredients', { list }).catch(showError);
  const current = () => store.state.household.map((h) => ({ ...h }));

  root.addEventListener('change', (e) => {
    const row = e.target.closest('[data-i]');
    if (!row || !e.target.dataset.k) return;
    const list = current();
    list[Number(row.dataset.i)][e.target.dataset.k] = e.target.value;
    save(list);
  });
  root.addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (del) { const list = current(); list.splice(Number(del.dataset.del), 1); save(list); return; }
    const add = e.target.closest('#s-add');
    if (!add) return;
    const name = root.querySelector('#s-name').value.trim();
    if (!name) return;
    const list = current().concat([{ Name: name, Quantity: root.querySelector('#s-qty').value, Unit: root.querySelector('#s-unit').value.trim(), UseByDate: root.querySelector('#s-useby').value }]);
    busy(add, async () => {
      await save(list);
      ['name', 'qty', 'unit', 'useby'].forEach((k) => { root.querySelector('#s-' + k).value = ''; });
      toast('Added ' + name);
    });
  });
  render();
  return { onState: render };
}

// ---------- Staples ----------

function staplesTab(root, head) {
  const st = store.state;
  const staples = C.staplesSet(st.pantry);
  const options = [];
  const seen = {};
  const push = (name, id) => {
    const k = C.ingredientKey(name);
    if (!k || seen[k]) return;
    seen[k] = true;
    options.push({ Name: name, IngredientID: id || '', on: !!(id && staples[id]) });
  };
  st.ingredients.filter((i) => staples[i.IngredientID]).forEach((i) => push(i.Name, i.IngredientID));
  COMMON_STAPLES.forEach((n) => { const hit = C.matchIngredient(n, st.ingredients); push(hit ? hit.Name : n, hit && hit.IngredientID); });
  st.ingredients.slice().sort((a, b) => a.Name.localeCompare(b.Name)).forEach((i) => push(i.Name, i.IngredientID));

  root.innerHTML = `${head()}
    <p class="muted">Your basics checklist. Tick what you <b>always</b> have. These never show up on a grocery list and count as "have" for suggestions.</p>
    <div class="card"><div class="staples">${options.map((o, n) => `<label class="check"><input type="checkbox" data-n="${n}" ${o.on ? 'checked' : ''}> ${esc(o.Name)}</label>`).join('')}</div>
      <div class="row" style="margin-top:12px"><input type="text" id="other" class="grow" placeholder="Something else…"><button class="btn ghost sm" id="add-other">Add</button></div>
    </div>
    <div class="spacer"></div>
    <button class="btn olive block" id="save">${icon('check', 'sm')} Save staples</button>`;

  root.querySelector('#add-other').onclick = () => {
    const input = root.querySelector('#other');
    const name = input.value.trim();
    if (!name) return;
    options.push({ Name: name, IngredientID: '', on: true });
    const grid = root.querySelector('.staples');
    grid.insertAdjacentHTML('afterbegin', `<label class="check"><input type="checkbox" data-n="${options.length - 1}" checked> ${esc(name)}</label>`);
    input.value = '';
  };
  root.querySelector('#save').onclick = (e) => {
    const list = [];
    root.querySelectorAll('.staples input').forEach((cb) => {
      const o = options[Number(cb.dataset.n)];
      if (cb.checked) list.push({ Name: o.Name, IngredientID: o.IngredientID, AlwaysHave: true });
    });
    busy(e.currentTarget, () => write('updatePantryStaples', { list }).then(() => toast('Staples saved')).catch(showError));
  };
  return {};
}

// ---------- Ingredients ----------

function nutritionLine(ing) {
  const n = ing.NutritionPer100g;
  if (!n) return '<span class="muted">Not looked up yet</span>';
  if (n.notFound) return `<span class="spoil">No USDA match for "${esc(n.query)}"</span>`;
  return `Per 100 g: ${Math.round(n.calories)} kcal · ${C.round(n.protein, 1)}g protein · ${C.round(n.carbs, 1)}g carbs · ${C.round(n.fat, 1)}g fat<br><span class="muted">Matched: ${esc(n.food)}</span>`;
}

function ingredientsTab(root, head) {
  let open = null, q = '';
  const render = () => {
    const st = store.state;
    const list = st.ingredients.filter((i) => !q || i.Name.toLowerCase().includes(q.toLowerCase())).sort((a, b) => a.Name.localeCompare(b.Name));
    root.innerHTML = `${head()}
      <p class="muted">Every ingredient you've used. Gram conversions make nutrition and stock math work for cups, bunches, cans, and so on.</p>
      <div class="search">${icon('search', 'sm')}<input type="search" id="iq" placeholder="Find an ingredient" value="${esc(q)}"></div>
      <div class="card" style="margin-top:12px">${list.length ? list.map((i) => `
        <div class="trow" data-open="${esc(i.IngredientID)}" style="cursor:pointer">
          <span class="grow"><b>${esc(i.Name)}</b><br><span class="small muted">${esc(i.Category)}${i.GramsPerUnit ? ' · ' + esc(i.GramsPerUnit) : ''}</span></span>
          ${i.NutritionPer100g && !i.NutritionPer100g.notFound ? `<span class="pill olive">nutrition</span>` : i.NutritionPer100g ? '<span class="pill terra">no match</span>' : ''}
        </div>
        ${open === i.IngredientID ? `<div class="ing-edit" data-id="${esc(i.IngredientID)}">
          <label class="field"><span>Name</span><input type="text" data-k="Name" value="${esc(i.Name)}"></label>
          <label class="field"><span>Aisle category</span><select data-k="Category">${C.CATEGORIES.map((c) => `<option ${c === i.Category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
          <label class="field"><span>Grams per unit</span><input type="text" data-k="GramsPerUnit" value="${esc(i.GramsPerUnit)}" placeholder="cup=120; each=50; bunch=60" autocapitalize="off">
            <span class="help">One entry per unit, like <b>cup=120</b>. One volume entry covers tsp, tbsp, and cups.</span></label>
          <label class="field"><span>Usually keeps (days)</span><input type="number" inputmode="numeric" data-k="DefaultShelfLifeDays" value="${esc(i.DefaultShelfLifeDays)}"></label>
          <p class="small">${nutritionLine(i)}</p>
          <div class="row"><input type="text" data-k="query" class="grow" placeholder="Better search, e.g. cilantro raw"><button class="btn ghost sm" data-refetch>Look up</button></div>
          <div class="spacer" style="height:10px"></div>
          <button class="btn olive block sm" data-save>Save</button>
        </div>` : ''}`).join('') : '<p class="muted">No ingredients yet.</p>'}</div>`;
    const iq = root.querySelector('#iq');
    iq.oninput = () => { q = iq.value; const pos = iq.selectionStart; render(); const n = root.querySelector('#iq'); n.focus(); n.setSelectionRange(pos, pos); };
  };

  root.addEventListener('click', (e) => {
    const ed = e.target.closest('.ing-edit');
    if (ed) {
      const v = (k) => ed.querySelector(`[data-k="${k}"]`).value;
      const saveBtn = e.target.closest('[data-save]');
      if (saveBtn) {
        busy(saveBtn, () => write('updateIngredient', { ingredient: {
          IngredientID: ed.dataset.id, Name: v('Name').trim(), Category: v('Category'), GramsPerUnit: v('GramsPerUnit'), DefaultShelfLifeDays: Number(v('DefaultShelfLifeDays')) || '',
        } }).then(() => { toast('Saved'); render(); }).catch(showError));
      }
      const re = e.target.closest('[data-refetch]');
      if (re) {
        busy(re, () => write('refreshNutrition', { id: ed.dataset.id, query: v('query').trim() || v('Name').trim() })
          .then((r) => { toast(r.note || 'Looked up'); render(); }).catch(showError));
      }
      return;
    }
    const row = e.target.closest('[data-open]');
    if (row) { open = open === row.dataset.open ? null : row.dataset.open; render(); }
  });
  render();
  return {};
}

// ---------- Stores & aisle order ----------

function storesTab(root, head) {
  const st = store.state;
  let stores = st.stores.map((s) => ({ ...s }));
  let orderStore = (stores[0] || {}).StoreID;
  const orderFor = (id) => {
    const rows = store.state.sectionOrder.filter((r) => String(r.StoreID) === String(id)).sort((a, b) => a.SortOrder - b.SortOrder).map((r) => r.Category);
    C.CATEGORIES.forEach((c) => { if (!rows.includes(c)) rows.push(c); });
    return rows;
  };
  let order = orderFor(orderStore);

  const render = () => {
    root.innerHTML = `${head()}
      <div class="card"><h2>Stores</h2>
        ${stores.map((s, n) => `<div class="trow"><input type="text" data-sn="${n}" class="grow" value="${esc(s.Name)}" aria-label="Store name">
          <button class="icon-btn flat" data-sdel="${n}" aria-label="Remove store">${icon('trash', 'sm')}</button></div>`).join('')}
        <div class="row" style="margin-top:10px"><button class="btn ghost sm" id="s-add">${icon('plus', 'sm')} Store</button><span class="grow"></span><button class="btn sm olive" id="s-save">Save stores</button></div>
      </div>
      <div class="card"><h2>Aisle order</h2>
        <p class="muted">The order you walk the store. The grocery list follows it.</p>
        <select id="o-store">${store.state.stores.map((s) => `<option value="${esc(s.StoreID)}" ${s.StoreID === orderStore ? 'selected' : ''}>${esc(s.Name)}</option>`).join('')}</select>
        <div style="margin-top:10px">${order.map((c, n) => `<div class="order-row"><span class="n">${n + 1}</span><span class="grow">${esc(c)}</span>
          <button class="icon-btn flat" data-up="${n}" ${n ? '' : 'disabled'} aria-label="Move up">${icon('up', 'sm')}</button>
          <button class="icon-btn flat" data-down="${n}" ${n < order.length - 1 ? '' : 'disabled'} aria-label="Move down">${icon('down', 'sm')}</button></div>`).join('')}</div>
        <div class="spacer" style="height:10px"></div>
        <button class="btn olive block" id="o-save">Save aisle order</button>
      </div>`;
  };

  root.addEventListener('input', (e) => { if (e.target.dataset.sn) stores[Number(e.target.dataset.sn)].Name = e.target.value; });
  root.addEventListener('change', (e) => { if (e.target.id === 'o-store') { orderStore = e.target.value; order = orderFor(orderStore); render(); } });
  root.addEventListener('click', (e) => {
    const t = e.target;
    const move = (from, to) => { const [c] = order.splice(from, 1); order.splice(to, 0, c); render(); };
    if (t.closest('[data-up]')) return move(Number(t.closest('[data-up]').dataset.up), Number(t.closest('[data-up]').dataset.up) - 1);
    if (t.closest('[data-down]')) return move(Number(t.closest('[data-down]').dataset.down), Number(t.closest('[data-down]').dataset.down) + 1);
    if (t.closest('[data-sdel]')) {
      const n = Number(t.closest('[data-sdel]').dataset.sdel);
      if (stores.length > 1 && confirm(`Remove ${stores[n].Name}?`)) { stores.splice(n, 1); render(); }
      return;
    }
    if (t.closest('#s-add')) { stores.push({ Name: 'New store' }); render(); return; }
    const ss = t.closest('#s-save');
    if (ss) {
      busy(ss, () => write('updateStores', { stores }).then(() => {
        stores = store.state.stores.map((s) => ({ ...s }));
        if (!stores.some((s) => s.StoreID === orderStore)) { orderStore = stores[0].StoreID; order = orderFor(orderStore); }
        toast('Stores saved');
        render();
      }).catch(showError));
      return;
    }
    const os = t.closest('#o-save');
    if (os) busy(os, () => write('updateSectionOrder', { storeId: orderStore, categories: order }).then(() => toast('Aisle order saved')).catch(showError));
  });
  render();
  return {};
}

// ---------- App / connection ----------

function appTab(root, head) {
  const render = () => {
    const url = getApiUrl();
    const last = store.lastSync ? new Date(store.lastSync).toLocaleString() : 'never';
    root.innerHTML = `${store.state ? head() : '<div class="page-head"><h1>Connect</h1></div>'}
      <div class="card"><h2>Your Google Sheet</h2>
        <label class="field"><span>Apps Script Web App URL</span>
          <input type="url" id="api" value="${esc(url)}" placeholder="https://script.google.com/macros/s/…/exec" autocapitalize="off"></label>
        <p class="help" style="margin-top:-6px">From Apps Script › Deploy › Manage deployments. It's saved only on this phone.</p>
        <button class="btn block" id="connect">${icon('link', 'sm')} Save & connect</button>
      </div>
      <div class="card"><h2>Sync</h2>
        <p>Status: <b>${store.online ? 'Online' : 'Offline'}</b><br>Last synced: <b>${esc(last)}</b><br>
        Changes waiting: <b>${store.queue.length}</b></p>
        <button class="btn ghost block" id="refresh" ${url ? '' : 'disabled'}>${icon('refresh', 'sm')} Refresh now</button>
      </div>
      <p class="center small muted">Ts Menu ${APP_VERSION}</p>`;
    root.querySelector('#connect').onclick = (e) => busy(e.currentTarget, async () => {
      const value = root.querySelector('#api').value.trim();
      const old = getApiUrl();
      setApiUrl(value);
      try {
        await api.get('ping');
        await refresh();
        toast('Connected');
        location.hash = '#/home';
      } catch (err) {
        if (old && old !== value) setApiUrl(old);
        showError(err);
      }
    });
    root.querySelector('#refresh').onclick = (e) => busy(e.currentTarget, () => refresh().then(() => toast('Up to date')).catch(showError));
  };
  render();
  return { onState: () => { if (!root.querySelector('#api:focus')) render(); } };
}
