# Oppals Orientation Modal Porting Guide

This guide is the source of truth for the finalized Oppals mobile viewport, fullscreen, background, and orientation gate implementation.

It is intentionally detailed so another AI or engineer can port the feature into a similar Phaser + React + Vite casino game without relying on memory or previous chat context.

The implementation is not just a modal. The working feature is a complete browser shell handler that:

1. Owns the visible mobile viewport using `visualViewport` when available.
2. Detects phone-like sessions without softlocking desktop launchers.
3. Detects landscape orientation across viewport, device, host message, query, and fallback signals.
4. Renders a rotate-to-portrait gate above the game, background, launcher iframe, and native fullscreen layer.
5. Prevents hidden overlays and old background elements from blocking gameplay.
6. Refreshes Phaser scale after resize, orientation, fullscreen, iframe, toolbar, and restart events.
7. Provides mobile fullscreen helpers with native fullscreen first and soft fullscreen fallback.
8. Survives stale or missing `style.css` in deployed DEV/STG/provider environments by injecting the full shell and modal CSS at runtime.

Use `C:\Users\User\Documents\GitHub\minium\oppals` as the canonical working implementation.

## Copy-Paste Prompt For Future AI

Use this prompt when asking another AI to port the feature into a new game. Replace the target path and target slug.

```text
You are working inside this repository:
C:\Users\User\Documents\GitHub\minium

Use this file as the source of truth:
C:\Users\User\Documents\GitHub\minium\oppals\orientation-modal-porting-guide.md

Use Oppals as the canonical implementation:
C:\Users\User\Documents\GitHub\minium\oppals

Port the finalized Oppals mobile viewport, fullscreen, background, and orientation gate implementation into:
C:\Users\User\Documents\GitHub\minium\<target_game_folder>

Target game slug:
<target_game_slug>

Do the full integration, not only the modal CSS.

Requirements:
- If the target already has src/bootstrap/MobileViewport.ts, replace/update it from Oppals and keep only the target GAME_ID changed.
- If the target has no src/bootstrap/MobileViewport.ts, create src/bootstrap/, copy the Oppals MobileViewport.ts, change GAME_ID, then wire imports and Phaser registration.
- Import ./bootstrap/MobileViewport as the first import in src/main.tsx.
- Register the Phaser game with registerMobileViewportGame(game, { parent }) immediately after Phaser game creation.
- Preserve target-specific Phaser parent id and restart lifecycle.
- Use CSS background handling for fullscreen_bg.webp. Do not use live background image DOM overlays.
- Keep the latest desktop-provider fix: device=mobile and host mobile messages are hints only, DPR alone is not mobile, desktop fine-pointer/hover profiles are excluded, and a clearly portrait iframe viewport wins over stale desktop screen.orientation or host landscape.
- Remove or neutralize old orientation modal, old viewport handlers, old fullscreen handlers that conflict, and any visible .background-container / .background-image overlay.
- Build with npm run build-nolog.
- Verify the built bundle contains mobile-orientation-gate, tb-mobile-viewport-shell-style, pointer: fine, and data-tb-orientation-source.
- Report changed files and build result.
```

## Integration Decision Tree

Use this decision tree before editing the target. It prevents the most common failed ports.

1. Target has `src/bootstrap/MobileViewport.ts`:
   - Treat it as an older copy unless proven identical to Oppals.
   - Replace it with `oppals/src/bootstrap/MobileViewport.ts`.
   - Change only `const GAME_ID = 'oppals';` to the target slug.
   - Re-check `src/main.tsx`, `src/game/main.ts`, `index.html`, and `public/style.css`.

2. Target does not have `src/bootstrap/MobileViewport.ts`:
   - Create `src/bootstrap/`.
   - Copy `oppals/src/bootstrap/MobileViewport.ts`.
   - Change only `GAME_ID`.
   - Add the first import in `src/main.tsx`.
   - Wire `registerMobileViewportGame()` into the Phaser startup file.
   - Add shell CSS and clean `index.html`.

3. Target has a different game startup path:
   - Search for `new Game(`, `new Phaser.Game(`, `parent:`, and `Phaser.Scale`.
   - Register the returned Phaser instance, not a scene, not a React component, and not a temporary config object.
   - If the game restarts Phaser, re-register the new instance after every restart.

4. Target has no React:
   - Still copy `MobileViewport.ts`.
   - Import it from the earliest browser entry file that runs before Phaser creation.
   - If the project uses plain TypeScript or JavaScript, the same logic applies: the handler must execute before Phaser creates or sizes the canvas.

5. Target uses JavaScript instead of TypeScript:
   - Prefer keeping the TypeScript file if the build accepts `.ts`.
   - If the target is JS-only, convert type declarations to JSDoc or plain JS carefully, but keep the runtime logic identical.
   - Do not rewrite the detection algorithm during conversion.

6. Target has no `public/fullscreen_bg.webp`:
   - Add the correct background asset or change `--tb-shell-background-image` to the target's actual background.
   - Keep it as a CSS background. Do not add `<img class="background-image">`.

## What The Latest Fix Changed

The current Oppals implementation includes the provider/desktop fixes that must be copied into every target.

The old broken behavior:

- Some provider launchers append `?device=mobile` even on desktop.
- Desktop DevTools can make an iframe look phone-sized while the physical desktop `screen.orientation` still reports landscape.
- Some host pages send mobile-ish messages that reflect the launcher route, not the real device.
- DPR can be high on desktop monitors, so DPR alone is not a mobile signal.

The required fixed behavior:

- `?device=mobile` is only a launcher hint.
- Host `mobile`, `isMobile`, `mobileLike`, or `device=mobile` messages are only hints.
- `dpr >= 1.25` is not enough to classify a desktop iframe as mobile.
- A desktop pointer profile, defined as `pointer: fine`, `hover: hover`, no mobile UA, no iPadOS, and no touch, blocks DevTools mobile emulation detection.
- If the visible iframe viewport is clearly portrait, it wins over stale desktop `screen.orientation: landscape` and host `landscape`, unless `window.orientation` gives a real legacy mobile landscape signal.

These exact concepts must remain in the target `MobileViewport.ts`:

