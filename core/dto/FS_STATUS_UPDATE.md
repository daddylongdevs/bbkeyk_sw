# Free-round `fsStatus` / `fsTotal`

Working log for promotional (initialization) free rounds. Not the DTO migration log (`CORE_DTO_MIGRATION.md`). Not scatter/bonus `slot.freespin` items.

---

## Two payloads

| When | DTO | What it is |
|---|---|---|
| Slot initialize | `InitFreeSpinRoundDto` | Grant at session start |
| Each bet with `isFs: true` | `FreeRoundBetResponseDto<TSlot>` | Per-spin envelope |

Do not put `fsCount` / `fsStatus` / `fsTotal` on `InitFreeSpinRoundDto` or on `SpinData`. `SpinData` is the playable spin (`slot` + `bet` / `playerId`).

---

## Core DTOs

Import as `@core/dto`. Games specialize `FreeRoundBetResponseDto<SlotData>`.

### `InitFreeSpinRoundDto`

File: `core/dto/InitFreeSpinRoundDto.ts`

```ts
export interface InitFreeSpinRoundDto {
    bet: string;
    totalFreeSpin: number;
    usedFreeSpin: number;
    remainingFreeSpin: number;
}
```

Lives on `SlotInitializeDataDto.freeSpinRound` (`InitFreeSpinRoundDto[] | null`). Sugar uses remaining/bet to enter free-round mode and lock the grant stake.

### `FreeRoundBetResponseDto`

File: `core/dto/FreeRoundBetResponseDto.ts`

```ts
export const FreeRoundStatus = {
    COMPLETE: "complete",
    PENDING: "pending",
    PARTIAL: "partial",
    CANCELLED: "cancelled",
    FAILED: "failed",
} as const;

export interface FreeRoundBetResponseDto<TSlot = unknown> {
    balance: number;
    fsCount: number;
    fsStatus?: FreeRoundStatus;
    fsTotal?: number;
    fsTotalAccumulatedWin?: number;
    slot: TSlot;
}

export interface FreeRoundCountUpdateDto {
    fsCount: number;
    fsStatus: FreeRoundStatus;
    fsTotal?: number;
    fsTotalAccumulatedWin?: number;
    balance?: number;
    totalWin?: number; // slot.totalWin (per-spin; not the complete/partial modal amount)
}
```

Helpers: `resolveFreeRoundStatus` (missing → `pending`), `isUnplayedFreeRoundStatus` (`failed` / `cancelled`).

---

## GameAPI integration (Sugar)

`sugar_wonderland` is the first game on this flow. It uses `@core/FreeRoundManager`.

### Initialize

`initializeSlotSession` caches `SlotInitializeDataDto`, extracts remaining from `freeSpinRound`.

`Game.ts` + core `FreeRoundManager` then:

- set `isInFreeSpinRound`
- lock bet to grant `bet`
- show start prompt
- HUD remaining from `getRemainingInitFreeSpins()`

### Bet (`doSpin`)

Tag `isFs: true` when `buyFeat === 0` and (`isInFreeSpinRound` or remaining > 0). Do **not** decrement remaining locally.

On success:

1. Cast JSON as `FreeRoundBetResponseDto`.
2. Emit `FREEROUND_COUNT_UPDATE` as `FreeRoundCountUpdateDto` (`fsCount`, `fsStatus`, `fsTotal`, `fsTotalAccumulatedWin`, `balance`, `totalWin` from `slot.totalWin`).
3. Store remaining as `envelope.fsCount`.
4. Assign the same JSON into `SpinData` so `slot` drives the reels.

On `failed` / `cancelled`, SlotController aborts reel play (`FREEROUND_SPIN_ABORTED`) and does **not** show the generic bet-failed popup. Abort calls `Symbols.cancelClientSpinPresentation` when present so the strip snaps back to the pre-spin grid; games without that method still emit the abort event and skip the popup, but reels may stay mid-spin.

422 `"No valid freespins available"` still emits `{ fsCount: 0, fsStatus: "complete" }` (dummy idle grid). It does **not** clear `isInFreeSpinRound` — the complete modal owns that.

---

## How `fsCount` is used

Authoritative **remaining** promotional spins after this bet. HUD remaining is this value. No client decrement.

---

## How `fsStatus` and `fsTotal` are used

Wired in core `FreeRoundManager`. Every playable free-round spin, including `complete`, `partial`, and `pending` with `fsCount <= 0`, updates the HUD from payload `balance` through the normal spin settlement flow before its status modal is dismissed. Unplayed `cancelled` / `failed` responses apply their envelope `balance` after their modal closes.

| `fsStatus` | Client behavior |
|---|---|
| `pending` | Keep free-round mode. If `fsCount <= 0`, treat as complete. |
| `complete` | Play and settle the spin, then **Free Spin Done**: `{fsTotalAccumulatedWin} has been credited to your balance from {fsTotal} spins.` Ends the grant. |
| `partial` | Play and settle the spin, then **Free Spin Done**: `{fsTotalAccumulatedWin}` credited from `{fsTotal - fsCount}` spins, remaining `{fsCount}` spin(s) cancelled. Ends the grant. |
| `cancelled` | Do **not** play the spin. **Free Spin Cancelled**: no wins credited. Ends the grant. Still apply last envelope `balance` on close. |
| `failed` | Do **not** play the spin. **Free Spin Failed**: bet not consumed. Apply the envelope balance on close and continue free-round mode. No generic bet-failed popup. |

Missing `fsStatus` → `pending`.

`fsTotal` missing → init remaining / `initialFreeSpins`. Credited amount on complete / partial is last-response `fsTotalAccumulatedWin`, else the session accumulator.

---

## Later / TODO

`cancelClientSpinPresentation` (on Symbols) is what actually snaps the reel strip back on unplayed `failed` / `cancelled` spins. SlotController already optional-chains it. Add a real implementation on games that only call it today:

- rainbow_fist
- warfreaks
- shuten_doji
- pastry_cub
- grave_threat
- beelze_bop
- mars_triumph
- zero_law
- boobies_trap
- blockchain_blitz

trippy_cat defines the method but it is currently a no-op.

---

## Not this feature

- Scatter / buy-feature bonus: `gameStateManager.isBonus`, `simulateFreeSpin()`, `slot.freespin` / `freeSpin`.
- `SpinData.slot.freespin.totalWin` (bonus win total — different field).
