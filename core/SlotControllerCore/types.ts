export interface SlotControllerConfig {
  balance: number;
  initialBet: number;
  minBet: number;
  maxBet: number;
  betStep: number;
  featureMultipliers?: number[];
  featureMultiplier?: number;
  /** Amplify/enhanced-bet cost multiplier applied to spin cost (default 1.25). */
  enhancedBetMultiplier?: number;
  betLevels: number[];
}

export type SlotControllerAutoplayPauseReason = "bonus" | "betFailed" | "user";

export interface SlotControllerState {
  balance: number;
  bet: number;
  featureCost: number;
  isGameplayControlsLocked: boolean;
  isAutoplayEnabled: boolean;
  remainingAutoplaySpins: number;
  isBonusModeActive: boolean;
  remainingBonusSpins: number;
  isFreeRoundModeActive: boolean;
  remainingFreeRoundSpins: number;
  isTurboEnabled: boolean;
  isAmplifyEnabled: boolean;
  canDecreaseBet: boolean;
  canIncreaseBet: boolean;
  canSpin: boolean;
  spinPhase: SlotControllerSpinPhase;
  activeSpinSource: SlotControllerSpinSource;
  /** When false, paid spins are blocked until `setBalanceReady(true)`. Defaults true for backward compatibility. */
  isBalanceReady: boolean;
  /** Remaining autoplay spins saved while paused (e.g. bonus entry). */
  pausedAutoplaySpins: number;
  autoplayPauseReason: SlotControllerAutoplayPauseReason | null;
}

export type SlotControllerSpinPhase = "idle" | "spinning";
export type SlotControllerSpinSource = "manual" | "autoplay" | "bonus" | "freeRound" | null;
export type SlotControllerSpinLifecycle = "simulated" | "external";

export type SlotControllerAction =
  | { type: "menu"; state: SlotControllerState }
  | { type: "requestAutoplay"; state: SlotControllerState }
  | { type: "requestBetOptions"; state: SlotControllerState }
  | { type: "requestFeature"; state: SlotControllerState }
  | { type: "bonus"; enabled: boolean; state: SlotControllerState }
  | { type: "freeRound"; enabled: boolean; state: SlotControllerState }
  | { type: "spin"; state: SlotControllerState }
  | { type: "spinFailed"; state: SlotControllerState }
  | { type: "feature"; state: SlotControllerState }
  | { type: "autoplay"; enabled: boolean; state: SlotControllerState }
  | { type: "autoplayPaused"; reason: SlotControllerAutoplayPauseReason; state: SlotControllerState }
  | { type: "autoplayResumed"; state: SlotControllerState }
  | { type: "balanceReady"; ready: boolean; state: SlotControllerState }
  | { type: "turbo"; enabled: boolean; state: SlotControllerState }
  | { type: "amplify"; enabled: boolean; state: SlotControllerState }
  | { type: "betChanged"; direction: -1 | 1; state: SlotControllerState };

export interface SlotControllerTimings {
  spinSimulationMs: number;
  bonusCompletionMs: number;
}

export interface SlotControllerScheduler {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(timeoutId: unknown): void;
}

export interface SlotControllerCoreOptions {
  config: SlotControllerConfig;
  scheduler: SlotControllerScheduler;
  timings: SlotControllerTimings;
  spinLifecycle?: SlotControllerSpinLifecycle;
}

export type StateListener = (state: SlotControllerState) => void;
export type ActionListener = (action: SlotControllerAction) => void;
