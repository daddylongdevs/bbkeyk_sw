# Apply `core/ModalManager` to a game project

Guide for migrating a slot game onto the shared modal system used by **blockchain_blitz**.

**Reference implementation:** `blockchain_blitz/src/managers/ModalManager.ts`  
**Shared package:** `core/ModalManager/` (`createModalManager`, `GenericModal`, `MODAL_LAYOUT`, `ERROR_CODE_MAP`, `MODAL_SPEC`)

Projects differ (file layout, event names, whether they have Replay / Currency / Preloader bootstrap modals). Use the discovery checklist first, then only apply steps that match what exists.

---

## Goals

- One construction path: core `GenericModal` + locked `MODAL_LAYOUT` (same spacing/look everywhere).
- API errors go through `checkAndHandleModal` (core owns `ERROR_CODE_MAP`).
- Project keeps a **thin adapter** only: scene lookup, localization injection, event hooks, optional Replay.
- Delete duplicate per-popup classes (`BetFailedPopup`, `TokenExpiredPopup`, etc.) when replaced.
- Include **bet limit exceeded** localization (`DJ400BL` → `BET_LIMIT_EXCEEDED`).

---

## Non-goals / do not change in core for a port

- Do **not** copy layout knobs into the project.
- Do **not** redefine `ERROR_CODE_MAP` / `MODAL_SPEC` / priorities in the project.
- Do **not** pass `bodyKey` / button label keys from the project — core resolves via `MODAL_SPEC` + injected localization.
- Replay / UnresolvedSpin custom UIs may stay project-local (`forceShow` / local components).

---

## Phase 0 — Discover (always)

Inspect the target project and record answers (paths will vary):

| Question | What to search / check |
|----------|-------------------------|
| Existing popup orchestrator? | `PopupManager`, `checkAndHandlePopup`, `showPopup` |
| Per-type popup classes? | `*Popup.ts` under `components` / `managers` |
| Who calls popups on API errors? | `GameAPI`, `*API.ts`, spin/bet fetch handlers |
| Out-of-balance / offline UX? | `SlotController`, HUD, bet buttons |
| Uses `core/SlotControllerCore`? | `SlotControllerLogic.ts` extends `SlotControllerCore`; also check HUD `SlotController.ts` |
| Session / idle / token UX? | token refresh failure, idle timeout |
| Preloader bootstrap failure? | `Preloader`, `GameLoadingFailed` |
| Currency missing popup? | `CurrencyManager` or similar |
| Replay prompt? | `ReplayPopup`, `forceShowReplay` |
| Localization module? | `LocalizationData`, `LOCALIZATION_DEFAULTS`, `localizationManager` |
| Event bus for bet-failed autoplay? | `BET_FAILED_ERROR`, `BET_FAILED_POPUP_CLOSED`, or Logic `pauseAutoplay("betFailed")` |
| Phaser game global + scene keys? | `window.phaserGame` / `window.game`, scenes named `Game` / `Preloader` or other |
| Vite already allows `../../core`? | `vite/config.*.mjs` → `server.fs.allow` (see aztec / blitz) |
| Relative import depth to repo `core/`? | e.g. from `src/managers` → `../../../core/ModalManager` |

**Stop and adapt** if the project has no popup system yet — still add adapter + wire API error paths + localization keys, but skip “delete old popup classes.”

---

## Phase 1 — Tooling

1. Ensure Vite can serve/import repo `core` (if using Vite):

```js
// vite/config.dev.mjs (and prod if needed)
import { fileURLToPath } from 'node:url';
// ...
server: {
  fs: {
    allow: [
      fileURLToPath(new URL('..', import.meta.url)),
      fileURLToPath(new URL('../../core', import.meta.url)),
    ],
  },
},
```

2. Confirm the project loads (or will load) standard modal assets under default keys (or plan a `theme` alias):
   - Texture: `long_button`
   - Fonts: `Poppins-Regular`, `Poppins-Bold`  
   If keys differ, pass optional `theme: { buttonTextureKey, fontFamily, fontFamilyBold }` into `createModalManager` — **layout still comes from core**.

---

## Phase 2 — Thin project adapter

Create (or replace) something like `src/managers/ModalManager.ts` modeled on Blitz:

