# Default bet index

The slots initialize payload may include `defaultBetIndex`, a 0-based index into `betLevels`. That value is the bet the game starts on, unless a free-round, unresolved-spin, or replay stake already applied.

## Payload

`SlotInitializeData` in `src/backend/GameAPI.ts`:

```ts
defaultBetIndex?: number;
```

Read it from `gameAPI.getInitializationData()?.defaultBetIndex`. Do not reach into `GameAPI` from the util.

## `getStartingBet`

Lives in `core/shared/controllerUtils.ts`. Games re-export it from `src/config/GameConfig.ts`. Inject the ladder and raw index:

```ts
getStartingBet(betLevels: number[], rawIndex: unknown, fallback = 0.2, fallbackIndex = 4): number
```

Resolution order:

1. Coerce `rawIndex` with `Number(...)`.
2. If it is a finite value `>= 0`, use `Math.floor(rawIndex)`; otherwise use `fallbackIndex` (`4`, same as `STARTING_BET_INDEX`).
3. Return `betLevels[index]`, else `betLevels[0]`, else `fallback` (`0.2`).

## Call sites

| File | Usage |
|------|--------|
| `src/game/scenes/Game.ts` (`initializeBetAmount`) | Canonical start bet after boot |
| `src/game/components/SlotController.ts` (HUD create) | Initial HUD amount before `initializeBetAmount` overwrites it |
| Core-controller games | Also pass the resolved value as `initialBet` into `SlotControllerLogic` |

Both pass `betLevels` and `defaultBetIndex` in. `Game.ts` uses `gameData.betLevels`; `SlotController` uses `this.getBetLevels()`.

`initializeBetAmount` is skipped when a free-round, unresolved-spin, or replay bet was already applied.
