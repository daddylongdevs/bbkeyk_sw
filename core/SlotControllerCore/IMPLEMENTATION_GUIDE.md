# Slot Controller Core Implementation Guide

This guide explains exactly how to integrate `core/SlotControllerCore` into another game in this repo. It is intended to be followed step by step.

Current consumers you can crib from:

- **`jungle_fruity`** — the canonical reference: real backend API, `spinLifecycle: "external"`, core-owned autoplay pause/resume and balance readiness
- **`mad_freaks`** — real API, external lifecycle (still uses local bet-failed pause flags instead of core `pauseAutoplay`)
- **`trippy_cat`** — real API, external lifecycle (predates the newer core pause/balance APIs; no contract test)
- **`slot_controller`** — the original demo game the core was extracted from: simulated spin lifecycle, no backend

## Goal

The goal is to keep all reusable controller rules inside `core/SlotControllerCore` and keep each game responsible only for:

- its default config values
- its timing values
- its rendering
- its overlays
- its scene orchestration
- its backend or demo-specific mode entry decisions

In short:

- `core/SlotControllerCore` owns controller behavior
- the game adapter owns defaults and compatibility helpers
- the HUD owns rendering
- the scene owns orchestration

## What Lives Where

Use this structure as the standard layout:

- `core/SlotControllerCore/`
  - reusable controller state machine
  - reusable controller types
  - reusable display selectors
  - reusable scheduler contract
- `your_game/src/game/slot/SlotControllerLogic.ts`
  - thin adapter over `SlotControllerCore`
  - default config for that game
  - default timings for that game
  - optional compatibility helpers
- `your_game/src/game/components/SlotController.ts`
  - Phaser HUD rendering
  - state-driven button visuals
  - user input forwarding into logic methods
- `your_game/src/game/scenes/Game.ts`
  - creates logic and HUD
  - listens to controller actions
  - opens and closes overlays
  - decides when external flows should call `startBonusMode()` or `startFreeRoundMode()`
- `your_game/src/tests/SlotControllerCore.test.ts`
  - contract tests against the shared core

## Shared Core API

The reusable module exports:

- `SlotControllerCore`
- `SlotControllerConfig`
- `SlotControllerState`
- `SlotControllerAction`
- `SlotControllerScheduler`
- `SlotControllerTimings`
- `getDisplayedBonusSpinCount()`
- `getDisplayedFreeRoundSpinCount()`
- `createGlobalSlotControllerScheduler()`

The shared core must not import:

- Phaser
- scene classes
- texture keys
- backend code
- asset config
- audio systems
- game-specific modal classes

If any of those appear in `core/SlotControllerCore`, the boundary has been broken.

## Step 1: Make The Game Able To Import The Core

Before writing any game code, make sure the consuming app can import files from `../core`.

### TypeScript

Update the game `tsconfig.json` so it includes both local source and the repo-level core folder.

Example:

```json
{
  "include": ["src", "../core"]
}
```

Why this is required:

- the game imports TypeScript files from outside its own root
- TypeScript will not typecheck those files unless they are included

### Vite

If the game uses Vite, allow the dev server to read files from the repo-level core folder.

Example pattern:

```js
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  server: {
    fs: {
      allow: [
        fileURLToPath(new URL("..", import.meta.url)),
        fileURLToPath(new URL("../../core", import.meta.url)),
      ],
    },
  },
});
```

Apply the same `fs.allow` logic anywhere that Vite config is used for your game setup.

Why this is required:

- Vite blocks filesystem access outside the project root by default
- repo-level imports will fail in dev without this allowance

## Step 2: Create The Game Adapter

Each game should have a thin adapter file like:

- `src/game/slot/SlotControllerLogic.ts`

This file should import from `core/SlotControllerCore`, define game defaults, and extend `SlotControllerCore`.

Responsibilities of this adapter:

- choose the bet ladder
- choose the initial balance
- choose feature multiplier defaults
- choose simulation timings
- choose the scheduler implementation
- expose compatibility helpers if the game wants old method names

### Standard Adapter Shape

Use this pattern:

```ts
import {
  createGlobalSlotControllerScheduler,
  SlotControllerCore,
  type SlotControllerConfig,
  type SlotControllerScheduler,
  type SlotControllerTimings,
} from "../../../../core/SlotControllerCore";

export const GAME_DEFAULT_CONFIG: SlotControllerConfig = {
  balance: 200_000,
  initialBet: 0.2,
  minBet: 0.2,
  maxBet: 150,
  betStep: 0.2,
  featureMultipliers: [100], // or legacy featureMultiplier: 100 when only one option exists
  betLevels: [0.2, 0.4, 0.6],
};

export const GAME_DEFAULT_TIMINGS: SlotControllerTimings = {
  spinSimulationMs: 1_500,
  bonusCompletionMs: 600,
};

export class SlotControllerLogic extends SlotControllerCore {
  constructor(
    config: Partial<SlotControllerConfig> = {},
    options?: {
      scheduler?: SlotControllerScheduler;
      timings?: SlotControllerTimings;
    },
  ) {
    super({
      config: { ...GAME_DEFAULT_CONFIG, ...config },
      scheduler: options?.scheduler ?? createGlobalSlotControllerScheduler(),
      timings: options?.timings ?? GAME_DEFAULT_TIMINGS,
    });
  }
}
```

### Choose The Spin Lifecycle

`spinLifecycle` (passed in the `super()` options) selects who finishes a spin:

- `"simulated"` (default) — the core resolves each spin itself after `timings.spinSimulationMs`. Only for demo games with no backend (`slot_controller`).
- `"external"` — the game drives the real spin: the adapter calls the backend, the game runs its own spin presentation (whatever mechanics it has), and **the adapter must call `finishSpin()` when the game considers the round complete**. Use this for every real-API game (`jungle_fruity`, `mad_freaks`, `trippy_cat`).

Real-API adapter additions (illustrative — event names and the presentation-complete signal are game-specific; see `jungle_fruity/src/game/slot/SlotControllerLogic.ts` for one full implementation):

```ts
super({
  config: { ...GAME_DEFAULT_CONFIG, ...config },
  scheduler: options?.scheduler ?? createGlobalSlotControllerScheduler(),
  timings: options?.timings ?? GAME_DEFAULT_TIMINGS,
  spinLifecycle: "external",
});

// Gate paid spins until the wallet has loaded;
// call setBalanceReady(true) when the balance arrives.
this.setBalanceReady(false);

// Run the real backend spin when the core accepts a spin intent.
this.onAction((action) => {
  if (action.type === "spin" || action.type === "feature") {
    void this.runSpinRequest(action);
  }
});

// Release the spin phase when your game's presentation-complete event fires.
yourEventManager.on(YOUR_PRESENTATION_COMPLETE_EVENT, () => this.finishSpin());
```

With `"external"`, `canSpin` stays `false` and `spinPhase` stays `"spinning"` until your `finishSpin()` call — see "Spin phase vs presentation (external lifecycle)" in `CONTROLLER_ARCHITECTURE.md` if your HUD re-enables the spin control before the full presentation ends.

### Compatibility Helpers

If an older game already uses methods such as `simulateBonusMode()` or `simulateFreeRoundMode()`, keep them in the adapter, not the shared core.

Example:

```ts
simulateBonusMode(spinCount: number): boolean {
  return this.startBonusMode(spinCount);
}

simulateFreeRoundMode(spinCount: number): boolean {
  return this.startFreeRoundMode(spinCount);
}
```

Why this matters:

- the shared core should expose the clean canonical API
- the adapter can preserve legacy game call sites during migration

## Step 3: Re-Export Shared Types And Selectors Through The Adapter

This is optional, but strongly recommended if the rest of the game already imports from `SlotControllerLogic.ts`.

Re-export from the adapter:

- `SlotControllerState`
- `SlotControllerAction`
- `SlotControllerConfig`
- `SlotControllerTimings`
- `SlotControllerScheduler`
- `getDisplayedBonusSpinCount()`
- `getDisplayedFreeRoundSpinCount()`

