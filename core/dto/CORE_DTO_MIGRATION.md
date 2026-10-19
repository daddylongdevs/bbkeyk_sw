# Core DTO migration

Extract backend DTOs that are the same across games into `core/dto/`, so one change updates every consumer.

This file is a working log. Update it as each DTO moves.

---

## Conventions

- **One file per DTO.** Filename matches the main interface and both end with `Dto` (`InitFreeSpinRoundDto.ts`). Field-local helpers (status unions) stay in that file.
- Games may re-export a local alias without the suffix (`export type SlotInitializeData = SlotInitializeDataDto<SpinData>`).
- **Import as `@core/dto`.** Sugar already has the Vite + tsconfig `@core/*` alias. From a game `src/backend` file:

  ```ts
  import type { InitFreeSpinRoundDto } from "@core/dto";
  ```

  Do not use relative `../../../core/...` imports.

- **Tight types on wired fields.** Required = a caller already reads it and the flow cannot run without it. Unused / not-yet-wired fields stay optional (`?`) until something reads them — then tighten. Optional also when the backend omits it and a caller already handles that.
- **Closed string sets** use a const object + derived union (same pattern as `FreeRoundTextKey`), not a TypeScript `enum`.
- **Per-game spin payloads stay out of core.** `UnresolvedSpinDto`, `ReplayDataDto`, and `SlotInitializeDataDto` take `TSpinData = unknown`. `FreeRoundBetResponseDto` takes `TSlot = unknown`. Games specialize as `UnresolvedSpinDto<SpinData>` / `FreeRoundBetResponseDto<SlotData>` when wiring.
- **Migrate one game at a time.** Leave other games on their local copy until they are switched.

---

## Status

| DTO | Core file | Games using core | Notes |
|---|---|---|---|
| `InitFreeSpinRoundDto` | `core/dto/InitFreeSpinRoundDto.ts` | `sugar_wonderland` | Init grant only (`bet` / remaining counts) |
| `FreeRoundBetResponseDto` | `core/dto/FreeRoundBetResponseDto.ts` | `sugar_wonderland` | `isFs` envelope; Sugar + core FRM read `fsCount` / `fsStatus` / `fsTotal` / `balance` / `slot.totalWin` |
| `UnresolvedSpinDto` | `core/dto/UnresolvedSpinDto.ts` | `sugar_wonderland` | `uuid` / `index` / `response` tight; `betSize?` / `mode?` |
| `ReplayDataDto` | `core/dto/ReplayDataDto.ts` | `sugar_wonderland` | Wired: `round_id`, `created_at.date`, `currency`, `spinData`. Rest optional |
| `SlotInitializeDataDto` | `core/dto/SlotInitializeDataDto.ts` | `sugar_wonderland` | `SlotInitializeDataDto<SpinData>`; unused flags already optional |
| `LocalizationDataDto` | `core/dto/LocalizationDataDto.ts` | `sugar_wonderland` | Wired: `locale`, `maxWin`, `rtp`. Request-echo ids optional |
| `HistoryItemDto` | `core/dto/HistoryItemDto.ts` | `sugar_wonderland` | Re-exported; unused in UI — all fields optional |

---

## `InitFreeSpinRoundDto`

Initialize payload entry (`freeSpinRound[]`).

```ts
export interface InitFreeSpinRoundDto {
    bet: string;
    totalFreeSpin: number;
    usedFreeSpin: number;
    remainingFreeSpin: number;
}
```

**Not on `SpinData` or `InitFreeSpinRoundDto`.** Per-spin remaining count / status live on `FreeRoundBetResponseDto`.

---

## `FreeRoundBetResponseDto`

`/api/v1/slots/bet` body when `isFs: true`. Same envelope in every game except `slot`.

```ts
export interface FreeRoundBetResponseDto<TSlot = unknown> {
    balance: number;
    fsCount: number;
    fsStatus?: FreeRoundStatus;
    fsTotal?: number;
    slot: TSlot;
}
```

