# Ts Menu

A personal vegetarian recipe manager and grocery-list builder. It's a home-screen app on the
iPhone, backed by a Google Sheet.

- **Frontend** (`docs/`): plain HTML/CSS/JS, hosted on GitHub Pages and installed with Safari's
  "Add to Home Screen". Works offline from the last sync.
- **Backend** (`backend/`): a Google Apps Script Web App over a Google Sheet. Photos go to a Drive
  folder, and nutrition comes from USDA FoodData Central.
- **Shared logic** (`shared/core.js`): units, scaling, grocery math, suggestions, and recipe
  parsing. The same file runs in the browser and in Apps Script.

The spec and decisions live in the Second Brain vault: `Projects/Recipe & Grocery App.md`.

## One-time setup

### 1. Sheet + backend
1. Create a Google Sheet named **Ts Menu**.
2. **Extensions › Apps Script**. Open the starter `Code.gs`, delete what's in it, and paste in
   the whole of `backend-bundle/Code.gs`. That one file contains every file in `backend/`.
3. **Project Settings** › tick *Show "appsscript.json"*, then paste in `backend/appsscript.json`.
4. Choose `setupSheet` in the function picker and click **Run**. Approve the permissions. All
   the tabs appear in the Sheet.
5. **Project Settings › Script Properties** › add `USDA_API_KEY` (free key from
   https://fdc.nal.usda.gov/api-key-signup.html). Without it the shared `DEMO_KEY` is used,
   which is limited to about 30 lookups an hour.
6. **Deploy › New deployment › Web app**: Execute as **Me**, Who has access **Anyone**. Copy the
   `/exec` URL.

The Drive folder "Ts Menu Photos" is created automatically on the first photo upload.

### 2. Frontend
1. Create a GitHub repo `ts-menu` and push this folder.
2. **Settings › Pages**: deploy from branch `main`, folder **/docs**.
3. On the iPhone, open `https://<you>.github.io/ts-menu/` in Safari, then **Share › Add to Home
   Screen**.
4. Open the app, go to **Pantry › App**, paste the Web App URL, and tap **Save & connect**.

The URL is stored only on the phone, not in the repo. That keeps the open endpoint
unlisted. Anyone who has the URL could read or change the data; that risk was accepted in the spec
interview.

### 3. Fill in your stores
**Pantry › Stores › Aisle order**: arrange the categories in the order you walk Trader Joe's
and Costco.

## Updating

- **Backend change:** edit the files in `backend/`, run `node tools/bundle-backend.mjs`, and
  paste the whole new `backend-bundle/Code.gs` over the old one in Apps Script. Then **Deploy ›
  Manage deployments › Edit › Version: New version**. The URL stays the same.
- **Shared logic change:** edit `shared/core.js` only, then run `node tools/sync-shared.mjs`, which
  rewrites `backend/Core.gs`, `docs/js/core.js` and `backend-bundle/Code.gs`. Paste the new
  `Code.gs` into Apps Script and deploy a new version.
- **Frontend change:** bump `VERSION` in `docs/sw.js` so phones pick it up, then push.
- **Sheet schema change:** add it to `SCHEMA` in `backend/Setup.gs` and run `setupSheet` again.
  It only adds missing tabs and columns, and never touches existing data.

## Local development

Needs Node 20+ and nothing to install.

```
node tools/dev-server.mjs        # http://localhost:8787 — the real backend on a fake Sheet
node --test tools/test.mjs       # core logic + end-to-end backend tests
node tools/make-icons.mjs        # regenerate docs/icons/*.png
```

The dev server runs the actual `backend/*.gs` files through an Apps Script emulator
(`tools/gas-harness.mjs`). Data is saved in `tools/.dev-data/` (git-ignored); delete that folder
to start fresh. Set `USDA_API_KEY` in the environment to use your key locally, or `TSMENU_PORT`
to change the port.

## How things work

- **Servings:** every recipe is stored at 2 servings. Amounts in step text written as
  `[1 cup]` scale with the stepper. Unbracketed text stays as written. URL imports suggest
  the brackets, and you confirm them on the review screen.
- **Grocery list:** built from the recipes you add, scaled by servings, minus staples and
  kitchen stock. Units are converted through grams where possible. If units can't be
  converted, the list shows the full amount plus a note such as "have: 1 bunch".
  Checkmarks made offline sync later.
- **Done shopping:** checked items go into kitchen stock with a use-by date, pre-filled from
  the ingredient's shelf life.
- **Cooked it:** subtracts the recipe's scaled amounts from stock, soonest use-by first.
- **What can I cook?:** ranks recipes by fewest missing ingredients, then by what's closest to
  spoiling.
- **Gram conversions** (Pantry › Ingredients) such as `cup=120; each=50` power nutrition and
  mixed-unit math. Common ingredients come pre-filled.
