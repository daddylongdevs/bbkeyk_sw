import type { Scene } from "phaser";

/** Localization keys used by FreeRoundManager UI. Games map these via `getText`. */
export const FreeRoundTextKey = {
  PANEL_LABEL: "freeround_panel-label",
  REWARD_TITLE: "freeround_reward-title",
  GRANTED_SUBTITLE: "freeround_granted-subtitle",
  SPINS_LABEL: "freeround_spins-label",
  WITH_LABEL: "freeround_with-label",
  SPIN_NOW_BUTTON: "freeround_spin-now-button",
  DONE_TITLE: "freeround_done-title",
  CREDITED_LINE1: "freeround_credited-line1",
  CREDITED_LINE2: "freeround_credited-line2",
  CREDITED_FROM_SPINS: "freeround_credited-from-spins",
  CREDITED_FROM_SPIN: "freeround_credited-from-spin",
  FAILED_TITLE: "freeround_failed-title",
  FAILED_BODY: "freeround_failed-body",
  CANCELLED_TITLE: "freeround_cancelled-title",
  CANCELLED_BODY: "freeround_cancelled-body",
  PARTIAL_REMAINING_CANCELLED: "freeround_partial-remaining-cancelled",
  PARTIAL_REMAINING_CANCELLED_ONE: "freeround_partial-remaining-cancelled-one",
  OK: "common_ok",
} as const;

export type FreeRoundTextKeyId = (typeof FreeRoundTextKey)[keyof typeof FreeRoundTextKey];

/** English fallbacks when a game has not mapped a key yet. */
export const FREE_ROUND_TEXT_FALLBACKS: Record<string, string> = {
  [FreeRoundTextKey.PANEL_LABEL]: "Free\nSpin",
  [FreeRoundTextKey.REWARD_TITLE]: "Free Spin Reward",
  [FreeRoundTextKey.GRANTED_SUBTITLE]: "You have been Granted",
  [FreeRoundTextKey.SPINS_LABEL]: "Spins",
  [FreeRoundTextKey.WITH_LABEL]: "With",
  [FreeRoundTextKey.SPIN_NOW_BUTTON]: "SPIN NOW",
  [FreeRoundTextKey.DONE_TITLE]: "Free Spin Done",
  [FreeRoundTextKey.CREDITED_LINE1]: "has been credited",
  [FreeRoundTextKey.CREDITED_LINE2]: "to your balance",
  [FreeRoundTextKey.CREDITED_FROM_SPINS]:
    "has been credited to your balance from {count} free spins.",
  [FreeRoundTextKey.CREDITED_FROM_SPIN]:
    "has been credited to your balance from {count} free spin.",
  [FreeRoundTextKey.FAILED_TITLE]: "Free Spin Failed",
  [FreeRoundTextKey.FAILED_BODY]:
    "Bet failed. Free spin bet was not consumed. Please try again.",
  [FreeRoundTextKey.CANCELLED_TITLE]: "Free Spin Cancelled",
  [FreeRoundTextKey.CANCELLED_BODY]:
    "Your free spins have been cancelled. No wins credited to your balance.",
  [FreeRoundTextKey.PARTIAL_REMAINING_CANCELLED]:
    "Remaining {count} free spins has been cancelled.",
  [FreeRoundTextKey.PARTIAL_REMAINING_CANCELLED_ONE]:
    "Remaining {count} free spin has been cancelled.",
  [FreeRoundTextKey.OK]: "OK",
};

/** Event names FreeRoundManager listens for (string values match per-game GameEventType). */
export const FreeRoundEventName = {
  FREEROUND_COUNT_UPDATE: "FREEROUND_COUNT_UPDATE",
  /** Emitted when an isFs bet should not play (fsStatus failed / cancelled). */
  FREEROUND_SPIN_ABORTED: "FREEROUND_SPIN_ABORTED",
  WIN_STOP: "WIN_STOP",
  REELS_STOP: "REELS_STOP",
  WIN_DIALOG_CLOSED: "WIN_DIALOG_CLOSED",
  /**
   * Default spin-success events used for free-round win accumulation.
   * Games emit either `SPIN_DATA_RESPONSE` or `SPIN_RESPONSE_RECEIVED` (or both).
   * Pass `spinDataReceivedEvent` in deps to add an extra/custom name.
   */
  SPIN_DATA_RESPONSE: "SPIN_DATA_RESPONSE",
  SPIN_RESPONSE_RECEIVED: "SPIN_RESPONSE_RECEIVED",
} as const;

export interface FreeRoundInitializationData {
  hasFreeSpinRound?: boolean;
}

export interface FreeRoundGameAPIPort {
  getInitializationData(): FreeRoundInitializationData | null;
  getRemainingInitFreeSpins(): number;
  getInitFreeSpinBet(): number | null;
  getDemoState?(): boolean;
}

