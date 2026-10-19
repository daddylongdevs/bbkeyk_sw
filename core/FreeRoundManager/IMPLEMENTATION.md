# FreeRoundManager — Integration Guide

Shared initialization free-rounds UI for slot games. Construct **once** in `Game.ts` after `SlotController.create`; the manager then reacts to backend events.

Reference implementation games: `trippy_cat`, `mad_freaks`, `jungle_fruity`.

---

## Quick create shape

```ts
import { FreeRoundManager } from '@core/FreeRoundManager';

this.freeRoundManager = new FreeRoundManager();

// Skip when an unresolved bonus spin takes priority.
if (!unresolvedSpinManager.hasUnresolvedSpin) {
  this.freeRoundManager.create({
    scene: this,
    gameAPI: this.gameAPI,
    slotController: this.slotController,
    deps: {
      getText: (key) => localizationManager.getTextByKey(key) ?? LOCALIZATION_DEFAULTS[key] ?? key,
      formatCurrencyNumber,
      getCurrencyPrefix: (isDemo) => (isDemo ? '' : CurrencyManager.getCurrencyCode()),
      gameState: {
        get isReelSpinning() { return gameStateManager.isReelSpinning; },
        get isShowingWinDialog() { return gameStateManager.isShowingWinDialog; },
        get isShowingWinlines() { return gameStateManager.isShowingWinlines; },
        get isBonus() { return gameStateManager.isBonus; },
        get isProcessingSpin() { return gameStateManager.isProcessingSpin; },
        setInFreeSpinRound: (active) => { gameStateManager.isInFreeSpinRound = active; },
        isInFreeSpinRound: () => gameStateManager.isInFreeSpinRound,
      },
      events: {
        on: (event, handler) => gameEventManager.on(event as GameEventType, handler),
      },
      rewardPanelDelayMs: 500,
    },
  });

  // Apply init free-spin bet if present. Do NOT call enableFreeSpinMode / setFreeSpins —
  // create() owns delayed enable + start panel.
  // The opening ladder bet (getStartingBet) is applied again when the grant ends.
  if (initData?.hasFreeSpinRound && initFsRemaining > 0 && initFsBet > 0) {
    this.slotController.updateBetAmount(initFsBet);
  }
}
```

---

## Integration checklist

Complete these before shipping FRM on a new game.

### 1. GameStateManager
- [ ] Typed `isInFreeSpinRound` getter/setter on `GameStateManager` (not an untyped `as any` flag).
- [ ] Cleared in `reset()` / included in `getState()` when present.

### 2. SlotController port (`FreeRoundSlotControllerPort`)
- [ ] `getSpinButton()` / `getSpinIcon()` / `getAutoplayStopIcon()`
- [ ] `getPrimaryControllersContainer()` (recommended for correct depth/parenting)
- [ ] `disableControlsForFreeRounds()` — hide buy-feature row; disable autoplay / amplify / bet UI
- [ ] `enableControlsAfterFreeRounds()` — restore the above, then set the bet back to the initialization opening bet (see §9)
- [ ] `setAwaitingFreeRoundStartPrompt(awaiting)` — lock spin until start modal is dismissed
- [ ] `isAwaitingFreeRoundStartPromptActive()` — used by SPACE hotkey gating
- [ ] Honor `gameStateManager.isInFreeSpinRound` for free/no-charge spins and control locks
- [ ] `applyFreeRoundIdleControlState()` — idempotently restore the FR idle state after a playable spin: autoplay/amplify/all bet controls disabled and non-interactive; feature hidden and non-interactive; menu/turbo/spin enabled when no normal spin or modal lock applies
- [ ] Every playable free-round spin, including complete / partial, updates the HUD from payload `balance` through the normal spin settlement flow. Defer unplayed failed / cancelled envelopes until modal close (`applyFreeRoundEndBalance` / `shouldDeferFreeRoundWalletUntilModal`).
- [ ] On `fsStatus` `failed` / `cancelled`: abort reel play, emit `FREEROUND_SPIN_ABORTED`, do not show generic bet-failed popup

### 3. SPACE / hotkey gating
- [ ] Block spin when `slotController.isAwaitingFreeRoundStartPromptActive()` **or** `freeRoundManager?.isPromptVisible() === true`

### 4. GameAPI
- [ ] Implements `getInitializationData()`, `getRemainingInitFreeSpins()`, `getInitFreeSpinBet()`
- [ ] Flag-driven `isFs`: set `isFs = true` when `isInFreeSpinRound && !isBonus` (and not buy-feature). Do **not** locally decrement a free-spin counter for tagging.
- [ ] Emit `FREEROUND_COUNT_UPDATE` with `FreeRoundCountUpdateDto` (`fsCount`, `fsStatus`, `fsTotal`, `fsTotalAccumulatedWin`, `balance`, `totalWin` from `slot.totalWin`). A numeric `fsCount` is still accepted (treated as `pending`). Complete / partial modals display `fsTotalAccumulatedWin`.
- [ ] On 422 “No valid freespins”, emit `{ fsCount: 0, fsStatus: "complete" }`. Do **not** clear `isInFreeSpinRound` here — the complete modal owns that.

### 5. Init gate
- [ ] Do **not** call `freeRoundManager.create(...)` when `unresolvedSpinManager.hasUnresolvedSpin` is true

### 6. Assets & copy
- [ ] Textures (or override via `deps.textures`): `spin`, `freeround_bg`, `spin_icon`, `autoplay_stop_icon`, `spin_now_button`
- [ ] Localization keys from `FreeRoundTextKey` in `types.ts`

### 7. Win accumulation
- Core listens to both `SPIN_DATA_RESPONSE` and `SPIN_RESPONSE_RECEIVED` (deduped).
- Default extractor: `extractTotalWin` (`slot.totalWin`, else `base.win + bonus.win`).
- Optional: pass `deps.extractSpinWin` or `deps.spinDataReceivedEvent` only if the game needs a custom path.

### 8. Timing
- Prefer `rewardPanelDelayMs: 500`. Avoid calling `enableFreeSpinMode()` from Game — `create()` already schedules it.

### 9. Bet when the grant ends
- [ ] While the grant is active, the HUD bet stays on `getInitFreeSpinBet()` exactly. Do not snap that stake to the nearest ladder step. Ladder clamping resumes after the grant ends.
- [ ] When the grant ends, set the bet to the initialization opening bet: `getStartingBet(betLevels, initializationData.defaultBetIndex)` from `core/shared/controllerUtils`. That is the stake `initializeBetAmount()` would have applied if the free-round bet had not replaced it. Mirror it into the bet-options panel when the game keeps one.
- [ ] Do this inside `enableControlsAfterFreeRounds()`. `finishFreeRoundMode()` calls that when the complete, partial, or cancelled panel closes.
- [ ] A failed panel closes through `restoreSpinAfterFreeRoundErrorModal()` and leaves the free-round stake in place. The grant is still active.

---

## Ownership split

| Owner | Responsibility |
|---|---|
| **FreeRoundManager** | Info HUD, start / complete / partial / failed / cancelled panels, spin re-skin, `isInFreeSpinRound` via deps, HUD remaining from `fsCount` |
| **Game.ts** | Construct once, unresolved-spin gate, init bet apply, SPACE blockers |
| **SlotController** | Port methods, spin lock during prompts, control disable/enable, freeze balance, abort failed/cancelled spins, apply envelope balance on modal close, restore the initialization opening bet when the grant ends |
| **GameAPI** | `isFs` tagging from flag, `FREEROUND_COUNT_UPDATE` from backend envelope |

Does **not** require `SlotControllerCore`.
