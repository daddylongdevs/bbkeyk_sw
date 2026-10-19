# Slot Controller Architecture

This document describes how the controller is structured, using `slot_controller` (the demo game the core was extracted from) as the running example. The same layering applies to every consumer regardless of its game mechanics; for real-API games the canonical reference is `jungle_fruity` (external spin lifecycle — see "Spin phase vs presentation (external lifecycle)" below). For step-by-step integration into a new game, follow `IMPLEMENTATION_GUIDE.md`.

## Refactor Goals

The controller was simplified into a small set of focused pieces:

- Keep controller state in one place instead of spreading it across UI components.
- Separate Phaser rendering from controller rules and state transitions.
- Make modal flows predictable by routing them through the scene.
- Reuse Sugar Wonderland assets while keeping the game logic lightweight and readable.
- Support demo behaviors such as autoplay, bonus-mode simulation, and free-round simulation without backend dependencies.
- Keep the reusable controller core free of Phaser imports and game-specific demo assumptions.

## Current Structure

### `../core/SlotControllerCore/`

This folder is the reusable shared-core boundary.

Shared-core API:

- `SlotControllerCore`: framework-agnostic controller state machine
- `SlotControllerConfig`: pure controller config contract
- `SlotControllerState`: controller snapshot shape
- `SlotControllerAction`: emitted intent and transition events
- `SlotControllerScheduler`: injected timeout abstraction for spin and bonus timing
- `SlotControllerTimings`: adapter-supplied timing values
- `getDisplayedBonusSpinCount()`: shared selector for bonus-spin display
- `getDisplayedFreeRoundSpinCount()`: shared selector for free-round display

This folder must not import Phaser, scene classes, assets, or backend modules.

For a full migration and reuse guide, see `../core/SlotControllerCore/IMPLEMENTATION_GUIDE.md`.

### `src/game/slot/SlotControllerLogic.ts`

This file is now the `slot_controller` game adapter for the shared core.

It is responsible for:

- providing the slot-controller default config
- providing the demo timing values for spin and bonus completion
- creating the default global scheduler implementation
- preserving compatibility helpers such as `simulateBonusMode()` and `simulateFreeRoundMode()`

The shared core remains the single source of truth for controller state.

It owns:

- balance
- current bet
- feature cost
- temporary gameplay-control lock state
- autoplay state and remaining autoplay spins
- bonus-mode state and remaining bonus spins
- free-round state and remaining free-round spins
- turbo and amplify flags
- spin availability
- bet ladder bounds

The shared core exposes intent methods such as:

- `menu()`
- `requestBetOptions()`
- `requestAutoplay()`
- `requestFeature()`
- `spin()`
- `startAutoplay()`
- `toggleAutoplay()`
- `toggleTurbo()`
- `toggleAmplify()`
- `increaseBet()`
- `decreaseBet()`
- `setBet()`
- `setBalance()`
- `updateBalance()`
- `setGameplayControlsLocked()`
- `buyFeature()`
- `startBonusMode()`
- `startFreeRoundMode()`

It also exposes two outputs:

- `subscribe(listener)` for state updates
- `onAction(listener)` for action events

This keeps Phaser UI rendering separate from controller rules, while keeping game-specific defaults in the adapter layer.

Balance remains logic-owned state. External code can now either:

- replace the current balance with `setBalance()`
- apply a delta with `updateBalance()`

This gives the scene or future backend wiring a clean way to reconcile authoritative balance updates without mutating UI components directly.

### `src/game/components/SlotController.ts`

This is the Phaser HUD renderer for the slot controller.

It creates and updates:

- balance display
- bet display
- buy-feature display
- menu button
- autoplay button
- amplify button
- turbo button
- spin button visuals
- autoplay count display
- bonus free-spin display
- free-round center panel and free-round spin background swap

This class does not own controller state. It reads state from `SlotControllerLogic` and forwards user input back into logic methods.

### `src/game/scenes/Game.ts`

The `Game` scene is the composition and orchestration layer.

It creates:

- `SlotControllerLogic`
- `SlotController`
- `BetOptions`
- `AutoplayOptions`
- `BuyFeature`
- `Menu`

It listens to controller actions and decides which overlay to open or close.

It also:

- stores recent action history for the Menu history tab
- emits controller actions through `EventBus`
- renders a temporary centered text label that shows which simulation mode is active
- contains the current startup debug hook: `this.slotControllerLogic.simulateFreeRoundMode(5);`

### Overlay Components

These components are UI-only drawers or panels:

- `src/game/components/BetOptions.ts`
- `src/game/components/AutoplayOptions.ts`
- `src/game/components/BuyFeature.ts`
- `src/game/components/Menu.ts`

They receive display data when shown and call back into `SlotControllerLogic` on confirm. They do not own persistent game state.

## Data Flow

The controller now follows a simple flow:

1. `SlotController` captures button presses.
2. It calls a method on `SlotControllerLogic`.
3. `SlotControllerCore` updates internal state and emits:
   - a state snapshot through `subscribe()`
   - an action event through `onAction()`
