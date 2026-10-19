import type {
  ActionListener,
  SlotControllerAction,
  SlotControllerAutoplayPauseReason,
  SlotControllerCoreOptions,
  SlotControllerState,
  StateListener,
} from "./types";

export class SlotControllerCore {
  private static readonly DEFAULT_FEATURE_MULTIPLIER = 100;
  private static readonly DEFAULT_ENHANCED_BET_MULTIPLIER = 1.25;

  private readonly config: SlotControllerCoreOptions["config"];
  private readonly scheduler;
  private readonly timings;
  private readonly spinLifecycle;
  private readonly stateListeners = new Set<StateListener>();
  private readonly actionListeners = new Set<ActionListener>();
  private state: SlotControllerState;
  private spinTimeoutId: unknown | null = null;
  private bonusCompletionTimeoutId: unknown | null = null;
  private readonly balanceReadyWaiters = new Set<() => void>();

  constructor({ config, scheduler, timings, spinLifecycle = "simulated" }: SlotControllerCoreOptions) {
    this.config = config;
    this.scheduler = scheduler;
    this.timings = timings;
    this.spinLifecycle = spinLifecycle;
    this.state = this.createInitialState();
  }

  getFeatureMultipliers(): number[] {
    return [...this.getFeatureMultipliersList()];
  }

  getFeatureCost(bet: number, optionIndex: number = 0): number {
    return this.calculateFeatureCost(bet, optionIndex);
  }

  /** Display / affordability spin cost (base bet or amplified). */
  getEffectiveBetAmount(bet?: number, amplifyEnabled?: boolean): number {
    const baseBet = bet ?? this.state.bet;
    const amplified = amplifyEnabled ?? this.state.isAmplifyEnabled;
    const amount = amplified
      ? baseBet * this.getEnhancedBetMultiplier()
      : baseBet;

    return this.roundCurrency(amount);
  }

  subscribe(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    listener(this.getState());

    return () => {
      this.stateListeners.delete(listener);
    };
  }

  onAction(listener: ActionListener): () => void {
    this.actionListeners.add(listener);

    return () => {
      this.actionListeners.delete(listener);
    };
  }

  getState(): SlotControllerState {
    return { ...this.state };
  }

  getAvailableBets(): number[] {
    return [...this.getBetLevels()];
  }

  menu(): void {
    if (this.state.isBonusModeActive || this.state.isFreeRoundModeActive) {
      return;
    }

    this.emitAction({ type: "menu", state: this.getState() });
  }

  requestBetOptions(): void {
    if (this.state.isBonusModeActive || this.state.isFreeRoundModeActive) {
      return;
    }

    this.emitAction({ type: "requestBetOptions", state: this.getState() });
  }

  requestAutoplay(): void {
    if (this.state.isBonusModeActive || this.state.isFreeRoundModeActive) {
      return;
    }

    this.emitAction({ type: "requestAutoplay", state: this.getState() });
  }

  requestFeature(): void {
    if (
      this.state.isBonusModeActive
      || this.state.isFreeRoundModeActive
      || this.state.isAmplifyEnabled
    ) {
      return;
    }

    this.emitAction({ type: "requestFeature", state: this.getState() });
  }

  setBalance(balance: number): boolean {
    if (!Number.isFinite(balance) || balance < 0) {
      return false;
    }

    const nextBalance = this.roundCurrency(balance);

    if (nextBalance === this.state.balance) {
      return false;
    }

    this.updateState({ balance: nextBalance });
    return true;
  }

  setBalanceReady(ready: boolean): boolean {
    const nextValue = Boolean(ready);

    if (this.state.isBalanceReady === nextValue) {
      return false;
    }

    this.updateState({ isBalanceReady: nextValue });
    this.emitAction({
      type: "balanceReady",
      ready: nextValue,
      state: this.getState(),
    });

    if (nextValue) {
      this.balanceReadyWaiters.forEach((resolve) => resolve());
      this.balanceReadyWaiters.clear();
    }

    return true;
  }

