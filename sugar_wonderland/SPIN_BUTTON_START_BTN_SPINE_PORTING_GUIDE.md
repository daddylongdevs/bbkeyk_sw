# Spin Button — `start_btn_spine` + Free-Round Stack (Porting Guide)

**Reference game:** `sugar_wonderland`  
**Date:** 2026-09-16  
**Audience:** AI agents / engineers porting an older `spin_bg` / Image-hit spin button to this stack.

This document describes the **canonical spin-button architecture** after retiring flat `spin_bg.png` as the main disc. Copy assets from this game, then wire code the same way. Do **not** invent a new hit-proxy Image or call `setTexture('spin')` on the rotating icon.

---

## 1. Goal (what “done” looks like)

| Mode | Disc | Press FX | Overlay | Hit |
|------|------|----------|---------|-----|
| **Normal play** | Spine idle disc (`start_btn_spine` @ keyframe 0) | Full `"animation"` on the same spine | Rotating `spin_icon.png` | Invisible Phaser `Zone` |
| **Init free-round spins only** | `freeround_bg.png` | `Button_Bonus_Buttom` spine (`Button_Bonus_Bottom`) | Same `spin_icon` (still rotates) | Same `Zone` |

- Spam-clicks must **not** restart/cut the press FX: once started, it plays to the end, then returns to idle (normal) or hides VFX (free-round).
- Space hotkey / pointer both go through the same activation path; visual feedback is separate from bet logic.

---

## 2. Pull these assets (source of truth)

Copy from **this repo** into the target game’s `public/` (or equivalent static root). Prefer **portrait/high** as the loaded set unless the target game already splits low/high the same way.

### 2.1 Normal spin button (required)

| File | Source path in `sugar_wonderland` |
|------|-----------------------------------|
| Atlas | `public/assets/controller/portrait/high/spin_button_anim/start_btn_spine.atlas` |
| Skeleton JSON | `public/assets/controller/portrait/high/spin_button_anim/start_btn_spine.json` |
| Atlas page | `public/assets/controller/portrait/high/spin_button_anim/start_btn_spine.webp` |
| Spin arrows overlay | `public/assets/controller/portrait/high/spin_icon.png` (and low twin if you ship dual quality) |
| Autoplay / skip overlay | `public/assets/controller/portrait/high/autoplay_stop_icon.png` |

**Spine notes**

- Skeleton animation name: **`animation`** (idle = play once, freeze at track time `0`, `timeScale = 0`).
- Atlas regions include disc (`Button`), particles, additive saber — all in one spine. There is **no** separate `spin_bg` for normal mode.
- Atlas `scale: 0.5` — runtime scale is usually small (`assetScale × ~0.2`); tune via config (below).

### 2.2 Free-round spin button (required if the game uses init free rounds)

| File | Source path in `sugar_wonderland` |
|------|-----------------------------------|
| FR disc PNG | `public/assets/controller/portrait/high/freeround_bg.png` |
| FR VFX atlas | `public/assets/controller/portrait/high/Button_Bonus_Buttom/Button_Bonus_VFX.atlas` |
| FR VFX JSON | `public/assets/controller/portrait/high/Button_Bonus_Buttom/Button_Bonus_VFX.json` |
| FR VFX page | `public/assets/controller/portrait/high/Button_Bonus_Buttom/Button_Bonus_VFX.webp` |

**Spine notes**

- Folder name is intentionally `Button_Bonus_Buttom` (typo preserved — match paths).
- Animation name: **`Button_Bonus_Bottom`**.
- Idle look = `freeround_bg` Image only; VFX spine stays **hidden** until press, then hides again on complete.

### 2.3 Retired / do not use for the main disc

| Asset / key | Status |
|-------------|--------|
| `spin_bg.png` | **Retired** as the clickable/visible disc (may still exist on disk; do not load for spin). |
| Texture key `spin` | **Do not** `setTexture('spin')` on overlays — often unloaded → Phaser silent `__MISSING`. |
| Generated `spin_hit_area` / `__WHITE` Image hit proxy | **Do not** — use `Zone` instead. |
| Alpha `0` Image as hit target | **Do not** — Phaser skips input when `willRender` is false (`alpha === 0`). |

---

## 3. AssetConfig registration (copy pattern)

Reference: `sugar_wonderland/src/config/AssetConfig.ts` (controller / button group).