`fsStatus` values: `complete` | `pending` | `partial` | `cancelled` | `failed`.

Sugar `doSpin` types the `isFs` JSON as `FreeRoundBetResponseDto<SlotData>` and emits `FREEROUND_COUNT_UPDATE` as `FreeRoundCountUpdateDto` (`fsCount`, `fsStatus`, `fsTotal`, `balance`, `totalWin` from `slot.totalWin`). Core `FreeRoundManager` reads that payload. The same JSON is still assigned into `SpinData` so `slot` drives the reels. Omitted `fsStatus` is treated as `pending`.

---

## `UnresolvedSpinDto`

```ts
export interface UnresolvedSpinDto<TSpinData = unknown> {
    uuid: string;
    index: number;
    response: TSpinData;
    betSize?: string;
    mode?: string;
}
```

- Required: `uuid`, `index`, `response`.
- Optional: `betSize` (used when present), `mode` (not read yet).

---

## `ReplayDataDto`

Wired in Sugar: `round_id`, `created_at.date`, `currency`, `spinData`. Unused envelope fields are optional.

```ts
export interface ReplayDateTimeDto {
    date: string;
    time?: string;
}

export interface ReplayDataDto<TSpinData = unknown> {
    id?: number;
    uuid?: string;
    round_id: string;
    type?: string;
    created_at: ReplayDateTimeDto;
    updated_at?: ReplayDateTimeDto;
    currency: string;
    currencySymbol?: string;
    spinData: TSpinData;
}
```

---

## `SlotInitializeDataDto`

```ts
export interface SlotInitializeDataDto<TSpinData = unknown> {
    gameId: string;
    playerId?: string;
    sessionId: string;
    lang: string;
    currency: string;
    currencySymbol?: string;
    currencyDecimalPlaces?: number;
    betLevels?: number[];
    defaultBetIndex?: number;
    hasFreeSpinRound: boolean;
    freeSpinRound: InitFreeSpinRoundDto[] | null;
    hasUnresolvedSpin?: boolean;
    unresolvedSpinIndex?: number;
    unresolvedSpin?: UnresolvedSpinDto<TSpinData> | null;
    maxWin?: number | null;
    rtpRange?: string | null;
}
```

Legacy `freeSpinRound` as a number or loose object is GameAPI’s problem (`extractRemainingInitFreeSpins`), not the DTO.

---

## `LocalizationDataDto`

Locale endpoint body. Not the per-game help-string map in `LocalizationData.ts` key files.

```ts
export interface LocalizationDataDto {
    sessionId?: string;
    gameId?: string;
    lang?: string;
    locale: string | null;
    maxWin: number | null;
    rtp: string | null;
}
```

Sugar currently types `maxWin` / `rtp` as non-null but the mapper already assigns `null`. Core matches the mapper. `sessionId` / `gameId` / `lang` are request echo, not read after fetch.

---

## `HistoryItemDto`

Not wired in Sugar. All fields optional until a history UI reads them.

```ts
export interface HistoryItemDto {
    id?: number;
    roundId?: string;
    type?: HistoryItemType;
    gameId?: string;
    gameName?: string;
    currency?: string;
    bet?: string;
    win?: string;
    jackpotWin?: string;
    createdAt?: string;
}
```

---

## Next

1. Switch other games onto the same core files.
2. Other games can emit `FREEROUND_COUNT_UPDATE` as `{ fsCount, fsStatus, … }` when their backend adds `fsStatus`. A numeric `0` payload still maps to `pending` + complete-when-count-is-0.

---

## How to switch a game

1. Delete the local `export interface …`.
2. Import from `@core/dto` (or `@core/dto/<Name>`).
3. Re-export from `GameAPI` if other local files imported the type from there.
4. For spin-bearing DTOs: `UnresolvedSpinDto<SpinData>`, `ReplayDataDto<SpinData>`, `SlotInitializeDataDto<SpinData>`.
5. For the `isFs` bet envelope: `FreeRoundBetResponseDto<SlotData>`.
