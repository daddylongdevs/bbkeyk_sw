# SlotControllerCore extensions (autoplay pause + balance readiness)

Summary of additive changes to the shared core and why they exist. Full migration guidance remains in [IMPLEMENTATION_GUIDE.md](./IMPLEMENTATION_GUIDE.md).

**Status:** Core API shipped with unit tests. Contract tests live in the consuming games: `slot_controller`, `jungle_fruity`, and `mad_freaks` (`<game>/src/tests/SlotControllerCore.test.ts`). **jungle_fruity** is the first game adapter migrated to these extensions. **mad_freaks** and **trippy_cat** are on core with `spinLifecycle: "external"` but still use logic-local pause flags.

---

## Problem

Games using `spinLifecycle: "external"` (jungle_fruity, trippy_cat) needed behaviors the core did not model:

1. **Autoplay pause for bonus** — When scatter/bonus interrupts autoplay, remaining spins must be saved and restored after bonus exit. `stopAutoplay()` always cleared `isAutoplayEnabled` and `remainingAutoplaySpins`, so every game duplicated backup fields in the HUD (`autoplaySpinsBackupBeforeBonus`, `resumeAutoplayAfterBonusPending`, etc.).

2. **Autoplay soft-pause for bet-failed** (trippy policy) — During autoplay, a bet-failed popup should block the next spin without ending the session. trippy_cat kept a private `autoplayPausedForBetFailedPopup` flag in logic; jungle_fruity instead stops autoplay on `BET_FAILED_ERROR`.

3. **Balance readiness** — Adapters each maintained `isBalanceInitialized` + waiter sets so paid spins do not run before `BALANCE_INITIALIZED`. Same pattern was copy-pasted in jungle_fruity and trippy_cat logic.

4. **Amplify spin cost** — Enhanced-bet cost uses `config.enhancedBetMultiplier` (default **1.25**) in `getEffectiveBetAmount()` / `startSpin`. Public **`getEnhancedBetMultiplier()`** exposes the resolved value for HUD/modals. Jungle Fruity removed `GameData` mirrors for amplify state and multiplier.

Presentation state (reel motion, win animations, dialogs — whatever mechanics the game has) stays in `GameStateManager` / HUD — not added to core.

---

## What changed

### State (`types.ts`)

| Field | Default | Purpose |
|-------|---------|---------|
| `isBalanceReady` | `true` | Backward compatible. Adapters that opt in set `false` until wallet is ready. |
| `pausedAutoplaySpins` | `0` | Spins to restore on `resumeAutoplay()` after bonus pause. |
| `autoplayPauseReason` | `null` | Why autoplay is paused: `"bonus"`, `"betFailed"`, or `"user"`. |

New type: `SlotControllerAutoplayPauseReason` — the **reason tag** only (not full pause state). Named with `Reason` so it is not confused with “is paused” boolean or a pause snapshot object.

### Config

- `enhancedBetMultiplier?: number` — optional; defaults to **1.25** when omitted (preserves previous hardcoded behavior).

### Methods (`SlotControllerCore.ts`)

| API | Behavior |
|-----|----------|
| `pauseAutoplay(reason, options?)` | **bonus / user:** sets `isAutoplayEnabled: false`, saves `pausedAutoplaySpins`, emits `autoplayPaused`. Re-entrant bonus pause does not clobber saved count. **betFailed:** soft pause — keeps `isAutoplayEnabled: true`, blocks autoplay advance until `resumeAutoplay()`. |
| `resumeAutoplay()` | Clears bet-failed soft pause, or calls `startAutoplay(pausedAutoplaySpins)` when bonus pause pending and not in bonus/free-round. Emits `autoplayResumed` on success. |
| `stopAutoplay({ clearPause? })` | **Unchanged default:** ends session and clears pause cache (`clearPause: true`). Optional `clearPause: false` for HUD paths that must stop visuals without dropping resume cache. |
| `hasPausedAutoplay()` | `pausedAutoplaySpins > 0` or `autoplayPauseReason !== null`. |
| `setBalanceReady(ready)` | Updates `isBalanceReady`; emits `balanceReady` action. |
| `waitUntilBalanceReady()` | Promise resolved when balance becomes ready (replaces per-adapter waiter sets). |
| `getEffectiveBetAmount(bet?, amplifyEnabled?)` | Resolved spin/display cost (base or base × `getEnhancedBetMultiplier()`). |
| `getEnhancedBetMultiplier()` | Public accessor for `config.enhancedBetMultiplier` (default **1.25**). |