4. `SlotController` re-renders from the new state.
5. `Game` reacts to action events and opens or closes overlays when needed.

This means:

- logic decides what is allowed
- UI only reflects state
- scene controls modal visibility

## Action Routing

`Game.handleControllerAction()` currently routes these request actions:

- `menu`
- `requestBetOptions`
- `requestAutoplay`
- `requestFeature`

Before opening one overlay, it hides the others. This keeps the modal flow exclusive and predictable.

## Temporary Gameplay Control Lock

`SlotControllerLogic` now exposes `setGameplayControlsLocked(isLocked)`.

This is a shared override for short-lived gameplay transitions, such as scatter reveal sequences, where the game should temporarily suppress primary gameplay input without pretending the controller has entered bonus mode or free-round mode.

When `isGameplayControlsLocked` is true, `SlotController` disables only these gameplay controls:

- buy feature
- bet decrement
- bet increment
- bet display panel interaction
- autoplay
- spin
- amplify bet

This lock is additive to the existing rules:

- it defaults to `false`, so current behavior remains unchanged until something explicitly enables it
- it does not replace `canSpin`
- it does not replace bonus-mode or free-round gating
- it does not affect menu or turbo, which still follow their existing rules

## Normal Spin Flow

In normal mode:

1. `spin()` checks whether a manual spin is allowed.
2. `startSpin()` verifies the player can afford the current bet.
3. On a paid base-game spin, the current bet is deducted from `balance`.
4. `startSpin()` sets `canSpin` to `false`.
5. A simulated spin runs for `1500ms`.
6. When the timer ends, the controller either:
   - returns to idle
   - advances autoplay
   - advances bonus mode
   - resolves a free-round spin and re-enables manual spin input

This project currently uses adapter-supplied local simulated timing instead of a backend round-trip.

If `balance < bet`, the spin button is disabled and `spin()` returns `false`.

### Spin phase vs presentation (external lifecycle)

Games that run their own spin presentation in the scene (rather than the core’s built-in spin timer) use an **external** presentation lifecycle. In that mode the core still owns **`canSpin`** and **`spinPhase`**:

- **`startSpin()`** sets `canSpin` to `false` and `spinPhase` to `"spinning"`.
- **`finishSpin()`** sets `canSpin` to `true`, `spinPhase` to `"idle"`, and clears `activeSpinSource`. Autoplay advancement only runs when `finishSpin` is called with `autoAdvance: true` (default).

Until **`finishSpin()`** runs, **`startSpin()`** will not accept another spin (`canSpin` is false). So if the HUD re-enables the spin control at an earlier presentation milestone than the one where the adapter calls **`finishSpin()`** (for example when symbols settle, while the win presentation is still running), a manual **spin** tap in that window would still be blocked by the core.

**Early-release pattern:** an adapter can resolve that mismatch by calling **`finishSpin({ autoAdvance: false })`** before delegating to **`super.spin()`** once its early milestone has been reached. That restores **`canSpin`** without scheduling autoplay, so the new round can start and the scene can clear or skip the remaining presentation on the new spin intent. Scope it narrowly — `jungle_fruity` applies it to manual base-game spins only, excluding autoplay, bonus, and free-round flows (see `jungle_fruity/src/game/slot/SlotControllerLogic.ts` and `jungle_fruity/docs/SLOT_CONTROLLER_BEHAVIOR.md`).

## Autoplay Flow

Autoplay is configured through `AutoplayOptions`.

When autoplay starts:

- logic first checks that the player can afford the current bet
- autoplay is enabled in logic
- the remaining autoplay count is stored in state
- the first spin starts immediately

After each simulated spin:

- autoplay decrements its remaining count
- if spins remain, the next autoplay spin starts automatically
- if not, autoplay is disabled

The autoplay button stays usable during autoplay so it can still stop the session.

If balance runs too low for the next paid spin, autoplay stops instead of continuing into an invalid state.

## Buy Feature Flow

The buy-feature flow is:

1. open `BuyFeature`
2. select a bet
3. confirm purchase
4. call `setBet()`
5. call `buyFeature()`

`buyFeature()` first verifies that the feature can be afforded, deducts `featureCost` from `balance`, and emits a `feature` action.

`Game` currently keeps the demo coupling by immediately calling `startBonusMode(10)` after a successful purchase, so the reusable core does not hardcode purchased-feature bonus entry.

The buy button is only enabled when `balance >= bet * featureMultipliers[optionIndex]` (out-of-range index uses multiplier `100`).

## Bonus Simulation Flow

Bonus mode is currently a simulated free-spin sequence.

### Starting bonus mode

Bonus mode can currently start from:

- `Game`, which currently calls `startBonusMode(10)` after a successful feature purchase
- explicit local simulation calls when testing bonus behavior

### During bonus mode

While `isBonusModeActive` is true:

- menu requests are blocked
- bet options requests are blocked
- autoplay requests are blocked
- buy-feature requests are blocked
- turbo and amplify toggles are blocked
- manual bet changes are blocked
- manual spin is blocked

The UI also changes:

- menu, autoplay, amplify, and turbo buttons are hidden
- their labels are hidden
- the spin button background is hidden
- the bonus free-spin counter is shown instead

Bonus spins do not deduct the current bet. They only consume `remainingBonusSpins`.

### Ending bonus mode

Each bonus spin consumes one free spin.

When the last free spin is consumed:

- `remainingBonusSpins` becomes `0`
- `isBonusModeActive` is set to `false`
- a `bonus` disabled action is emitted

This now happens immediately when the final free spin is consumed.

## Current Bonus Display

The bonus free-spin display was adjusted to follow the Sugar Wonderland controller style more closely.

It currently shows:

- `Remaining`
- `Free Spin :`
- a large white numeric count

The number shown is based on `getDisplayedBonusSpinCount()`, which compensates for the currently running in-flight spin so the displayed count matches what the player expects.

## Free Round Simulation Flow

Free round mode is now a separate simulated mode from bonus mode.

### Starting free round mode

Free round mode can currently start from:

- `Game.create()`, which currently triggers `simulateFreeRoundMode(5)` for startup testing
- explicit local simulation calls when testing the free-round controller behavior

### During free round mode

While `isFreeRoundModeActive` is true:

- menu requests are blocked
- bet options requests are blocked
- autoplay requests are blocked
- buy-feature requests are blocked
- turbo and amplify toggles are blocked
- manual bet changes are blocked
- manual spin is allowed
- autoplay is not used for free rounds

The UI also changes:

- the buy-feature button and its value/label are hidden
- a Sugar Wonderland-style free-spin panel is shown in the center slot instead
- the free-spin panel shows a gold bordered black panel, `FREE SPIN` label, and remaining count
- the main spin button background swaps to `freeround_bg`
- autoplay and amplify stay visible but are greyed out
- bet increment/decrement buttons are greyed out
- the bet display button remains visible but is not interactive

Free-round spins do not deduct the current bet. They only consume `remainingFreeRoundSpins`.

The displayed free-round count is based directly on `remainingFreeRoundSpins`, so it decrements immediately when a free-round spin is triggered.

### Ending free round mode

Each manual free-round spin consumes one free spin.

When the last free spin finishes:

- `remainingFreeRoundSpins` becomes `0`
- `isFreeRoundModeActive` is set to `false`
- a `freeRound` disabled action is emitted
- the free-spin center panel and free-round spin background are removed immediately after the spin completes

## Current Free Round Display

The free-round center panel was aligned to the Sugar Wonderland controller style more closely.

It currently shows:

- a gold bordered black rounded panel in the buy-feature slot
- a gold gradient `FREE SPIN` label on the left
- a stroked white numeric count on the right

Unlike the bonus counter, the free-round display does not compensate for an in-flight spin.

## Important UI Rules

### Controller rendering rules

- `SlotControllerLogic` is authoritative.
- `SlotController` should not invent state.
- Buttons should reflect logic state, not local UI guesses.
- Spin and feature controls should also reflect affordability based on `state.balance`.
- `isGameplayControlsLocked` is a temporary shared override for gameplay-only inputs and should be used for short transition windows instead of scattering per-button disables through scene code.

### Modal rules

- only one of bet options, autoplay options, buy feature, or menu should be open at a time
- opening one closes the others

### Button behavior

- turbo should not grey out after every normal spin
- autoplay can remain actionable while autoplay is active
- bonus mode hides side controls instead of greying them out
- free round mode hides the buy-feature block but greys out autoplay, amplify, and bet controls
- gameplay transition lockouts should flow through `setGameplayControlsLocked()` so the same gameplay buttons disable consistently in one place

## Current File Responsibilities

- `../core/SlotControllerCore/`: reusable state machine, actions, scheduler contract, and selectors
- `src/game/slot/SlotControllerLogic.ts`: `slot_controller` defaults and compatibility adapter over the shared core
- `src/game/components/SlotController.ts`: HUD rendering and input forwarding
- `src/game/scenes/Game.ts`: wiring, overlay routing, and action history
- `src/game/components/BetOptions.ts`: bet selection drawer
- `src/game/components/AutoplayOptions.ts`: autoplay setup drawer
- `src/game/components/BuyFeature.ts`: buy-feature drawer
- `src/game/components/Menu.ts`: rules, history, and settings overlay

## Known Temporary Debug Behavior

`Game.create()` currently contains:

```ts
this.slotControllerLogic.simulateFreeRoundMode(5);
```

This forces free round mode to start as soon as the scene loads. Remove or gate this line when the startup simulation is no longer needed.

## Recommended Next Refactor Steps

- Move startup debug behaviors behind a flag instead of hard-coding them in `Game.create()`.
- Consider whether bonus simulation and purchased-feature entry should remain coupled if those flows diverge later.
- If free round mode becomes backend-driven, keep its state transitions centralized in `SlotControllerLogic` instead of moving them into Phaser UI code.
- If backend gameplay is added, keep `SlotControllerLogic` as the UI-facing state layer and let server results feed into it instead of coupling Phaser components directly to backend responses.
