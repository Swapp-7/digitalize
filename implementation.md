# DIGITALIZE — Plan d'optimisation

---

## Phase 1 — Quick Wins *(15–45 min chacun)*

| # | Fichier | Problème | Fix |
|---|---------|----------|-----|
| **QW-1** | `filters.js` | Formule luminance copiée-collée **5 fois** (lignes ~105, 144, 184, 268, 525) | Extraire `function luma(r,g,b)` en haut du fichier |
| **QW-2** | `store.js` | Duplicate layer → IDs cassés (`id + '-dup-dup'` = collision) | Utiliser un compteur unique au lieu de string concat |
| **QW-3** | `main.js` | Canvas temporaire de chargement jamais libéré en mémoire | `scratch.width = 0` après `getImageData()` |
| **QW-4** | `store.js` | `subscribe()` ne retourne jamais de fonction de désabonnement → fuite mémoire latente | Retourner `() => _listeners.splice(idx, 1)` |
| **QW-5** | `ui.js` | Sliders déclenchent le pipeline complet à **60fps** (pas de debounce) → UI freeze | `debounce(dispatch, 60ms)` sur les sliders uniquement |
| **QW-6** | `filters.js` | Filtre Glitch re-randomise à **chaque re-render**, même sans changement | Ajouter un paramètre `seed` + LCG déterministe, reroll = changer la seed |
| **QW-7** | `layers.js` | Erreurs dans `runLayerStack` silencieusement avalées | `try/catch` + `console.error` |

---

## Phase 2 — Refactors *(2–4h chacun)*

### RF-1 — Pooler le canvas temporaire de halftone `filters.js`
Actuellement un nouveau `<canvas>` est créé **à chaque appel** de `applyHalftone`.
Le transformer en variable module-level réutilisée (resize uniquement si dimensions changent).

```js
let _halftoneTmp = null;
let _halftoneTmpW = 0, _halftoneTmpH = 0;

function getHalftoneCanvas(W, H) {
  if (!_halftoneTmp) _halftoneTmp = document.createElement('canvas');
  if (_halftoneTmpW !== W || _halftoneTmpH !== H) {
    _halftoneTmp.width = W; _halftoneTmp.height = H;
    _halftoneTmpW = W; _halftoneTmpH = H;
  }
  return _halftoneTmp;
}
```

---

### RF-2 — Blur par fenêtre glissante `filters.js` *(impact majeur)*
`boxBlurPass()` est actuellement **O(W × H × radius)**. Un accumulateur glissant le ramène à **O(W × H)** quel que soit le rayon.
`applyGlowFx` appelle cette fonction 6 fois → gain **5–20x** sur les grandes images.

L'API externe `boxBlurPass(src, W, H, radius, horizontal)` reste identique, aucun appelant à modifier.

---

### RF-3 — Cache LUT pour le filtre palette `filters.js` *(impact majeur)*
`nearestColor()` fait un scan linéaire sur toute la palette **pour chaque pixel** → ~1 milliard d'opérations sur 2000×2000 avec 256 couleurs.

Fix : quantifier les couleurs source en 12-bit key, cacher dans un `Map` :

```js
function applyPalette(canvas, ctx, params) {
  // ... build palette array as before ...
  const cache = new Map();
  for (let i = 0; i < d.length; i += 4) {
    const key = (d[i] >> 4) << 8 | (d[i+1] >> 4) << 4 | (d[i+2] >> 4); // 12-bit key
    let entry = cache.get(key);
    if (!entry) { entry = nearestColor(d[i], d[i+1], d[i+2], palette); cache.set(key, entry); }
    d[i] = entry[0]; d[i+1] = entry[1]; d[i+2] = entry[2];
  }
}
```
4096 lookups max au lieu de 4 millions.

---

### RF-4 — Undo par étape `store.js + main.js`
Actuellement l'undo efface **tous** les modifiers d'un coup.

Ajouter un stack d'historique dans le store (max 20 états). Les events slider en cours de drag sont marqués `_transient` (pas pushés dans l'historique), commit sur `pointerup`.