```ts
import {
  createModalManager,
  ModalType,
  type BackendErrorResponse,
} from '../../../core/ModalManager'; // adjust relative path
import { /* project event bus */ } from '../event/EventManager';
import { localizationManager } from './LocalizationManager'; // or project equivalent
import { LOCALIZATION_DEFAULTS } from '../backend/LocalizationData'; // or project equivalent

function getGameScene(): unknown | null {
  // Adapt to this project's Phaser access + scene keys
  try {
    const phaserGame = (window as any).phaserGame /* or .game */;
    if (!phaserGame?.scene) return null;
    return (
      phaserGame.scene.getScene?.('Game') ??
      phaserGame.scene.getScene?.('Preloader') ??
      // add project-specific scene keys if different
      null
    );
  } catch {
    return null;
  }
}

export const modalManager = createModalManager({
  getScene: getGameScene,
  localization: {
    getText: (key) => localizationManager.getTextByKey(key), // adapt API name
    defaults: LOCALIZATION_DEFAULTS,
  },
  // Optional: theme: { buttonTextureKey: '...' },
  // Optional: betFailedAutoCloseMs: 2500, // core default is 2500 if omitted
  onBlockingError: (modalType) => {
    // Emit whatever this project uses to stop/pause autoplay on API errors.
    // Blitz: GameEventType.BET_FAILED_ERROR with { popupType: modalType }
  },
  onBetFailedClosed: () => {
    // Only if this project resumes autoplay after BET_FAILED dismiss/auto-close.
    // Blitz: GameEventType.BET_FAILED_POPUP_CLOSED
  },
});

export const {
  checkAndHandleModal,
  showModal,
  showBetFailureModalFromError,
  showIdleSessionExpiredModal,
  showGameLoadingFailedModal,
  clearCurrentModal,
  isModalActive,
  forceShow,
} = modalManager;

export { ModalType };
export type { BackendErrorResponse };
```

### Adapter rules

- **No** deprecated PopupManager aliases.
- **No** `errorCodeMap`, `bodyKey`, or priority in project config.
- **Replay (optional):** if the project has `ReplayPopup`, keep a local `forceShowReplayPopup` using `forceShow(ModalType.REPLAY, …)` like Blitz. If no replay, omit.
- If localization is structured differently (no `LOCALIZATION_DEFAULTS` object), build a `Record<string, string>` of defaults that at least includes the modal keys in Phase 3.

---

## Phase 3 — Localization keys (required)

Add missing keys to the project’s localization constants **and** defaults map. Key strings must match core `MODAL_SPEC.bodyKey` / `buttonKey` values.

### Required for full modal set

| Key | Suggested default (English) | Used by |
|-----|------------------------------|---------|
| `common_ok` | `OK` | Most dismiss buttons |
| `popup_generic-error` | `Something went wrong.` | `GENERIC_ERROR` (always this copy; ignore API message) |
| `popup_bet-failed` | Project existing copy, or Blitz: `We couldn't process your bet. Your credits will be refunded.` | `BET_FAILED` |
| `popup_bet-limit-exceeded` | `You have reached your betting limit.` | `BET_LIMIT_EXCEEDED` (`DJ400BL`) |
| `popup_network-offline` | Project existing / offline message | `NETWORK_OFFLINE` |
| `popup_insufficient-balance` | Project existing insufficient-balance copy | `OUT_OF_BALANCE` |
| `popup_currency-error` | Project existing currency error copy | `CURRENCY_ERROR` |
| `popup_session-expired` | Project existing session expired copy | `TOKEN_EXPIRED` |
| `popup_idle-session-expired` | Project existing idle copy | `IDLE_SESSION_EXPIRED` |
| `popup_game-loading-failed` | Project existing load-failed copy | `GAME_LOADING_FAILED` |
| `popup_reload` | `RELOAD` | `GAME_LOADING_FAILED` button |

### Bet limit exceeded (must add if missing)

```ts
export const POPUP_BET_LIMIT_EXCEEDED = 'popup_bet-limit-exceeded';

// In LOCALIZATION_DEFAULTS (or equivalent):
[POPUP_BET_LIMIT_EXCEEDED]: 'You have reached your betting limit.',
```

**Behavior (already in core):** `DJ400BL` → OK button (dismiss only, no auto-close). Autoplay **stops** on show; do not resume on hide (unlike `BET_FAILED`).

Preserve existing project-specific English for other keys when they already exist; only add gaps. Do not change key strings to “prettier” names — core `MODAL_SPEC` depends on these exact keys.

---

## Phase 4 — Rewire call sites

Map old APIs to new ones (names may differ per project):

| Old (typical) | New |
|---------------|-----|
| `checkAndHandlePopup(err)` | `checkAndHandleModal(err)` |
| `showBetFailurePopupFromError(err)` | `showBetFailureModalFromError(err)` |
| `showIdleSessionExpiredPopup()` | `showIdleSessionExpiredModal()` |
| `showGameLoadingFailedPopup(scene, opts)` | `showGameLoadingFailedModal({ scene, showReloadButton, onReload })` |
| `showPopup(OUT_OF_BALANCE, …)` / local OutOfBalance class | `showModal(ModalType.OUT_OF_BALANCE)` |
| Currency inline popup | `showModal(ModalType.CURRENCY_ERROR)` |
| `isPopupActive` | `isModalActive` |
| `clearCurrentPopup` | `clearCurrentModal` |
| `PopupType.*` | `ModalType.*` |