```ts
const desktopPointerProfile = !mobileUa && !iPadOS && !touchCapable && safeMatchMedia('(pointer: fine)') && safeMatchMedia('(hover: hover)');
const devToolsMobileEmulation = compactTabletViewport && dpr >= 1.25 && safeMatchMedia('(max-width: 1200px)') && !desktopPointerProfile;
const pointerMobileLike = (coarsePointer || noHover) && compactTabletViewport;
const touchCompactMobileLike = touchCapable && deviceSizedLikeMobile && compactTabletViewport;
const compactPhoneMobileLike = compactPhoneViewport && (
    mobileUa ||
    iPadOS ||
    pointerMobileLike ||
    touchCompactMobileLike
);
const launcherMobileHint = launchDeviceMobile && (
    mobileUa ||
    iPadOS ||
    pointerMobileLike ||
    touchCompactMobileLike ||
    devToolsMobileEmulation ||
    compactPhoneMobileLike
);
const hostMobileHint = hostMobileLike === true && (
    mobileUa ||
    iPadOS ||
    pointerMobileLike ||
    touchCompactMobileLike ||
    devToolsMobileEmulation ||
    compactPhoneMobileLike
);
```

And this orientation conflict guard must remain:

```ts
const viewportPortraitBeatsLandscapeHint = isMobileLike &&
    (viewportMode === 'portrait' || mediaMode === 'portrait') &&
    legacyMode !== 'landscape' &&
    mediaMode !== 'landscape';

if (hostOrientation === 'landscape' && !viewportPortraitBeatsLandscapeHint) return { mode: 'landscape', source: 'host' };
if (legacyMode) return { mode: legacyMode, source: 'device' };
if (screenMode === 'landscape' && !viewportPortraitBeatsLandscapeHint) return { mode: 'landscape', source: 'device' };
if (viewportMode === 'landscape') return { mode: 'landscape', source: 'viewport' };
if (mediaMode === 'landscape') return { mode: 'landscape', source: 'device' };
if (viewportPortraitBeatsLandscapeHint) {
    return { mode: 'portrait', source: viewportMode === 'portrait' ? 'viewport' : 'device' };
}
```

Do not "simplify" those checks. They exist because DEV/STG/provider iframe behavior is different from local direct browser testing.

## Canonical Files

These files define the implementation. Port all of them as a set.

| File | Required role |
| --- | --- |
| `src/bootstrap/MobileViewport.ts` | Main implementation. Owns viewport state, mobile detection, orientation detection, fullscreen helpers, generated modal DOM, runtime CSS injection, input blocking, legacy background suppression, host messaging, debug globals, and Phaser registration. |
| `src/main.tsx` | Imports `./bootstrap/MobileViewport` before React mounts. This must be the first browser-side import. |
| `src/game/main.ts` | Imports and calls `registerMobileViewportGame(game, { parent })` after Phaser creation. If the game can restart, it also cleans up and re-registers after every new Phaser instance. |
| `public/style.css` | First-paint CSS mirror of the shell and modal visuals. It improves initial render, but runtime injection in `MobileViewport.ts` is still required. |
| `index.html` | Minimal shell. Uses relative public asset paths and CSS background handling. It must not contain live background image DOM or static orientation modal DOM. |

## Required Result

After porting, a target game must have this behavior:

- In portrait on a phone-like session: game is playable and no modal is visible.
- In landscape on a phone-like session: orientation gate appears above everything and blocks game input.
- In native fullscreen on mobile: the gate still appears above the fullscreen `#root`.
- In iOS Safari or iframe contexts where native fullscreen is denied: soft fullscreen sizing still fills the viewport.
- In desktop browser or desktop launcher: the orientation gate does not softlock the game just because the URL has `device=mobile`.
- If `style.css` is stale, cached, or missing: the modal is still visible because `MobileViewport.ts` injects complete CSS.
- If old `.background-container` or `.background-image` elements exist: they are hidden, non-interactive, and cannot cover Phaser.

## Non-Negotiable Rules

- Copy the entire `MobileViewport.ts`. Do not port only the CSS or only the modal DOM.
- Keep `MobileViewport.ts` loaded before React and before Phaser game creation.
- Let `MobileViewport.ts` generate the modal DOM. Do not add static `#mobile-orientation-gate` markup to `index.html`.
- Keep full modal visual CSS inside `ensureShellStyle()` in `MobileViewport.ts`.
- Keep matching modal CSS in `public/style.css` as a mirror.
- The background must be a CSS background on `html`, `body`, and fullscreen `#root`, not a live image overlay.
- Do not use `z-index: -1` for background layers.
- Do not leave `.background-container` or `.background-image` as visible DOM overlays.
- Use relative public asset URLs: `./style.css`, `./fullscreen_bg.webp`, `./src/main.tsx`.
- Treat `?device=mobile` as a launcher hint only. It must not force mobile UI by itself on desktop.
- Append the gate to the active native fullscreen element when native fullscreen is active. A body-level gate will not reliably appear over fullscreen content.
- Keep `root.inert = false` and remove `inert` when syncing. Input blocking is handled through capture listeners only when the gate is truly open.
- Keep the debug state attributes on `<html>`:
  - `data-tb-mobile-ui`
  - `data-tb-orientation`
  - `data-tb-orientation-source`
  - `data-tb-fullscreen`

## Porting Checklist

Use this exact order.

1. Create `src/bootstrap/` in the target game.
2. Copy `oppals/src/bootstrap/MobileViewport.ts` into `target/src/bootstrap/MobileViewport.ts`.
3. Change only `GAME_ID` in the copied file:

```ts
const GAME_ID = 'target_game_slug';
```

4. Add this as the first import in `target/src/main.tsx`:

```ts
import './bootstrap/MobileViewport';
```

5. In the Phaser startup file, import the registration function:

```ts
import { registerMobileViewportGame } from '../bootstrap/MobileViewport';
```

6. Register the Phaser game immediately after creating it.
7. If the game can destroy/recreate Phaser, clean up before destroying the old game and re-register after creating the new game.
8. Replace `target/public/style.css` shell/orientation sections with the Oppals version, or copy the full Oppals `public/style.css` when the target uses the same shell structure.
9. Rewrite `target/index.html` to the shell pattern in this guide.
10. Remove or hide all old static orientation modal code and old viewport/fullscreen handlers that overlap this system.
11. Build with `npm run build-nolog`.
12. Verify the built JS contains the runtime modal CSS and the built HTML has no live fullscreen background image element.

## Discovery Commands Before Porting

Run these from `C:\Users\User\Documents\GitHub\minium` before touching a new target. They reveal whether the game already has the required integration points.

```powershell
$target = "target_game_folder"
Test-Path "$target\src\bootstrap\MobileViewport.ts"
Test-Path "$target\src\main.tsx"
Test-Path "$target\src\game\main.ts"
Test-Path "$target\public\style.css"
Test-Path "$target\public\fullscreen_bg.webp"
Test-Path "$target\index.html"
```

Search for existing orientation, fullscreen, and background code:

```powershell
rg -n "MobileViewport|mobile-orientation-gate|orientation|screen.orientation|window.orientation|device=mobile|background-container|background-image|fullscreen_bg|requestFullscreen|startFullscreen|toggleFullscreen|fullscreenTarget|new Phaser.Game|new Game|parent:" target_game_folder\src target_game_folder\index.html target_game_folder\public
```

The target is safe to port when you know:

- the browser entry file
- the Phaser startup file
- the Phaser parent id
- whether Phaser can restart
- whether old orientation/fullscreen handlers exist
- whether the background is CSS or live DOM

Do not guess those details. Read the files first.

## Full Path: Target Has No `MobileViewport.ts`

Use this path for a game that has no orientation infrastructure at all.

1. Create the bootstrap folder:

```powershell
New-Item -ItemType Directory -Force -Path target_game_folder\src\bootstrap
```

2. Copy the canonical file:

```powershell
Copy-Item oppals\src\bootstrap\MobileViewport.ts target_game_folder\src\bootstrap\MobileViewport.ts
```

3. Change only the game id:

```ts
const GAME_ID = 'target_game_slug';
```

Use the folder slug unless the project already has a clear deploy slug. Examples:

- `thats_bait`
- `genghisbao`
- `sk8leton`
- `sugar_wonderland`

4. Add the bootstrap import as the first import in the browser entry file.

For React/Vite games this is usually `src/main.tsx`:

```ts
import './bootstrap/MobileViewport';
import React from 'react';
import ReactDOM from 'react-dom/client';
```

If the target uses another entry file, use the earliest browser-side file that runs before Phaser creation. Examples:

- `src/main.ts`
- `src/index.ts`
- `src/App.tsx` only if there is no earlier entry file

5. Find Phaser creation.

Search:

```powershell
rg -n "new Game|new Phaser.Game|Phaser.Game|parent:" target_game_folder\src
```

The target usually has one of these patterns:

```ts
const StartGame = (parent: string) => {
    const game = new Game({ ...config, parent });
    return game;
};
```

```ts
const game = new Phaser.Game(config);
```

```ts
game = new Game({ ...config, parent });
```

6. Import registration in the Phaser startup file:

```ts
import { registerMobileViewportGame } from '../bootstrap/MobileViewport';
```

Adjust the relative path if the startup file is not under `src/game/`:

- From `src/game/main.ts`: `../bootstrap/MobileViewport`
- From `src/main.ts`: `./bootstrap/MobileViewport`
- From `src/phaser/main.ts`: `../bootstrap/MobileViewport`
- From `src/game/startup/main.ts`: `../../bootstrap/MobileViewport`

7. Register immediately after creating the Phaser game:

```ts
const game = new Game({ ...config, parent });
const mobileViewportCleanup = registerMobileViewportGame(game, { parent });
```

8. Add cleanup.

Minimum cleanup:

```ts
game.events?.once?.('destroy', () => {
    try { mobileViewportCleanup?.(); } catch {}
});
```

If the game already has cleanup arrays, add the returned cleanup function there instead of creating a second lifecycle system.

9. If the game restarts Phaser, re-register after every restart.

Required shape:

```ts
let game = new Game({ ...config, parent });
let mobileViewportCleanup: (() => void) | null = null;

const rebindMobileViewport = () => {
    try { mobileViewportCleanup?.(); } catch {}
    mobileViewportCleanup = registerMobileViewportGame(game, { parent });
};

rebindMobileViewport();

const restartGame = () => {
    try { mobileViewportCleanup?.(); } catch {}
    mobileViewportCleanup = null;
    try { game.destroy(true); } catch {}

    game = new Game({ ...config, parent });
    rebindMobileViewport();
};
```

10. Update `index.html` and `public/style.css` using the sections below.

11. Remove conflicting old code:

```powershell
rg -n "mobile-orientation-gate|showOrientationModal|hideOrientationModal|orientation-modal|rotate-device|background-container|background-image|visualViewport|requestFullscreen|toggleFullscreen" target_game_folder
```

Delete static modal DOM. Keep only the modal generated by `MobileViewport.ts`.

12. Build and verify:

```powershell
cd target_game_folder
npm run build-nolog
```

## Full Path: Target Already Has `MobileViewport.ts`

Use this path for games that were previously ported but are older or inconsistent.

1. Save the target slug:

```ts
const GAME_ID = 'existing_target_slug';
```

2. Replace the target file from Oppals:

```powershell
Copy-Item ..\oppals\src\bootstrap\MobileViewport.ts .\src\bootstrap\MobileViewport.ts -Force
```

Or from repo root:

```powershell
Copy-Item oppals\src\bootstrap\MobileViewport.ts target_game_folder\src\bootstrap\MobileViewport.ts -Force
```

3. Restore only the target slug:

```ts
const GAME_ID = 'existing_target_slug';
```

4. Do not manually merge old detection code back in.

5. Re-check `src/main.tsx` and Phaser registration. Older ports may have correct files but stale logic.

6. Build and verify.

## File-by-File Porting Contract

This is the complete target file contract.

| Target file | Required action |
| --- | --- |
| `src/bootstrap/MobileViewport.ts` | Copy from Oppals, change only `GAME_ID`. This file must contain shell CSS, modal DOM creation, mobile detection, orientation detection, fullscreen helpers, host messages, input blocking, and Phaser registration. |
| `src/main.tsx` or earliest browser entry | First import must be `import './bootstrap/MobileViewport';`. No React, Phaser, app, or CSS import should run before it unless the project genuinely requires polyfills. |
| `src/game/main.ts` or Phaser startup | Import `registerMobileViewportGame`. Call it immediately after the Phaser game instance is created. Clean it up on destroy. Re-register on restart. |
| `index.html` | Use a minimal shell with `<div id="root"></div>`, relative asset paths, CSS background, no live background image DOM, no static orientation modal. |
| `public/style.css` | Mirror the shell and modal CSS for first paint. Runtime CSS still lives in `MobileViewport.ts`. |
| `public/fullscreen_bg.webp` | Must exist or be replaced with the target game's correct background asset in both `index.html`, `public/style.css`, and `MobileViewport.ts`. |
| old modal/fullscreen scripts | Remove or disable if they conflict. There should not be two systems fighting over viewport size or modal visibility. |

If a game cannot follow this file layout, keep the behavior contract, not the exact paths. The handler must still run before Phaser, own the shell, generate the gate, and register the Phaser instance.

## `src/main.tsx` Wiring

`MobileViewport.ts` must run before React imports app code.

Correct:

```ts
import './bootstrap/MobileViewport';
import React from 'react';
import ReactDOM from 'react-dom/client';
```

Incorrect:

```ts
import React from 'react';
import ReactDOM from 'react-dom/client';
import './bootstrap/MobileViewport';
```