```js
const _history = [];
const MAX_HISTORY = 20;

function dispatch(action) {
  if (!action._transient) {
    _history.push(_state);
    if (_history.length > MAX_HISTORY) _history.shift();
  }
  // ... reduce as before ...
}

function undo() {
  if (!_history.length) return;
  _state = _history.pop();
  _listeners.forEach(fn => fn(_state, null));
}
```

Mettre à jour le handler `btnUndo` dans `main.js` pour appeler `Store.undo()`.

---

### RF-5 — Vérifier le skip pipeline sur opacity/visibility `fabric-bridge.js`
`sync()` est censé ne pas re-lancer le pipeline si seule l'opacité change.
Vérifier empiriquement avec un `console.log` — si le pipeline tourne quand même, ajouter un guard explicite sur `modifiers` et `imageData` avant de lancer `runLayerStack`.

---

## Phase 3 — Architecture *(1–2 jours)*

### AR-1 — Web Worker pour les boucles pixel
Les filtres lourds (halftone, glow, dither) **bloquent le main thread** pendant 2–5s sur les grandes images.

Architecture cible :
1. Créer `worker.js` avec les fonctions de filtre opérant uniquement sur `ArrayBuffer` (transférable sans copie).
2. `runLayerStack` dans `layers.js` transfère `imageData.data.buffer` au worker, reçoit le buffer traité, écrit via `putImageData`.
3. Afficher un overlay CSS "processing..." pendant le calcul.

> **Prérequis : AR-2 doit être fait d'abord pour le filtre halftone** (qui utilise canvas 2D et ne peut pas tourner dans un worker tel quel).

---

### AR-2 — Halftone en pixel pur (sans canvas 2D)
`applyHalftone` utilise `ctx.arc()` / `ctx.fillRect()` → impossible dans un worker.

Réécrire en rasterisation directe dans un `Uint8ClampedArray` — même pattern que `fillDot()` déjà présent dans `filters.js`. Pour les cercles : pour chaque cellule de grille, tester `dx*dx + dy*dy <= r*r` et écrire la couleur directement dans le buffer.

Bénéfice double : élimine la dépendance canvas 2D **et** supprime l'allocation du canvas temporaire (RF-1 devient inutile).

---

### AR-3 — Découper le reducer `store.js`
143 lignes dans un seul switch → séparer en sous-reducers avant que ça devienne ingérable :

```js
function layersReducer(layers, action) { /* ADD/REMOVE/MOVE/DUPLICATE/SET_ACTIVE/SET_PROP */ }
function modifiersReducer(state, action) { /* ADD/REMOVE/UPDATE/SYNC/CLEAR */ }

function _reduce(state, action) {
  switch (action.type) {
    case 'LOAD_IMAGE': return { ... };
    case 'ADD_LAYER': case 'REMOVE_LAYER': /* ... */:
      return { ...state, layers: layersReducer(state.layers, action) };
    case 'ADD_MODIFIER': /* ... */:
      return { ...state, ...modifiersReducer(state, action) };
    default: return state;
  }
}
```

---

## Ordre de priorité recommandé

```
QW-5  debounce sliders          ← impact immédiat, 30 min
QW-1  extraire luma()           ← trivial, nettoie tout filters.js
QW-2  fix IDs duplicates        ← bug de correction silencieux
QW-7  try/catch runLayerStack   ← debug visibility
QW-3  libérer scratch canvas    ← mémoire
QW-4  unsubscribe pattern       ← future-proof
QW-6  glitch seed déterministe  ← UX visible
──────────────────────────────────────────────────────────────
RF-2  sliding-window blur       ← gain perf majeur (5–20x)
RF-3  palette LUT cache         ← gain perf majeur (~1Md ops évitées)
RF-1  pooler canvas halftone    ← mémoire / allocation
RF-5  vérifier opacity skip     ← vérifier avant de toucher
RF-4  undo par étape            ← feature UX importante
──────────────────────────────────────────────────────────────
AR-2  halftone pixel pur        ← prérequis AR-1
AR-1  Web Worker pipeline       ← éliminer les freezes complets
AR-3  sub-reducers              ← maintenance long terme
```