### API / spin layer

Wherever HTTP `!response.ok` (or equivalent) already showed a popup:

```ts
checkAndHandleModal({
  status: response.status,
  errorCode: errPayload.errorCode,
  message: errPayload.message,
});
```

Ensure `errorCode` is parsed from the backend JSON (`DJ400BL`, `DJ400BF`, `DJ401UA`, etc.). No project-side switch on `DJ400BL` is required — core maps it.

Do **not** pick `TOKEN_EXPIRED` from HTTP status (`401`, `400`, `504`, …). Pass the response `errorCode` through. Inject `DJ401UA` / `DJ401TE` **only** when the refresh-token request failed (or there is no refresh token / `tryRefresh` returned null) **and** there is no usable `errorCode` on that refresh failure. Any other failed API call uses the payload `errorCode`; missing/unknown codes fall through to `GENERIC_ERROR`.

### Autoplay / HUD

- If the project pauses autoplay only for bet-failed and stops for other blocking errors, keep comparing `modalType === ModalType.BET_FAILED` (or payload `popupType`) on the blocking-error event.
- `BET_LIMIT_EXCEEDED` should **stop** autoplay when the error is received, not use the bet-failed pause/resume path. Closing the OK button must not resume autoplay.

### SPACE hotkey overlay (when `SpaceHotkeyManager` exists)

When renaming `isPopupActive` → `isModalActive`, preserve **all** other block conditions in the spin-hotkey predicate. Common extras (include only if the project has them):

- `unresolvedSpinManager.isPopupVisible()`
- `this.slotController.isAwaitingFreeRoundStartPromptActive()`
- `this.freeRoundManager?.isPromptVisible() === true`

If `unresolvedSpinManager.isPopupVisible` is **not** available on that project, still add the line in the predicate but **commented out**, e.g.:

```ts
// unresolvedSpinManager.isPopupVisible() ||
```

Do not drop free-round checks while swapping the modal active helper — that was a real merge regression in Blitz.

### Skip when absent

- No Preloader failure UI → skip `showGameLoadingFailedModal`.
- No currency popup → skip currency rewire.
- No idle timeout → skip idle modal helper.
- No offline heuristic path → skip `showBetFailureModalFromError` or add it where fetch fails without HTTP body. That helper shows **network offline only**. `BET_FAILED` is **only** `DJ400BF` via `checkAndHandleModal`.

---

## Games using `core/SlotControllerCore`

**No changes to `core/ModalManager` code are required** for these games. ModalManager stays project-wired (scene, localization, events); SlotControllerCore stays Phaser-free. FreeRoundManager usage is unrelated aside from SPACE overlay checks.

Examples: `trippy_cat`, `jungle_fruity`, `mad_freaks`, `aztec_lost_empire`, `necronomicoin`, `bad_beach`, `slot_controller`.

### Extra call sites (beyond Blitz-style HUD)

| Area | What to rewire |
|------|----------------|
| `src/game/slot/SlotControllerLogic.ts` | Spin / offline / OOB / bet-failure paths that call `checkAndHandlePopup` or `showBetFailurePopupFromError` |
| `src/game/components/SlotController.ts` (HUD) | Still rewire local `showPopup(OUT_OF_BALANCE, …)` → `showModal(ModalType.OUT_OF_BALANCE, …)` when present |

### Lazy `import()` from Logic (required)

Contract tests run in Node and must not pull Phaser through the adapter import graph. `ModalManager` → `GenericModal` → Phaser, so **`SlotControllerLogic` must not statically import the project ModalManager** (same rule as `core/SlotControllerCore/IMPLEMENTATION_GUIDE.md`).

Use type-only + lazy load (pattern from `jungle_fruity/src/game/slot/SlotControllerLogic.ts`):

```ts
import type { BackendErrorResponse } from "../../managers/ModalManager";

// Do NOT: import { checkAndHandleModal, ... } from "../../managers/ModalManager";

function checkAndHandleModal(response: BackendErrorResponse | null | undefined): void {
  void import("../../managers/ModalManager")
    .then((modals) => modals.checkAndHandleModal(response))
    .catch((err) => console.error("[SlotControllerLogic] checkAndHandleModal failed:", err));
}

function showBetFailureModalFromError(error: unknown): void {
  void import("../../managers/ModalManager")
    .then((modals) => modals.showBetFailureModalFromError(error))
    .catch((err) => console.error("[SlotControllerLogic] showBetFailureModalFromError failed:", err));
}
```

Phaser HUD / Game / GameAPI / Preloader may keep normal static imports of the project adapter.

### Autoplay hooks