The late import is risky because React or Phaser may already create and size `#root`, `#app`, or `#game-container` before viewport CSS variables and runtime CSS exist.

## `src/game/main.ts` Wiring

### Simple Phaser Startup

Use this when the game creates Phaser once and does not have a restart path.

```ts
import { registerMobileViewportGame } from '../bootstrap/MobileViewport';

const StartGame = (parent: string) => {
    const game = new Game({ ...config, parent });

    let mobileViewportCleanup: (() => void) | null = null;
    try {
        mobileViewportCleanup = registerMobileViewportGame(game, { parent });
        game.events?.once?.('destroy', () => {
            try { mobileViewportCleanup?.(); } catch {}
            mobileViewportCleanup = null;
        });
    } catch {}

    (window as any).phaserGame = game;
    return game;
};
```

### Startup With Existing Cleanup Array

Oppals uses this pattern. It is preferred when the game already has lifecycle cleanup helpers.

```ts
const StartGame = (parent: string) => {
    const cleanups: Array<() => void> = [];
    const addCleanup = (cleanup: () => void): void => {
        cleanups.push(cleanup);
    };
    const cleanupGameResources = (): void => {
        while (cleanups.length > 0) {
            const cleanup = cleanups.pop();
            try { cleanup?.(); } catch {}
        }
    };

    const game = new Game({ ...config, parent });
    (game as any).__cleanupStartGame = cleanupGameResources;
    try { (game.events as any)?.once?.('destroy', cleanupGameResources); } catch {}

    let mobileViewportCleanup: (() => void) | null = null;
    try {
        mobileViewportCleanup = registerMobileViewportGame(game, { parent });
        addCleanup(() => {
            try { mobileViewportCleanup?.(); } catch {}
            mobileViewportCleanup = null;
        });
    } catch {}

    (window as any).phaserGame = game;
    return game;
};
```

### Startup With Phaser Restart

Use this when the game can recreate Phaser after WebGL context loss or global errors.

```ts
const StartGame = (parent: string) => {
    let game: Phaser.Game = new Game({ ...config, parent });
    (window as any).game = game;
    (window as any).phaserGame = game;

    let mobileViewportCleanup: (() => void) | null = null;
    const rebindMobileViewport = () => {
        try { mobileViewportCleanup?.(); } catch {}
        mobileViewportCleanup = registerMobileViewportGame(game, { parent });
    };
    rebindMobileViewport();

    const restartGame = () => {
        const old = game;

        try { mobileViewportCleanup?.(); } catch {}
        mobileViewportCleanup = null;
        try { old.destroy(true); } catch {}

        game = new Game({ ...config, parent });
        (window as any).game = game;
        (window as any).phaserGame = game;
        rebindMobileViewport();
    };

    return game;
};
```

Do not register once and forget it. The handler stores the Phaser game instance so `scale.refresh()`, fullscreen target, and canvas listeners continue to point at the correct object.

## Phaser Config Requirements

The current implementation expects the common project layout:

```ts
const config: Phaser.Types.Core.GameConfig = {
    width: 428,
    height: 926,
    parent: 'game-container',
    backgroundColor: 'transparent',
    scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
    },
};
```

Rules:

- Keep the game parent id consistent with the React component and `registerMobileViewportGame(game, { parent })`.
- Keep Phaser background transparent so the shell background can show behind the canvas.
- Do not set a fixed CSS size on canvas that fights the viewport shell.
- If a game uses a different parent id, pass that exact id to registration.

## `index.html` Shell

Use relative URLs. Absolute `/style.css` or `/fullscreen_bg.webp` can break under deployed subpaths such as `/oppals/`, `/games/foo/`, provider asset prefixes, and iframe launchers.

```html
<!doctype html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/png" href="./favicon.png" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <link rel="stylesheet" href="./style.css">
    <title>Game Title</title>
    <link rel="stylesheet" href="./main.scss">
    <style>
        :root {
            --tb-shell-background-image: url("./fullscreen_bg.webp");
        }

        html,
        body {
            margin: 0;
            padding: 0;
            width: 100%;
            height: 100%;
            min-height: 100%;
            overflow: hidden;
            background: #000000;
            background-image: var(--tb-shell-background-image);
            background-size: cover;
            background-position: center bottom;
            background-repeat: no-repeat;
        }

        .background-container,
        .background-image {
            display: none !important;
            pointer-events: none !important;
            visibility: hidden !important;
        }

        #root {
            position: relative;
            z-index: 1;
            width: 100%;
            height: 100%;
            min-height: 100%;
            background: transparent;
        }

        #root:fullscreen,
        #root:-webkit-full-screen {
            background-color: #000000;
            background-image: var(--tb-shell-background-image);
            background-size: cover;
            background-position: center bottom;
            background-repeat: no-repeat;
        }
    </style>
</head>

<body>
    <div id="root"></div>
    <script type="module" src="./src/main.tsx"></script>
</body>
</html>
```

If the target game has a boot loader, keep it, but keep these rules:

- `#boot-loader` may exist.
- `#root` must still exist.
- The game script must use `./src/main.tsx`.
- Do not add a live background `<img>`.
- Do not add static orientation modal markup.
- `MobileViewport.ts` will size `#boot-loader` if it exists.

## Background Handling

The deployment-safe background rule is:

```text
fullscreen_bg.webp is a CSS background, not a page element.
```

Use this in `index.html`, `public/style.css`, and runtime CSS injection:

```css
:root {
    --tb-shell-background-image: url("./fullscreen_bg.webp");
}

html,
body,
#root:fullscreen,
#root:-webkit-full-screen,
.tb-native-fullscreen,
.tb-soft-fullscreen {
    background-color: #000000;
    background-image: var(--tb-shell-background-image);
    background-size: cover;
    background-position: center bottom;
    background-repeat: no-repeat;
}
```

Old pattern to remove:

```html
<div class="background-container">
    <img class="background-image" src="./fullscreen_bg.webp" />
</div>
```

Why it must be removed:

- It can layer above Phaser in provider launchers.
- It can become black or invisible if the image fails while still blocking the game.
- `z-index: -1` behaves differently across body backgrounds, fullscreen elements, transformed parents, and iframe contexts.
- Some mobile browsers create stacking contexts that make the layer order inconsistent.

The handler also contains a defensive cleanup:

```ts
document.querySelectorAll<HTMLElement>('.background-container, .background-image').forEach((el) => {
    setStyle(el, 'display', 'none', 'important');
    setStyle(el, 'visibility', 'hidden', 'important');
    setStyle(el, 'pointer-events', 'none', 'important');
    setStyle(el, 'z-index', '0', 'important');
    el.setAttribute('aria-hidden', 'true');
});
```