```ts
// Images
'spin_icon': `assets/controller/${screenMode}/${quality}/spin_icon.png`,
'autoplay_stop_icon': `assets/controller/portrait/high/autoplay_stop_icon.png`, // high-only OK
'freeround_bg': `assets/controller/portrait/high/freeround_bg.png`,
// DO NOT register spin_bg for the spin button anymore.

// Spine
'spin_button_animation': {
  atlas: `assets/controller/portrait/high/spin_button_anim/start_btn_spine.atlas`,
  json:  `assets/controller/portrait/high/spin_button_anim/start_btn_spine.json`,
},
'fr_spin_button_animation': {
  atlas: `assets/controller/portrait/high/Button_Bonus_Buttom/Button_Bonus_VFX.atlas`,
  json:  `assets/controller/portrait/high/Button_Bonus_Buttom/Button_Bonus_VFX.json`,
},
```

Loader keys used at runtime:

| Logical role | Phaser / cache key |
|--------------|--------------------|
| Normal spine | `spin_button_animation` + atlas `spin_button_animation-atlas` |
| FR VFX spine | `fr_spin_button_animation` + atlas `fr_spin_button_animation-atlas` |
| FR disc | texture `freeround_bg` |
| Overlay | texture `spin_icon` |

---

## 4. Runtime stack (draw / input order)

Shared **anchor** = center of the spin control (same X/Y for disc, overlays, Zone).

```
[back]  start_btn_spine     OR  freeround_bg          (mode-dependent; only one disc visible)
        Button_Bonus VFX        (FR press only; hidden when idle)
        spin_icon               (idle rotate tween)
        autoplay_stop_icon      (autoplay / manual skip; usually hidden)
[front] Zone hit                (non-rendering, always on top for clicks)
```

**Layout / scale knobs** live in `src/config/UIPositionConfig.ts`:

| Constant | Purpose | Reference default |
|----------|---------|-------------------|
| `SPIN_BUTTON_SPINE_SCALE_MODIFIER` | `start_btn_spine` scale × `assetScale` | `0.2` |
| `SPIN_BUTTON_SPINE_OFFSET_X/Y` | Fine position after bounds-center | game-tuned |
| `SPIN_BUTTON_HIT_SIZE` | Zone width/height before `assetScale` | `160` |
| `SPIN_ICON_OFFSET_X/Y` | Overlay nudge | `0` |
| `FREEROUND_SPIN_DISC_SCALE_MODIFIER` | `freeround_bg` | `1.2` |
| `FREEROUND_SPIN_VFX_SCALE_MODIFIER` | Button_Bonus spine | `1.2` |
| `FREEROUND_SPIN_DISC_OFFSET_X/Y` | FR disc nudge | `0` |

---

## 5. Code ownership (where to change)

### 5.1 `SlotController` (primary)

Reference: `sugar_wonderland/src/game/components/SlotController.ts`

Implement / port these behaviors:

1. **`spinHitZone`** — `scene.add.zone(...).setInteractive({ useHandCursor: true })`. Never an Image.
2. **`spinIcon` + idle angle tween** — only create when `textures.exists('spin_icon')` and usable (not `__MISSING`). Never create early and leave a green placeholder rotating.
3. **`createSpinButtonAnimation`** — `scene.add.spine(..., 'spin_button_animation', 'spin_button_animation-atlas')`, then `setStartBtnSpineIdle` (freeze `"animation"` at t=0).
4. **`ensureFreeRoundSpinDisc`** — Image `freeround_bg`, hidden until FR mode.
5. **`freeRoundSpinButtonAnimation`** — FR spine, scale via `FREEROUND_SPIN_VFX_SCALE_MODIFIER`, hidden until press.
6. **`setFreeRoundSpinButtonVisuals(active: boolean)`** — public API for FreeRoundManager:
   - `true`: hide `start_btn_spine`, show `freeround_bg`, keep icon, hide FR VFX until click.
   - `false`: hide FR disc/VFX, restore `start_btn_spine` idle.
7. **`playSpinButtonAnimation`**:
   - Normal → play `"animation"` on `start_btn_spine`.
   - FR → play `"Button_Bonus_Bottom"` on FR spine; keep `freeround_bg` visible under it.
   - **`spinButtonPressPlaying` lock:** if already playing, **return** (no `setAnimation` restart). Clear lock on `complete` (+ short safety timeout).
   - Clamp `trackEntry.animationEnd = duration - 0.01` to avoid end-frame snap (same idea as Button_Bonus).