Wire adapter `onBlockingError` / `onBetFailedClosed` to **this game’s** policy — do not assume Blitz’s event pair:

- Some games emit `BET_FAILED_ERROR` / `BET_FAILED_POPUP_CLOSED` for HUD listeners.
- Core-controller games may pause/resume inside Logic (`pauseAutoplay("betFailed")`, local flags, etc.). Match existing behavior; only rename popup → modal APIs.

---

## Phase 5 — Remove obsolete project popup UI

After call sites compile against the adapter:

**Safe to delete** when no longer imported (typical Blitz/jungle set):

- `BetFailedPopup.ts`
- `NetworkOfflinePopup.ts`
- `TokenExpiredPopup.ts`
- `OutOfBalancePopup.ts`
- `GenericErrorPopup.ts`
- `IdleSessionExpiredPopup.ts`
- `GameLoadingFailedPopup.ts`
- Inline `CurrencyErrorPopup` classes
- Old `PopupManager.ts` (replaced by adapter)

**Keep for now (unless migrating in the same change):**

- `ReplayPopup.ts` (+ thin `forceShowReplayPopup` in adapter)
- Unresolved-spin (or similar) custom continue modals

---

## Phase 6 — Verify

- [ ] Vite/build resolves `core/ModalManager`
- [ ] Spin/bet `DJ400BF` → bet failed (OK + auto-close if configured). No other error path shows this modal.
- [ ] Spin/bet `DJ400BL` → bet limit exceeded, **OK** (dismiss only), no auto-close; autoplay stays stopped
- [ ] Unmapped / missing `errorCode` → generic “Something went wrong.” (not API `message`)
- [ ] `DJ401UA` / `DJ401TE` → session expired (no button), if those flows exist
- [ ] `DJ400NEB` / local insufficient balance → out of balance
- [ ] Offline / failed fetch → network or bet-failed helper, if wired
- [ ] Preloader load failure → loading failed + reload callback, if wired
- [ ] Autoplay stops (or pauses correctly) on blocking modal events
- [ ] If `SpaceHotkeyManager` exists: overlay predicate uses `isModalActive()` **and** still blocks on free-round prompts when those features exist; if `unresolvedSpinManager.isPopupVisible` is missing, leave it in the predicate commented out
- [ ] Localization defaults include `popup_bet-limit-exceeded`
- [ ] No remaining imports of deleted `*Popup` classes / old `PopupManager`
- [ ] If the game uses `SlotControllerCore`: Logic call sites rewired; **no static** ModalManager import from `SlotControllerLogic` (lazy `import()` only); Node contract test still collects

---

## Core behavior cheat sheet (do not reimplement)

| `errorCode` | `ModalType` | Button | Auto-close |
|-------------|-------------|--------|------------|
| `DJ401UA`, `DJ401TE` | `TOKEN_EXPIRED` | No | No |
| `DJ400NEB` | `OUT_OF_BALANCE` | OK | No |
| `DJ400BF` | `BET_FAILED` | OK | Yes (default 2500ms) |
| `DJ400BL` | `BET_LIMIT_EXCEEDED` | OK | No |
| _(missing/unmapped)_ | `GENERIC_ERROR` | OK | No |

Idle / network / currency / game-loading are shown via dedicated helpers or `showModal`, not only via `errorCode`.

---

## Reference file map (blockchain_blitz)

| Area | Path |
|------|------|
| Adapter | `blockchain_blitz/src/managers/ModalManager.ts` |
| Core | `core/ModalManager/*` |
| Localization + bet limit | `blockchain_blitz/src/backend/LocalizationData.ts` (`POPUP_BET_LIMIT_EXCEEDED`) |
| API errors | `blockchain_blitz/src/backend/GameAPI.ts` → `checkAndHandleModal` |
| Spin / offline / OOB | `blockchain_blitz/src/game/components/SlotController.ts` |
| Preloader | `blockchain_blitz/src/game/scenes/Preloader.ts` |
| Currency | `blockchain_blitz/src/game/components/CurrencyManager.ts` |
| Vite `fs.allow` | `blockchain_blitz/vite/config.dev.mjs` |

### SlotControllerCore reference (lazy Logic imports)

| Area | Path |
|------|------|
| Lazy popup/modal delegates | `jungle_fruity/src/game/slot/SlotControllerLogic.ts` |
| Import-graph rule | `core/SlotControllerCore/IMPLEMENTATION_GUIDE.md` (“Keep The Adapter Importable In Node”) |
| Example still on PopupManager (port target) | `trippy_cat/src/game/slot/SlotControllerLogic.ts` |

When unsure how a step should look, open the Blitz file above and mirror structure — not file paths or event enum names verbatim if this project differs. For SlotControllerCore games, also follow the jungle_fruity lazy-import pattern in Logic.
