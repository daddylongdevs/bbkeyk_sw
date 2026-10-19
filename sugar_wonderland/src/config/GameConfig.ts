/**
 * Game Configuration Constants
 * Centralized configuration for the slot game
 */

// Grid Configuration
export const SLOT_COLUMNS: number = 5; // number of rows
export const SLOT_ROWS: number = 6; // number of columns
export const STARTING_BET_INDEX: number = 4;

// Symbol Configuration
export const SCATTER_SYMBOL: number[] = [0]; // Renamed from SCATTER_SYMBOL
export const NORMAL_SYMBOLS: number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9];
export const MULTIPLIER_SYMBOLS: number[] = [10,11,12,13,14,15,16,17,18,19,20,21,22]; // 12 = x2, 13 = x3, 14 = x4
export const ALL_SYMBOLS: number[] = [...SCATTER_SYMBOL, ...NORMAL_SYMBOLS, ...MULTIPLIER_SYMBOLS];

// Timing Configuration
export const DELAY_BETWEEN_SPINS: number = 3000;
// Ratio for time between column starts relative to DELAY_BETWEEN_SPINS
export const DROP_REEL_START_INTERVAL_RATIO: number = 0.08;

// Idle / session timeout (minutes); converted to ms where needed
export const MAX_IDLE_TIME_MINUTES: number = 20;

/** Marketing / help / preloader fallback when slot init and locale omit maxWin. */
export const MAX_WIN_MULTIPLIER: number = 21000;

/**
 * Delay before re-enabling controller buttons (spin, bet options, amplify, buy feature, etc.)
 * after the TotalWin-equivalent dialog (Congrats_KA) or MaxWin drawer closes.
 * Applies to manual close, autoplay continuation, and paused-autoplay resume.
 */
export const WIN_DIALOG_CONTROLS_REENABLE_DELAY_MS: number = 2000;

/**
 * Minimum time before a player can dismiss a dialog via click or SPACE (manual input only).
 * Big / Mega / Epic / Super tier dialogs (SmallW_KA … SuperW_KA).
 */
export const DIALOG_MANUAL_DISMISS_DELAY_MS_WIN_TIERS: number = 3000;

/**
 * Total (Congrats_KA), Max Win drawer, free-spin, and retrigger (FreeSpinDialog_KA) dialogs.
 * Win summary dialogs (Congrats_KA / MaxWin) also use DIALOG_MIN_CLOSE_DELAY_MS via getManualDismissDelayMs.
 */
export const DIALOG_MANUAL_DISMISS_DELAY_MS_SUMMARY: number = 1000;

/** Minimum delay before win / bonus-summary dialogs can be manually closed. */
export const DIALOG_MIN_CLOSE_DELAY_MS: number = 3000;

/** Auto-close delay for tier win dialogs (SmallW … SuperW). MaxWin is excluded. */
export const WIN_DIALOG_AUTO_CLOSE_MS: number = 10000;

/** Auto-close delay for bet-failed popup while autoplay is active (matches shuten_doji). */
export const BET_FAILED_POPUP_AUTO_CLOSE_MS: number = 2500;

// Winline Configuration
export const WINLINES: number[][][] = [
  [
    [1, 1, 1, 1, 1],
    [0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0],
  ],
  [
    [0, 0, 0, 0, 0],
    [1, 1, 1, 1, 1],
    [0, 0, 0, 0, 0],
  ],
  [
    [0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0],
    [1, 1, 1, 1, 1],
  ],
  [
    [0, 1, 1, 1, 0],
    [1, 0, 0, 0, 1],
    [0, 0, 0, 0, 0],
  ],
  [
    [0, 0, 0, 0, 0],
    [1, 0, 0, 0, 1],
    [0, 1, 1, 1, 0],
  ],
  [
    [0, 0, 1, 0, 0],
    [1, 1, 0, 1, 1],
    [0, 0, 0, 0, 0],
  ],
  [
    [0, 0, 0, 0, 0],
    [1, 1, 0, 1, 1],
    [0, 0, 1, 0, 0],
  ],
  [
    [1, 1, 0, 1, 1],
    [0, 0, 0, 0, 0],
    [0, 0, 1, 0, 0],
  ],
  [
    [0, 0, 1, 0, 0],
    [0, 0, 0, 0, 0],
    [1, 1, 0, 1, 1],
  ],
  [
    [1, 0, 0, 0, 1],
    [0, 1, 0, 1, 0],
    [0, 0, 1, 0, 0],
  ],
  [
    [0, 0, 1, 0, 0],
    [0, 1, 0, 1, 0],
    [1, 0, 0, 0, 1],
  ],
  [
    [0, 0, 0, 1, 1],
    [0, 0, 1, 0, 0],
    [1, 1, 0, 0, 0],
  ],
  [
    [1, 1, 0, 0, 0],
    [0, 0, 1, 0, 0],
    [0, 0, 0, 1, 1],
  ],
  [
    [0, 0, 0, 1, 0],
    [1, 0, 1, 0, 1],
    [0, 1, 0, 0, 0],
  ],
  [
    [1, 0, 0, 0, 1],
    [0, 0, 0, 0, 0],
    [0, 1, 1, 1, 0],
  ],
  [
    [0, 1, 0, 0, 0],
    [1, 0, 1, 0, 1],
    [0, 0, 0, 1, 0],
  ],
  [
    [1, 0, 0, 0, 1],
    [0, 1, 1, 1, 0],
    [0, 0, 0, 0, 0],
  ],
  [
    [0, 0, 0, 0, 0],
    [0, 1, 1, 1, 0],
    [1, 0, 0, 0, 1],
  ],
  [
    [1, 0, 1, 0, 1],
    [0, 1, 0, 1, 0],
    [0, 0, 0, 0, 0],
  ],
  [
    [0, 0, 0, 0, 0],
    [0, 1, 0, 1, 0],
    [1, 0, 1, 0, 1],
  ],
];

export { getStartingBet } from '@core/shared/controllerUtils';