Why this helps:

- game code can keep importing from one local file
- the core location stays hidden behind the adapter
- future refactors become easier

## Step 4: Keep The HUD As A Pure Renderer

Your Phaser HUD class should not own controller state.

It should only:

- subscribe to logic state
- render based on that state
- call logic methods in response to button presses

### HUD Rules

The HUD must:

- accept `SlotControllerLogic` in the constructor
- call `logic.subscribe()` on create
- render every control from state
- never store its own source of truth for balance, bet, autoplay, bonus, or free rounds

The HUD must not:

- decide whether a spin is allowed by itself
- maintain a separate balance variable
- maintain a separate autoplay count
- manually infer bonus rules that already exist in logic

### Use Shared Selectors For Shared Displays

If the UI needs:

- displayed bonus spin count
- displayed free-round count

use the shared selectors instead of duplicating the calculation in the HUD.

Use:

- `getDisplayedBonusSpinCount(state)`
- `getDisplayedFreeRoundSpinCount(state)`

This keeps all games aligned if display logic changes later.

### UI State Mapping Checklist

When rendering from `SlotControllerState`, map at least:

- `balance`
- `bet`
- `featureCost`
- `isAutoplayEnabled`
- `remainingAutoplaySpins`
- `isBonusModeActive`
- `remainingBonusSpins`
- `isFreeRoundModeActive`
- `remainingFreeRoundSpins`
- `isTurboEnabled`
- `isAmplifyEnabled`
- `canDecreaseBet`
- `canIncreaseBet`
- `canSpin`
- `isGameplayControlsLocked`

### Amplify / enhanced bet (state + config)

Do **not** duplicate amplify on `GameData` when the game uses `SlotControllerCore`. Use core only:

| Concern | Core API |
|---------|----------|
| Toggle state | `state.isAmplifyEnabled` — `toggleAmplify()` |
| Multiplier | `config.enhancedBetMultiplier` — optional; defaults to **1.25** (`getEnhancedBetMultiplier()`) |
| Effective spin / display bet | `getEffectiveBetAmount()` |

**Adapter / HUD pattern (jungle_fruity):**

- Expose thin wrappers on the Phaser HUD: `isAmplifyEnabled()`, `getEnhancedBetMultiplier()`, `getDisplayBetAmount()` via logic.
- `Game.ts` modals pass `isEnhancedBet: slotController.isAmplifyEnabled()` and `enhancedBetMultiplier: slotController.getEnhancedBetMultiplier()` into `BetOptions` / `AutoplayOptions` (modal config keys may still be named `isEnhancedBet`).
- `runSpinRequest` / `doSpin` must pass **`state.isAmplifyEnabled`** — not a mirrored `GameData` flag.
- HUD rendering should drive amplify visuals from **`state.isAmplifyEnabled`**, not a local toggle flag.

Games not yet on core may keep `GameData.isEnhancedBet` until migration; once on core, remove the mirror and stop syncing it in the adapter.

### Recommended Rendering Pattern

For every button, compute enabled or visible state from the controller state.

Examples:

- spin button enabled when the logic says the current mode allows spinning
- buy-feature button enabled only when the player can afford `featureCost`
- autoplay button stays actionable when autoplay is active so it can stop autoplay
- free-round UI state depends on `isFreeRoundModeActive`
- bonus UI state depends on `isBonusModeActive`

Do not bypass controller state for convenience.

## Step 5: Let The Scene Orchestrate Actions

The `Game` scene should create the logic instance and listen to emitted actions.

The scene is responsible for:

- opening and closing overlays
- deciding which modal is exclusive
- deciding what external flows happen after controller actions
- optionally publishing actions through an event bus
- storing action history if the game needs it

### Scene Setup Checklist

In the scene:

1. create `SlotControllerLogic`
2. create overlays such as bet options, autoplay options, buy feature, menu
3. subscribe to `logic.onAction()`
4. route request actions to overlay show or hide functions
5. create the HUD and pass the logic instance into it
6. on scene shutdown, unsubscribe and call `logic.destroy()`

### Action Routing Responsibilities