Keep this cleanup in the port.

## Runtime CSS Injection

This was the critical production fix.

`MobileViewport.ts` must inject the full shell and modal CSS through `ensureShellStyle()`.

Reason: in DEV/STG/provider environments, `style.css` may be stale, cached, blocked, omitted, or from a previous build. If the modal DOM exists but the visual CSS is missing, users see an invisible blocker and the game becomes unclickable.

`ensureShellStyle()` must include these CSS groups:

- `:root { --tb-shell-background-image: url("./fullscreen_bg.webp"); }`
- `html, body` background fallback.
- `#root` transparent layout and high z-index.
- fullscreen background selectors:
  - `#root:fullscreen`
  - `#root:-webkit-full-screen`
  - `.tb-native-fullscreen`
  - `.tb-soft-fullscreen`
- legacy background suppression:
  - `.background-container`
  - `.background-image`
  - `.background-container .background-image`
- `.mobile-orientation-gate` fixed positioning, safe-area padding, scrim, typography, pointer behavior, isolation, and `z-index: 2147483647`.
- hidden gate rules.
- panel layout.
- icon layout.
- circular arrow wrapper, spinner, SVG, path, arrowhead.
- CSS phone frame.
- phone `::before` speaker detail.
- phone `::after` home/detail dot.
- title and description styles.
- `.tb-orientation-blocked #root { pointer-events: none !important; }`
- all keyframes.
- reduced-motion media query.

Treat `public/style.css` as a mirror, not the only source.

## Orientation Gate DOM

`ensureGate()` creates the modal dynamically. The DOM shape must remain compatible with the CSS selectors.

```html
<div id="mobile-orientation-gate"
     class="mobile-orientation-gate mobile-orientation-gate--hidden"
     role="dialog"
     aria-modal="true"
     aria-labelledby="mobile-orientation-gate-title"
     aria-describedby="mobile-orientation-gate-description"
     aria-hidden="true"
     hidden>
    <div class="mobile-orientation-gate__panel">
        <div class="mobile-orientation-gate__icon" aria-hidden="true">
            <div class="mobile-orientation-gate__circ-wrap">
                <div class="mobile-orientation-gate__circ-spin">
                    <svg class="mobile-orientation-gate__circ-svg" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
                        <path class="mobile-orientation-gate__circ-path"
                              fill="none"
                              stroke="#66D449"
                              stroke-width="3.25"
                              stroke-linecap="round"
                              d="M 50 13 A 37 37 0 1 1 13 50" />
                        <g class="mobile-orientation-gate__circ-arrow" transform="translate(50,13) rotate(180)" aria-hidden="true">
                            <polygon points="-4,-4 -4,4 14,0" fill="#66D449" />
                        </g>
                    </svg>
                </div>
            </div>
            <div class="mobile-orientation-gate__phone"></div>
        </div>
        <div class="mobile-orientation-gate__copy">
            <p id="mobile-orientation-gate-title" class="mobile-orientation-gate__title">Rotate to portrait</p>
            <p id="mobile-orientation-gate-description" class="mobile-orientation-gate__text">Please switch back to Portrait mode to continue the game.</p>
        </div>
    </div>
</div>
```

Visual notes:

- The accent color is `#66D449`.
- The phone is CSS-drawn, not an image.
- The phone starts in landscape, rotates to portrait, turns green at the aligned moment, then resets.
- The arrow ring fades in, performs one full counter-clockwise revolution per loop, then fades out.
- Do not use SVG `<marker>` for the arrowhead. WebKit/mobile browsers can hide marker arrowheads when filters or overflow are involved.
- The glow is applied to `.mobile-orientation-gate__circ-wrap`, not to the SVG path itself.
- The phone has higher stacking order than the arrow ring.

## Modal Visual CSS Contract

These values are intentional and should be kept unless a future design update changes the source of truth.

```css
.mobile-orientation-gate {
    position: fixed;
    inset: var(--tb-viewport-top) auto auto var(--tb-viewport-left);
    width: var(--tb-viewport-width);
    height: var(--tb-viewport-height);
    z-index: 2147483647;
    display: flex;
    align-items: center;
    justify-content: center;
    padding:
        max(24px, env(safe-area-inset-top))
        max(24px, env(safe-area-inset-right))
        max(24px, env(safe-area-inset-bottom))
        max(24px, env(safe-area-inset-left));
    box-sizing: border-box;
    background:
        radial-gradient(circle at 50% 36%, rgba(102, 212, 73, 0.18), rgba(2, 7, 12, 0) 36%),
        rgba(2, 7, 12, 0.88);
    color: #ffffff;
    pointer-events: auto;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    isolation: isolate;
}
```

Panel and icon sizing:

```css
.mobile-orientation-gate__panel {
    width: min(320px, calc(var(--tb-viewport-width) - 48px));
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: clamp(10px, 2vmin, 18px);
    text-align: center;
    transform: translateY(-2px);
}

.mobile-orientation-gate__icon {
    position: relative;
    width: clamp(100px, 16vmin, 134px);
    height: clamp(100px, 16vmin, 134px);
    display: flex;
    align-items: center;
    justify-content: center;
    --gate-loop-duration: 2s;
}
```

Phone sizing:

```css
.mobile-orientation-gate__phone {
    width: clamp(32px, 5vmin, 44px);
    height: clamp(52px, 8vmin, 70px);
    border: clamp(3px, 0.45vmin, 4px) solid rgba(255, 255, 255, 0.96);
    border-radius: clamp(10px, 1.5vmin, 14px);
    transform-origin: 50% 50%;
    animation:
        tb-gate-seq-phone var(--gate-loop-duration) linear infinite,
        tb-gate-seq-phone-paint var(--gate-loop-duration) linear infinite;
}
```

Animation keyframes:

```css
@keyframes tb-gate-seq-phone {
    0%, 6% { transform: rotate(90deg); }
    28%, 62% { transform: rotate(0deg); }
    82%, 100% { transform: rotate(90deg); }
}

@keyframes tb-gate-seq-circ-spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(-360deg); }
}
```

The phone and ring use the same `--gate-loop-duration`. Do not desync them unless you retune the full animation.

## Fullscreen Handling

The fullscreen implementation has two modes:

| Mode | When used | Behavior |
| --- | --- | --- |
| Native fullscreen | Browser allows `#root.requestFullscreen()` or prefixed equivalent. | `#root` enters fullscreen. Gate host changes to the active fullscreen element. |
| Soft fullscreen | Native fullscreen denied or unsupported, common on iOS Safari and some iframes. | Adds `.tb-soft-fullscreen` and sizes shell to viewport without native fullscreen API. |