8. **`getSpinButton()`** — may return the **`spin_icon` overlay** for position / legacy callers. Document that callers must **not** apply disc textures to it.
9. **`getSpinIcon()` / `getAutoplayStopIcon()`** — required by FreeRoundManager port.

### 5.2 `FreeRoundManager` (shared `@core`)

Reference: `minium/core/FreeRoundManager/`

- Prefer **`slotController.setFreeRoundSpinButtonVisuals?.(true|false)`** in `enableFreeSpinMode` / `disableFreeSpinMode` (and immediately when init FR is active).
- **Do not** `spinButton.setTexture('spin' | 'freeround_bg')` when `getSpinButton()` is the icon overlay — Phaser `textures.get(missingKey)` **silently returns `__MISSING`** (green box), with **no throw**.
- Guard legacy disc retexture: only if the button Image is a real disc and `textures.exists(key)`.
- Port interface: `FreeRoundSlotControllerPort.setFreeRoundSpinButtonVisuals?(active: boolean)`.

See also: `core/FreeRoundManager/IMPLEMENTATION.md`.

### 5.3 `Game.ts`

Create FreeRoundManager **after** `SlotController.create`. When init data has free rounds, FR visuals can turn on before the reward panel delay.

---

## 6. Critical Phaser pitfalls (agents hit these often)

1. **Silent `__MISSING`**  
   `scene.textures.get('spin')` / `image.setTexture('spin')` when key is unloaded → green placeholder, **no console error**. Always `textures.exists(key)` before `setTexture` / `add.image`.

2. **Alpha-0 Image is not clickable**  
   Phaser input uses `willRender`; `alpha === 0` skips hits. Use **`Zone`**, not invisible Images.

3. **Creating `add.image(x,y,'spin_icon')` before load**  
   Binds `__MISSING` permanently until `setTexture` repair. Create-when-ready or retry.

4. **FreeRoundManager + `getSpinButton()`**  
   If `buttons.set('spin', spinIcon)`, FR `setTexture('spin')` on disable **corrupts the rotating icon**. Fix visuals via `setFreeRoundSpinButtonVisuals`, not disc keys on the icon.

5. **Spam restart**  
   Idle pose also uses track `"animation"` at t=0 with `timeScale = 0`. Do **not** detect “already playing” only via track time — use an explicit `spinButtonPressPlaying` boolean.

6. **Stale `complete` listeners**  
   Multiple `addListener(complete → setStartBtnSpineIdle)` from spam can freeze a new play. One listener + token, or lock so spam never calls `setAnimation` again mid-play.

7. **`spin_icon` idle rotation stalls (`angle: 360`)** — *thats_bait, 2026-09-17*  
   Idle tween **must** use relative `angle: '+=360'` with `repeat: -1`. Absolute `angle: 360` completes once (property already at 360) and subsequent repeats do nothing — arrows look frozen even though press-FX `+=360` still logs “rotation started/completed”.  
   Also: **never** `tweens.killTweensOf(spinIcon)` in skip/reset paths — that destroys the idle tween permanently; `resume()` on a killed tween is a no-op. Kill only non-idle tweens on that target, then call `ensureSpinIconIdleTween()`.

8. **No alpha fade when swapping to `autoplay_stop_icon`** — *thats_bait, 2026-09-17*  
   `spin_icon` ↔ `autoplay_stop_icon` (autoplay / manual-skip HUD) must be an **instant** visibility swap (`setVisible` + `setAlpha(1)`), **not** a smooth fade. Fade tweens on `spin_icon` also race the idle rotation tween and make the arrows look dead. Use a helper like `setSpinOverlayIconsImmediate(showStop)` for autoplay sync, skip mode, and restore.

9. **Do not dim/darken `spin_icon` when the spin control is disabled** — *thats_bait, 2026-09-17*  
   `disableSpinButton` must only gate **input** (`setSpinButtonInputEnabled(false)` / Zone + overlay `disableInteractive`). **Never** `setAlpha(0.5)`, `setTint(0x666666)`, or pause the idle rotation on `spin_icon`. Keep arrows full-bright and spinning; the disc Spine / FR VFX may still grey if desired. Exclude `spinIcon` from any shared `applySpinButtonVisualTint` helper.

---

## 7. Agent migration checklist

Use this when updating another game from the old button:

- [ ] Copy **§2** asset folders/files into the target game’s `public/assets/controller/...`
- [ ] Update **AssetConfig**: register `spin_button_animation`, `fr_spin_button_animation`, `spin_icon`, `freeround_bg`; remove spin disc load of `spin_bg` / `spin` for the main button
- [ ] Add **UIPositionConfig** knobs (or paste from `sugar_wonderland`)
- [ ] Replace spin disc Image + hit Image with **Zone + start_btn_spine + spin_icon**
- [ ] Wire **FR** disc + Button_Bonus; implement `setFreeRoundSpinButtonVisuals`
- [ ] Update **FreeRoundManager** integration (core already prefers optional visuals API)
- [ ] Enforce **press-FX play-to-end** lock (`spinButtonPressPlaying`)
- [ ] Idle `spin_icon` tween uses **`angle: '+=360'`** + `ensureSpinIconIdleTween` (not absolute `360`; never `killTweensOf(spinIcon)` for skip reset)
- [ ] `spin_icon` ↔ `autoplay_stop_icon` is an **instant** swap (no alpha fade)
- [ ] Disabled spin control: **input-only** for `spin_icon` (no alpha/tint/pause on the arrows)
- [ ] Smoke test:
  - [ ] Normal: green/candy spine disc + white rotating arrows; click plays FX fully under spam
  - [ ] Arrows keep spinning at idle (not only on press)
  - [ ] Autoplay / skip: stop icon appears instantly (no fade-out of arrows)
  - [ ] While spin is locked mid-spin: arrows stay full-bright (not greyed / half-alpha)
  - [ ] No green `__MISSING` square
  - [ ] Clicks + space both work
  - [ ] Init free rounds: orange `freeround_bg` + Button_Bonus VFX on press; restore normal spine after FR ends
  - [ ] Console: no silent `setTexture('spin')` path; optional warn if FR textures missing

---

## 7.1 Changelog (porting notes)

| Date | Game | Note |
|------|------|------|
| 2026-09-17 | `thats_bait` | Fixed frozen `spin_icon` (absolute `angle: 360` + `killTweensOf`); removed fade when replacing with `autoplay_stop_icon`; `spin_icon` no longer dims on disable (input-only). See §6.7–§6.9. |

## 8. Reference file map

| Concern | Path |
|---------|------|
| This guide | `sugar_wonderland/SPIN_BUTTON_START_BTN_SPINE_PORTING_GUIDE.md` |
| Scale / offsets | `sugar_wonderland/src/config/UIPositionConfig.ts` |
| Load keys | `sugar_wonderland/src/config/AssetConfig.ts` |
| Stack + press lock + FR visuals | `sugar_wonderland/src/game/components/SlotController.ts` |
| FR enable/disable visuals call | `minium/core/FreeRoundManager/FreeRoundManager.ts` |
| FR port types | `minium/core/FreeRoundManager/types.ts` |
| Related skip HUD notes | `sugar_wonderland/SPIN_BUTTON_SKIP.md` |

---

## 9. Quick “copy assets” commands (from repo root)

Adjust target game folder name as needed:

```bash
# Normal spin spine + webp + atlas + json
cp -r sugar_wonderland/public/assets/controller/portrait/high/spin_button_anim \
      <target_game>/public/assets/controller/portrait/high/

# FR VFX
cp -r sugar_wonderland/public/assets/controller/portrait/high/Button_Bonus_Buttom \
      <target_game>/public/assets/controller/portrait/high/

# Discs / overlays
cp sugar_wonderland/public/assets/controller/portrait/high/freeround_bg.png \
   sugar_wonderland/public/assets/controller/portrait/high/spin_icon.png \
   sugar_wonderland/public/assets/controller/portrait/high/autoplay_stop_icon.png \
   <target_game>/public/assets/controller/portrait/high/
```

On Windows (PowerShell), use `Copy-Item -Recurse` with the same paths.

---

## 10. One-sentence summary for agents

**Replace the old `spin_bg` Image button with `start_btn_spine` (idle + press) + rotating `spin_icon` (`angle: '+=360'`) + a `Zone` hitbox; for init free rounds only, swap the disc to `freeround_bg` and play `Button_Bonus_Buttom`; never `setTexture` unloaded keys onto the icon; never restart the press spine until the current play completes; swap `spin_icon` ↔ `autoplay_stop_icon` instantly (no alpha fade); and never dim/tint `spin_icon` when disabling — gate input only.**