  waitUntilBalanceReady(): Promise<void> {
    if (this.state.isBalanceReady) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      this.balanceReadyWaiters.add(resolve);
    });
  }

  hasPausedAutoplay(): boolean {
    return this.state.pausedAutoplaySpins > 0 || this.state.autoplayPauseReason !== null;
  }

  updateBalance(amount: number): boolean {
    if (!Number.isFinite(amount) || amount === 0) {
      return false;
    }

    const nextBalance = this.roundCurrency(this.state.balance + amount);

    if (nextBalance < 0 || nextBalance === this.state.balance) {
      return false;
    }

    this.updateState({ balance: nextBalance });
    return true;
  }

  setGameplayControlsLocked(isLocked: boolean): boolean {
    const nextValue = Boolean(isLocked);

    if (this.state.isGameplayControlsLocked === nextValue) {
      return false;
    }

    this.updateState({ isGameplayControlsLocked: nextValue });
    return true;
  }

  finishSpin(options?: { autoAdvance?: boolean }): boolean {
    if (this.state.spinPhase !== "spinning") {
      return false;
    }

    if (this.spinTimeoutId !== null) {
      this.scheduler.clearTimeout(this.spinTimeoutId);
      this.spinTimeoutId = null;
    }

    this.updateState({
      canSpin: true,
      spinPhase: "idle",
      activeSpinSource: null,
    });

    this.applyPostSpinCompletion(options?.autoAdvance ?? true);
    return true;
  }

  completeSpin(): boolean {
    return this.finishSpin();
  }

  advancePendingSpin(): boolean {
    if (this.state.spinPhase === "spinning" || !this.state.canSpin) {
      return false;
    }

    if (this.state.isBonusModeActive) {
      if (this.state.remainingBonusSpins <= 0) {
        this.scheduleBonusCompletion();
        return false;
      }

      return this.startSpin({
        consumeBonusSpin: true,
        ignoreSpinAvailability: true,
      });
    }

    if (this.state.isAutoplayEnabled) {
      if (this.state.remainingAutoplaySpins <= 0) {
        this.stopAutoplay();
        return false;
      }

      if (this.isAutoplayAdvanceBlocked()) {
        return false;
      }

      return this.startSpin({
        consumeAutoplaySpin: true,
        ignoreSpinAvailability: true,
      });
    }

    return false;
  }

  failSpin(options?: {
    balance?: number;
    stopAutoplay?: boolean;
    /**
     * When true, undo the autoplay counter consumed at spin start.
     * Defaults to true for failed autoplay spins that keep the session alive
     * (`stopAutoplay: false`) — bet-failed soft pause must not burn a spin.
     */
    refundConsumedAutoplaySpin?: boolean;
  }): boolean {
    if (this.state.spinPhase !== "spinning") {
      return false;
    }

    if (this.spinTimeoutId !== null) {
      this.scheduler.clearTimeout(this.spinTimeoutId);
      this.spinTimeoutId = null;
    }

    const wasAutoplaySpin = this.state.activeSpinSource === "autoplay";
    const stopAutoplay = options?.stopAutoplay ?? true;
    const shouldRefundAutoplaySpin =
      options?.refundConsumedAutoplaySpin
      ?? (wasAutoplaySpin && !stopAutoplay && this.state.isAutoplayEnabled);

    const nextState: Partial<SlotControllerState> = {
      canSpin: true,
      spinPhase: "idle",
      activeSpinSource: null,
    };

    if (shouldRefundAutoplaySpin) {
      nextState.remainingAutoplaySpins = this.state.remainingAutoplaySpins + 1;
    }

    if (typeof options?.balance === "number" && Number.isFinite(options.balance)) {
      nextState.balance = Math.max(0, this.roundCurrency(options.balance));
    }

    this.updateState(nextState);

    if (stopAutoplay) {
      this.stopAutoplay();
    }

    this.emitAction({ type: "spinFailed", state: this.getState() });
    return true;
  }

  startAutoplay(spinCount: number): boolean {
    const remainingAutoplaySpins = Math.max(0, Math.floor(spinCount));

    if (
      remainingAutoplaySpins <= 0
      || this.state.isBonusModeActive
      || this.state.isFreeRoundModeActive
      || !this.canAfford(this.state.bet)
    ) {
      return false;
    }

    if (this.state.isAutoplayEnabled) {
      this.stopAutoplay();
    }

    this.updateState({
      isAutoplayEnabled: true,
      remainingAutoplaySpins,
    });

    if (this.startSpin({ consumeAutoplaySpin: true })) {
      this.emitAutoplayAction(true);
      return true;
    }

    this.stopAutoplay();
    return false;
  }

  activateBonusMode(spinCount: number): boolean {
    const remainingBonusSpins = Math.max(0, Math.floor(spinCount));

    if (
      remainingBonusSpins <= 0
      || this.state.isBonusModeActive
      || this.state.isFreeRoundModeActive
    ) {
      return false;
    }

    if (this.state.isAutoplayEnabled) {
      this.pauseAutoplay("bonus");
    }

    this.updateState({
      isBonusModeActive: true,
      remainingBonusSpins,
      canSpin: true,
      spinPhase: "idle",
      activeSpinSource: null,
    });
    this.emitBonusAction(true);
    return true;
  }

  setRemainingBonusSpins(spinCount: number): boolean {
    if (!this.state.isBonusModeActive) {
      return false;
    }

    const remainingBonusSpins = Math.max(0, Math.floor(spinCount));

    if (remainingBonusSpins === this.state.remainingBonusSpins) {
      return false;
    }

    // Retrigger grants raise remaining after the last spin already scheduled completion —
    // cancel that timeout so the session is not torn down mid-dialog.
    if (remainingBonusSpins > 0) {
      this.cancelScheduledBonusCompletion();
    }

    this.updateState({ remainingBonusSpins });

    if (remainingBonusSpins <= 0 && this.state.spinPhase !== "spinning") {
      this.scheduleBonusCompletion();
    }

    return true;
  }

  /** Cancel a pending `scheduleBonusCompletion` (e.g. last-spin retrigger grant). */
  cancelScheduledBonusCompletion(): void {
    if (this.bonusCompletionTimeoutId !== null) {
      this.scheduler.clearTimeout(this.bonusCompletionTimeoutId);
      this.bonusCompletionTimeoutId = null;
    }
  }

  spin(): boolean {
    if (this.state.isBonusModeActive) {
      return false;
    }

    if (this.state.isAutoplayEnabled) {
      this.stopAutoplay();
      return false;
    }

    if (this.state.isFreeRoundModeActive) {
      return this.startSpin({ consumeFreeRoundSpin: true });
    }

    return this.startSpin();
  }

  /**
   * Start a spin without charging bet and without decrementing simulation free-round
   * counters. Used by adapters for backend initialization free rounds (`isFs` / fsCount),
   * where remaining count is owned by FreeRoundManager + the backend.
   */
  spinWaivingBet(): boolean {
    if (this.state.isBonusModeActive) {
      return false;
    }

    if (this.state.isAutoplayEnabled) {
      this.stopAutoplay();
      return false;
    }

    return this.startSpin({ waiveBet: true });
  }

  buyFeature(optionIndex: number = 0): boolean {
    const featureCost = this.calculateFeatureCost(this.state.bet, optionIndex);

    if (
      this.state.isBonusModeActive
      || this.state.isFreeRoundModeActive
      || !this.state.canSpin
      || !this.canAfford(featureCost)
    ) {
      return false;
    }

    this.updateState({
      balance: this.roundCurrency(this.state.balance - featureCost),
      featureCost,
    });
    this.emitAction({ type: "feature", state: this.getState() });
    return true;
  }

  toggleAutoplay(): void {
    if (this.state.isBonusModeActive || this.state.isFreeRoundModeActive) {
      return;
    }

    if (this.state.isAutoplayEnabled) {
      this.stopAutoplay();
    }
  }

  stopAutoplay(options?: { clearPause?: boolean }): void {
    const clearPause = options?.clearPause ?? true;

    if (
      !this.state.isAutoplayEnabled
      && this.state.remainingAutoplaySpins === 0
      && (!clearPause || !this.hasPausedAutoplay())
    ) {
      return;
    }

    const nextState: Partial<SlotControllerState> = {
      isAutoplayEnabled: false,
      remainingAutoplaySpins: 0,
    };

    if (clearPause) {
      nextState.pausedAutoplaySpins = 0;
      nextState.autoplayPauseReason = null;
    }

    this.updateState(nextState);
    this.emitAutoplayAction(false);
  }

  pauseAutoplay(
    reason: SlotControllerAutoplayPauseReason,
    options?: { preserveRemaining?: boolean },
  ): void {
    if (reason === "betFailed") {
      if (!this.state.isAutoplayEnabled) {
        return;
      }

      if (this.state.autoplayPauseReason === "betFailed") {
        return;
      }

      this.updateState({ autoplayPauseReason: "betFailed" });
      this.emitAction({
        type: "autoplayPaused",
        reason: "betFailed",
        state: this.getState(),
      });
      return;
    }

    if (
      reason === "bonus"
      && this.state.autoplayPauseReason === "bonus"
      && this.state.pausedAutoplaySpins > 0
    ) {
      if (this.state.isAutoplayEnabled || this.state.remainingAutoplaySpins > 0) {
        this.updateState({
          isAutoplayEnabled: false,
          remainingAutoplaySpins: 0,
        });
      }

      return;
    }

    const preserveRemaining = options?.preserveRemaining ?? true;
    const activeSpins = Math.max(0, this.state.remainingAutoplaySpins);
    const spinsToSave = preserveRemaining
      ? Math.max(this.state.pausedAutoplaySpins, activeSpins)
      : activeSpins;

    if (!this.state.isAutoplayEnabled && spinsToSave <= 0) {
      return;
    }

    this.updateState({
      isAutoplayEnabled: false,
      remainingAutoplaySpins: 0,
      pausedAutoplaySpins: spinsToSave,
      autoplayPauseReason: reason,
    });
    this.emitAction({
      type: "autoplayPaused",
      reason,
      state: this.getState(),
    });
  }

  resumeAutoplay(): boolean {
    if (this.state.autoplayPauseReason === "betFailed") {
      this.updateState({ autoplayPauseReason: null });
      this.emitAction({
        type: "autoplayResumed",
        state: this.getState(),
      });
      return true;
    }

    if (this.state.pausedAutoplaySpins <= 0) {
      return false;
    }

    if (this.state.isBonusModeActive || this.state.isFreeRoundModeActive) {
      return false;
    }

    const spinsToResume = this.state.pausedAutoplaySpins;
    this.updateState({
      pausedAutoplaySpins: 0,
      autoplayPauseReason: null,
    });

    if (this.startAutoplay(spinsToResume)) {
      this.emitAction({
        type: "autoplayResumed",
        state: this.getState(),
      });
      return true;
    }

    return false;
  }

  clearAutoplayPause(): void {
    if (!this.hasPausedAutoplay()) {
      return;
    }

    this.updateState({
      pausedAutoplaySpins: 0,
      autoplayPauseReason: null,
    });
  }

  toggleTurbo(): void {
    if (this.state.isBonusModeActive || this.state.isFreeRoundModeActive) {
      return;
    }

    this.updateState({
      isTurboEnabled: !this.state.isTurboEnabled,
    });
    this.emitAction({
      type: "turbo",
      enabled: this.state.isTurboEnabled,
      state: this.getState(),
    });
  }

  toggleAmplify(): void {
    if (this.state.isBonusModeActive || this.state.isFreeRoundModeActive) {
      return;
    }

    this.updateState({
      isAmplifyEnabled: !this.state.isAmplifyEnabled,
    });
    this.emitAction({
      type: "amplify",
      enabled: this.state.isAmplifyEnabled,
      state: this.getState(),
    });
  }

  increaseBet(): void {
    this.changeBet(1);
  }

  decreaseBet(): void {
    this.changeBet(-1);
  }

  setBet(bet: number, options?: { clampToLadder?: boolean }): boolean {
    if (this.state.isBonusModeActive || this.state.isFreeRoundModeActive) {
      return false;
    }

    const nextBet = options?.clampToLadder === false
      ? this.acceptExactBet(bet)
      : this.clampBet(bet);

    if (!Number.isFinite(nextBet) || nextBet === this.state.bet) {
      return false;
    }

    const direction: -1 | 1 = nextBet > this.state.bet ? 1 : -1;

    this.updateState({
      bet: nextBet,
      featureCost: this.calculateFeatureCost(nextBet),
    });
    this.emitAction({
      type: "betChanged",
      direction,
      state: this.getState(),
    });

    return true;
  }

  destroy(): void {
    if (this.spinTimeoutId !== null) {
      this.scheduler.clearTimeout(this.spinTimeoutId);
      this.spinTimeoutId = null;
    }

    if (this.bonusCompletionTimeoutId !== null) {
      this.scheduler.clearTimeout(this.bonusCompletionTimeoutId);
      this.bonusCompletionTimeoutId = null;
    }

    this.balanceReadyWaiters.clear();
  }

  startBonusMode(spinCount: number): boolean {
    if (!this.activateBonusMode(spinCount)) {
      return false;
    }

    if (this.startSpin({
      consumeBonusSpin: true,
    })) {
      return true;
    }

    this.stopBonusMode();
    return false;
  }

  startFreeRoundMode(spinCount: number): boolean {
    if (!this.activateFreeRoundMode(spinCount)) {
      return false;
    }

    return true;
  }

  activateFreeRoundMode(spinCount: number): boolean {
    const remainingFreeRoundSpins = Math.max(0, Math.floor(spinCount));

    if (
      remainingFreeRoundSpins <= 0
      || this.state.isBonusModeActive
      || this.state.isFreeRoundModeActive
    ) {
      return false;
    }

    if (this.state.isAutoplayEnabled) {
      this.stopAutoplay();
    }

    this.updateState({
      isFreeRoundModeActive: true,
      remainingFreeRoundSpins,
      canSpin: true,
      spinPhase: "idle",
      activeSpinSource: null,
    });
    this.emitFreeRoundAction(true);
    return true;
  }

  setRemainingFreeRoundSpins(spinCount: number): boolean {
    if (!this.state.isFreeRoundModeActive) {
      return false;
    }

    const remainingFreeRoundSpins = Math.max(0, Math.floor(spinCount));

    if (remainingFreeRoundSpins === this.state.remainingFreeRoundSpins) {
      return false;
    }

    this.updateState({ remainingFreeRoundSpins });

    if (remainingFreeRoundSpins <= 0 && this.state.spinPhase !== "spinning") {
      this.stopFreeRoundMode();
    }

    return true;
  }

  completeBonusMode(): void {
    this.stopBonusMode();
  }

  completeFreeRoundMode(): void {
    this.stopFreeRoundMode();
  }

  private changeBet(direction: -1 | 1): void {
    if (this.state.isBonusModeActive || this.state.isFreeRoundModeActive) {
      return;
    }

    const betLevels = this.getBetLevels();
    const currentIndex = this.findClosestBetIndex(this.state.bet);
    const nextIndex = Math.max(0, Math.min(currentIndex + direction, betLevels.length - 1));
    const nextBet = betLevels[nextIndex];

    if (nextBet === this.state.bet) {
      return;
    }

    this.updateState({
      bet: nextBet,
      featureCost: this.calculateFeatureCost(nextBet),
    });
    this.emitAction({
      type: "betChanged",
      direction,
      state: this.getState(),
    });
  }

  private updateState(partialState: Partial<SlotControllerState>): void {
    const betLevels = this.getBetLevels();
    const currentBet = partialState.bet ?? this.state.bet;
    const currentBetIndex = this.findClosestBetIndex(currentBet);

    this.state = {
      ...this.state,
      ...partialState,
    };

    this.state = {
      ...this.state,
      canDecreaseBet: currentBetIndex > 0,
      canIncreaseBet: currentBetIndex < betLevels.length - 1,
    };

    this.emitState();
  }

  private emitState(): void {
    const snapshot = this.getState();
    this.stateListeners.forEach((listener) => {
      listener(snapshot);
    });
  }

  private emitAction(action: SlotControllerAction): void {
    this.actionListeners.forEach((listener) => {
      listener(action);
    });
  }

  private emitAutoplayAction(enabled: boolean): void {
    this.emitAction({
      type: "autoplay",
      enabled,
      state: this.getState(),
    });
  }

  private emitBonusAction(enabled: boolean): void {
    this.emitAction({
      type: "bonus",
      enabled,
      state: this.getState(),
    });
  }

  private emitFreeRoundAction(enabled: boolean): void {
    this.emitAction({
      type: "freeRound",
      enabled,
      state: this.getState(),
    });
  }

  private scheduleSpinReset(): void {
    if (this.spinLifecycle === "external") {
      return;
    }

    if (this.spinTimeoutId !== null) {
      this.scheduler.clearTimeout(this.spinTimeoutId);
    }

    this.spinTimeoutId = this.scheduler.setTimeout(() => {
      this.spinTimeoutId = null;
      this.finishSpin();
    }, Math.max(0, this.timings.spinSimulationMs));
  }

  private stopBonusMode(): void {
    if (!this.state.isBonusModeActive && this.state.remainingBonusSpins === 0) {
      return;
    }

    if (this.bonusCompletionTimeoutId !== null) {
      this.scheduler.clearTimeout(this.bonusCompletionTimeoutId);
      this.bonusCompletionTimeoutId = null;
    }

    this.updateState({
      canSpin: true,
      isBonusModeActive: false,
      remainingBonusSpins: 0,
      spinPhase: "idle",
      activeSpinSource: null,
    });
    this.emitBonusAction(false);
  }

  private stopFreeRoundMode(): void {
    if (!this.state.isFreeRoundModeActive && this.state.remainingFreeRoundSpins === 0) {
      return;
    }

    if (this.bonusCompletionTimeoutId !== null) {
      this.scheduler.clearTimeout(this.bonusCompletionTimeoutId);
      this.bonusCompletionTimeoutId = null;
    }

    this.updateState({
      canSpin: true,
      isFreeRoundModeActive: false,
      remainingFreeRoundSpins: 0,
      spinPhase: "idle",
      activeSpinSource: null,
    });
    this.emitFreeRoundAction(false);
  }

  private startSpin(options: {
    consumeAutoplaySpin?: boolean;
    consumeBonusSpin?: boolean;
    consumeFreeRoundSpin?: boolean;
    /** Zero-cost spin without consuming simulation free-round counters (init free rounds). */
    waiveBet?: boolean;
    ignoreSpinAvailability?: boolean;
  } = {}): boolean {
    const {
      consumeAutoplaySpin = false,
      consumeBonusSpin = false,
      consumeFreeRoundSpin = false,
      waiveBet = false,
      ignoreSpinAvailability = false,
    } = options;

    if (!ignoreSpinAvailability && !this.state.canSpin) {
      return false;
    }

    const spinCost = consumeBonusSpin || consumeFreeRoundSpin || waiveBet
      ? 0
      : this.getEffectiveBetAmount();

    if (spinCost > 0 && !this.state.isBalanceReady) {
      return false;
    }

    if (spinCost > 0 && !this.canAfford(spinCost)) {
      return false;
    }

    if (this.bonusCompletionTimeoutId !== null) {
      this.scheduler.clearTimeout(this.bonusCompletionTimeoutId);
      this.bonusCompletionTimeoutId = null;
    }

    const activeSpinSource = consumeBonusSpin
      ? "bonus"
      : consumeFreeRoundSpin
        ? "freeRound"
        : waiveBet
          ? "manual"
          : consumeAutoplaySpin
            ? "autoplay"
            : "manual";

    const nextState: Partial<SlotControllerState> = {
      canSpin: false,
      spinPhase: "spinning",
      activeSpinSource,
    };

    if (spinCost > 0) {
      nextState.balance = this.roundCurrency(this.state.balance - spinCost);
    }

    if (consumeAutoplaySpin) {
      nextState.remainingAutoplaySpins = Math.max(0, this.state.remainingAutoplaySpins - 1);
    }

    if (consumeBonusSpin) {
      nextState.remainingBonusSpins = Math.max(0, this.state.remainingBonusSpins - 1);
    }

    if (consumeFreeRoundSpin) {
      nextState.remainingFreeRoundSpins = Math.max(0, this.state.remainingFreeRoundSpins - 1);
    }

    this.updateState(nextState);
    this.emitAction({ type: "spin", state: this.getState() });

    this.scheduleSpinReset();

    return true;
  }

  private scheduleBonusCompletion(): void {
    if (this.bonusCompletionTimeoutId !== null) {
      this.scheduler.clearTimeout(this.bonusCompletionTimeoutId);
    }

    this.bonusCompletionTimeoutId = this.scheduler.setTimeout(() => {
      this.bonusCompletionTimeoutId = null;

      if (!this.state.isBonusModeActive || this.state.remainingBonusSpins > 0) {
        return;
      }

      this.stopBonusMode();
    }, Math.max(0, this.timings.bonusCompletionMs));
  }

  private createInitialState(): SlotControllerState {
    const bet = this.clampBet(this.config.initialBet);
    const betLevels = this.getBetLevels();
    const initialIndex = this.findClosestBetIndex(bet);

    return {
      balance: this.config.balance,
      bet,
      featureCost: this.calculateFeatureCost(bet),
      isGameplayControlsLocked: false,
      isAutoplayEnabled: false,
      remainingAutoplaySpins: 0,
      isBonusModeActive: false,
      remainingBonusSpins: 0,
      isFreeRoundModeActive: false,
      remainingFreeRoundSpins: 0,
      isTurboEnabled: false,
      isAmplifyEnabled: false,
      canDecreaseBet: initialIndex > 0,
      canIncreaseBet: initialIndex < betLevels.length - 1,
      canSpin: true,
      spinPhase: "idle",
      activeSpinSource: null,
      isBalanceReady: true,
      pausedAutoplaySpins: 0,
      autoplayPauseReason: null,
    };
  }

  private isAutoplayAdvanceBlocked(): boolean {
    return this.state.autoplayPauseReason === "betFailed";
  }

  getEnhancedBetMultiplier(): number {
    const multiplier = this.config.enhancedBetMultiplier;

    if (Number.isFinite(multiplier) && (multiplier as number) > 0) {
      return multiplier as number;
    }

    return SlotControllerCore.DEFAULT_ENHANCED_BET_MULTIPLIER;
  }

  private applyPostSpinCompletion(autoAdvance: boolean): void {
    if (this.state.isBonusModeActive) {
      if (this.state.remainingBonusSpins <= 0) {
        this.scheduleBonusCompletion();
        return;
      }

      if (autoAdvance) {
        this.advancePendingSpin();
      }

      return;
    }

    if (this.state.isFreeRoundModeActive) {
      if (this.state.remainingFreeRoundSpins <= 0) {
        this.stopFreeRoundMode();
      }

      return;
    }

    if (!this.state.isAutoplayEnabled) {
      return;
    }

    if (this.isAutoplayAdvanceBlocked()) {
      return;
    }

    if (this.state.remainingAutoplaySpins <= 0) {
      this.stopAutoplay();
      return;
    }

    if (autoAdvance) {
      this.advancePendingSpin();
    }
  }

  private getFeatureMultipliersList(): number[] {
    const multipliers = this.config.featureMultipliers;

    if (Array.isArray(multipliers) && multipliers.length > 0) {
      return multipliers;
    }

    if (Number.isFinite(this.config.featureMultiplier)) {
      return [this.config.featureMultiplier as number];
    }

    return [SlotControllerCore.DEFAULT_FEATURE_MULTIPLIER];
  }

  private getFeatureMultiplierForOption(optionIndex: number): number {
    const featureMultipliers = this.getFeatureMultipliersList();
    const index = Math.max(0, Math.floor(optionIndex));

    if (index >= featureMultipliers.length) {
      return SlotControllerCore.DEFAULT_FEATURE_MULTIPLIER;
    }

    const multiplier = featureMultipliers[index];
    return Number.isFinite(multiplier)
      ? multiplier
      : SlotControllerCore.DEFAULT_FEATURE_MULTIPLIER;
  }

  private calculateFeatureCost(bet: number, optionIndex: number = 0): number {
    return Math.round(bet * this.getFeatureMultiplierForOption(optionIndex));
  }

  private canAfford(amount: number): boolean {
    return this.roundCurrency(amount) <= this.state.balance;
  }

  private roundCurrency(value: number): number {
    return Number(value.toFixed(2));
  }

  private clampBet(bet: number): number {
    const betLevels = this.getBetLevels();
    const closestBet = betLevels[this.findClosestBetIndex(bet)];

    return Number(closestBet.toFixed(2));
  }

  /** Keep a backend stake as given. Used for initialization free-round bets that are not on the ladder. */
  private acceptExactBet(bet: number): number {
    if (!Number.isFinite(bet) || bet <= 0) {
      return Number.NaN;
    }
    return bet;
  }

  private getBetLevels(): number[] {
    if (Array.isArray(this.config.betLevels) && this.config.betLevels.length > 0) {
      return this.config.betLevels;
    }

    return this.buildBetLevelsFromStep();
  }

  private buildBetLevelsFromStep(): number[] {
    const levels: number[] = [];

    for (
      let bet = this.config.minBet;
      bet <= this.config.maxBet + 0.0001;
      bet += this.config.betStep
    ) {
      levels.push(Number(bet.toFixed(2)));
    }

    return levels;
  }

  private findClosestBetIndex(bet: number): number {
    const betLevels = this.getBetLevels();
    let closestIndex = 0;
    let smallestDifference = Math.abs(betLevels[0] - bet);

    for (let index = 1; index < betLevels.length; index += 1) {
      const difference = Math.abs(betLevels[index] - bet);

      if (difference < smallestDifference) {
        smallestDifference = difference;
        closestIndex = index;
      }
    }

    return closestIndex;
  }
}