Important code points:

```ts
const getFullscreenTarget = (): HTMLElement => {
    return (document.getElementById('root') as HTMLElement | null) || document.documentElement;
};

const getNativeFullscreenElement = (): Element | null => {
    const doc: any = document as any;
    return doc.fullscreenElement || doc.webkitFullscreenElement || doc.mozFullScreenElement || doc.msFullscreenElement || null;
};

const getGateHost = (): HTMLElement | null => {
    const fullscreenElement = getNativeFullscreenElement();
    if (fullscreenElement instanceof HTMLElement) return fullscreenElement;
    return document.body || null;
};
```

Do not change `getGateHost()` to always return `document.body`.

Why: when `#root` is in native fullscreen, browser top-layer rules can prevent a body-level modal from appearing above fullscreen content. The gate must be appended inside the active fullscreen element.

The fullscreen API exposed to game UI:

```ts
window.requestMobileFullscreen?.();
window.exitMobileFullscreen?.();
window.toggleMobileFullscreen?.();
window.tbMobileViewport?.requestFullscreen();
window.tbMobileViewport?.toggleFullscreen();
```

If a Phaser fullscreen button exists, wire it to `window.toggleMobileFullscreen()` instead of raw Phaser fullscreen where possible.

## Mobile Detection Rules

The handler intentionally does not trust one signal. It combines:

- User agent phone/tablet identifiers.
- iPadOS desktop UA with `MacIntel` plus touch points.
- `(pointer: coarse)`.
- `(hover: none)`.
- Touch support.
- DPR.
- viewport size.
- screen size.
- host messages.
- explicit query/localStorage overrides.

Critical rule:

```text
?device=mobile is a launcher hint, not a hard force.
```

This prevents desktop launchers like PlayVegaz or browser DevTools from becoming stuck in a permanent orientation modal just because the provider adds `device=mobile`.

The same rule applies to host messages. A parent page may send a mobile-ish message because the launcher URL contains `device=mobile`; do not treat that host message as proof of a physical phone by itself.

The canonical Oppals implementation gates mobile mode with the following shape:

```ts
const desktopPointerProfile = !mobileUa && !iPadOS && !touchCapable && safeMatchMedia('(pointer: fine)') && safeMatchMedia('(hover: hover)');
const devToolsMobileEmulation = compactTabletViewport && dpr >= 1.25 && safeMatchMedia('(max-width: 1200px)') && !desktopPointerProfile;
const pointerMobileLike = (coarsePointer || noHover) && compactTabletViewport;
const touchCompactMobileLike = touchCapable && deviceSizedLikeMobile && compactTabletViewport;
const compactPhoneMobileLike = compactPhoneViewport && (
    mobileUa ||
    iPadOS ||
    pointerMobileLike ||
    touchCompactMobileLike
);
const launcherMobileHint = launchDeviceMobile && (
    mobileUa ||
    iPadOS ||
    pointerMobileLike ||
    touchCompactMobileLike ||
    devToolsMobileEmulation ||
    compactPhoneMobileLike
);
const hostMobileHint = hostMobileLike === true && (
    mobileUa ||
    iPadOS ||
    pointerMobileLike ||
    touchCompactMobileLike ||
    devToolsMobileEmulation ||
    compactPhoneMobileLike
);
```

Do not add `launchDeviceMobile`, `hostMobileLike === true`, or `dpr >= 1.25` directly into `compactPhoneMobileLike`. Those are the exact mistakes that can softlock a desktop iframe in the orientation modal.

Hard force keys still exist and should remain:

```text
?tbPhoneUi=1
?tb_phone_ui=1
?tbForcePhone=1
?forcePhone=1
?forceMobile=1
localStorage tb_force_phone_ui = 1
```

Desktop override keys:

```text
?tbDesktopUi=1
?tb_desktop_ui=1
?tbForceDesktop=1
?forceDesktop=1
localStorage tb_force_desktop_behavior = 1
```

Disable gate keys:

```text
?tbDisableOrientationGate=1
?disableOrientationGate=1
localStorage tb_disable_orientation_gate = 1
```

## Orientation Detection Rules

Detection priority:

1. Explicit query override:
   - `?tbOrientation=landscape`
   - `?tb_orientation=portrait`
   - `?orientation=landscape`
   - `?screenOrientation=portrait`
   - `?deviceOrientation=landscape`
   - `?tbForceLandscape=1`
   - `?forceLandscape=1`
   - `?landscape=1`
   - `?tbForcePortrait=1`
   - `?forcePortrait=1`
   - `?portrait=1`
2. Visible portrait conflict guard.
3. Host message orientation.
4. `window.orientation`.
5. `screen.orientation.type`.
6. viewport dimensions.
7. `matchMedia('(orientation: landscape)')`.
8. mobile-only cross-check using `outerWidth`, `screen.width`, and `screen.availWidth`.
9. fallback portrait.

Important nuance:

- A clearly portrait visible viewport wins over stale desktop `screen.orientation` or host `landscape` hints when there is no legacy/mobile landscape signal.
- Host `landscape` is trusted early only when the visible viewport is not clearly portrait.
- Host `portrait` is accepted after stronger visible landscape checks.
- This avoids hiding the modal when a provider incorrectly reports portrait while the actual viewport is landscape.
- This also prevents desktop DevTools and provider wrappers from forcing the modal just because the physical desktop screen still reports landscape while the iframe viewport is portrait.

Keep this guard in `detectOrientation()`:

```ts
const viewportPortraitBeatsLandscapeHint = isMobileLike &&
    (viewportMode === 'portrait' || mediaMode === 'portrait') &&
    legacyMode !== 'landscape' &&
    mediaMode !== 'landscape';

if (hostOrientation === 'landscape' && !viewportPortraitBeatsLandscapeHint) return { mode: 'landscape', source: 'host' };
if (legacyMode) return { mode: legacyMode, source: 'device' };
if (screenMode === 'landscape' && !viewportPortraitBeatsLandscapeHint) return { mode: 'landscape', source: 'device' };
if (viewportMode === 'landscape') return { mode: 'landscape', source: 'viewport' };
if (mediaMode === 'landscape') return { mode: 'landscape', source: 'device' };
if (viewportPortraitBeatsLandscapeHint) {
    return { mode: 'portrait', source: viewportMode === 'portrait' ? 'viewport' : 'device' };
}
```

The current state is exposed on `<html>`:

```html
<html
  data-tb-mobile-ui="true"
  data-tb-orientation="landscape"
  data-tb-orientation-source="viewport"
  data-tb-fullscreen="native">
```

Use these attributes when debugging.

## Host Messages

The handler listens to `window.message` for provider/launcher hints. It accepts either direct fields or nested `payload`/`detail`.

