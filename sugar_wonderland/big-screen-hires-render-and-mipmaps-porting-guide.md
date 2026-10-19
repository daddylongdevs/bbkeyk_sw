# Big-Screen Support Porting Guide — HiRes Render + Runtime Mipmaps

> **Audience:** an AI (or engineer) porting big-screen support (35"+ TVs, 4K, HiDPI desktops) into a **sibling slot** built on the same Phaser 3 + Spine + TypeScript template (`joker_ace` lineage, `king_in_gold`, and others).
>
> **Sources of truth:**
> - `joker_ace` after the *HiResRender + SpineAtlasMipmaps* work — Phaser **3.90.0**, `@esotericsoftware/spine-phaser-v3` **4.2.x**. Parts A, B, C all applied.
> - `king_in_gold` (`C:\Users\User\Documents\GitHub\king_in_gold`) — Phaser **4.2.1**, `@esotericsoftware/spine-phaser-v4` **4.3.13**. Parts **B + C applied** (2026-09-14) with the Phaser 4 texture path described in **§B.5**; Part A **not applied** (see §A.2 note + §8).
>
> **Do not** copy tuning numbers blindly. Port **behavior**, then re-tune the knobs in §7 for the target game's asset sizes and GPU budget.
>
> **Companion guide:** `docs/fixed-ratio-extended-width-porting-guide.md` — fixed game-world size / two-mode scaling (mobile vs desktop). Read it before touching `MobileViewport.ts` for anything else; §10 of this guide and that guide edit the same function (`refreshGames`).

This guide covers two independent layers that together make a portrait slot look correct and sharp on a large display:

| Layer | Problem it solves | Files (joker_ace) |
|-------|-------------------|-------------------|
| **A. HiRes Render** | Phaser FIT renders at logical size (e.g. 428×926) and CSS-upscales — a ~2.3× stretch on 4K. Everything looks soft. | `src/bootstrap/HiResRender.ts`, `src/game/main.ts`, `src/config/UIPositionConfig.ts` |
| **B. Runtime Mipmaps** | Spine atlases are NPOT and `Linear,Linear`; WebGL1 cannot mipmap them → far-row sparkle/shimmer and texture-cache thrash on heavily minified symbols. | `src/utils/SpineAtlasMipmaps.ts`, `src/game/layout/PerspectiveSymbolLod.ts`, `src/game/components/Background.ts` — king_in_gold: same util (Phaser 4 path), `PerspectiveSymbolLod.ts`, `src/game/components/Symbols.ts`, `src/game/effects/NormalBgCharacterActor.ts` |
| **A→B fallout** | Custom Spine render paths that mix world and screen space break under a zoomed camera. | `src/game/effects/SpineVertexFx.ts` |
| **C. Refresh-loop fix** | `MobileViewport` re-triggered itself from Phaser's RESIZE event forever (~30 % CPU on every device; felt as lag on 4K). Pre-existing, present in siblings. | `src/bootstrap/MobileViewport.ts` (§10) |

Suggested order: **C (refresh loop, §10.2) → B (mipmaps) → A (hi-res) → A-fallout audit → verify matrix → §10.5 perf re-measure**. C first, because any big-screen perf measurement taken while the loop runs is meaningless. B is low-risk and independent. A changes the camera and needs the audit in §4. On **Phaser 4** siblings, the A-fallout pass must include **§A-F.4** (Mask-filter origin sync) whenever reel/menu/sweep code uses `filters.external.addMask` — that bug is invisible on phones and only shows on large R.

---

## 0. Mental model — three sizes, two coordinate spaces

Phaser 3 keeps **three** sizes inside `ScaleManager`. Phaser always ties the first two together; HiRes Render is the act of untying them.

```
┌───────────────────────────────────────────────────────────────────────┐
│ gameSize  (LOGICAL)                                                   │
│   scene.scale.width / height, getSafeArea(), every layout constant   │
│   428–580 × 926  — NEVER changes with HiRes                           │
├───────────────────────────────────────────────────────────────────────┤
│ baseSize  (PHYSICAL)                                                  │
│   canvas.width/height, renderer.width/height, camera viewport,        │
│   Spine SceneRenderer viewport, pointer.x/y                            │
│   Phaser default:  baseSize = gameSize                                │
│   HiRes:           baseSize = gameSize × R                            │
├───────────────────────────────────────────────────────────────────────┤
│ displaySize (CSS)                                                     │
│   canvas.style.width/height — FIT/ENVELOP result inside the parent    │
│   Unchanged by HiRes (computed from gameSize aspect)                   │
└───────────────────────────────────────────────────────────────────────┘

R  =  (displaySize / gameSize) × devicePixelRatio      →  1:1 device pixels
```

Two coordinate spaces follow from this:

| Space | Units | Who lives here |
|-------|-------|----------------|
| **World / logical** | game px (428-wide) | game objects, `scene.scale.*`, safe area, perspective quads, glow/sweep centres, `pointer.worldX/Y`, `camera.displayWidth/Height` |
| **Screen / physical** | canvas px (= world × R) | `camera.width/height/centerX`, `pointer.x/y`, `renderer.width`, vertex positions handed to the GPU, post-FX radii |

Every bug encountered while building this feature was one of the two spaces being used where the other was expected. The audit in §4 is a checklist of exactly those mixes.

---

# Part A — HiRes Render

## A.1 Why the naive approach fails

The usual Phaser advice — "set `width/height` to CSS × DPR and `camera.setZoom(dpr)`" — makes `scene.scale.width` return the **physical** size. `joker_ace` has ~170 direct `scale.width/height` reads across 25 files plus `getSafeArea()` on top of them; every one would double-scale. Not portable.

Phaser 3.90 (and every 3.x since 3.16) still separates `gameSize` from `baseSize` internally — that is what the removed `resolution` config used to drive. Re-deriving `baseSize` ourselves gets DPR rendering **with zero layout changes**.

## A.2 Where Phaser reads which size (verified in 3.90.0 source)

Check these against the target Phaser version before porting. If they match, the approach ports as-is.

| Location | Reads | Notes |
|----------|-------|-------|
| `ScaleManager.width/height` getters | `gameSize` | ✅ layout stays logical |
| `ScaleManager.setGameSize / resize` | sets `baseSize = gameSize`, `canvas.width = baseSize` | we override in `refresh` |
| `ScaleManager.updateScale` (FIT/ENVELOP) | `gameSize` for aspect + `displaySize.fitTo(parent)` | ✅ unaffected by baseSize |
| `ScaleManager.refresh` | `displayScale = baseSize / canvasBounds`; emits `RESIZE(gameSize, baseSize, displaySize, prevW, prevH)` | our hook point |
| `ScaleManager.transformX/Y` | `displayScale` → **pointer.x/y are physical** | see §4 |
| `WebGLRenderer.onResize(gameSize, baseSize)` | `resize(baseSize)` → viewport, projection, scissor | ✅ |
| `CameraManager.onResize` | `cam.setSize(baseSize)` only if cam matched previous gameSize | we re-fix after |
| `CameraManager.boot/start` | `add()` → new main camera at **`scale.width/height` = gameSize** on every scene start | must hook `Scenes.Events.START` |
| `SpinePlugin.onResize` (spine-phaser-v3) | `renderer.width/height` | ✅ physical, consistent |
| `SpineGameObject.renderWebGL` | `GetCalcMatrix(src, camera, parentMatrix)` | ✅ includes camera zoom |
| `GameObjectFactory.text` / `Text` | `style.resolution` default 1 | text needs bump (§A.5) |
| `ScaleManager.boot` | `game.events.once(READY, this.refresh, this)` — captures the **original** function | must re-call refresh on READY |

> **Phaser version note.** In 3.16–3.24 `baseSize = gameSize × resolution` was native; there you can simply set `resolution` in the game config and skip A.3 (still do the camera-origin check in A.4 and the audit in §4). From 3.50 on, use this guide.
>
> **Phaser 4 (verified on 4.2.1 in `king_in_gold`, 2026-09-14).** An earlier revision of this guide claimed Phaser 4 has native DPR rendering (`autoResolution`) and that Part A does not apply. That is **not true for 4.2.1**: `WebGLRenderer.js` still calls `canvas.getContext('webgl', …)` (a **WebGL1** context) and `ScaleManager.js` still has the same `gameSize` / `baseSize` / `displaySize`, `refresh()`, `updateScale()`, `transformX/Y` and unconditional `RESIZE` emission as 3.90 — so the §A.2 table matches and Part A **would** port with the same hooks. Part A was nevertheless **not applied** to `king_in_gold` (the user scoped the work to mipmaps + the refresh loop). Anyone applying it later: re-verify §A.2 against `node_modules/phaser/src/scale/ScaleManager.js` and `CameraManager.js`, then run the §4 audit — Phaser 4 replaced `postFX/preFX` with `Filters` (`Filters Glow`, `Blur`), so the `postFX|preFX` audit row becomes `rg "\.filters\.(internal|external)\.add"`.

## A.3 The hook — `installHiResRender(game)`

File: `src/bootstrap/HiResRender.ts`. Call it **immediately after `new Game(config)`** in `main.ts` (before MobileViewport registration is fine; order doesn't matter because everything routes through `refresh`).

Phaser's `refresh()` is `updateScale() → updateBounds() → displayScale → emit(RESIZE)`. We hook **both** `updateScale` and `refresh`:

```ts
// 1) updateScale: displaySize is current right after Phaser's own updateScale(),
//    so derive R here and resize baseSize/canvas BEFORE updateBounds + RESIZE fan-out.
let pendingState = null;
const originalUpdateScale = scale.updateScale;
scale.updateScale = function (...args) {
	const result = originalUpdateScale.apply(this, args);
	const { r } = computeRenderScale(this);   // §A.6
	const bw = Math.round(this.gameSize.width  * r);
	const bh = Math.round(this.gameSize.height * r);
	if (this.baseSize.width !== bw || this.baseSize.height !== bh) this.baseSize.setSize(bw, bh);
	if (this.canvas.width !== bw || this.canvas.height !== bh) { this.canvas.width = bw; this.canvas.height = bh; } // resets GL drawing buffer
	pendingState = { scale: r, baseWidth: bw, baseHeight: bh, ... };
	return result;
};

// 2) refresh: after Phaser emitted RESIZE (→ renderer.resize(base), CameraManager.onResize,
//    SpinePlugin.onResize) fix cameras + text and publish window.__hiResRender.
const originalRefresh = scale.refresh;
scale.refresh = function (previousWidth?, previousHeight?) {
	pendingState = null;
	const result = originalRefresh.call(this, previousWidth, previousHeight);
	if (pendingState) applyState(game, pendingState);
	return result;
};
game.events.once(Phaser.Core.Events.READY, () => scale.refresh()); // Phaser's own READY refresh bypasses the wrapper
if (scale.canvas) scale.refresh();                                  // game may already have booted synchronously
```

Why wrapping `refresh` is sufficient: `setGameSize`, `resize`, `setParentSize`, window resize, fullscreen enter/leave, orientation change and `MobileViewport`'s FIT↔ENVELOP swaps all end in `this.refresh()` (dynamic dispatch → hits the wrapper). The only static capture is the READY listener, handled above. In Phaser 3.90 `updateScale` is called **only** from `refresh` (verify with `rg "updateScale\(\)" node_modules/phaser/src/scale/ScaleManager.js` on the target version).

> **Do not** call `this.updateScale()` a second time from the `refresh` wrapper to "make displaySize current" (the first shipped version did). `updateScale → updateCenter` writes canvas margins → style recalc, and `refresh` runs far more often than you expect (see §10). In the 4K trace that extra call alone was 0.85 s of 20 s CPU.

## A.4 Camera fix — **origin (0,0) is mandatory**

On every `ScaleManager` refresh and every `Scenes.Events.START`:

```ts
for (const cam of scene.cameras.cameras) {
	if (!managed && !(cam.x === 0 && cam.y === 0 && (isGameSized(cam) || isBaseSized(cam)))) continue;
	cam.setSize(baseW, baseH);
	cam.setOrigin(0, 0);       // ← the important line
	cam.setZoom(R, R);
	cam.setScroll(0, 0);
}
```

Why origin (0,0), not `centerOn()`: Phaser's camera matrix is `T(origin) · S(zoom) · T(-origin)`, and scroll is applied per-object as `x - scrollX × scrollFactorX`. With the default origin 0.5 you need a negative scroll to map world (0,0) → screen (0,0); that scroll is **not applied to `scrollFactor(0)` objects**, so they shift by `origin × (1 − R)`. `joker_ace` has 70+ `setScrollFactor(0)` calls (joker char, HUD, overlays). With origin (0,0) and scroll 0 the matrix is a pure `S(R)` and both scroll factors agree.

Side effects to know: `camera.midPoint` / `worldView` / `centerX` are computed from `width` (physical) and are therefore **not** logical — do not use them for layout (see §4). Phaser does not cull against `worldView` unless you call `camera.cull()`, so rendering is unaffected.

Scene START hook: `CameraManager` registers its own `START` listener in its constructor, so a listener added later runs **after** the new main camera exists and **before** the scene's `create()` — overlay scenes that read camera size in `create()` see the corrected camera.

## A.5 Text resolution

`Phaser.GameObjects.Text` renders to an internal canvas at `style.resolution` (default 1) and is then drawn zoomed by R → soft. Wrap `GameObjectFactory.prototype.text` and `GameObjectCreator.prototype.text`; after the original creates the object, `obj.setResolution(Math.max(obj.style.resolution, R))`. On R change, walk `scene.children.list` recursively (containers) and bump existing `Text` objects. `BitmapText` needs nothing (it's texture-based). Keep any explicit higher `resolution` (e.g. `GAME_PRIMARY_TEXT_RESOLUTION = 2` for stroked text).

## A.6 Choosing R

```ts
cssScale = max(displaySize.width / gameSize.width, displaySize.height / gameSize.height)  // FIT → equal, ENVELOP → larger axis
r = cssScale × clamp(devicePixelRatio, 1, 4)
r = min(r, HI_RES_RENDER_MAX_SCALE)
if (gameW × gameH × r² > HI_RES_RENDER_MAX_CANVAS_PIXELS) r = sqrt(budget / (gameW × gameH))
r = round(r / STEP) × STEP
if (max(innerWidth, innerHeight) < HI_RES_RENDER_MIN_SCREEN_MAX_AXIS_PX) r = 1   // phones stay native
if (r ≤ 1.001) r = 1
```

Fill cost scales with **R²**. Defaults in `joker_ace`: gate 1000 CSS px, cap 2.5, budget 2.6 M px, step 0.25. Resulting R by display: 1080p desktop → 1.25, 1440p → 1.5, 4K TV → 2.25, phone → 1 (gate).

Query overrides: `?renderScale=2` (force), `?hires=0` (disable). Live state: `window.__hiResRender`.

## A.7 When R = 1 nothing changes

`installHiResRender` restores any camera it previously managed (origin 0.5, zoom 1, gameSize) and leaves everything else untouched, so phones run the exact legacy path. This is also the safety net: set `HI_RES_RENDER_ENABLED = false` and the game is bit-identical to before the port.

---

# Part B — Runtime Mipmaps (WebGL1-safe)

## B.1 Why runtime, not export-time

- Phaser 3 creates a **WebGL1** context. `gl.generateMipmap` fails on NPOT textures (`glGenerateMipmap: non-power-of-two texture`).
- Every Spine atlas in this template is NPOT and `filter:Linear,Linear` (symbols 1472–1996², `joker_char_JA` 936², dialogs 1000²).
- Re-exporting is the right long-term fix (see §7) but the runtime path works with assets as-authored and is a no-op once POT assets arrive.

## B.2 The upgrade — `SpineAtlasMipmaps.ts`

Per spine-webgl `GLTexture`:

1. Skip if `tex.__gameVisualMipmapped`.
2. Read the page image (`tex._image`). If WebGL2 or already POT → skip to 4.
3. **Stretch** (not pad) the image onto a `nextPowerOfTwo` canvas and assign `tex._image = canvas`; call `tex.update(true)`. Uniform stretch keeps the atlas's normalized region UVs valid. Cache the canvas per source image (`WeakMap`).
4. `tex.setFilters(minFilter, LINEAR)` — **only after** the texture is POT-capable; this is what prevents the GL error.
5. Anisotropy: `EXT_texture_filter_anisotropic` → `tex.bind()` then `gl.texParameterf(TEXTURE_2D, TEXTURE_MAX_ANISOTROPY_EXT, min(cfg, max))`. Cache the extension per `gl`.
6. Set `page.minFilter/magFilter` so Spine doesn't reset them.

Entry points:

| Function | Use |
|----------|-----|
| `enableMipmapsOnSpineAtlasKeys(scene, keys)` | targeted — pass Spine keys; both `key` and `key-atlas` are probed in the plugin's `atlasCache` |
| `enableMipmapsOnSpineSkeleton(skeleton, scene)` | fallback — upgrades whatever pages the live skeleton's attachments reference |
| `enableMipmapsOnAllSpineAtlases(scene)` | phase-2 sweep for dialogs/buttons; **not wired** by default |

Filter choice (`GAME_VISUAL_MIPMAP_MIN_FILTER`): `'sharp'` = `LINEAR_MIPMAP_NEAREST` (bilinear in level, snaps level — crispest on TVs), `'linear'` = trilinear (softest), `'nearest'` = `NEAREST_MIPMAP_LINEAR` (legacy, can look crunchy). **Anisotropy (default 4)** matters more than the filter for the perspective grid — far rows are viewed obliquely and isotropic mips over-blur one axis.

## B.3 Wiring in joker_ace

- **Symbols:** `PerspectiveSymbolLod.enableSymbolSpineAtlasMipmaps(scene)` builds keys from `getSymbolAssetDefinitions()`, wild variants and `SYMBOL_BACK_CARD_SPINE_KEY`, delegates to the shared util. Called from `PerspectiveSymbolWarper` constructor + `setGrid`, plus `enableMipmapsOnSpineSkeleton` once per warped source as a late-attach fallback. Gated by `SYMBOL_SPINE_MIPMAPS_ENABLED` — **decoupled from the LOD soften flag** (previously mipmaps only ran when soften was on).
- **Joker:** `Background.applyJokerCharMipmaps()` right after `createJokerCharSpine`, gated by `JOKER_CHAR_MIPMAPS_ENABLED`.
- Expected console output: `[PerspectiveLOD] Enabled mipmaps on 24 symbol Spine atlas page(s) (12 atlas key(s) found)` and `[Background] Enabled mipmaps on joker_char_ja (1 page(s))`.

## B.4 What mipmaps do and don't do

Mipmaps only affect **minified** sampling (texture drawn smaller than its source). They remove sparkle/shimmer and reduce texture bandwidth; they never sharpen an upscaled canvas. On a TV without Part A the whole frame is still a CSS stretch — that is why both parts are needed.

## B.5 Phaser 4 + spine-phaser-v4 port (`king_in_gold`, Phaser 4.2.1, spine-phaser-v4 4.3.13)

§B.2 is written against spine-webgl's own `GLTexture` (`tex._image`, `tex.update(true)`, `tex.setFilters`). **spine-phaser-v4 does not use it.** Its atlas pages are `PhaserTexture` objects that wrap a Phaser `TextureSource`; the GL object is Phaser's `WebGLTextureWrapper` (`source.glTexture`). Porting B without knowing this produces a util that silently upgrades nothing (`upgraded 0`).

### B.5.1 What to inspect first in the target `node_modules`

| File | What to confirm |
|------|-----------------|
| `phaser/src/renderer/webgl/WebGLRenderer.js` | `getContext('webgl', …)` → WebGL1 → NPOT cannot mipmap. (If a future 4.x goes WebGL2, the util skips the POT resample automatically via `isWebGL2Context`.) |
| `phaser/src/renderer/webgl/wrappers/WebGLTextureWrapper.js` | `update(source, width, height, flipY, wrapS, wrapT, minFilter, magFilter, format)` re-uploads and re-applies sampler state; `generateMipmap()` only runs when `isMipmap()` and both dims are POT. |
| `@esotericsoftware/spine-phaser-v4/dist/PhaserTexture.js` | `applySamplerState()` calls `texture.generateMipmap()` and `setFilters()` writes `minFilter/magFilter` back onto the wrapper — i.e. Spine can **revert** our filters unless we also set `pageTexture.minFilter/magFilter`. |
| `phaser/src/textures/TextureSource.js` | `image/source`, `width/height`, `isPowerOf2`, `isCanvas`, `glTexture`, `renderer`. |

### B.5.2 The Phaser-backed upgrade (`upgradePhaserBackedSpineTexture`, same util file)

```
src = pageTexture.source                       // TextureSource
skip if src.__gameVisualMipmapped
{potW, potH} = resolvePotSize(src.width, src.height, opts.maxPageSize)   // nextPOT, or floorPOT when > cap
if NPOT (or over cap):
    canvas = resampleToPot(src.image, potW, potH)     // uniform STRETCH, cached per source image
    src.image = src.source = canvas; src.isCanvas = true; src.width/height = pot; src.isPowerOf2 = true
    texture.frames['__BASE'].setSize(potW, potH, 0, 0)  // keep Phaser's base frame covering the page
src.glTexture.update(upload, w, h, src.flipY, CLAMP_TO_EDGE, CLAMP_TO_EDGE, minFilter, LINEAR, format)
renderer.glTextureUnits.bind(glTexture, 0) → texParameterf(TEXTURE_MAX_ANISOTROPY_EXT) → rebind previous unit-0 texture
pageTexture.minFilter = minFilter; pageTexture.magFilter = LINEAR      // so applySamplerState() agrees
flag src + glTexture
```

Rules that differ from the 3.x path:

- **Never call `gl.texParameteri` yourself before `update()`** — the wrapper owns sampler state and `update()` re-applies it; set filters *through* `update()` so the POT upload and the mipmap filter land in one call (otherwise you get the same `glGenerateMipmap: non-power-of-two` error as §B.2 step 4 warns about).
- **Restore texture unit 0** after anisotropy. Phaser 4's `glTextureUnits` tracks bindings; leaving a different texture bound desynchronises the batcher for the next draw.
- `upgradeSpinePageTextureMipmaps(tex, gl, opts)` dispatches: `tex.source`/`tex.phaserTexture` → Phaser path; `tex.setFilters && tex.update` → legacy `GLTexture` path. Keep both so the file is copy-paste portable between 3.x and 4.x siblings.
- Atlas lookup: the plugin caches atlases as `key` **and** `key-atlas`; `enableMipmapsOnSpineAtlasKeys` probes both via `plugin.getAtlas?.(k) ?? plugin.atlasCache?.get?.(k)`.

### B.5.3 `maxPageSize` — the VRAM knob that did not exist in joker_ace

`SpineMipmapOptions.maxPageSize` (0 = round *up* to next POT) lets a page be resampled **down** to `floorPowerOfTwo(cap)` instead of up. Symbol pages of 1504–2047² would otherwise become 2048² (~2.5× VRAM per page). Config: `SYMBOL_SPINE_MIPMAP_MAX_PAGE_SIZE = 1024`, `NORMAL_BG_CHARACTER_MIPMAP_MAX_PAGE_SIZE = 2048` (characters draw near 1× and keep full detail; `2001×1402 → 2048²`).

> In `king_in_gold` the symbol `.webp` pages were already pre-shrunk to ~190×223, so they round **up** to 256² and the 1024 cap is only a guard. Check the real page sizes (`atlas.pages[i].width/height` or the image files) before assuming the cap is doing anything — the first verification pass here chased a "why is it 256² when the cap is 1024" ghost for that reason.

### B.5.4 Wiring in king_in_gold

| Where | Call | Gate |
|-------|------|------|
| `PerspectiveSymbolLod.enableSymbolSpineAtlasMipmaps(scene)` | keys = `getSymbolAssetDefinitions()` + `getWildVariantAssetDefinitions()` + `SYMBOL_BACK_CARD_SPINE_KEY`; settles once `found >= loadable` (counts only keys present in `scene.cache.text` — the back card may be absent in a skin) | `SYMBOL_SPINE_MIPMAPS_ENABLED` + `isBigScreenMipmapsAllowed()` |
| `Symbols.createManagedSpineSymbol` / `createSymbolBackCardSpine` | atlas-key path before `scene.add.spine(...)`, then `enableMipmapsOnSpineSkeleton(spineObj.skeleton, scene)` as late-attach fallback | same |
| `NormalBgCharacterActor.build` → `applyNormalBgCharacterMipmaps(scene, atlasKey, spine, id)` | atlas-key path, skeleton fallback if `upgraded === 0`; player + king share one atlas → idempotent flag makes the second call a no-op | `NORMAL_BG_CHARACTER_MIPMAPS_ENABLED` |

Config block (`UIPositionConfig.ts`): `GAME_VISUAL_MIPMAPS_ENABLED`, `GAME_VISUAL_MIPMAP_MIN_FILTER: 'sharp' \| 'linear' \| 'nearest' = 'sharp'`, `GAME_VISUAL_MIPMAP_ANISOTROPY = 4`, `GAME_VISUAL_MIPMAPS_MIN_SCREEN_MAX_AXIS_PX = 0`, `SYMBOL_SPINE_MIPMAPS_ENABLED`, `SYMBOL_SPINE_MIPMAP_MAX_PAGE_SIZE = 1024`, `NORMAL_BG_CHARACTER_MIPMAPS_ENABLED`, `NORMAL_BG_CHARACTER_MIPMAP_MAX_PAGE_SIZE = 2048`. The Phaser-side soft LOD blur (`SYMBOL_GRID_PERSPECTIVE_LOD_*`, a Phaser 4 `Blur` filter) is independent and stays.

Expected console: `[PerspectiveLOD] Enabled mipmaps on N symbol Spine atlas page(s) (11/12 atlas key(s) found)` and `[NormalBgCharacterActor:player] Enabled mipmaps on NormalBackground_KG… (1 page(s))`; `gl.getError() === 0`.

### B.5.5 Porting checklist for the next Phaser 4 sibling

1. `rg "getContext\('webgl" node_modules/phaser/src/renderer/webgl/WebGLRenderer.js` → WebGL1? If WebGL2, POT resample becomes a no-op but filters/anisotropy still apply.
2. `rg "class PhaserTexture|applySamplerState|setFilters" node_modules/@esotericsoftware/spine-phaser-v4/dist/PhaserTexture.js` → confirm the wrapper shape.
3. Copy `src/utils/SpineAtlasMipmaps.ts` verbatim; adjust only the config imports.
4. Replace stub/`@deprecated` mipmap functions in the sibling's `PerspectiveSymbolLod.ts` (siblings forked after the Phaser 4 move have no-op stubs there with the comment "NPOT Spine atlases can't use Phaser 4 mips") with the delegating versions above.
5. Wire symbol + character creation sites; run the game; confirm the console lines and check page sizes (`§B.5.3`).

---

# Part A-fallout — custom render paths under a zoomed camera

## A-F.1 The bug that shipped first

After Part A the **perspective grid rendered ~R× too large** while joker/HUD were fine (`SpineVertexFx.spineFxRenderWebGL`). Root cause: `GetCalcMatrix(src, camera, parentMatrix).calc` is **camera × world** — its output is *screen* px. That value was fed into `mapWorldPointThroughPerspectiveWarp`, whose source AABB and destination quad are *world* units. At zoom 1 the spaces coincide so it was invisible; at R = 2.5 every vertex landed 2.5× outside the AABB and the projective remap inflated the grid. Glow/sweep/region-glow/ghost passes had the same mix (world-space centres and radii vs. screen-space vertices).

## A-F.2 The fix — split the transform once per render

```ts
const space = resolveFxSpace(calc, camera);   // camera⁻¹ × calc  →  skeleton→WORLD affine
toWorld(vx, vy)  = world affine, then perspective warp (world units)
... all effect math (glow expand, sweep falloff, ghost ±radius) in world ...
const s = space.toScreen(wx, wy);             // camera matrix
vertices[i] = s.x; vertices[i + 1] = s.y;
```

`resolveFxSpace` returns `calc` unchanged with an identity `toScreen` when the camera matrix is identity, so the legacy (R = 1) path is bit-identical. `camera.matrix` is exactly what `GetCalcMatrix` copies, so the inverse is exact.

Bonus: the LOD ghost fringe radius is now in game px and stays a constant visual size at any R.

## A-F.3 How to find the same class of bug in a sibling

```
rg "GetCalcMatrix|camera\.matrix|drawSkeleton\(" src
```

Any code that takes a `calc`/camera-transformed point and then compares or remaps it against world-space state (AABBs, centres, radii, quads) needs the `resolveFxSpace` split.

## A-F.4 Phaser 4 Mask filters drift under HiRes (reel grid + silhouette sweeps) — `bad_beach`, 2026-09-16

**Applies to:** Phaser **4.x** siblings that use `filters.external.addMask(source, invert, cameras.main, 'world')` for reel windows, menu content clips, or Spine silhouette shines (`SpineLightSweep`, etc.). Phaser 3 `GeometryMask` / `BitmapMask` are **not** this bug (the §4 "no change" note for GeometryMask still holds on 3.x).

**Symptom on super-massive / 4K screens (R ≫ 1):** the symbol grid clip window and any Mask-filter light sweep sit offset from the symbols — worse as R grows. At R = 1 (phones / `?hires=0`) everything looks correct.

**Root cause:** Part A sets the managed main camera to **origin (0,0) + zoom R** (§A.4). Phaser 4's `focusFiltersOnCamera(main)` (called every frame when `filtersFocusContext` / context focus is on) copies `width`, `height`, `scroll`, `rotation`, and `zoom` from the scene camera onto the per-object `filterCamera` — but **does not copy `origin`**. Filter cameras keep the default origin **0.5**. That is the same A.4 failure mode applied to the mask FBO: content and mask capture disagree by roughly `origin × (1 − R)`.

World-space masks also need **context focus**. Object focus (`filtersFocusContext = false`) sizes the filter FBO to the GameObject's local bounds at zoom 1, which cannot line up with a zoomed main camera either. Menu content areas that `setSize(...)` are especially prone to silently taking the object-focus path unless you force context focus.

**Fix (two layers — do both when porting Part A to a Phaser 4 sibling):**

1. **Central patch in `HiResRender.ts`** (recommended — covers every Mask filter site):

```ts
// After patchTextFactories(), once per install:
const proto = Phaser.GameObjects.GameObject.prototype;
const original = proto.focusFiltersOnCamera;
proto.focusFiltersOnCamera = function (camera) {
	const result = original.call(this, camera);
	try {
		const fc = this.filterCamera;
		if (fc && camera && typeof fc.setOrigin === 'function') {
			fc.setOrigin(camera.originX, camera.originY);
		}
	} catch {}
	return result;
};
```

2. **At every world-space `addMask(..., cameras.main, 'world')` call site**, before `addMask`:

```ts
target.enableFilters();
target.filtersFocusContext = true;   // camera/world FBO, not object-local
target.filters.external.addMask(maskSource, false, scene.cameras.main, 'world');
```

**Find siblings that need this:**

```
rg "filters\.external\.addMask|addMask\(" src
rg "filtersFocusContext" src
```

Any hit that passes `cameras.main` (or omits the camera and relies on the current view) with a GameObject / Graphics / Spine mask source in **world** space needs both layers. Texture-key masks that already match the filter FBO may be fine, but still benefit from the origin patch if they use context focus.

**`bad_beach` sites fixed:** `Symbols.createContainer` + `applyReelStripMask` (reel window), `SpineLightSweep.applySilhouetteMask` (shine strip), plus the `HiResRender` origin patch. `Menu` content clip already set `filtersFocusContext = true`.

**Alternate (heavier):** replace Filter Masks with Phaser 4.2 stencil layers (see `king_in_gold` `ReelMaskLayer`) — avoids the FBO/origin path entirely, but is a larger port than the two-layer fix above.

---

# 4. Physical-vs-logical audit (do this in every sibling)

Run each search; fix every hit as shown. This list is what had to change in `joker_ace`.

| Search | Wrong (physical) | Right (logical) | joker_ace hits |
|--------|------------------|-----------------|----------------|
| `cameras\.main\.(width\|height)` used for layout/size | `cam.width`, `cam.height` | `cam.displayWidth`, `cam.displayHeight` (= width / zoom) | Water/Box/IntroJa/BonusJa overlay transitions (full-screen dimmers, spine cover scale) |
| `cameras\.main\.(centerX\|centerY\|midPoint)` | `camera.centerX` | `scene.scale.width * 0.5` | `Dialogs.createClickHandler`, `SymbolExplosionTransition` |
| `pointer\.(x\|y)\b` deltas / comparisons | `pointer.y - lastY` | `pointer.worldY - lastY` | `Menu` + `HelpScreen` drag-scroll |
| `getLocalPoint(pointer.x, pointer.y)` | — `getLocalPoint` only compensates **scroll**, not zoom | `getLocalPoint(pointer.worldX, pointer.worldY)` | `Menu` volume sliders |
| `postFX\|preFX\|addBlur\|addGlow` | radii/strength are in physical px → appear R× thinner | multiply by `getHiResRenderScale()` if it matters | only the PNG-mesh LOD blur; accepted |
| `renderer\.(width\|height)`, `canvas\.(width\|height)`, `\.baseSize` | physical | — | none in joker_ace |
| `camera\.(setZoom\|zoomTo\|setBounds\|shake\|pan)` | would fight/override the managed zoom | scope to a non-managed camera or multiply by R | none in joker_ace |
| `scene.textures.addCanvas` / `RenderTexture` snapshots of the screen | physical size | — | none |
| **Phaser 4 only:** `filters\.external\.addMask` / `addMask(` with `cameras.main` + world GameObject mask | filterCamera keeps origin 0.5 while HiRes main is origin (0,0); object-focus FBO at zoom 1 | force `filtersFocusContext = true` + copy origin in `focusFiltersOnCamera` (§A-F.4) | n/a in joker_ace (3.x); **`bad_beach` reel + light sweep** |

Things that need **no** change (verified on Phaser **3.x**): `scene.scale.*`, `getSafeArea`/`getVisibleGameRect`, `setInteractive` hit-testing, `GeometryMask` / `BitmapMask`, containers, tweens, Spine game objects on the normal render path, `MobileViewport`, `FullScreenManager`.

**Phaser 4 caveat:** WebGL ignores GeometryMask/`setMask` — siblings use Filter `addMask` instead. Those **do** need the §A-F.4 audit when Part A is applied; do not treat them as "GeometryMask → no change".

---
# 5. Files touched in joker_ace (diff checklist)

| File | Change |
|------|--------|
| `src/config/UIPositionConfig.ts` | `GAME_VISUAL_MIPMAPS_*`, `SYMBOL_SPINE_MIPMAPS_ENABLED`, `JOKER_CHAR_MIPMAPS_ENABLED`, `HI_RES_RENDER_*` blocks; deprecated `SYMBOL_GRID_PERSPECTIVE_LOD_MIPMAP_MIN_FILTER` |
| `src/bootstrap/HiResRender.ts` | **new** — Part A (hooks `updateScale` + `refresh`; no duplicate `updateScale()` call — §10.3) |
| `src/bootstrap/MobileViewport.ts` | `refreshPassDepth` re-entrancy guard: `onScaleResize` ignores RESIZE emitted by `refreshGames()` itself (§10.2) |
| `src/game/main.ts` | `installHiResRender(game)` after `new Game()`, cleanup registered |
| `src/utils/SpineAtlasMipmaps.ts` | **new/rewritten** — Part B shared impl |
| `src/utils/PhaserTextureMipmaps.ts`, `src/utils/GameVisualMipmaps.ts` | Phaser-image mipmaps + all-sweep; compile but **unwired** (phase 2) |
| `src/game/layout/PerspectiveSymbolLod.ts` | GL code removed; delegates to shared util; mipmaps decoupled from soften flag |
| `src/game/layout/PerspectiveSymbolWarper.ts` | mipmap calls no longer gated by `LOD_ENABLED` |
| `src/game/components/Background.ts` | `applyJokerCharMipmaps()` |
| `src/game/effects/SpineVertexFx.ts` | `resolveFxSpace`, `toScreen` at 5 vertex write sites, `drawAtlasRegionGlowHalos(…, toScreen)` |
| `src/game/scenes/{Water,Box,IntroJa,BonusJa}OverlayTransition.ts` | `cam.width/height` → `displayWidth/displayHeight` |
| `src/game/components/Dialogs.ts`, `SymbolExplosionTransition.ts` | `camera.centerX/width` → `scene.scale.*` |
| `src/game/components/Menu.ts`, `MenuTabs/HelpScreen.ts` | `pointer.y` → `pointer.worldY`; slider `getLocalPoint(worldX, worldY)` |

## 5.1 Files touched in king_in_gold (Phaser 4.2.1 — Parts B + C only, 2026-09-14)

| File | Change |
|------|--------|
| `src/utils/SpineAtlasMipmaps.ts` | **new** — shared impl with both the Phaser-backed (`PhaserTexture`/`TextureSource`/`WebGLTextureWrapper`) path and the legacy `GLTexture` path; `maxPageSize` option (§B.5) |
| `src/game/layout/PerspectiveSymbolLod.ts` | no-op stubs replaced by delegating `enableSymbolSpineAtlasMipmaps` / `enableMipmapsOnSpineSkeleton`; settles on `found >= loadable` |
| `src/game/components/Symbols.ts` | mipmap calls in `createManagedSpineSymbol` + `createSymbolBackCardSpine` |
| `src/game/effects/NormalBgCharacterActor.ts` | `applyNormalBgCharacterMipmaps()` after spine creation |
| `src/config/UIPositionConfig.ts` | `GAME_VISUAL_MIPMAP*`, `SYMBOL_SPINE_MIPMAP*`, `NORMAL_BG_CHARACTER_MIPMAP*` block (§B.5.4) |
| `src/bootstrap/MobileViewport.ts` | §10.2 guard — `refreshInFlight` flag set around `refreshGames()` in `runRefreshPass`; `onScaleResize` returns early while set; `sync()` additionally drops echo RESIZEs (`REFRESH_ECHO_COOLDOWN_MS` after a pass) whose viewport fingerprint is unchanged; `refreshGames` skips a pass entirely when its fingerprint (viewport box + world size + fullscreen) is unchanged |
| *not touched* | `HiResRender.ts` (Part A), `SpineVertexFx.ts` (A-fallout), overlay scenes, `Menu`/`HelpScreen` pointer fixes — all Part-A dependent |

## 5.2 Files touched in bad_beach (Phaser 4.2.1 — Parts A + B + C + A-F.4, 2026-09-16)

| File | Change |
|------|--------|
| `src/config/UIPositionConfig.ts` | **new** — `GAME_VISUAL_MIPMAP*`, `SYMBOL_SPINE_MIPMAP*`, `HEADER_CHAR_MIPMAP*`, `HI_RES_RENDER_*` |
| `src/bootstrap/HiResRender.ts` | **new** — Part A + §A-F.4 `focusFiltersOnCamera` origin sync patch |
| `src/bootstrap/MobileViewport.ts` | §10.2 Phaser 4 variant (`refreshInFlight` + fingerprint echo guards) |
| `src/utils/SpineAtlasMipmaps.ts` | **new** — §B.5 Phaser-backed path (from `king_in_gold`) |
| `src/game/layout/SymbolSpineMipmaps.ts` | **new** — symbol + header-char wiring helpers |
| `src/game/main.ts` | `installHiResRender(game)` after create |
| `src/game/symbols/Symbols.ts` | mipmap wiring; `filtersFocusContext = true` on reel Mask filters (§A-F.4) |
| `src/game/effects/SpineLightSweep.ts` | `filtersFocusContext = true` on silhouette Mask (§A-F.4) |
| `src/game/components/Header.ts` | `applyHeaderCharMipmaps` after char spine create |
| `src/game/components/Menu.ts`, `MenuTabs/HelpScreen.ts` | `pointer.worldX/Y` / slider `getLocalPoint(world…)` |
| `src/game/components/BuyFeature.ts` | `cameras.main.width/height` → `scene.scale.*` |

---

# 6. Verify matrix

Headless verification used Chrome via the DevTools protocol (`--headless=new --window-size=W,H --force-device-scale-factor=DPR`, `?demo=true&forceDesktop=1`, click Press-to-Play by mapping the button's logical position through the canvas rect). Reproduce manually or with the same script.

| Viewport | Expect |
|----------|--------|
| 1200×2160 @ dpr 1 (4K portrait TV) | `[HiResRender] scale=2.25 … canvas=963×2084 game=428×926`; `canvas.width` ≈ `canvas.clientWidth × dpr`; every active scene camera `viewport=963×2084 zoom=2.25 origin=0 scroll=0 display=428×926`; Text `style.resolution` = 2.25; click on logical button position advances Press-to-Play; grid proportions identical to phone layout; `gl.getError() === 0`; 0 exceptions |
| 390×844 @ dpr 3 (phone) | `scale=1.00 (screen … < 1000px gate)`; cameras untouched (`origin=0.5 zoom=1`); identical to pre-port |
| `?renderScale=2` on a phone | forces 2×; use to eyeball input/layout on a small device |
| `?hires=0` on a TV | back to CSS stretch — A/B the sharpness |
| Fullscreen toggle / window resize | one `[HiResRender]` log per R change; no layout jump; scroll/slider drag speed unchanged |
| Menu → Help scroll, volume sliders | drag tracks finger 1:1 at any R (world-space pointer fix) |
| Console | `Enabled mipmaps on 24 symbol Spine atlas page(s)` and `… joker_char_ja (1 page(s))`; no `glGenerateMipmap` errors |
| Win presentation | glow/sweep/region glow centred on the card (world-space fx fix) |

**king_in_gold (Parts B + C only) — what was checked on 2026-09-14** using the Cursor in-IDE browser + CDP (`Runtime.evaluate`, `Emulation.setDeviceMetricsOverride`), `http://localhost:8080/?demo=true`:

| Check | Result |
|-------|--------|
| Console after Preloader → Game | `[PerspectiveLOD] Enabled mipmaps on … symbol Spine atlas page(s) (11/12 atlas key(s) found)` (back card not loaded in this skin), `[NormalBgCharacterActor:*] Enabled mipmaps on NormalBackground_KG… (1 page(s))`; no `glGenerateMipmap` errors; `gl.getError() === 0` |
| Page sizes after upgrade | symbol pages 256² (source ~190×223, rounded up), character 2048² (source 2001×1402) |
| §10.5 in-page RESIZE counter, idle | **0** in 5 s (Preloader and Game) |
| Synthetic resize | finite burst, then 0 |
| Spin + tumble win | no exceptions, symbols/characters render without corruption |

---

# 7. Tuning + the asset-size standard

## 7.1 Performance knobs

| Knob | Default | Lower it when… |
|------|---------|----------------|
| `HI_RES_RENDER_MAX_CANVAS_PIXELS` | 2 600 000 | TV boxes / iGPUs stutter at 4K. Fill cost ∝ R². |
| `HI_RES_RENDER_MAX_SCALE` | 2.5 | you never want more than N× oversampling |
| `HI_RES_RENDER_MIN_SCREEN_MAX_AXIS_PX` | 1000 | (raise) to exclude tablets |
| `GAME_VISUAL_MIPMAP_ANISOTROPY` | 4 | old mobile GPUs; 0 disables |
| `GAME_VISUAL_MIPMAPS_MIN_SCREEN_MAX_AXIS_PX` | 0 (always) | to save VRAM on small phones |

## 7.2 GPU texture memory — the real cause of "2K lags"

The canvas stays at game size under FIT, so pixel count is not what makes 2K displays lag; **texture memory on iGPUs** is. In `joker_ace`: 25 symbol pages at 1472–1996² = **223 MB raw**, **517 MB** after POT-stretch (1504 → 2048 is 1.85×) + mips. Symbol skeletons are authored at ~1150×1491 for a cell that draws at ~84×94 game px — **~14× oversized**.

## 7.3 Standard sizes for sibling games

Rule: **source px = max on-screen size in game px × 2**, never > 3×; export pages at **exact POT** (no runtime stretch) with `filter: MipMap,Linear` so Spine mipmaps natively and the runtime path becomes a no-op.

| Asset | On-screen (game px) | Author at | Page | Spine export scale (from joker_ace source) |
|-------|---------------------|-----------|------|--------------------------------------------|
| Grid symbols | ~84×94, ~110×125 on win pop | ~230×300 skeleton | **1 × 512²** (1024² if many parts) | **0.20–0.25** |
| Back card | as symbols | ~230×300 | 512² | 0.20 |
| Seated character (`joker_char`) | ~full canvas height | 1× game px (current) | **1024²** exact | 1.0, repack POT |
| Full-screen dialogs/overlays | canvas | 1×–1.5× | 1024²/2048² exact | — |

With that, symbols drop from 223 MB → ~15–50 MB and the startup POT re-upload hitch disappears.

---

# 8. Porting to other Phaser versions — quick decision table

| Phaser | What to do |
|--------|------------|
| 3.16 – 3.24 | Native `resolution` config drives `baseSize = gameSize × resolution`. Set it from the §A.6 formula on boot; still apply **A.4 camera origin (0,0)**, **A.5 text**, **§4 audit**, **A-F** if you have custom Spine render callbacks. |
| 3.50 – 3.90 | This guide verbatim. Re-verify §A.2 table lines against the target minor version (`ScaleManager.refresh`, `CameraManager.onResize/start`, `GetCalcMatrix`). |
| 3.9x newer than 3.90 | Same; diff `ScaleManager.js` for any new `baseSize` writer and add it to the wrapper if it bypasses `refresh`. |
| Phaser 4.2.1 (`king_in_gold`) | **Still WebGL1, no native DPR** (verified — see §A.2 note). Part B: use the **§B.5 Phaser-backed texture path** (`TextureSource` + `WebGLTextureWrapper.update`), not the `GLTexture` path. Part C: identical (`ScaleManager.refresh` still emits RESIZE unconditionally). Part A: not yet ported there; the §A.2 hook points exist unchanged, but re-audit §4 with `Filters` instead of `postFX`, and **must** apply **§A-F.4** (Mask-filter origin sync) wherever `filters.external.addMask` + world GameObject masks exist. |
| Phaser 4.2.1 (`bad_beach`, 2026-09-16) | Parts **A + B + C + A-F.4** applied. Same WebGL1 / ScaleManager story as `king_in_gold`. Reel Mask filters + `SpineLightSweep` required the §A-F.4 origin patch — expect the same on any Phaser 4 sibling that clips the grid or shines with `addMask(..., cameras.main, 'world')`. |
| Phaser 4.x newer than 4.2.1 | Re-check `WebGLRenderer.js` for `getContext('webgl2'` — if WebGL2, the POT resample in B becomes unnecessary (the util detects it) but filters/anisotropy still need applying, and Spine's `Linear,Linear` atlases still need the mip filter. Re-check `ScaleManager.js` for a native resolution/DPR option before porting A. |
| spine-phaser (4.1) vs spine-phaser-v3 (4.2) | Both size the Spine `SceneRenderer` from `renderer.width/height` and use `GetCalcMatrix` → no change. Verify `plugin.getAtlas(key)` / `atlasCache` names for Part B key probing. |
| spine-phaser-v4 (4.3.x) | Atlas pages are `PhaserTexture` wrappers around Phaser textures — **§B.5**. `plugin.getAtlas(key)` and `key-atlas` probing unchanged. `applySamplerState()` will re-apply `pageTexture.minFilter/magFilter`, so set those too. |
| Canvas renderer | Not supported by this guide (mipmaps are WebGL; `CanvasRenderer.onResize` would need the same baseSize logic). |

---

# 9. Failure signatures → cause

| Symptom | Cause | Fix |
|---------|-------|-----|
| Whole game renders small in the top-left at R > 1 | a scene's main camera wasn't re-fixed after `CameraManager.start` | ensure `Scenes.Events.START` hook is attached to every scene (`hookAllScenes`) |
| `scrollFactor(0)` objects (HUD/joker) shifted, rest fine | camera centred via `centerOn()`/scroll instead of origin (0,0) | A.4 |
| Perspective grid / warped spines R× too big | world-space warp fed screen-space points | A-F.2 |
| Win glow off-centre, sweep band in wrong place | same world/screen mix in fx passes | A-F.2 |
| **Reel grid mask / silhouette light-sweep offset on big screens only (Phaser 4); worse as R grows; fine at R = 1** | Filter `addMask` `filterCamera` keeps origin 0.5 while HiRes main is origin (0,0); and/or object-focus FBO instead of context focus | **§A-F.4** — patch `focusFiltersOnCamera` origin sync + `filtersFocusContext = true` at world-space `addMask` sites |
| Full-screen dimmer/overlay covers only 1/R of the screen or overshoots | `cam.width/height` used as world size | `displayWidth/Height` |
| Drag scroll R× too fast; slider jumps | `pointer.x/y` are physical | `pointer.worldX/Y` |
| Text soft while sprites are sharp | `Text.resolution` still 1 | A.5 |
| `glGenerateMipmap: non-power-of-two texture` | `setFilters` before POT upload | B.2 step order (3.x) / pass filters through `WebGLTextureWrapper.update()` in one call (4.x, §B.5.2) |
| Util runs, logs `upgraded 0`, no errors (Phaser 4) | pages are `PhaserTexture`, not spine-webgl `GLTexture`; the legacy path finds no `setFilters` | §B.5 Phaser-backed path |
| Mipmaps visibly "switch off" after a while (Phaser 4) | Spine `applySamplerState()` re-applied the page's `Linear,Linear` | set `pageTexture.minFilter/magFilter` too (§B.5.2) |
| Symbol pages end up 256² "although the cap is 1024" | source pages were already small; the cap only bounds *upward* rounding | not a bug — check `atlas.pages[i].width/height` (§B.5.3) |
| Still soft on TV after mipmaps | canvas is still CSS-stretched | Part A is required; check `window.__hiResRender.scale` |
| Sharp but game stutters on TV box | R² fill cost / 500 MB textures | lower `MAX_CANVAS_PIXELS`; re-export assets per §7.3 |
| Stutter on a big screen, GPU thread mostly idle, `TimerFire` ≫ `FireAnimationFrame` in a trace, `setTimeout(…, 4)` storms | perpetual `MobileViewport` refresh loop (Scale RESIZE → `sync` → re-arm timers → pass → RESIZE …) | §10.2 re-entrancy guard; verify `resizesPerSec === 0` at idle (§10.5) |
| Dev-server edits "don't take effect" during verification | another sibling's Vite grabbed `:8080`; this project moved to `:8081` | check `Get-NetTCPConnection -LocalPort 8080/8081` → process command line before trusting a measurement |

---

# 10. Performance investigation — the "lag on a big screen" trace (2026-09-09)

This section records exactly what was measured and changed after the user reported lag while playing on a 4K portrait display with HiRes Render at 2.25×. **Read it before tuning `HI_RES_RENDER_*` downward** — the lag was not the GPU.

## 10.1 Trace facts (Chrome DevTools performance trace, 26.7 s, Phaser 3.90, joker_ace on `localhost:8081`)

| Metric | Value | Meaning |
|--------|-------|---------|
| Main-thread busy | 13.1 s of 26.7 s (49 %) | CPU-bound on the renderer main thread |
| GPU process busy (`GPUTask`) | 2.0 s of 26.7 s | GPU had ~90 % headroom; the 963×2084 canvas was **not** the bottleneck |
| Frames presented | 2 200, 0 dropped by the compositor | jank came from main-thread task scheduling, not from presentation |
| rAF handler (Phaser `step` + render) | avg **2.0 ms**, 87 % < 4 ms, 3.9 s total | the game itself is cheap at R = 2.25 |
| rAF intervals > 18 ms | 154 of 2 269 (7 %) + 9 > 35 ms | the visible stutter |
| `TimerFire` tasks | **2 384**, avg 2.8 ms, 6.7 s total | ~90 timers/s doing something heavy |
| `TimerInstall` | 33 262 (≈ 1 250/s); 4 849 each of 60/160/320/640/1000 ms, 4 491 of **4 ms** | the 4 ms bucket = Chrome clamping nested `setTimeout(…, 0)` → a chained loop |
| `MobileViewport.runRefreshPass` inclusive | **6.6 s (33 % of sampled CPU)** | the loop body |
| `HiResRender.wrappedRefresh` inclusive | 5.1 s, of which extra `updateScale()` = 0.85 s | our wrapper sits inside the loop |
| `getBoundingClientRect` / `set hidden` / `clearTimeout` / `setTimeout` self | 1.1 s / 2.0 s / 1.5 s / 1.0 s | forced layout + DOM toggles + timer churn per pass |
| Style recalc + layout (`UpdateLayoutTree`, `Layout`) | 1.5 s; 10 767 `ScheduleStyleRecalculation` | each pass writes html/body/canvas styles and toggles `gate.hidden` |
| Body CSS background repaint | 70 × in a 2 s hitch window, 1646×926 image painted at 3685 px tall | why the loop *feels* worse on a 4K screen than on a phone |
| GC | 5 274 events, 1.8 s | allocation pressure from state objects / CustomEvents per pass |
| Texture upload (`texImage2D`) | 0.24 s total | mipmap POT-stretch cost is negligible |
| One-off 403 ms task at 9.0 s | `Game.create` (scene boot) | expected startup hitch, not the reported lag |

## 10.2 Root cause — a self-sustaining refresh loop in `MobileViewport.ts` (pre-existing)

```
sync()  →  scheduleRefresh()  →  clearRefreshTimers(); arm timers [0, 60, 160, 320, 640, 1000] ms
   ▲                                       │
   │                                       ▼ (0 ms fires)
   │                                runRefreshPass()
   │                                  getViewportState()      // getBoundingClientRect, matchMedia
   │                                  applyViewportShell()    // html/body/root style writes
   │                                  setGate()               // gate.hidden toggle
   │                                  refreshGames()
   │                                    scale.setParentSize() → Phaser refresh() → emit RESIZE ─┐
   │                                    scale.refresh()       → emit RESIZE ────────────────────┤
   └────────────────── onScaleResize() ◄─────────────────────────────────────────────────────────┘
```

Phaser's `ScaleManager.refresh()` emits `RESIZE` **unconditionally**. `onScaleResize` called `sync()` unconditionally. So every pass cleared the pending 60…1000 ms timers, re-armed all six, and the 0 ms one fired again ~4 ms later — forever, from boot until page unload, on **every** device. Consequences:

- ~120 passes/s, 240 RESIZE events/s, ~30 % of main-thread CPU, on phones too (battery).
- The intended settle cascade (60…1000 ms) **never fired**; only the 0 ms step ever ran.
- `Symbols.scaleResizeHandler`'s 80 ms debounce was re-cleared every 4 ms, so `refreshSymbolLayout('scale_resize')` never ran during the loop.
- Every RESIZE listener (`Symbols`, `Background`, `Menu`, `FullScreenManager`, `ComboHud`, `WinTracker`, Spine plugin, our HiRes wrapper) ran 240×/s.

It predates HiRes Render (file last changed 2026-08-14 upstream) and existed identically in **`king_in_gold`** (fixed 2026-09-14 — see the variant below) and probably every sibling forked from this template. Big screens exposed it because each pass now also re-styles a 4K-tall body/background and the frame budget is tighter.

**Fix (this repo):**

```ts
let refreshPassDepth = 0;                       // module scope

const refreshGames = () => registeredGames.forEach((entry) => {
	refreshPassDepth += 1;
	try {
		applyViewportScaleMode(entry);
		scale.setParentSize(bounds.width, bounds.height);
		/* canvas styles */
		entry.game.scale?.refresh?.();
	} finally {
		refreshPassDepth -= 1;
	}
});

const onScaleResize = () => {
	if (refreshPassDepth > 0) return;           // RESIZE we caused ourselves — pass already applied shell/gate
	sync();
};
```

Only the feedback edge is removed. External triggers (window `resize`, orientation, visualViewport, fullscreen enter/leave, ResizeObserver, `setDesktopUi`, …) still call `sync()`, and each `sync()` still runs the full 0/60/160/320/640/1000 ms cascade — which now actually completes and then stops.

**Variant applied in `king_in_gold` (Phaser 4.2.1):** same idea, three layers, because Phaser 4's RESIZE can also arrive one task *after* our pass (async echo):

```ts
let refreshInFlight = false;                       // set in runRefreshPass around refreshGames()
let lastRefreshPassAt = 0;                         // nowMs() after each pass
const REFRESH_ECHO_COOLDOWN_MS = …;

const onScaleResize = () => { if (refreshInFlight) return; sync(); };     // layer 1: synchronous echo

// layer 2, inside sync(): an echo (in-flight or within the cooldown) whose viewport fingerprint
// (w,h,left,top,landscape,gateOpen) equals the last scheduled one does NOT re-arm the ladder.
const isEcho = refreshInFlight || nowMs() - lastRefreshPassAt < REFRESH_ECHO_COOLDOWN_MS;
if (isEcho && fingerprint === lastScheduledFingerprint) return;

// layer 3, inside refreshGames(): per-game fingerprint (viewport box, world size, fullscreen);
// unchanged → skip setParentSize/refresh entirely, so Phaser emits nothing.
```

The ladder `[0, 60, 160, 320, 640, 1000]` is intentional and must stay; only `visualViewport` **scroll** is debounced, resize/orientation call `sync()` immediately (see the `.cursor/rules` guardrails in that repo).

## 10.3 Secondary fix — HiRes wrapper cost

`wrappedRefresh` called `this.updateScale()` before delegating to Phaser's `refresh` (which calls it again). Replaced by hooking `updateScale` itself (§A.3). Removes one `updateCenter` margin write + style recalc per refresh. Small (4 % CPU) but it multiplied with the loop and is the only HiRes-specific CPU cost per refresh.

## 10.4 What was *not* the problem (so nobody "fixes" it)

- **R² fill cost.** GPU thread 8 % busy at R = 2.25 on the user's machine. Only lower `HI_RES_RENDER_MAX_CANVAS_PIXELS` if a trace shows the GPU process or `DrawingBuffer::prepareMailbox` saturating. (Headless SwiftShader numbers are software rasterization and *not* evidence: there `hires=0` ran 8.6 fps vs 2.9 fps at 2.25×.)
- **Mipmap POT stretch / texImage2D.** 0.24 s total, at scene start only.
- **Spine drawing.** `drawSkeleton` 0.73 s + `spineFxRenderWebGL` 0.46 s over 26 s — fine.
- **Text resolution bumps.** Only on R change; not visible in the profile.

## 10.5 How to re-measure (do this in every sibling after porting)

1. **Chrome DevTools → Performance**, record 20–30 s of normal play at the target screen size, save as `.json.gz`. Decompress and run a Trace-Event script (or load in DevTools) and check, in this order: `TimerFire` count vs `FireAnimationFrame` count (should be far fewer), `TimerInstall` timeout histogram (a large **4 ms** bucket means a nested-timer loop), inclusive time of `runRefreshPass` / `wrappedRefresh` (should be ≈ 0 at idle), GPU process busy %.
2. **In-page quick check** (paste in console, any device):
   ```js
   (() => { let n = 0; const sm = window.phaserGame.scale; const h = () => n++; sm.on('resize', h);
     setTimeout(() => { sm.off('resize', h); console.log('Scale RESIZE events in 5 s:', n); }, 5000); })();
   ```
   Expect **0** at idle. After a window resize expect a finite burst (measured here: 14 events over 1.1 s = 6 passes × 2 + Phaser's own) and then 0 again.
3. **Headless regression check** (what was used here): Chrome `--headless=new --window-size=1200,2160 --force-device-scale-factor=1`, raw CDP `Runtime.evaluate`, count RESIZE events + `setTimeout` calls/s + rAF gap P50/P95 for 5 s in Preloader and again in the Game scene; then `Emulation.setDeviceMetricsOverride` to a new size and confirm the burst settles. Results after the fixes: `resizesPerSec 0`, `setTimeoutPerSec 0`, cameras `963×2084 zoom 2.25 origin 0 display 428×926`, `[HiResRender] scale=2.25 (auto)`.
4. **Port-check for siblings:** `rg -n "onScaleResize|scale\?\.on\?\.\('resize'" src/bootstrap/MobileViewport.ts` — if the handler calls `sync()` unconditionally and `refreshGames()` calls `setParentSize`/`refresh`, the loop is present.