The scene should route these request actions:

- `menu`
- `requestBetOptions`
- `requestAutoplay`
- `requestFeature`

The scene should also decide what game-specific action follows a successful purchase or server result.

Important:

- `buyFeature()` now only deducts balance and emits `feature`
- the scene or backend adapter must decide whether that should enter bonus mode

Example:

```ts
if (this.slotControllerLogic.buyFeature(selectedOptionIndex)) {
  this.slotControllerLogic.startBonusMode(10);
}
```

This is intentional. It prevents the shared core from hardcoding a specific bought-feature flow.

## Step 6: Decide How Your Game Enters Bonus And Free Rounds

This is one of the most important migration rules.

The shared core provides:

- `startBonusMode(spinCount)`
- `startFreeRoundMode(spinCount)`

But it does not decide when those should happen.

Each game must decide whether mode entry comes from:

- a buy-feature confirmation
- a backend spin result
- a debug button
- a startup simulation
- a test helper

### Good Pattern

- backend or scene determines the mode entry condition
- scene or adapter calls `startBonusMode()` or `startFreeRoundMode()`

### Bad Pattern

- hardcoding purchased-feature bonus entry back into the shared core
- hardcoding a specific backend response shape inside the shared core
- importing the backend client into the shared core

## Step 7: Keep Overlay Components UI-Only

Overlay components should remain stateless UI layers.

Examples:

- bet selection drawer
- autoplay setup drawer
- buy feature dialog
- menu

These overlays should receive:

- display values
- currently selected values
- available options
- callbacks for confirm actions

They should not:

- mutate controller state directly outside callbacks
- keep authoritative copies of state
- implement controller rules on their own

## Step 8: Preserve The Gameplay Lock Contract

The shared core includes `setGameplayControlsLocked(isLocked)`.

Use it for temporary transition lockouts such as:

- scatter reveal sequences
- short transition moments before a mode change
- blocking controller actions during animations

Do not use it as a replacement for:

- bonus mode state
- free-round mode state
- affordability checks
- spin lifecycle state

The lock is additive only. It is meant to suppress gameplay inputs temporarily while still letting the core remain the source of truth.

## Step 9: Understand What The Shared Core Already Handles

Before porting a game, know which rules already exist so you do not duplicate them elsewhere.

The shared core already handles:

- bet ladder clamping
- bet up and down boundaries
- feature cost calculation
- affordability checks
- manual paid spins
- autoplay state and advancement
- bonus mode state and advancement
- free-round mode state
- paid spin balance deduction
- free spin and free-round spin no-cost behavior
- spin gating through `canSpin`
- action emission for UI orchestration
- state subscription for rendering
- bonus completion timing

The shared core does not handle:

- Phaser drawing
- texture selection
- asset loading
- overlay classes
- backend calls
- network timing
- actual reel results
- audio
- animations
- external analytics

## Presentation vs core ownership

Keep a strict split between the shared core and game presentation layers (Phaser HUD + `GameStateManager`). Reference: `jungle_fruity/docs/SLOT_CONTROLLER_BEHAVIOR.md`.

| Layer | Owns |
|--------|------|
| **`SlotControllerCore`** | Balance, bet, autoplay/bonus/free-round modes, `remainingAutoplaySpins` / `remainingBonusSpins` / `remainingFreeRoundSpins`, `spinPhase`, `activeSpinSource`, `isGameplayControlsLocked`, `isBalanceReady`, autoplay pause cache (`pausedAutoplaySpins`, `autoplayPauseReason`) |
| **`GameStateManager`** | Spin processing (`isProcessingSpin`) and the game's presentation flags — reel motion, win/dialog presentation, feature-scene state, and any other mechanic-specific substate |
| **`SlotController` HUD** | Button affordances, `getSpinBlockReason`, explicit disable on `SPIN` / `REELS_START`, manual-base early re-enable after reel stop |

Autoplay HUD must read **`logic.getState().isAutoplayEnabled`**, not `gameStateManager.isAutoPlaying` alone (GSM can lag core by a frame).