Orientation fields:

```text
orientation
deviceOrientation
screenOrientation
mode
payload.orientation
payload.deviceOrientation
payload.screenOrientation
detail.orientation
detail.deviceOrientation
detail.screenOrientation
```

Mobile fields:

```text
mobile
isMobile
mobileLike
deviceMobile
device
payload.mobile
payload.isMobile
payload.mobileLike
payload.device
detail.mobile
detail.isMobile
detail.mobileLike
detail.device
```

The game announces readiness to the parent:

```ts
window.parent.postMessage({
    type: 'dijoker:game-viewport-ready',
    game: GAME_ID,
    wants: ['orientation', 'fullscreen', 'viewport'],
    viewport: {
        width: latestState.width,
        height: latestState.height,
        left: latestState.left,
        top: latestState.top,
    },
}, '*');
```

On fullscreen request it also posts:

```ts
window.parent.postMessage({
    type: 'dijoker:game-fullscreen-request',
    game: GAME_ID,
    requested: true,
}, '*');
```

Keep these messages. They are harmless when no parent is listening and useful for providers that can cooperate.

## Viewport Sizing

`getViewportState()` reads:

```ts
const vv = window.visualViewport;
const width = Math.max(1, Math.round(vv?.width || window.innerWidth || document.documentElement.clientWidth || 1));
const height = Math.max(1, Math.round(vv?.height || window.innerHeight || document.documentElement.clientHeight || 1));
const left = Math.round(vv?.offsetLeft || 0);
const top = Math.round(vv?.offsetTop || 0);
```

Then `applyViewportShell()` writes:

```css
--tb-viewport-width
--tb-viewport-height
--tb-viewport-left
--tb-viewport-top
```

And applies pixel dimensions to:

- `body`
- `#root`
- `#app`
- `#game-container`
- `#boot-loader` if it exists
- `#mobile-orientation-gate`

Do not replace this with only `100vh`/`100vw`. Mobile browser toolbars and iOS visual viewport changes make those unreliable.

## Refresh Scheduling

The handler refreshes immediately and then repeats delayed passes:

```ts
const REFRESH_DELAYS = [0, 60, 160, 320, 640, 1000];
```

This is necessary because mobile browser viewport changes are not always settled at the first `resize` or `orientationchange`.

Listeners that must remain:

- `window.resize`
- `window.orientationchange`
- `window.pageshow`
- `window.focus`
- `window.message`
- `document.visibilitychange`
- `document.fullscreenchange`
- `document.webkitfullscreenchange`
- `visualViewport.resize`
- `visualViewport.scroll`
- `screen.orientation.change`

## Input Blocking

Input should only be blocked when the gate is actually visible.

The handler listens in capture phase to:

```text
pointerdown
pointermove
pointerup
pointercancel
touchstart
touchmove
touchend
touchcancel
mousedown
mousemove
mouseup
click
dblclick
contextmenu
wheel
keydown
keyup
```

The blocker checks:

```ts
gateOpen &&
gate &&
!gate.hidden &&
gate.getAttribute('aria-hidden') !== 'true' &&
!gate.classList.contains('mobile-orientation-gate--hidden')
```

Do not block input based only on `shouldBlockOrientation`. The DOM must be visibly open.

## Accessibility And Hidden State

Opening the gate:

- `gate.hidden = false`
- remove `mobile-orientation-gate--hidden`
- `aria-hidden="false"`
- `display: flex`
- `visibility: visible`
- `pointer-events: auto`
- blur active element
- add `.tb-orientation-blocked` to `html` and `body`

Closing the gate:

- `gate.hidden = true`
- add `mobile-orientation-gate--hidden`
- `aria-hidden="true"`
- `display: none`
- `visibility: hidden`
- `pointer-events: none`
- remove `.tb-orientation-blocked`
- ensure `#root` is not inert
- remove `aria-hidden` from `#root` if needed

Do not use a permanent invisible overlay.

## Shell Observer

`installShellObserver()` watches body mutations and re-applies:

- legacy background hiding
- viewport shell sizing
- gate state

Keep this observer. Some launchers, React remounts, boot loaders, and third-party scripts mutate `hidden`, `style`, `class`, or DOM placement after initial load.

## Public Globals For QA And Game UI

The handler exposes:

```ts
window.tbMobileViewport
window.syncMobileViewport
window.showOrientationGate
window.hideOrientationGate
window.useAutomaticOrientationGate
window.requestMobileFullscreen
window.exitMobileFullscreen
window.toggleMobileFullscreen
window.tbSetDesktopUi
window.tbSetPhoneUi
window.showOrientationModal
window.hideOrientationModal
window.syncOrientationModal
```

Useful console checks:

```js
window.tbMobileViewport.getState()
window.tbMobileViewport.getFullscreenState()
window.showOrientationGate()
window.hideOrientationGate()
window.useAutomaticOrientationGate()
window.tbSetDesktopUi(true)
window.tbSetPhoneUi(true)
```

Compatibility aliases `showOrientationModal`, `hideOrientationModal`, and `syncOrientationModal` exist for older code. Keep them unless all old callers are removed.

## Build Verification

Run:

```powershell
npm run build-nolog
```

Verify the built JavaScript contains the runtime handler and visual CSS:

```powershell
rg -n "mobile-orientation-gate|tb-mobile-viewport-shell-style|tb-gate-seq-phone|tb-gate-seq-circ-spin|data-tb-orientation-source|GAME_ID" dist\assets -g "*.js"
```

Verify the built JavaScript contains the latest provider/desktop fixes:

```powershell
rg -n "\(pointer: fine\)|\(hover: hover\)|source:\"viewport\"|source:\"host\"|source:\"device\"" dist\assets -g "index-*.js"
```

Verify the source does not contain the old hard-lock pattern:

```powershell
rg -n "launchDeviceMobile \|\||dpr >= 1\.25 \|\||hostMobileLike === true$" src\bootstrap\MobileViewport.ts
```

Expected result: no matches.

Verify the source contains the latest guard names:

```powershell
rg -n "desktopPointerProfile|hostMobileHint|viewportPortraitBeatsLandscapeHint" src\bootstrap\MobileViewport.ts
```

Expected result: matches for all three names.

Verify the built HTML has no live background image DOM:

```powershell
rg -n '<div class="background-container"|<img[^>]*fullscreen_bg' index.html dist\index.html
```

Expected result: no matches.

Verify `fullscreen_bg.webp` is still copied:

```powershell
Test-Path .\dist\fullscreen_bg.webp
```

Expected result: `True`.

## Manual Browser Verification

Test at least these scenarios:

1. Local dev server portrait mobile viewport:
   - game visible
   - no modal
   - `document.documentElement.dataset.tbOrientation` is `portrait`

2. Local dev server landscape mobile viewport:
   - modal visible
   - game cannot be clicked behind modal
   - `data-tb-orientation` is `landscape`

3. Real Android Chrome portrait and landscape:
   - modal opens in landscape
   - closes after rotating back to portrait
   - no side gaps in fullscreen/soft fullscreen

4. Real iPhone Safari portrait and landscape:
   - modal opens in landscape
   - native fullscreen may be unsupported, but soft fullscreen still sizes correctly
   - no invisible blocker after returning to portrait

5. Desktop browser normal:
   - no modal softlock
   - `?device=mobile` alone does not force a modal

6. Desktop DevTools mobile emulation:
   - modal behavior follows actual emulated orientation and viewport
   - no permanent modal when returning to portrait
   - if the emulated viewport is portrait while desktop `screen.orientation` is landscape, `data-tb-orientation` should be `portrait`

7. Embedded iframe launcher:
   - background stays behind Phaser
   - modal appears above game and background
   - fullscreen button does not bypass the modal
   - `?device=mobile` alone does not make desktop iframe sessions mobile

8. Native fullscreen on mobile where supported:
   - enter fullscreen
   - rotate landscape
   - modal appears above fullscreen game

9. Provider-style desktop launcher:
   - open the game in a desktop browser iframe with `?device=mobile`
   - do not enable DevTools mobile touch emulation
   - expected: `data-tb-mobile-ui="false"` and no modal softlock

10. Provider-style mobile launcher:
    - open on a real Android or iPhone through the provider iframe
    - rotate to landscape
    - expected: `data-tb-mobile-ui="true"`, modal visible, Phaser unclickable behind modal
    - rotate back to portrait
    - expected: modal hidden, Phaser clickable, no invisible overlay

## Common Porting Mistakes

### Mistake: Only copying `public/style.css`

Symptom: works locally, invisible blocker or no modal in staging.

Fix: copy and import `MobileViewport.ts`; keep full CSS in `ensureShellStyle()`.

### Mistake: Adding static modal markup to `index.html`

Symptom: duplicate modals, stale hidden states, or wrong fullscreen layering.

Fix: remove static modal markup. `ensureGate()` creates it.

### Mistake: Keeping `<img class="background-image">`

Symptom: `fullscreen_bg.webp` appears above Phaser or blocks clicks.

Fix: remove the DOM background and use CSS background.

### Mistake: Using `/style.css` or `/fullscreen_bg.webp`

Symptom: assets fail when deployed under a subpath or provider launcher.

Fix: use `./style.css` and `./fullscreen_bg.webp`.

### Mistake: Treating `device=mobile` as hard mobile

Symptom: desktop provider/DevTools is stuck in orientation modal.

Fix: keep `device=mobile` as a hint only. Use hard force keys only for QA.

### Mistake: Treating DPR As A Mobile Device

Symptom: desktop monitors with high display scaling get the mobile orientation gate.

Fix: keep `desktopPointerProfile` and do not use `dpr >= 1.25` by itself as a mobile signal.

### Mistake: Trusting Desktop `screen.orientation` Over Visible Iframe Size

Symptom: provider or DevTools shows a portrait game viewport but the modal stays open because the physical desktop screen reports landscape.

Fix: keep `viewportPortraitBeatsLandscapeHint` in `detectOrientation()`.

### Mistake: Trusting Host `landscape` Too Early

Symptom: parent page sends stale `landscape` after the iframe has returned to portrait.

Fix: host landscape must be ignored when `viewportPortraitBeatsLandscapeHint` is true.

### Mistake: Importing `MobileViewport.ts` After React Or Phaser

Symptom: first paint sizes incorrectly, background flashes above the canvas, or modal appears late.

Fix: import `./bootstrap/MobileViewport` first in the earliest browser entry file.

### Mistake: Registering A Scene Instead Of The Phaser Game

Symptom: scale refresh and fullscreen target do not update correctly.

Fix: pass the Phaser game instance returned by `new Game(...)` or `new Phaser.Game(...)` to `registerMobileViewportGame(game, { parent })`.

### Mistake: Appending gate only to `document.body`

Symptom: modal disappears when `#root` enters native fullscreen.

Fix: keep `getGateHost()` and move the gate into the active fullscreen element.

### Mistake: Not re-registering after Phaser restart

Symptom: fullscreen target, scale refresh, or input listeners point at destroyed canvas.

Fix: call cleanup before destroying old game and register the new game.

### Mistake: Removing delayed refresh passes

Symptom: wrong size after browser toolbar collapse, rotate, or iframe resize.

Fix: keep `REFRESH_DELAYS = [0, 60, 160, 320, 640, 1000]`.

## Minimum Diff Summary For A Similar Game

For a game with the same Phaser template structure, the minimum expected diff is:

```text
index.html
public/style.css
src/main.tsx
src/game/main.ts
src/bootstrap/MobileViewport.ts
```

If the game can restart Phaser, `src/game/main.ts` must include cleanup/rebind logic.

If the game has old orientation code elsewhere, remove or disable it so only `MobileViewport.ts` owns the orientation gate.

## Final Acceptance Criteria

The port is complete only when all are true:

- `src/bootstrap/MobileViewport.ts` exists in the target.
- `GAME_ID` matches the target game slug.
- `src/main.tsx` imports `./bootstrap/MobileViewport` first.
- Phaser startup calls `registerMobileViewportGame(game, { parent })`.
- Phaser restart paths clean up and re-register.
- `index.html` uses relative asset paths.
- `index.html` has no live background image DOM.
- `index.html` has no static orientation modal DOM.
- `public/style.css` contains the shell and modal visual mirror.
- `ensureShellStyle()` contains the full shell and modal visual CSS.
- Built JS contains `mobile-orientation-gate`, `tb-mobile-viewport-shell-style`, `tb-gate-seq-phone`, and `tb-gate-seq-circ-spin`.
- Source contains `desktopPointerProfile`, `hostMobileHint`, and `viewportPortraitBeatsLandscapeHint`.
- Source does not contain `launchDeviceMobile ||`, `dpr >= 1.25 ||`, or direct `hostMobileLike === true` inside compact phone detection.
- Built HTML has no `<img>` or `.background-container` for `fullscreen_bg.webp`.
- Desktop provider iframe with `?device=mobile` does not open the modal unless there is a real mobile/touch/emulated signal.
- Portrait DevTools/provider iframe does not stay locked because physical desktop `screen.orientation` is landscape.
- Real mobile and provider iframe tests pass in portrait, landscape, and fullscreen.