### Behavior adjustments

- `activateBonusMode()` — if autoplay is active, calls `pauseAutoplay("bonus")` instead of `stopAutoplay()`, so bonus entry preserves remaining spins even when the HUD did not pause first.
- `advancePendingSpin()` / post-spin autoplay advance — no-op while `autoplayPauseReason === "betFailed"`.
- Paid `startSpin` — blocked when `!isBalanceReady` (bonus/free-round spins exempt).

### Actions (adapter hooks)

- `autoplayPaused` — GSM/UI sync when session is hidden but spins are saved (e.g. emit `AUTO_STOP` without losing cache).
- `autoplayResumed` — after `resumeAutoplay()`.
- `balanceReady` — after `setBalanceReady()`.

### Tests

Extended `slot_controller/src/tests/SlotControllerCore.test.ts`: bonus pause/resume, `stopAutoplay` clears cache, bet-failed soft pause, balance readiness, `waitUntilBalanceReady`.

---

## Backward compatibility

- Existing `stopAutoplay()`, `startAutoplay()`, `finishSpin()`, bonus/free-round flows unchanged unless callers opt into new APIs.
- `isBalanceReady` defaults to **true** so games that do not call `setBalanceReady(false)` behave as before.
- `enhancedBetMultiplier` defaults to **1.25** — same effective spin cost as the old literal.
- `getEnhancedBetMultiplier()` is **public** on `SlotControllerCore` for HUD/modal display wiring.
- No Phaser, backend, or presentation flags in core.

---

## Consumer migration

| Game | Status |
|------|--------|
| **jungle_fruity** | Migrated: HUD `pauseAutoplayForBonus` / `resumeAutoplayIfPending` delegate to `logic.pauseAutoplayForBonus()` / `resumeAutoplayAfterBonus()`; balance waiters use core `setBalanceReady` / `waitUntilBalanceReady`. **Bet-failed:** soft pause via `pauseAutoplayForBetFailed()` / `resumeAutoplayAfterBetFailed()` (not `stopAutoplay()`). **Amplify:** `GameData` no longer mirrors amplify—`isAmplifyEnabled` and `enhancedBetMultiplier` read from core via `SlotController.isAmplifyEnabled()` / `getEnhancedBetMultiplier()`; modals and `doSpin` use the same source. See `jungle_fruity/docs/SLOT_CONTROLLER_BEHAVIOR.md` §10. |
| **mad_freaks** | **Not migrated to the pause/balance extensions** — on core with `spinLifecycle: "external"` and a contract test, but keeps a logic-local `pauseAutoplayForBetFailedPopup` flag instead of core `pauseAutoplay("betFailed")`. |
| **trippy_cat** | **Not migrated** — keeps local HUD backup fields and logic `autoplayPausedForBetFailedPopup`; no contract test. Can adopt core pause API in a future PR without changing gameplay if adapters mirror current semantics. |

---

## Naming reference

- `SlotControllerAutoplayPauseReason` — union of pause **causes**, used by `pauseAutoplay(reason)` and `autoplayPauseReason` state.
- `pausedAutoplaySpins` — **count** to restore (bonus path).
- `autoplayPauseReason` — **which** pause policy applies (bonus hard-pause vs bet-failed soft-pause).