Presentation substates (reel motion, win animations, dialogs — any mechanic-specific presentation) **must not** be folded into the core state machine.

## Autoplay pause / resume contract

The core provides `pauseAutoplay(reason)`, `resumeAutoplay()`, and `stopAutoplay({ clearPause?: boolean })`.

| Method | Behavior |
|--------|----------|
| `pauseAutoplay("bonus")` | Ends the active autoplay session (`isAutoplayEnabled: false`) but saves `pausedAutoplaySpins` for `resumeAutoplay()` after bonus exit. Repeated bonus pause in one session must not clobber the saved count. |
| `pauseAutoplay("betFailed")` | Soft pause: keeps `isAutoplayEnabled: true`, sets `autoplayPauseReason: "betFailed"`, blocks `advancePendingSpin` / post-spin autoplay advance until `resumeAutoplay()`. |
| `failSpin({ stopAutoplay: false })` | On a failed **autoplay** spin, **refunds** the counter consumed at spin start so bet-failed does not burn a remaining spin. Use `stopAutoplay: true` (default) to end the session without refund. |
| `resumeAutoplay()` | Restores bonus-paused spins via `startAutoplay(pausedAutoplaySpins)` or clears a bet-failed soft pause. No-op when bonus/free-round is still active. |
| `stopAutoplay()` | Ends the session and **clears** pause cache (default `clearPause: true`). User-initiated stop and affordability hard-stop must use this. |

Aligns with `.cursor/rules/autoplay-bonus-persistence-and-control-locks.mdc`: only the Auto Play and Spin buttons may cancel an active session; bonus entry pauses and preserves count; resume is owned by a single end-of-bonus path.

`activateBonusMode()` calls `pauseAutoplay("bonus")` when autoplay is active so games that enter bonus without an explicit HUD pause still preserve remaining spins.

## Balance readiness

- `isBalanceReady` defaults to **`true`** so existing games are unchanged.
- New adapters may call `setBalanceReady(false)` in the constructor and `setBalanceReady(true)` on `BALANCE_INITIALIZED`.
- Paid spins (`startSpin` with cost > 0) are blocked while `isBalanceReady === false`.
- `waitUntilBalanceReady()` returns a promise resolved when balance becomes ready (replaces per-game waiter sets in adapters).

Bonus and free-round spins skip balance-readiness gating.

## Bonus free-spin HUD counter

`remainingBonusSpins` in core is **authoritative** for the HUD. It is set at bonus start (`activateBonusMode`) and decremented once per bonus spin at spin start (`consumeBonusSpin`).

**Do not** overwrite `remainingBonusSpins` mid-bonus from backend payload snapshots — grant-time totals are not per-step remaining counts.

