# Demo Mode Implementation Changes (Sugar Wonderland v2)

This document outlines the changes made to support **demo mode** functionality in **Sugar Wonderland v2**, following the same naming + detection patterns used in `rainbow_fist`.

## Overview

Demo mode allows the game to run without requiring authentication tokens or making real API calls for balance/history. When demo mode is active, the game uses mock data and simplified API interactions, and keeps a local demo balance in sync with gameplay events.

## Changes Made

### 1. `src/backend/GameAPI.ts`

#### Constants Added

- **`GAME_ID`**
  - Used in demo spin requests and URL token generation request body
  - Current value: `'00010525'`

- **`DEMO_BALANCE`**
  - Default demo balance
  - Current value: `10000`

#### Methods Modified

##### `initializeGame()`
- **Demo Storage**: when the `demo` URL param is detected, it is stored in both `localStorage` and `sessionStorage`:
  - **Note**: While demo is stored in localStorage/sessionStorage, it is no longer read from there. All demo checks now use `getDemoState()` only.
  ```ts
  localStorage.setItem('demo', isDemo);
  sessionStorage.setItem('demo', isDemo);
  ```

- **Early Return**: when demo mode is active, returns `''` and does **not** require a token.

##### `gameLauncher()`
- **Demo Cleanup**: removes `demo` from both storages during cleanup.

##### `getBalance()`
- **Demo Check**: checks for demo mode using `getDemoState()` only

- **Mock Response**: in demo mode returns:

  ```ts
  { data: { balance: GameAPI.DEMO_BALANCE } }
  ```

- **No Token / No API Call**: demo mode does not show token-expired popup and does not hit `/api/v1/slots/balance`.

##### `initializeBalance()`
- **Demo Check**: checks for demo mode using `getDemoState()` only
- **Demo Behavior**: returns `GameAPI.DEMO_BALANCE` directly in demo mode.
- **Purpose**: many flows use this as the "balance refresh" path; in demo mode it effectively refreshes UI from the in-memory demo balance.

##### `doSpin(bet, buyFeat, isEnhancedBet, isFs?)`
- **Demo Check**: checks for demo mode using `getDemoState()` only
- **Token Requirement**: only enforced when **not** in demo mode.
- **Conditional Authorization Header**: included only if a token exists.
- **Demo Endpoint**: `/api/v1/analytics/spin`
- **Normal Endpoint**: `/api/v1/slots/bet`
- **Demo Request Body**:

  ```ts
  {
    bet: bet.toString(),
    gameId: GameAPI.GAME_ID,
    isEnhancedBet,
    buyFeat, // integer flag (0 = normal spin, 1 = buy feature spin)
    isFs: false
  }
  ```

> Note: non-demo mode preserves Sugar Wonderland’s existing initialization free-spin handling (`remainingInitFreeSpins` → `isFs`).

##### `getHistory(page, limit)`
- **Demo Check**: checks for demo mode using `getDemoState()` only
- **Demo Behavior**: returns empty history immediately, no API call:

  ```ts
  {
    data: [],
    meta: { page: 1, pageCount: 1, totalPages: 1, total: 0 }
  }
  ```

#### Methods Added (same naming as `rainbow_fist`)

- **`getDemoState()`**: reads `demo` from URL params
- **`getGameId()`**: returns `GAME_ID`
- **`getDemoBalance()`**: returns `DEMO_BALANCE`
- **`updateDemoBalance(newBalance)`**: updates `DEMO_BALANCE`

---

### 2. `src/game/scenes/Preloader.ts`

#### Modified behavior

- **Demo State Logging**: logs demo state at startup.
- **Slot Session Init Skip**: `initializeSlotSession()` is skipped in demo mode, since it requires a token.
- **UI Indicator**: clock suffix includes `| DEMO` when demo mode is active.

---

### 3. `src/game/scenes/Game.ts`

#### Modified behavior

##### `WIN_STOP` handling
- In demo mode and **only in base game** (not scatter, not bonus), demo balance is increased by the win amount:

  ```ts
  if (isDemo && !gameStateManager.isScatter && !gameStateManager.isBonus) {
    this.gameAPI.updateDemoBalance(this.gameAPI.getDemoBalance() + totalWin);
  }
  ```

#### UI Indicator
- Clock suffix includes `| DEMO` when demo mode is active.

---

### 4. `src/game/components/SlotController.ts`

#### Modified behavior

##### `decrementBalanceByBet()`
- In demo mode, after deducting the bet locally, demo balance is synced:

  ```ts
  if (this.gameAPI?.getDemoState()) {
    this.gameAPI.updateDemoBalance(newBalance);
  }
  ```

##### `handleBuyFeature()`
- In demo mode, after deducting buy-feature price locally, demo balance is synced.

##### `updateBalanceFromServer()`
- In demo mode, server refresh is skipped entirely.

#### Currency Symbol Removal + Centering
- Balance, bet, and buy-feature amount fields hide currency symbols and center the numeric value when demo is active.

---

### 5. `src/game/components/Menu.ts` — History Tab

#### Modified behavior

- **Tab still visible** but **disabled** in demo mode (opacity reduced and `disableInteractive()` applied).
- **Tab switching protected**: prevents switching to `history` tab programmatically in demo mode.
- **History content**: shows `History is not available in demo mode` and makes no API calls.