export interface FreeRoundSlotControllerPort {
  getSpinButton(): Phaser.GameObjects.Image | null;
  getSpinIcon(): Phaser.GameObjects.Image | null;
  getAutoplayStopIcon(): Phaser.GameObjects.Image | null;
  getPrimaryControllersContainer?(): Phaser.GameObjects.Container | null;
  /** Local-space anchor for the remaining-spins HUD (defaults to scene 0.5 / 0.724). */
  getFreeRoundInfoPanelPosition?(): { x: number; y: number } | null;
  disableControlsForFreeRounds(): void;
  enableControlsAfterFreeRounds(): void;
  /**
   * Re-apply the FR idle state after a playable spin settles: autoplay, amplify,
   * and bet controls disabled; feature hidden; menu, turbo, and idle spin enabled.
   */
  applyFreeRoundIdleControlState?(): void;
  setAwaitingFreeRoundStartPrompt(awaiting: boolean): void;
  getBaseBetAmount?(): number;
  /** Apply an unplayed failed/cancelled isFs envelope `balance` after its modal closes. */
  applyFreeRoundEndBalance?(balance: number): void;
  updateSpinButtonState?(): void;
  /** Re-enable spin after a recoverable FR error panel (failed status) without leaving free-round mode. */
  restoreSpinAfterFreeRoundErrorModal?(): void;
  /**
   * Spine-disc games (e.g. bad_beach): swap FR disc/VFX vs start_btn_spine + spin_icon.
   * When present, FreeRoundManager must use this instead of setTexture('spin' / 'freeround_bg').
   */
  setFreeRoundSpinButtonVisuals?(active: boolean): void;
}

export interface FreeRoundGameStatePort {
  isReelSpinning: boolean;
  isShowingWinDialog: boolean;
  isShowingWinlines: boolean;
  isBonus: boolean;
  /** True while a bet request is in flight (before reels start). */
  isProcessingSpin?: boolean;
  setInFreeSpinRound(active: boolean): void;
  isInFreeSpinRound(): boolean;
}

export interface FreeRoundEventBusPort {
  /**
   * Subscribe to a game event. Prefer returning an unsubscribe function when available.
   */
  on(event: string, handler: (...args: any[]) => void): (() => void) | void;
}

export interface FreeRoundManagerDeps {
  getText: (key: string) => string;
  formatCurrencyNumber: (value: number) => string;
  getCurrencyPrefix: (isDemo: boolean) => string;
  gameState: FreeRoundGameStatePort;
  events: FreeRoundEventBusPort;
  /**
   * Extract per-spin win from `spinData.slot` for session accumulation.
   * Defaults to `extractTotalWin` (`slot.totalWin`, else base.win + bonus.win).
   */
  extractSpinWin?: (slot: unknown) => number;
  /**
   * Extra/custom event name for free-round win accumulation.
   * Core already listens to both `SPIN_DATA_RESPONSE` and `SPIN_RESPONSE_RECEIVED`.
   * Use this only when the game emits a different spin-success event.
   */
  spinDataReceivedEvent?: string;
  /** Delay before showing the start reward panel. Default 500ms. */
  rewardPanelDelayMs?: number;
  textures?: Partial<FreeRoundTextureKeys>;
}

export interface FreeRoundTextureKeys {
  spin: string;
  freeroundBg: string;
  spinIcon: string;
  autoplayStopIcon: string;
  spinNowButton: string;
}

export const DEFAULT_FREE_ROUND_TEXTURES: FreeRoundTextureKeys = {
  spin: "spin",
  freeroundBg: "freeround_bg",
  spinIcon: "spin_icon",
  autoplayStopIcon: "autoplay_stop_icon",
  spinNowButton: "spin_now_button",
};

export interface FreeRoundManagerCreateOptions {
  scene: Scene;
  gameAPI: FreeRoundGameAPIPort;
  slotController?: FreeRoundSlotControllerPort;
  deps: FreeRoundManagerDeps;
}

/**
 * Default win extractor: prefer `slot.totalWin`, else `slot.base.win` + `slot.bonus.win`.
 */
export function extractTotalWin(slot: unknown): number {
  const s = slot as any;
  if (!s) {
    return 0;
  }

  const totalWin = Number(s.totalWin);
  if (Number.isFinite(totalWin)) {
    return totalWin;
  }

  const baseWin = Number(s.base?.win ?? 0);
  const bonusWin = Number(s.bonus?.win ?? 0);
  const fallback =
    (Number.isFinite(baseWin) ? baseWin : 0) + (Number.isFinite(bonusWin) ? bonusWin : 0);
  return fallback;
}