Keep a **single** code path that advances bonus spins (the adapter's `advancePendingSpin` path). Any game-local loop counters are loop-control only, never a second source of truth. See `jungle_fruity/docs/SLOT_CONTROLLER_BEHAVIOR.md` for one game's concrete wiring.

## Step 10: Add Contract Tests In The Consuming Game

Every game that consumes `core/SlotControllerCore` should keep a focused contract test file.

Recommended location:

- `src/tests/SlotControllerCore.test.ts`

### Why The Tests Stay In The Game

Keeping the tests in the consuming game verifies:

- the game can import the repo-level core
- the game toolchain can compile the external module
- the game depends on the same shared contract as the others

### Recommended Test Coverage

At minimum, test:

- bet rules
- autoplay flow
- bonus mode transitions
- free-round mode behavior
- spin gating when balance is too low
- purchased-feature decoupling
- autoplay pause for bonus and `resumeAutoplay` after `completeBonusMode`
- bet-failed soft pause (`pauseAutoplay("betFailed")`) if the game uses that policy
- balance readiness (`setBalanceReady` / `waitUntilBalanceReady`) when opted in

### Keep The Adapter Importable In Node

The contract tests run in Node with vitest — there is no DOM and no `window`. Importing `phaser` at module scope crashes Node (`window is not defined` in Phaser's device detection), so **nothing the test file imports may transitively pull in Phaser**. jungle_fruity's contract test silently failed to collect for a long time because of exactly this.

Rules:

- The adapter must not statically import modules that import Phaser (popup managers, HUD components). If the adapter needs one, keep a type-only import and lazy-load the module at the call site with `import("...")` — see the `checkAndHandlePopup` / `showBetFailurePopupFromError` delegates in `jungle_fruity/src/game/slot/SlotControllerLogic.ts`.
- If the adapter or test imports the game's event manager, that module's whole import chain must be Phaser-free too. jungle_fruity's `src/game/EventBus.ts` uses a small local emitter class instead of `Phaser.Events.EventEmitter` for this reason.
- Type-only imports (`import type { ... }`) are always safe — they are erased at compile time.

### Test Fakes Must Track The Adapter

When the adapter wraps a backend client (`GameAPI`), the test's fake must stub **every** method the adapter calls — not just `doSpin`. jungle_fruity's adapter also calls `simulateFreeSpin`, `getDemoState`, `getReplayState`, and `getDemoBalance`; a missing stub surfaces as an unhandled rejection inside the action handler and the spin silently never runs.

If the adapter calls `setBalanceReady(false)` in its constructor (recommended for real-API games), the test must call `logic.setBalanceReady(true)` before expecting paid spins or autoplay to start.

### Scheduler Strategy For Tests

Use a manual scheduler instead of real timers.

The manual scheduler should:

- store callbacks in a queue or map
- expose `runNext()`
- expose task count if needed

Why this matters:

- tests stay deterministic
- tests do not wait for real time
- you can assert each transition step clearly

## Step 11: Porting Sequence For Another Game

Follow this exact order for the safest migration.

### Phase 1: Tooling

1. allow imports from `../core` in `tsconfig.json`
2. allow filesystem access to `../core` in Vite
3. verify the game can import from `core/SlotControllerCore`

### Phase 2: Adapter

1. create `src/game/slot/SlotControllerLogic.ts`
2. import `SlotControllerCore` and shared types
3. define game default config
4. define game timings
5. extend `SlotControllerCore`
6. add compatibility helpers if the old game already expects them
7. **Presentation completion:** call `finishSpin()` when your game considers the round “ready for the next intent” (usually after its win presentation, whatever mechanics that involves). Until then, `canSpin` stays false and `spinPhase` stays `"spinning"`. If the HUD re-enables **manual** spin before the full presentation ends, either delay HUD enablement or release the core spin phase early via `finishSpin({ autoAdvance: false })` (see **Spin phase vs presentation (external lifecycle)** in `CONTROLLER_ARCHITECTURE.md`; `jungle_fruity` implements the early release for manual base-game spins only).

### Phase 3: HUD

1. inject `SlotControllerLogic` into the HUD
2. subscribe to logic state
3. replace locally stored controller state with logic state
4. wire button presses to logic methods
5. use shared selectors for bonus and free-round count displays

### Phase 4: Scene

1. instantiate `SlotControllerLogic`
2. instantiate overlays
3. subscribe to `onAction()`
4. route request actions to overlays
5. decide mode-entry behavior outside the shared core
6. destroy logic and unsubscribe on shutdown

### Phase 5: Remove Old Duplicated Logic

After the new flow works:

1. delete duplicated controller state from UI classes
2. delete duplicated autoplay counters
3. delete duplicated bonus or free-round display math
4. delete direct UI-side balance mutations
5. delete old hardcoded timers if they have been replaced by the core contract

### Phase 6: Verify

Run:

- `npx tsc -p tsconfig.json --noEmit`
- the game's test command — `npm test` if the script exists, otherwise `npx vitest run`
- `npm run build`

Then manually verify:

- spin button behavior
- manual spin while the previous round's win presentation is still running (if the HUD re-enables spin before presentation ends)
- autoplay start and stop behavior
- buy-feature behavior
- bonus entry behavior
- free-round behavior
- balance updates
- lockouts during gameplay transitions
- overlay exclusivity

## Step 12: Use This Checklist During Code Review

When porting another game, review the implementation against this checklist.

### Boundary Checklist

- no Phaser imports in `core/SlotControllerCore`
- no backend imports in `core/SlotControllerCore`
- no game assets imported in `core/SlotControllerCore`
- game-specific defaults live in the adapter, not the shared core

### HUD Checklist

- HUD subscribes to logic state
- HUD does not own authoritative controller state
- HUD uses shared selectors for shared counts
- HUD only forwards intents

### Scene Checklist

- scene listens to `onAction()`
- scene opens and closes overlays
- scene owns purchased-feature follow-up behavior
- scene destroys logic on shutdown

### Testing Checklist

- contract tests exist
- tests use manual scheduler
- tests cover bet ladder behavior
- tests cover autoplay behavior
- tests cover bonus behavior
- tests cover free-round behavior
- tests cover spin gating
- tests cover `finishSpin` timing relative to the game's presentation phases (when using external presentation)
- the test file's import chain stays Phaser-free so it collects in Node

## Common Mistakes To Avoid

Do not do these during migration:

- importing Phaser into `core/SlotControllerCore`
- re-implementing `canSpin` logic in the HUD
- deducting balance directly in UI classes
- hardcoding `buyFeature()` to enter bonus in the shared core
- computing displayed bonus counts differently in each game
- forgetting to call `logic.destroy()` on shutdown
- leaving the dev server unable to access `../core`
- relying on real timers in tests
- letting the adapter statically import Phaser-dependent modules (popups, HUD, a Phaser-based event bus) — this breaks the Node contract tests

## Recommended Customization Points

These are the places where games are expected to differ safely.

### Config

Customize:

- balance
- initial bet
- min bet
- max bet
- bet step
- feature multiplier
- exact bet ladder

### Timings

Customize:

- spin simulation duration
- bonus completion duration

### Scene Behavior

Customize:

- which overlay implementation is used
- whether a purchased feature enters bonus immediately
- whether backend responses trigger bonus or free-round entry
- whether action history is displayed
- whether debug simulation hooks exist

### HUD

Customize:

- texture keys
- layout
- button positions
- animation style
- typography
- display composition

## Minimal Integration Recipe

If you need the shortest safe path for another game, do this:

1. update `tsconfig.json` to include `../core`
2. update Vite config to allow `../core`
3. create a `SlotControllerLogic` adapter that extends `SlotControllerCore`
4. instantiate that adapter in the scene
5. make the HUD subscribe to it
6. route `onAction()` events in the scene
7. call `startBonusMode()` or `startFreeRoundMode()` from the scene when your game decides to enter those modes
8. add the shared core contract tests
9. run typecheck, tests, and build

## Current Reference Implementations

**For a real-API game (what a new game will almost certainly be), use `jungle_fruity` as the baseline — it is the canonical consumer:**

- `jungle_fruity/src/game/slot/SlotControllerLogic.ts` — external-lifecycle adapter: backend API wiring, `finishSpin()` on its presentation-complete event, balance readiness, autoplay pause/resume via core
- `jungle_fruity/src/game/components/SlotController.ts` — HUD rendering from `logic.getState()`
- `jungle_fruity/src/game/scenes/Game.ts` — wiring and `onAction` routing
- `jungle_fruity/src/tests/SlotControllerCore.test.ts` — contract test (Node-safe import chain, fake `GameAPI`)
- `jungle_fruity/docs/SLOT_CONTROLLER_BEHAVIOR.md` — HUD control-lock rules and sources-of-truth table

**For a demo game with no backend (simulated lifecycle), `slot_controller` is the original extraction source:**

- `slot_controller/src/game/slot/SlotControllerLogic.ts`
- `slot_controller/src/game/components/SlotController.ts`
- `slot_controller/src/game/scenes/Game.ts`
- `slot_controller/src/tests/SlotControllerCore.test.ts`
- `slot_controller/CONTROLLER_ARCHITECTURE.md`

If another game needs the same controller behavior, start by copying the adapter and scene wiring pattern from the matching reference, then replace only:

- config values
- timings
- assets
- overlay implementations
- backend or mode-entry decisions