---

### 6. Currency Symbol Removal Across UI

In demo mode, currency symbols are removed (or omitted) in several UI surfaces to match the `rainbow_fist` behavior:

- `Header.ts`
- `BonusHeader.ts`
- `WinTracker.ts`
- `MenuTabs/HelpScreen.ts`
- `AutoplayOptions.ts`
- `BetOptions.ts`
- `BuyFeature.ts`
- `FreeRoundManager.ts`
- `Dialogs.ts` (Congrats totals prefix)

---

## Demo Mode Detection Pattern

Throughout the codebase, demo mode is detected using this consistent pattern:

```ts
const isDemo = this.getDemoState();
```

**Note**: The previous pattern that checked `localStorage.getItem('demo') || sessionStorage.getItem('demo')` has been removed. Demo mode is now detected exclusively through URL parameters via `getDemoState()`.

This checks:
1. URL parameters via `getDemoState()` - returns `true` if `demo=true` is in the URL, otherwise `false`

## Storage Pattern

Demo value is stored in the same pattern as tokens:
- **Storage Locations**: Both `localStorage` and `sessionStorage`
- **Key**: `'demo'`
- **Value**: Stored as string `'true'` or `'false'`
- **Initialization**: Stored in `initializeGame()` when demo parameter is detected
- **Cleanup**: Removed in `gameLauncher()` during cleanup

**Important**: While demo is stored in localStorage/sessionStorage for cleanup purposes, it is **no longer read from storage**. All demo mode checks throughout the codebase now use `getDemoState()` exclusively, which reads from URL parameters only.

## Usage

### Enabling Demo Mode

Add `?demo=true` to the game URL.

Example:

```
http://localhost:8080/?demo=true
```

### Demo Mode Features

1. **No Token Required**: Game can run without authentication
2. **Mock Balance**: Returns fixed balance of 10000 (can be updated dynamically)
3. **Analytics Endpoint**: Uses analytics endpoint for spins
4. **Simplified Requests**: Uses simplified request body structure
5. **Single Balance Fetch**: Balance is only fetched once during initialization
6. **Dynamic Balance Updates**: Demo balance is updated during gameplay:
   - **Wins (base game only)**: Updated from the `WIN_STOP` handler when not in scatter/bonus
   - **Bet deductions**: Updated in `SlotController.decrementBalanceByBet()`
   - **Buy Feature deductions**: Updated in `SlotController.handleBuyFeature()`
7. **Currency Symbol Removal**: All currency symbols are hidden in demo mode, with value texts repositioned accordingly
8. **History Tab Disabled**: History tab is visible but non-interactive in demo mode, with no history API calls made

## API Behavior in Demo Mode

### Endpoints
- **Spin**: `/api/v1/analytics/spin` (demo) vs `/api/v1/slots/bet` (normal)
- **Balance**: Returns mock data, no API call
- **History**: Returns empty data, no API call

### Request Headers
- **Authorization**: Only included if token exists (optional in demo mode)

### Request Bodies
- Different structure for demo vs normal mode
- Demo mode uses simplified structure with hardcoded values

## Constants Reference

| Constant | Type | Value | Usage |
|----------|------|-------|-------|
| `GAME_ID` | `string` | `'00010525'` | Game identifier in API requests |
| `DEMO_BALANCE` | `number` | `10000` | Default balance in demo mode |

## Methods Reference

| Method | Returns | Description |
|--------|---------|-------------|
| `getDemoState()` | `boolean` | Gets demo state from URL parameters (returns `true` if `demo=true`, otherwise `false`) |
| `getGameId()` | `string` | Gets the game ID constant |
| `getDemoBalance()` | `number` | Gets the demo balance constant |
| `updateDemoBalance(newBalance)` | `void` | Updates the demo balance constant |

## Balance Management in Demo Mode

### Initial Balance
- Set to `DEMO_BALANCE` constant (10000) when game initializes
- Retrieved via `getBalance()` which returns mock data in demo mode

### Balance Updates During Gameplay
- **After Wins (base game only)**: Demo balance is updated in `WIN_STOP` event handler when not in scatter/bonus (Game.ts)
  - Adds win amount to current demo balance
  - Uses `updateDemoBalance()` to sync the constant
- **After Bet Deductions**: Balance is decremented locally in `SlotController.decrementBalanceByBet()` and demo balance is synced
- **After Buy Feature Purchase**: Balance is decremented locally in `SlotController.handleBuyFeature()` and demo balance is synced
- **No Server Calls**: Balance updates from server are skipped in demo mode

### Balance Synchronization
- `updateDemoBalance()` method allows dynamic updates to the demo balance constant
- Balance changes are tracked locally and reflected in the UI immediately
- No API calls are made to update balance in demo mode

## Notes

- Demo mode is detected at initialization and stored for the session
- All demo-related checks use `getDemoState()` exclusively (URL parameter-based detection)
- **Removed**: Code that read demo state from `localStorage.getItem('demo')` or `sessionStorage.getItem('demo')` has been removed
- Demo mode bypasses authentication requirements
- Balance updates are prevented in demo mode after initial fetch
- Demo mode uses different API endpoints optimized for analytics/testing
- Demo balance is updated dynamically during gameplay to reflect wins and bet deductions

