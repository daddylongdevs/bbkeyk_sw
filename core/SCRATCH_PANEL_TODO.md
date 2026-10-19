# TODO: Shared scratch card implementation and renderer review

Status: TODO. This document plans future implementation; it does not change game behavior.

## Goal

Move reusable scratch card code into `core/scratch/`. Each game should enable scratch through a small integration and provide a small helper describing which symbols and authored animations to use. Keep the implementation direct, with one shared owner for each behavior.

## Renderer choice

Prefer WebGL for panels with complex, live Spine win animations. Canvas 2D remains suitable for panels dominated by static images and cached animation frames. Choose using measurements on target devices before migrating an existing panel.

| Area | Canvas 2D | WebGL |
| --- | --- | --- |
| Simple cards and scratching | Convenient image compositing, erasing, and pixel operations. | Supports masks and render textures; implementation needs more rendering setup. |
| Live Spine animations | Mesh triangle drawing can be expensive and require custom mesh/blend handling. | Better suited to complex meshes, blending, and live animations. |
| Animation caching | Cached frames reduce repeated paint operations, but need initial generation and memory. | Live rendering can avoid animation-frame caches; textures and buffers still need memory management. |
| Separate side panel | Avoids another WebGL context and the existing shared Spine WebGL renderer interaction. | Adds a WebGL context and requires resource cleanup and context-loss handling. |
| Current Phaser 3 integration | Existing Canvas mesh, blend, and cache fixes must remain correct. | Existing per-game Spine renderer isolation and resize handling must remain correct. |

Canvas 2D can also use GPU acceleration internally. Its paint-operation count and a WebGL draw-call count measure different work and cannot establish a performance winner by themselves.

Current examples:

- `zero_law` uses a separate WebGL scratch game. Its recorded reason for switching from Canvas was expensive Spine mesh drawing during wins. It also isolates the scratch Spine renderer and guards the main game's camera during resizing.
- `boobies_trap` and `rainbow_fist` use Canvas 2D scratch games with game-specific rendering fixes and animation caching.
- These implementation choices and recorded reasons are not a current device benchmark.

## Tasks

- [ ] Inventory scratch implementations across games, including desktop side panels and panels inside the main game.
- [ ] Record differences in assets, symbols, animations, layout, renderer, backend configuration, and game integration before extracting common code.
- [ ] Compare Canvas 2D and WebGL during scratching and simultaneous symbol wins. Record frame times, responsiveness, first-open/first-animation stalls, and memory use. Compare cold and warm cached playback separately.
- [ ] Decide the shared renderer policy from those results. Keep working Canvas implementations while evaluating WebGL; avoid a blanket migration based only on counter values.
- [ ] Move shared panel creation, scratch/reveal input, card presentation, win presentation, and panel lifecycle into `core/scratch/`.
- [ ] Move shared desktop host behavior into core: positioning, opening/closing, resizing, prewarming, and disposal. Preserve the existing mobile/in-main presentation.
- [ ] Validate the `zero_law` hidden-panel sleep/wake pilot, then include the validated behavior in the shared host and roll it out to other games.
- [ ] Consolidate duplicated scratch client, response parsing, and connection lifecycle code where the contracts match. Keep game-specific configuration and main-game integration as explicit inputs/callbacks.
- [ ] Reuse existing core scratch-button effects and Canvas animation/cache utilities. Move remaining common renderer fixes into shared code with explicit renderer/runtime scope.
- [ ] Provide one small per-game symbol helper, then pass it to the shared scratch implementation.
- [ ] Migrate one representative game first, then verify both a Canvas 2D game and a WebGL game before migrating the remaining games.
- [ ] Remove replaced per-game scratch implementations after each migration is validated. Keep authored game assets in their existing game asset directories.

## Hidden-panel load reduction

Goal: retain the scratch game, textures, cached assets, and card state while stopping most recurring visual work when the panel is closed. Memory remains allocated; network/session work and necessary settlement callbacks can continue.

Current pilot: implemented only in `zero_law`'s separate desktop scratch game. Eight focused tests, scoped TypeScript checks, and its production build passed. Manual visual/device validation and measured performance improvement are still pending. Other games and the in-main scratch panel have not received this loop-sleep behavior.

- [ ] Finish the closing transition and stop transient sand/win effects before sleeping the separate scratch game's loop and disabling its input. Sleeping the loop must stop scene updates, animation/tween advancement, rendering, renderer housekeeping, and canvas clearing without destroying the game.
- [ ] After hidden prewarming completes its first frame, sleep the scratch loop until the panel opens.
- [ ] On reopening, refresh layout and retained card presentation, reset both the Phaser loop delta and the tween manager's separate clock, wake the loop, and wait for a completed game render before revealing the panel and enabling input.
- [ ] Preserve pending purchases, cashouts, wallet updates, and session handling while hidden. Keep settlement scheduling independent of the sleeping scene clock; defer expensive visual reconstruction and new animations until reopening.
- [ ] Keep the main game's loop running. For an in-main scratch panel, suspend only scratch-owned callbacks/effects rather than stopping the main game.
- [ ] Ensure final destruction still completes when the scratch loop is asleep, and clean up pending frame listeners and settlement timers.
- [ ] Verify repeated open/close, long hidden pauses, closing during a pending purchase or win/cashout, partially scratched cards, resizing/fullscreen changes, and destruction during opening.
- [ ] Compare first-open and reopen visuals, animation timing, and card/wallet state with the previous behavior. Measure closed-panel frame work, main-game frame consistency, and memory on target devices before expanding the rollout.

Reference pilot checks: [zero_law sleep/wake tests](../zero_law/tests/scratch-host-sleep.test.mjs). These are headless lifecycle/logic checks, not browser visual validation.

## Small per-game symbol helper

Keep this as a plain mapping plus small lookup functions where needed. Extract the actual common contract before choosing its final TypeScript shape. Avoid a plugin registry, game-name switches in core, or duplicated panel/client logic in the helper.

The helper should describe:

- Backend scratch symbol name and the corresponding game texture/asset path.
- Optional Spine asset key and exact authored animation names for reachable states.
- Static fallback when a symbol or animation has no Spine asset.
- Blank symbols, special multiplier symbols, badges, and legend information required by the current presentation.
- Existing symbol scale/offset adjustments where authored artwork requires them.

Core owns when and how to preload, display, animate, and dispose these visuals. The game helper supplies which visuals to use. Preserve authored animation selection, symbol mapping, prize meaning, and fallback behavior.

Game-specific endpoints, layout options, and callbacks should remain explicit configuration at the integration point rather than being hidden in the symbol helper.

## Behavior to preserve

- Scratch purchase, reveal, replay, payout, and wallet-update behavior.
- Input gating, including purchase-in-progress and open/close transitions.
- Connection cleanup, reconnect behavior, and handling of responses after a panel closes or is replaced.
- Main-game and scratch renderer isolation, resize behavior, and destruction cleanup.
- Spine blend order, transparency, animation timing/callbacks, and existing cache limits/disposal.

## Completion checks

- [ ] Migrated games use shared scratch code and retain only small integration/configuration and symbol helpers.
- [ ] Relevant type checks and builds pass; shared behavior changes have focused validation.
- [ ] Development counters report operations per frame independently for each game canvas. Canvas counters are labeled `Canvas Draws`; WebGL counters are labeled `Draw Calls`.
- [ ] Manually verify scratching, purchases, wins, multipliers, replay, panel reopening, resizing, and switching between desktop and mobile layouts.
- [ ] Manually verify main-game symbols remain correct while scratch opens, resizes, animates, and closes.
- [ ] Check target-device frame times and memory, including first-use stalls and repeated open/close cycles.
- [ ] Closed or prewarmed desktop scratch games retain their resources while their visual loops sleep; reopening paints a fresh frame before showing, and pending settlement continues correctly.

Leave game launches and browser/device testing to the user unless explicitly requested.

## References

- [Existing Canvas animation caching guideline](utils/CanvasAnimationFrameCache.md)
- [Shared draw-call debugger](debug/README.md)
- [Spine guidance on Canvas mesh limitations and WebGL](https://en.esotericsoftware.com/forum/d/28733-artefacts-when-rendering-spine-character-using-spine-canvas)
- [MDN: Optimizing Canvas](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas)
- [MDN: WebGL best practices](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices)
