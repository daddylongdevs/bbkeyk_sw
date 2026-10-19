import { Data } from "../../tmp_backend/Data";
import { GameObjects } from 'phaser';
import { Game } from "../scenes/Game";
import { GameData, setSpeed, pauseAutoplayForWinlines, resumeAutoplayAfterWinlines } from "./GameData";
import { ScatterAnimationManager } from "../../managers/ScatterAnimationManager";
import { SymbolDetector, Grid, Wins } from "../../tmp_backend/SymbolDetector";
import { gameEventManager, GameEventType } from '../../event/EventManager';
import { gameStateManager } from '../../managers/GameStateManager';
import { TurboConfig } from '../../config/TurboConfig';
import { SLOT_ROWS, SLOT_COLUMNS, DELAY_BETWEEN_SPINS, MULTIPLIER_SYMBOLS } from '../../config/GameConfig';
import { SoundEffectType } from '../../managers/AudioManager';
import { SpinDataUtils } from "../../backend/SpinData";
import { formatCurrencyNumber } from "../../utils/NumberPrecisionFormatter";
import { ReelDropSkipController } from "./ReelDropSkipController";
import { SymbolPool } from "./SymbolPool";
import {
  enableMipmapsOnSpineSkeleton,
  enableSymbolSpineAtlasMipmaps,
} from "../layout/SymbolSpineMipmaps";

// Global drop-speed tuning for Sugar Wonderland.
// Keep multipliers conservative so motion remains readable.
const PRE_SPIN_DROP_DELAY_MULTIPLIER = 0.6;
const PRE_SPIN_DROP_DURATION_MULTIPLIER = 0.75;
const NEW_SYMBOL_DROP_DELAY_MULTIPLIER = 0.7;
const NEW_SYMBOL_DROP_DURATION_MULTIPLIER = 0.75;
const SKIP_UNIFIED_DROP_DURATION_MULTIPLIER = TurboConfig.TURBO_SPEED_MULTIPLIER * NEW_SYMBOL_DROP_DURATION_MULTIPLIER;

export class Symbols {
  private static readonly WINLINE_CHECKING_DISABLED: boolean = true;
  
  public static FILLER_COUNT: number = 20;
  public reelCount: number = 0;
  public scene: Game;
  public symbolPool: SymbolPool;
  public container: Phaser.GameObjects.Container;
  public displayWidth: number;
  public displayHeight: number;
  public horizontalSpacing: number;
  public verticalSpacing: number;
  public symbols: any[][]; // Changed to any to support both Sprite and Spine objects
  public newSymbols: any[][]; // Changed to any to support both Sprite and Spine objects
  public slotX: number;
  public slotY: number;
  public totalGridWidth: number;
  public totalGridHeight: number;
  public scatterAnimationManager: ScatterAnimationManager;
  public symbolDetector: SymbolDetector;
  public winLineDrawer: any | null;
  private overlayRect?: Phaser.GameObjects.Graphics;
  public currentSpinData: any = null; // Store current spin data for access by other components
  private scatterCandyOverlay?: Phaser.GameObjects.Image | null;
  private overlayContainer: Phaser.GameObjects.Container | null = null;

  // Track whether any wins occurred during the current spin item (including all tumbles)
  private hadWinsInCurrentItem: boolean = false;
  
  // Track if multiplier animations are currently in progress
  private multiplierAnimationsInProgress: boolean = false;

  /** When max-win cap is hit during multiplier fly-in, skip remaining multiplier animations. */
  private skipMultipliersActive: boolean = false;
  private multiplierStaggerTimers: Phaser.Time.TimerEvent[] = [];
  private multiplierAnimationsAbortResolve: (() => void) | null = null;
  
  // Track if scatter retrigger animation is currently in progress
  private scatterRetriggerAnimationInProgress: boolean = false;
  
  // Cached total win calculated before freespin dialog is shown
  private cachedTotalWin: number = 0;

  // Skip state (beelze-style): allows tapping reels/spin button to accelerate active reel drop.
  /** When true, player-initiated reel-drop skip is allowed during bonus/free-spin mode. */
  public enableBonusModeSkip: boolean = true;
  private static readonly SKIP_CLEARED_SYMBOL_RELEASE_DELAY_MS = 1500;
  // Wall-clock alignment window used by startFastDropForCellAfterSkip (the mid-flight
  // intercept path that handles cells whose in-flight tweens were just killed). The
  // fast-path skip (skip active before dropReels starts) no longer goes through this
  // function — it falls through to the regular turbo tween via dropOneColumn's
  // turboOverride=true branch, which has delay:0 and matches turbo exactly.
  private static readonly SKIP_DROP_SYNC_BUFFER_MS = 60;
  public skipReelDropsActive: boolean = false;
  public skipReelDropsPending: boolean = false;
  public skipDropModeForCurrentSpin: boolean = false;
  private skipDropStartTick: number = 0;
  private skipReelDropRestartPromise: Promise<void> | null = null;
  // Public so dropReels' main-loop row IIFEs can early-abort when a mid-flight skip
  // restart has taken over the new-symbol drop schedule (see startSkipReelDropRestartIfPossible).
  public skipReelDropRestartInProgress: boolean = false;
  // Public, set true the instant dropReels' main loop begins iterating its row promises
  // and reset in dropReels' finally + clearSkipReelDrops. Used as the reliable gate for
  // startSkipReelDropRestartIfPossible — checking "is there an in-flight tween somewhere"
  // is timing-fragile (cells can have just nulled __skipDropResolve via tween onComplete
  // even though the staggered loop is mid-iteration), so we use the actual state of the
  // main loop instead.
  public dropReelsMainLoopStarted: boolean = false;
  /** Bumped on mid-loop skip restart so row IIFEs started before the restart abort. */
  public dropReelsRowPipelineGeneration: number = 0;
  public skipRequestedForCurrentSpin: boolean = false;
  public skipDropSoundTriggeredForCurrentReelDrop: boolean = false;
  private skipVisualClearAppliedForCurrentSpin: boolean = false;
  private skipClearedOldSymbols: any[] = [];
  private skipDespawnVfxTargets: WeakSet<any> | null = null;
  private skipDespawnVfxPlayedForCurrentSpin: boolean = false;
  private skipDespawnVfxSfxPending: boolean = false;
  private reelDropSkipController: ReelDropSkipController | null = null;
  public spinDataResponseReceivedForCurrentSpin: boolean = false;
  public tumbleInProgress: boolean = false;
  public reelDropInProgress: boolean = false;
  private skipTumblesActive: boolean = false;
  public preSpinDropInProgress: boolean = false;
  public preSpinDropPromise: Promise<void> | null = null;
  public preSpinDropRowPromises: Map<number, Promise<void>> = new Map<number, Promise<void>>();
  /** Set only by legacy abort paths so dropReels does not re-clear/drop old symbols per row. */
  private preSpinDropAbortedBySkip: boolean = false;
  private preSpinDropGeneration: number = 0;
  private skipOldDropAbortResolvers: Set<() => void> = new Set();
  public restingGridSnapshot: number[][] | null = null;
  public suppressStalePreSpinRowCleanup: boolean = false;

  /** Scatter pay from the spin that opened (or continued) the bonus; kept for congrats when currentSpinData is a later free spin. */
  private cachedScatterTriggerPayout: number = 0;

  // Configuration for Spine symbol scales - adjust these values manually
  private spineSymbolScales: { [key: number]: number } = {
    0:  0.135,   // Symbol0_KA (scatter) scale
    1:  0.035,  // Symbol1_KA scale
    2:  0.035,  // Symbol2_KA scale
    3:  0.035,  // Symbol3_KA scale
    4:  0.135,  // Symbol4_KA scale
    5:  0.135,  // Symbol5_KA scale
    6:  0.135,  // Symbol6_KA scale
    7:  0.135,  // Symbol7_KA scale
    8:  0.135,  // Symbol8_KA scale
    9:  0.135,  // Symbol9_KA scale
    10: 0.135,  // Symbol10_KA scale
    11: 0.135,  // Symbol11_KA scale
    12: 0.137,  // Symbol12_KA (wildcard x2) scale
    13: 0.137,  // Symbol13_KA (wildcard x3) scale
    14: 0.137  // Symbol14_KA (wildcard x4) scale
  };

  // Store current symbol data for reset purposes
  public currentSymbolData: number[][] | null = null;
  
  // Store free spins data for autoplay
  private pendingFreeSpinsData: { scatterIndex: number; actualFreeSpins: number } | null = null;
  
  // Free spin autoplay state
  public freeSpinAutoplayActive: boolean = false;
  private freeSpinAutoplaySpinsRemaining: number = 0;
  private freeSpinAutoplayTimer: Phaser.Time.TimerEvent | null = null;
  private freeSpinAutoplayWaitingForReelsStop: boolean = false;
  private freeSpinAutoplayWaitingForWinlines: boolean = false;
  private freeSpinAutoplayTriggered: boolean = false;
  private freeSpinAutoplayAwaitingReelsStart: boolean = false;
  private freeSpinAutoplayPerformedCount: number = 0;
  private maxWinBonusEndHandled: boolean = false;
  // Pending retrigger sequence info to run after WIN_STOP in bonus
  private pendingScatterRetrigger: { scatterGrids: Array<{ x: number; y: number }> } | null = null;
  
  /**
   * Mark a scatter retrigger to run after WIN_STOP during bonus mode.
   */
  public setPendingScatterRetrigger(scatterGrids: Array<{ x: number; y: number }>): void {
    this.pendingScatterRetrigger = { scatterGrids };
    // IMPORTANT: A retrigger means bonus is NOT finished, even if some other
    // system (e.g. SlotController REELS_STOP) tentatively flagged it.
    // Clear the isBonusFinished flag here to prevent premature congrats/end-of-bonus
    // flows while the retrigger dialog is pending.
    try {
      if (gameStateManager.isBonusFinished) {
        console.log('[Symbols] Retrigger scheduled - clearing isBonusFinished flag to avoid premature congrats');
      }
      gameStateManager.isBonusFinished = false;
    } catch {}
  }
  
  /**
   * Check if there's a pending scatter retrigger that will add more free spins
   */
  public hasPendingScatterRetrigger(): boolean {
    return !!(this.pendingScatterRetrigger && Array.isArray(this.pendingScatterRetrigger.scatterGrids) && this.pendingScatterRetrigger.scatterGrids.length > 0);
  }
  
  /**
   * Check if scatter retrigger animation is currently in progress
   */
  public isMultiplierAnimationsInProgress(): boolean {
    return this.multiplierAnimationsInProgress;
  }

  public isScatterRetriggerAnimationInProgress(): boolean {
    return this.scatterRetriggerAnimationInProgress;
  }
  
  /**
   * Synchronize the internal free spin autoplay counter with server-reported spinsLeft.
   * Use this when a retrigger occurs during bonus so our loop continues correctly.
   */
  public setFreeSpinAutoplaySpinsRemaining(spinsRemaining: number): void {
    const normalized = Math.max(0, Number(spinsRemaining) || 0);
    this.freeSpinAutoplaySpinsRemaining = normalized;
    console.log(`[Symbols] Synced free spin autoplay counter to server spinsLeft: ${normalized}`);
  }
  private dialogListenerSetup: boolean = false;

  constructor() { 
    this.scatterAnimationManager = ScatterAnimationManager.getInstance();
    this.symbolDetector = new SymbolDetector();
  }

  public create(scene: Game) {
    this.scene = scene;
    this.symbolPool = new SymbolPool(scene);
    // WinLineDrawer is no longer used in this game (cluster/tumble only).
    // Keep the property for compatibility but never instantiate it.
    this.winLineDrawer = null;
    initVariables(this);
    createContainer(this);
    this.initReelDropSkipController();
    onStart(this);
    onSpinDataReceived(this);
    gameEventManager.on(GameEventType.REELS_STOP, () => {
      this.spinDataResponseReceivedForCurrentSpin = false;
      this.clearSkipReelDrops();
    });
    this.onSpinDone(this.scene);
    this.setupDialogEventListeners();
    this.setupSpinEventListener(); // Re-enabled to clean up symbols at spin start
    

    // Listen for a full free spin reset request (after congrats/bonus end)
    this.scene.events.on('resetFreeSpinState', () => {
      console.log('[Symbols] resetFreeSpinState received - clearing free spin autoplay state');
      if (this.freeSpinAutoplayTimer) {
        this.freeSpinAutoplayTimer.destroy();
        this.freeSpinAutoplayTimer = null;
      }
      this.freeSpinAutoplayActive = false;
      this.freeSpinAutoplaySpinsRemaining = 0;
      this.freeSpinAutoplayWaitingForReelsStop = false;
      this.freeSpinAutoplayWaitingForWinlines = false;
      this.freeSpinAutoplayTriggered = false;
      this.dialogListenerSetup = false;
      this.cachedTotalWin = 0;
      this.cachedScatterTriggerPayout = 0;
      try {
        const gameAPI = (this.scene as any)?.slotController?.gameAPI;
        gameAPI?.clearBonusSessionSnapshots?.();
      } catch { /* noop */ }
    });
  }

  

  private setupSpinEventListener() {
    // Listen for spin events to reset any lingering Spine symbols
    gameEventManager.on(GameEventType.SPIN, () => {
      console.log('[Symbols] Spin event detected, ensuring clean state');
      
      // CRITICAL: Block autoplay spin actions if win dialog is showing, but allow manual spins
      // This fixes the timing issue where manual spin symbol cleanup was blocked
      if (gameStateManager.isShowingWinDialog && gameStateManager.isAutoPlaying) {
        console.log('[Symbols] Autoplay SPIN event BLOCKED - win dialog is showing');
        console.log('[Symbols] Manual spins are still allowed to proceed');
        return;
      }
      
      // Check if scatter animation is in progress before proceeding
      if (this.scatterAnimationManager && this.scatterAnimationManager.isAnimationInProgress()) {
        console.log('[Symbols] WARNING: SPIN event received during scatter bonus - this should not happen!');
        console.log('[Symbols] Stack trace:', new Error().stack);
        return;
      }
      
      // Reset multiplier animation tracking for new spin
      this.multiplierAnimationsInProgress = false;
      
      // Reset scatter retrigger animation tracking for new spin
      this.scatterRetriggerAnimationInProgress = false;
      
      this.ensureCleanSymbolState();
      
      // Win line checking/clearing disabled
      // Hide winning overlay when spin starts
      this.hideWinningOverlay();
      // Reset symbol depths
      this.resetSymbolDepths();
      // Restore symbol visibility for new spin
      this.restoreSymbolVisibility();
      
    });
    
    // WIN_START/WIN_STOP disabled

    // Listen for win dialog close
    gameEventManager.on(GameEventType.WIN_DIALOG_CLOSED, () => {
      console.log('[Symbols] WIN_DIALOG_CLOSED event received');
      // Reset dialog showing flag
      gameStateManager.isShowingWinDialog = false;

      if (gameStateManager.bonusEndedByMaxWin) {
        gameStateManager.bonusEndedByMaxWin = false;
        gameStateManager.suppressTotalWinDialog = false;
        this.cachedTotalWin = 0;
        this.cachedScatterTriggerPayout = 0;
        return;
      }

      // If bonus just finished, check if we need to wait for multiplier animations
      if (gameStateManager.isBonusFinished) {
        console.log('[Symbols] isBonusFinished is true on WIN_DIALOG_CLOSED');
        
        // If multiplier animations are in progress, wait for them to complete before showing congrats
        if (this.multiplierAnimationsInProgress) {
          console.log('[Symbols] Multiplier animations in progress - waiting for MULTIPLIER_ANIMATIONS_COMPLETE before showing congrats');
          // Set up one-time listener for multiplier animations completion
          gameEventManager.once(GameEventType.MULTIPLIER_ANIMATIONS_COMPLETE, () => {
            console.log('[Symbols] MULTIPLIER_ANIMATIONS_COMPLETE received - now showing congrats');
            this.showCongratsDialogAfterDelay();
            gameStateManager.isBonusFinished = false;
          });
        } else {
          console.log('[Symbols] No multiplier animations in progress - showing congrats immediately');
          // Show congrats now and reset the flag; bonus mode exit happens on congrats close
          this.showCongratsDialogAfterDelay();
          gameStateManager.isBonusFinished = false;
        }
      } else {
        // Fallback: if in bonus mode and spin data indicates no spins left, also proceed to congrats
        try {
          const fsData = this.currentSpinData?.slot?.freespin || this.currentSpinData?.slot?.freeSpin;
          const items = Array.isArray(fsData?.items) ? fsData.items : [];
          const totalRemaining = items.reduce((sum: number, it: any) => sum + (it?.spinsLeft || 0), 0);
          if (gameStateManager.isBonus && totalRemaining <= 0) {
            console.log('[Symbols] Bonus mode with 0 spins detected on WIN_DIALOG_CLOSED - showing congrats (fallback)');
            this.showCongratsDialogAfterDelay();
          }
        } catch {}
      }
    });
    
    // Track multiplier animation state
    gameEventManager.on(GameEventType.MULTIPLIERS_TRIGGERED, () => {
      console.log('[Symbols] MULTIPLIERS_TRIGGERED - setting multiplierAnimationsInProgress to true');
      this.multiplierAnimationsInProgress = true;
    });
    
    gameEventManager.on(GameEventType.MULTIPLIER_ANIMATIONS_COMPLETE, () => {
      console.log('[Symbols] MULTIPLIER_ANIMATIONS_COMPLETE - setting multiplierAnimationsInProgress to false');
      this.multiplierAnimationsInProgress = false;
    });

  }

  /**
   * Ensure symbols are in a clean state before spin animation (no conversion back to PNG)
   */
  public ensureCleanSymbolState(): void {
    if (!this.symbols || this.symbols.length === 0) {
      return;
    }
    
    console.log('[Symbols] Ensuring clean symbol state for spin (no PNG reversion)');
    let spineTracksCleared = 0;
    let multiplierWinsCleared = 0;
    
    // Stop any Spine tracks but keep objects intact (no conversion to PNG)
    for (let col = 0; col < this.symbols.length; col++) {
      for (let row = 0; row < this.symbols[col].length; row++) {
        const symbol = this.symbols[col][row];
        
        if (symbol && symbol.animationState) {
          try {
            // If this symbol is a multiplier with a paused Win from a previous item,
            // clear it back to Idle instead of resuming the Win on the next spin.
            const pausedInfo = (symbol as any)?.__pausedMultiplierWin;
            if (pausedInfo) {
              const animState: any = symbol.animationState;
              try {
                if (animState.clearTracks) { animState.clearTracks(); }
                // Attempt to return the multiplier to Idle state
                const base: string | undefined = pausedInfo?.base;
                if (base && animState.setAnimation) {
                  animState.setAnimation(0, `${base}_Idle`, true);
                }
                try { delete (symbol as any).__pausedMultiplierWin; } catch {}
                multiplierWinsCleared++;
              } catch {}
            } else {
              if (symbol.animationState.clearTracks) {
                symbol.animationState.clearTracks();
                spineTracksCleared++;
              }
            }
          } catch {}
        }
      }
    }
    
    if (spineTracksCleared > 0) {
      console.log(`[Symbols] Cleared tracks on ${spineTracksCleared} Spine symbols for spin`);
    }
    if (multiplierWinsCleared > 0) {
      console.log(`[Symbols] Cleared ${multiplierWinsCleared} paused multiplier Win animations back to Idle`);
    }
  }

  /**
   * Start dropping/clearing existing symbols as soon as a new spin is triggered.
   * This is intentionally decoupled from `dropReels` so the clear phase can
   * begin immediately at spin start (manual or autoplay), before new reels drop.
   */
  public startPreSpinDrop(): void {
    this.resetSkipReelDropStateForNewSpin();
    this.spinDataResponseReceivedForCurrentSpin = false;

    if (this.preSpinDropInProgress) {
      console.log('[Symbols] startPreSpinDrop: pre-spin drop already in progress, skipping duplicate call');
      return;
    }
    if (!this.symbols || this.symbols.length === 0) {
      console.log('[Symbols] startPreSpinDrop: no symbols to drop');
      return;
    }

    this.restingGridSnapshot = captureRestingGridSnapshot(this);

    const firstCol = this.symbols[0];
    const numRows = Array.isArray(firstCol) ? firstCol.length : 0;
    if (numRows === 0) {
      console.log('[Symbols] startPreSpinDrop: symbol grid has zero rows');
      return;
    }
    
    // Ensure GameData timings are initialized before the very first drop.
    // This mirrors the logic in processSpinDataSymbols so the first pre-spin
    // drop does not use the tiny constructor defaults (which look "too fast").
    const gameData = this.scene?.gameData as GameData;
    let isTurbo = false;
    let rowDelay = 0;
    if (gameData) {
      const baseDelay = DELAY_BETWEEN_SPINS; // 2500ms default
      const adjustedDelay = gameStateManager.isTurbo
        ? baseDelay * TurboConfig.TURBO_SPEED_MULTIPLIER
        : baseDelay;
      setSpeed(gameData, adjustedDelay);
      isTurbo = !!gameData.isTurbo;
      rowDelay = typeof (gameData as any).dropReelsDelay === 'number'
        ? (gameData as any).dropReelsDelay
        : 0;
    }

    const extendLastReelDrop = false;

    console.log('[Symbols] Starting pre-spin drop of existing symbols', {
      numRows,
      isTurbo,
      rowDelay,
    });

    this.preSpinDropInProgress = true;
    this.beginReelDropSkipWindow();
    this.preSpinDropRowPromises.clear();
    const rowPromises: Promise<void>[] = [];
    const preSpinGeneration = ++this.preSpinDropGeneration;

    // Reverse the sequence: start from bottom row to top row
    for (let step = 0; step < numRows; step++) {
      const actualRow = (numRows - 1) - step;
      const isLastReel = actualRow === 0;
      // Initial delay only consults turbo, because skip flags are NOT yet set at this point
      // (resetSkipReelDropStateForNewSpin cleared them at the top of this method). When the
      // player taps skip mid pre-spin, the delayOrSkip below collapses any remaining wait so
      // later rows drop immediately together — matching turbo's simultaneous-drop behaviour.
      const startDelay = isTurbo
        ? 0
        : rowDelay * PRE_SPIN_DROP_DELAY_MULTIPLIER * step;

      const rowPromise = new Promise<void>((resolve) => {
        (async () => {
          if (startDelay > 0) {
            await delayOrSkip(this, startDelay);
          }
          if (preSpinGeneration !== this.preSpinDropGeneration || this.preSpinDropAbortedBySkip) {
            return;
          }
          console.log(`[Symbols] Pre-spin dropping row ${actualRow}/${numRows - 1}`);
          try {
            await dropPrevSymbols(this, actualRow, isLastReel && extendLastReelDrop);
          } catch (e) {
            console.warn('[Symbols] Error during pre-spin drop for row', actualRow, e);
          } finally {
            resolve();
          }
        })();
      });
      this.preSpinDropRowPromises.set(actualRow, rowPromise);
      rowPromises.push(rowPromise);
    }

    this.preSpinDropPromise = Promise.allSettled(rowPromises).then(() => undefined).finally(() => {
      this.preSpinDropInProgress = false;
      this.preSpinDropPromise = null;
    });
  }

  public cancelClientSpinPresentation(options?: { restoreSymbols?: boolean; clearPreparedSymbols?: boolean }): void {
    const restoreSymbols = options?.restoreSymbols !== false;
    const clearPreparedSymbols = options?.clearPreparedSymbols !== false;

    this.suppressStalePreSpinRowCleanup = true;
    this.preSpinDropGeneration++;
    this.preSpinDropAbortedBySkip = true;
    this.abortAllInFlightDropPrevForSkip();
    this.preSpinDropInProgress = false;
    this.preSpinDropPromise = null;
    this.preSpinDropRowPromises.clear();
    this.spinDataResponseReceivedForCurrentSpin = false;
    this.reelDropInProgress = false;

    killSymbolGridTweens(this, this.symbols);
    if (clearPreparedSymbols) {
      killSymbolGridTweens(this, this.newSymbols);
    }

    if (this.skipClearedOldSymbols.length) {
      const pending = this.skipClearedOldSymbols.splice(0);
      for (const symbol of pending) {
        try {
          if (!symbol || symbol.destroyed) continue;
          try { this.symbolPool.release(symbol); } catch {}
        } catch {}
      }
    }

    if (clearPreparedSymbols && this.newSymbols?.length) {
      disposeSymbols(this, this.newSymbols);
      this.newSymbols = [];
    }

    if (restoreSymbols) {
      restoreRestingGridFromSymbolData(this);
      scheduleRestingGridRestoreRetry(this);
    } else {
      try { this.restoreSymbolVisibility(); } catch {}
      this.suppressStalePreSpinRowCleanup = false;
    }

    try { this.endReelDropSkipWindow(); } catch {}
    try { this.container?.setVisible?.(true); } catch {}
    try { this.container?.setAlpha?.(1); } catch {}
  }

  private onSpinDone(scene: Game) {
    gameEventManager.on(GameEventType.REELS_STOP, (data: any) => {
      console.log('[Symbols] REELS_STOP event received');
      
      // Check if scatter animation is in progress - if so, don't trigger a new spin
      if (this.scatterAnimationManager && this.scatterAnimationManager.isAnimationInProgress()) {
        console.log('[Symbols] REELS_STOP received during scatter bonus - not triggering new spin');
        return;
      }
      
      // Note: Autoplay continuation is now handled in onSpinDataReceived after winline animations complete
      // This prevents conflicts and ensures proper timing
      console.log('[Symbols] REELS_STOP received - autoplay continuation handled separately in onSpinDataReceived');
    });
  }

  private setupDialogEventListeners() {
    // Listen for dialog events to re-enable symbols
    this.scene.events.on('enableSymbols', () => {
      console.log('[Symbols] Re-enabling symbols after dialog transition');
      
      // Make sure symbols container is visible and interactive
      if (this.container) {
        this.container.setAlpha(1);
        this.container.setVisible(true);
        console.log('[Symbols] Symbols container re-enabled and visible');
      }
      
      // Reset any symbol tints/effects that might be active
      this.resetSymbolsState();
    });

    // Listen for scatter bonus activation to capture free spins data
    this.scene.events.on('scatterBonusActivated', (data: { scatterIndex: number; actualFreeSpins: number }) => {
      console.log(`[Symbols] Scatter bonus activated with ${data.actualFreeSpins} free spins - storing data for autoplay`);
      this.pendingFreeSpinsData = data;
    });

    // Listen for scatter bonus completion to restore symbol visibility
    this.scene.events.on('scatterBonusCompleted', () => {
      console.log('[Symbols] Scatter bonus completed event received - restoring symbol visibility');
      
      // Restore all symbols to visible state
      this.restoreSymbolVisibility();
      
      // Specifically ensure scatter symbols are visible
      this.ensureScatterSymbolsVisible();
      
      // Set up dialog animations complete listener only once
      if (!this.dialogListenerSetup) {
        console.log('[Symbols] Setting up dialog animations complete listener for the first time');
        this.dialogListenerSetup = true;
        
        // Wait for dialog animations (including iris transition) to complete before starting autoplay
        // This ensures the iris transition has fully completed before starting autoplay
        // Then wait an additional 3000ms before starting autoplay
        console.log('[Symbols] Waiting for dialog animations to complete before triggering free spins autoplay');
        this.scene.events.once('dialogAnimationsComplete', () => {
          console.log('[Symbols] Dialog animations complete - waiting additional 3000ms before starting autoplay');
          // Add 3000ms delay AFTER the iris transition completes
          this.scene.time.delayedCall(1000, () => {
            console.log('[Symbols] Additional 1200ms delay completed - now triggering autoplay for free spins');
            this.triggerAutoplayForFreeSpins();
          });
        });
      } else {
        console.log('[Symbols] Dialog animations complete listener already set up, skipping duplicate setup');
      }
      
      console.log('[Symbols] Symbol visibility restored after scatter bonus completion');
    });

    // Listen for reels stop to continue free spin autoplay
    gameEventManager.on(GameEventType.REELS_STOP, () => {
      if (this.freeSpinAutoplayActive && this.freeSpinAutoplayWaitingForReelsStop) {
        console.log('[Symbols] REELS_STOP received - continuing free spin autoplay');
        // Reset the waiting flag immediately to prevent multiple responses
        this.freeSpinAutoplayWaitingForReelsStop = false;
        this.continueFreeSpinAutoplay();
      }
    });
    
    // Listen for reels start to safely decrement the free spins counter
    gameEventManager.on(GameEventType.REELS_START, () => {
      if (this.freeSpinAutoplayActive && this.freeSpinAutoplayAwaitingReelsStart) {
        // Decrement exactly once per spin, only after reels actually start
        const before = this.freeSpinAutoplaySpinsRemaining;
        if (this.freeSpinAutoplaySpinsRemaining > 0) {
          this.freeSpinAutoplaySpinsRemaining -= 1;
        }
        this.freeSpinAutoplayPerformedCount++;
        this.freeSpinAutoplayAwaitingReelsStart = false;
        console.log(`[Symbols] Free spin counter decremented on REELS_START: ${before} -> ${this.freeSpinAutoplaySpinsRemaining}`);
      }
    });
    
    // Listen for win stop to run retrigger scatter sequence (bonus) and/or schedule next free spin
    gameEventManager.on(GameEventType.WIN_STOP, async () => {
      // If we have a pending retrigger (bonus scatter), run its sequence after the win dialog (if any) closes.
      // This ensures order: staged win dialog first -> then scatter retrigger animation -> retrigger dialog.
      if (gameStateManager.isBonus && this.pendingScatterRetrigger && Array.isArray(this.pendingScatterRetrigger.scatterGrids)) {
        const retrigger = this.pendingScatterRetrigger;
        this.pendingScatterRetrigger = null;

        const runRetriggerSequenceAndDialog = async () => {
          console.log('[Symbols] Running scatter retrigger sequence (bonus)');
          this.scatterRetriggerAnimationInProgress = true;
          try {
            const liveGrids = this.getLiveScatterGrids();
            await this.playScatterRetriggerSequence(liveGrids);
            try {
              gameEventManager.emit(GameEventType.SCATTER_RETRIGGER_ANIMATION_COMPLETE);
              console.log('[Symbols] Emitted SCATTER_RETRIGGER_ANIMATION_COMPLETE event');
            } catch {}
          } catch (e) {
            console.warn('[Symbols] Retrigger scatter sequence failed:', e);
            try {
              gameEventManager.emit(GameEventType.SCATTER_RETRIGGER_ANIMATION_COMPLETE);
            } catch {}
          }
          try {
            this.scatterAnimationManager?.showRetriggerFreeSpinsDialog(5);
          } catch (e) {
            console.warn('[Symbols] Failed to show retrigger dialog:', e);
            this.scatterRetriggerAnimationInProgress = false;
          }
          this.scene.events.once('dialogAnimationsComplete', () => {
            this.scatterRetriggerAnimationInProgress = false;
            console.log('[Symbols] Retrigger dialog closed - cleared scatterRetriggerAnimationInProgress flag');
            try {
              this.freeSpinAutoplayActive = true;
              gameStateManager.isAutoPlaying = true;
              if (this.scene?.gameData) this.scene.gameData.isAutoPlaying = true;
            } catch {}
            this.waitForAllDialogsToCloseThenResume();
          });
        };

        // Defer so Game.ts WIN_STOP can run first and show the win dialog if qualifying. Then either
        // wait for that dialog to close or run retrigger immediately if no win dialog is shown.
        this.scene.time.delayedCall(150, () => {
          const gameScene = this.scene as any;
          const dialogs = gameScene?.dialogs;
          const anyDialogShowing = !!(dialogs && typeof dialogs.isDialogShowing === 'function' && dialogs.isDialogShowing());
          if (anyDialogShowing) {
            console.log('[Symbols] WIN_STOP: Win dialog showing - deferring retrigger until dialogAnimationsComplete');
            this.scene.events.once('dialogAnimationsComplete', () => {
              runRetriggerSequenceAndDialog();
            });
          } else {
            console.log('[Symbols] WIN_STOP: No win dialog - running retrigger sequence now');
            runRetriggerSequenceAndDialog();
          }
        });
        return;
      }

      // No retrigger pending: continue autoplay if active
      if (this.freeSpinAutoplayActive) {
        this.handleFreeSpinAutoplayWinStop();
      }
    });
  }

  /**
   * Read current scatter symbol cells from the live symbols grid.
   * Uses [col][row] indexing consistent with internal storage.
   */
  private getLiveScatterGrids(): Array<{ x: number; y: number }> {
    const grids: Array<{ x: number; y: number }> = [];
    try {
      if (this.symbols && this.symbols.length > 0) {
        for (let col = 0; col < this.symbols.length; col++) {
          const column = this.symbols[col];
          if (!Array.isArray(column)) continue;
          for (let row = 0; row < column.length; row++) {
            const obj: any = column[row];
            if (!obj) continue;
            const isScatter = (obj as any)?.symbolValue === 0 || (obj?.texture?.key === 'symbol_0');
            if (isScatter) grids.push({ x: col, y: row });
          }
        }
      }
    } catch {}
    return grids;
  }

  /**
   * Get the configured scale for a specific symbol's Spine animation
   */
  public getSpineSymbolScale(symbolValue: number): number {
    const base = this.spineSymbolScales[symbolValue] || 0.6; // Default scale if not configured
    return base * 0.93; // Slight nudge larger
  }

  /**
   * Restore symbol visibility for new spin
   */
  public restoreSymbolVisibility(): void {
    console.log('[Symbols] Restoring symbol visibility for new spin');
    
    // Reset container alpha
    if (this.container) {
      this.container.setAlpha(1);
      console.log('[Symbols] Container alpha reset to 1');
    }
    
    // Reset visibility of any symbols that might have been hidden
    if (this.symbols && this.symbols.length > 0) {
      let resetCount = 0;
      let visibleCount = 0;
      for (let col = 0; col < this.symbols.length; col++) {
        for (let row = 0; row < this.symbols[col].length; row++) {
          const symbol = this.symbols[col][row];
          if (!symbol) continue;

          // Default: show symbol
          if (typeof symbol.setVisible === 'function') {
            symbol.setVisible(true);
            visibleCount++;
          }
          resetCount++;

          
        }
      }
      console.log(`[Symbols] Restored visibility for ${resetCount} symbols, set ${visibleCount} to visible`);
      
      // Also log the current state of the container
      if (this.container) {
        console.log(`[Symbols] Container alpha after restore: ${this.container.alpha}, visible: ${this.container.visible}`);
      }
      
      // Log the state of any scatter symbols specifically
      this.logScatterSymbolsState();
      
      // Force all symbols to be visible as a final safety measure
      this.forceAllSymbolsVisible();
    }
  }

  /**
   * Log the current state of scatter symbols for debugging
   */
  private logScatterSymbolsState(): void {
    if (!this.symbols || this.symbols.length === 0) {
      return;
    }
    
    let scatterCount = 0;
    let visibleScatterCount = 0;
    
    for (let col = 0; col < this.symbols.length; col++) {
      for (let row = 0; row < this.symbols[col].length; row++) {
        const symbol = this.symbols[col][row];
        if (symbol && symbol.texture && symbol.texture.key === 'symbol_0') {
          scatterCount++;
          if (symbol.visible) {
            visibleScatterCount++;
          }
          console.log(`[Symbols] Scatter symbol at (${row}, ${col}): visible=${symbol.visible}, alpha=${symbol.alpha}, inContainer=${symbol.parentContainer === this.container}`);
        }
      }
    }
    
    console.log(`[Symbols] Scatter symbols state: ${visibleScatterCount}/${scatterCount} visible`);
  }

  /**
   * Stop all Spine animations on symbols (without converting them)
   */
  public stopAllSpineAnimations(): void {
    console.log('[Symbols] Stopping all Spine animations on symbols...');
    
    if (this.symbols && this.symbols.length > 0) {
      let spineAnimationsStopped = 0;
      
      for (let col = 0; col < this.symbols.length; col++) {
        for (let row = 0; row < this.symbols[col].length; row++) {
          const symbol = this.symbols[col][row];
          if (symbol && symbol.animationState) {
            try {
              if (symbol.animationState.clearTracks) {
                symbol.animationState.clearTracks();
                spineAnimationsStopped++;
                console.log(`[Symbols] Stopped Spine animation at (${row}, ${col})`);
              }
            } catch (error) {
              console.warn(`[Symbols] Could not stop Spine animation at (${row}, ${col}):`, error);
            }
          }
        }
      }
      
      console.log(`[Symbols] Stopped ${spineAnimationsStopped} Spine animations`);
    }
  }

  /**
   * Stop all active animations on symbols (no conversion back to PNG)
   */
  public stopAllSymbolAnimations(): void {
    console.log('[Symbols] Stopping all active symbol animations (no PNG reversion)...');
    
    if (this.symbols && this.symbols.length > 0) {
      let animationsStopped = 0;
      let spineTracksCleared = 0;
      
      for (let col = 0; col < this.symbols.length; col++) {
        for (let row = 0; row < this.symbols[col].length; row++) {
          const symbol = this.symbols[col][row];
          if (symbol) {
            // Kill any active tweens on this symbol
           // this.scene.tweens.killTweensOf(symbol);
            animationsStopped++;
            
            // If this is a Spine animation, just stop tracks; do not convert
            if (symbol.animationState) {
              // Stop the Spine animation immediately
              try {
                if (symbol.animationState.clearTracks) {
                  symbol.animationState.clearTracks();
                  spineTracksCleared++;
                }
              } catch (error) {
                console.warn(`[Symbols] Could not stop Spine animation at (${row}, ${col}):`, error);
              }
            }
          }
        }
      }
      
      console.log(`[Symbols] Stopped animations on ${animationsStopped} symbols, cleared tracks on ${spineTracksCleared} Spine symbols`);
    }
    
    // Also kill any tweens on the container
    if (this.container) {
      this.scene.tweens.killTweensOf(this.container);
      console.log('[Symbols] Container tweens killed');
    }
  }

  /**
   * Specifically ensure scatter symbols are visible
   */
  public ensureScatterSymbolsVisible(): void {
    console.log('[Symbols] Specifically ensuring scatter symbols are visible');
    
    if (this.symbols && this.symbols.length > 0) {
      let scatterFound = 0;
      let scatterMadeVisible = 0;
      
      for (let col = 0; col < this.symbols.length; col++) {
        for (let row = 0; row < this.symbols[col].length; row++) {
          const symbol = this.symbols[col][row];
          if (symbol && symbol.texture && symbol.texture.key === 'symbol_0') {
            scatterFound++;
            
            if (typeof symbol.setVisible === 'function') {
              symbol.setVisible(true);
              scatterMadeVisible++;
              console.log(`[Symbols] Made scatter symbol visible at (${row}, ${col}): visible=${symbol.visible}, alpha=${symbol.alpha}`);
            }
          }
        }
      }
      
      console.log(`[Symbols] Found ${scatterFound} scatter symbols, made ${scatterMadeVisible} visible`);
      
      // Log the state after making them visible
      if (scatterFound > 0) {
        console.log('[Symbols] Scatter symbols state after ensuring visibility:');
        this.logScatterSymbolsState();
      }
    }
  }

  /**
   * Force all symbols to be visible (for debugging and recovery)
   */
  public forceAllSymbolsVisible(): void {
    console.log('[Symbols] Force setting all symbols to visible');
    
    if (this.symbols && this.symbols.length > 0) {
      let forceVisibleCount = 0;
      for (let col = 0; col < this.symbols.length; col++) {
        for (let row = 0; row < this.symbols[col].length; row++) {
          const symbol = this.symbols[col][row];
          if (symbol && typeof symbol.setVisible === 'function') {
            symbol.setVisible(true);
            forceVisibleCount++;
          }
        }
      }
      console.log(`[Symbols] Force set ${forceVisibleCount} symbols to visible`);
    }
    
    // Also ensure container is visible
    if (this.container) {
      this.container.setAlpha(1);
      this.container.setVisible(true);
      console.log('[Symbols] Container forced to visible with alpha 1');
    }
  }

  /**
   * Reset any Spine symbols back to PNG sprites (called when spin button is clicked)
   */
  public resetSpineSymbolsToPNG(): void {
    if (!this.symbols || this.symbols.length === 0) {
      console.warn('[Symbols] Cannot reset: symbols array is empty or null');
      return;
    }
    
    if (!this.currentSymbolData) {
      console.warn('[Symbols] Cannot reset: currentSymbolData is null');
      return;
    }
    
    console.log('[Symbols] Resetting Spine symbols back to PNG sprites');
    console.log('[Symbols] Current symbol data:', this.currentSymbolData);
    
    let spineCount = 0;
    let pngCount = 0;
    let resetCount = 0;
    
    // First, let's see what we have before cleanup
    for (let col = 0; col < this.symbols.length; col++) {
      for (let row = 0; row < this.symbols[col].length; row++) {
        const symbol = this.symbols[col][row];
        if (symbol) {
          if (symbol.animationState) {
            spineCount++;
            console.log(`[Symbols] Found Spine symbol at (${col}, ${row}): ${symbol.constructor.name}`);
          } else {
            pngCount++;
            console.log(`[Symbols] Found PNG symbol at (${col}, ${row}): ${symbol.texture?.key || 'unknown'}`);
          }
        } else {
          console.log(`[Symbols] Empty slot at (${col}, ${row})`);
        }
      }
    }
    
    console.log(`[Symbols] Before cleanup: ${spineCount} Spine symbols, ${pngCount} PNG symbols`);
    
    for (let col = 0; col < this.symbols.length; col++) {
      for (let row = 0; row < this.symbols[col].length; row++) {
        const symbol = this.symbols[col][row];
        
        // Check if this is a Spine object (has animationState property)
        if (symbol && symbol.animationState) {
          console.log(`[Symbols] Processing Spine symbol at (${col}, ${row})`);
          
          try {
            // Get the original symbol value from stored data
            const symbolValue = this.currentSymbolData[col][row];
            console.log(`[Symbols] Symbol value for (${col}, ${row}): ${symbolValue}`);
            
            if (symbolValue !== undefined) {
              
              // Store original position and dimensions
              const x = symbol.x;
              const y = symbol.y;
              console.log(`[Symbols] Position: (${x}, ${y}), Size: ${this.displayWidth}x${this.displayHeight}`);
              
              // Destroy the Spine object
              this.symbolPool.release(symbol);
              
              // Create PNG sprite in its place
              const spriteKey = 'symbol_' + symbolValue;
              console.log(`[Symbols] Creating PNG sprite with key: ${spriteKey}`);
              
              // Check if the sprite texture exists
              if (!this.scene.textures.exists(spriteKey)) {
                console.error(`[Symbols] Sprite texture '${spriteKey}' does not exist!`);
                console.log('[Symbols] Available textures:', this.scene.textures.getTextureKeys().filter(key => key.includes('symbol')));
                continue;
              }
              
              const pngSprite = this.scene.add.sprite(x, y, spriteKey);
              pngSprite.displayWidth = this.displayWidth;
              pngSprite.displayHeight = this.displayHeight;
              
              // Add to container and update reference
              this.container.add(pngSprite);
              this.symbols[col][row] = pngSprite;
              
              resetCount++;
              console.log(`[Symbols] Successfully reset Spine symbol back to PNG: ${spriteKey} at (${col}, ${row})`);
            } else {
              console.warn(`[Symbols] Symbol value is undefined for (${col}, ${row})`);
            }
          } catch (error) {
            console.error(`[Symbols] Failed to reset Spine symbol at (${col}, ${row}):`, error);
          }
        }
      }
    }
    
    console.log(`[Symbols] Reset complete: Found ${spineCount} Spine symbols, successfully reset ${resetCount}`);
  }

  public resetSymbolsState() {
    // Reset any active symbol animations or tints
    if (this.symbols && this.symbols.length > 0) {
      for (let col = 0; col < this.symbols.length; col++) {
        for (let row = 0; row < this.symbols[col].length; row++) {
          const symbol = this.symbols[col][row];
          
          if (symbol && symbol.active) {
            // Check if symbol has the required methods before calling them
            if (typeof symbol.clearTint === 'function') {
              symbol.clearTint();
            }
            if (typeof symbol.setBlendMode === 'function') {
              symbol.setBlendMode(Phaser.BlendModes.NORMAL);
            }
            if (typeof symbol.setAlpha === 'function') {
              symbol.setAlpha(1);
            }
            
            // Stop any active tweens on this symbol
            //this.scene.tweens.killTweensOf(symbol);
          }
        }
      }
      console.log('[Symbols] Reset symbols state - cleared tints and stopped animations');
    }
  }

  /**
   * Ensure all Spine symbols continue animating by forcing them into their Idle loops
   * and restoring any paused timeScale to 1. Keeps PNG symbols untouched.
   */
  public resumeIdleAnimationsForAllSymbols(): void {
    if (!this.symbols || this.symbols.length === 0) {
      return;
    }

    let resumedCount = 0;
    for (let col = 0; col < this.symbols.length; col++) {
      for (let row = 0; row < this.symbols[col].length; row++) {
        const obj: any = this.symbols[col][row] as any;
        if (!obj) continue;

        const animState: any = obj.animationState;
        if (!animState || typeof animState.setAnimation !== 'function') {
          continue; // PNG or non-spine
        }

        // Determine idle animation name from symbol value or multiplier base
        let idleName: string | null = null;
        try {
          const value: number | null = typeof obj.symbolValue === 'number' ? obj.symbolValue : null;
          if (value !== null && value !== undefined) {
            // Multipliers use shared bases, others use Symbol{n}_SW_Idle
            const multiBase = (typeof value === 'number') ? getMultiplierAnimationBase(value) : null;
            if (multiBase) {
              idleName = `${multiBase}_Idle`;
            } else {
              // Scatter (0) and regular symbols (1-9) use this format
              idleName = `Symbol${value}_SW_Idle`;
            }
          }
        } catch {}

        try {
          // If a multiplier Win was previously paused near the end, clear that state
          const pausedInfo = obj.__pausedMultiplierWin;
          if (pausedInfo) {
            try { delete obj.__pausedMultiplierWin; } catch {}
          }
        } catch {}

        try {
          let entry: any = null;
          if (idleName) {
            entry = animState.setAnimation(0, idleName, true);
          } else {
            // Fallback: if we can't resolve an idle name, just resume current track
            entry = animState.getCurrent ? animState.getCurrent(0) : null;
          }

          // Restore timeScale to normal (with slight jitter to avoid sync)
          const speedJitter = 0.95 + Math.random() * 0.1;
          if (entry && typeof entry.timeScale === 'number') {
            entry.timeScale = speedJitter;
          } else if (typeof animState.timeScale === 'number') {
            animState.timeScale = speedJitter;
          } else if (typeof obj.timeScale === 'number') {
            obj.timeScale = speedJitter;
          }

          // Randomize starting point a bit to desync visuals when possible
          try {
            const animName = entry?.animation?.name ?? idleName;
            const duration = (obj as any)?.skeleton?.data?.findAnimation?.(animName)?.duration;
            if (typeof duration === 'number' && duration > 0 && entry) {
              entry.trackTime = Math.random() * duration;
            }
          } catch {}

          resumedCount++;
        } catch (e) {
          // Non-fatal: continue with other symbols
        }
      }
    }

    if (resumedCount > 0) {
      console.log(`[Symbols] Resumed idle animations on ${resumedCount} Spine symbols`);
    }
  }

  /**
   * Manually trigger win line drawing (for testing)
   */
  public showWinLines(data: Data): void {
    if (this.winLineDrawer && data.wins && data.wins.allMatching.size > 0) {
      this.winLineDrawer.drawWinLines(data); // Now starts looping automatically
    }
  }

  /**
   * Clear win lines and stop looping
   */
  public clearWinLines(): void {
    if (this.winLineDrawer) {
      this.winLineDrawer.stopLooping();
      this.winLineDrawer.clearLines();
    }
  }

  

  /**
   * Check if there are currently visible wins (win lines or overlay)
   */
  public hasCurrentWins(): boolean {
    // Check if win line drawer has active lines
    const hasWinLines = this.winLineDrawer && this.winLineDrawer.hasActiveLines();
    
    // Check if black overlay is visible
    const hasOverlay = this.overlayRect && this.overlayRect.visible;
    
    return hasWinLines || (hasOverlay ?? false);
  }

  public isSkipReelDropsRequested(): boolean {
    return !!this.reelDropSkipController?.isSkipRequested();
  }

  public isSkipReelDropsActive(): boolean {
    return !!this.reelDropSkipController?.isSkipRequested() || !!this.skipReelDropsActive;
  }

  /**
   * Re-anchor the skip-drop synchronization tick to "now". Called from dropReels's fast
   * path so the SKIP_DROP_SYNC_BUFFER_MS alignment window covers only the upcoming
   * row-loop iteration — not whatever stale duration elapsed between the original
   * player tap and the fast path actually running (e.g. across a server response and
   * createNewSymbols in the bonus / buy-feature initial spin paths).
   */
  public markSkipDropStartNow(): void {
    this.skipDropStartTick = Date.now();
  }

  public isClientSpinPresentationActive(): boolean {
    return !!(
      this.preSpinDropInProgress ||
      this.reelDropInProgress ||
      this.preSpinDropRowPromises.size > 0
    );
  }

  public requestSkipReelDrops(): void {
    if (!this.canRequestSkipReelDropsNow()) return;
    this.executeReelDropSkipFromRequest();
    try { this.reelDropSkipController?.markSkipHandled(); } catch {}
  }

  public applySkipVisualClearState(_options?: { showWaitingSpinner?: boolean }): void {
    if (!this.canRequestSkipReelDropsNow()) return;
    this.executeReelDropSkipFromRequest();
  }

  public onSkipActivated(): void {
    try {
      const slotController = (this.scene as any)?.slotController;
      if (slotController && typeof slotController.onReelDropSkipActivated === 'function') {
        slotController.onReelDropSkipActivated();
      }
    } catch {}
  }

  public clearSkipReelDrops(): void {
    try { this.reelDropSkipController?.clear(); } catch {}
    this.releaseSkipClearedOldSymbolsLater();
    this.skipReelDropsActive = false;
    this.skipReelDropsPending = false;
    this.skipDropModeForCurrentSpin = false;
    this.skipReelDropRestartPromise = null;
    this.skipReelDropRestartInProgress = false;
    this.dropReelsMainLoopStarted = false;
    this.skipVisualClearAppliedForCurrentSpin = false;
    this.skipDespawnVfxPlayedForCurrentSpin = false;
    this.skipDespawnVfxTargets = null;
    this.skipDropStartTick = 0;
  }

  public requestSkipTumbles(): void {
    if (this.skipTumblesActive) return;
    this.skipTumblesActive = true;
  }

  public clearSkipTumbles(): void {
    this.skipTumblesActive = false;
  }

  public requestSkipMultipliers(): void {
    if (this.skipMultipliersActive) return;
    this.skipMultipliersActive = true;
    for (const timer of this.multiplierStaggerTimers) {
      try { timer?.destroy(); } catch {}
    }
    this.multiplierStaggerTimers = [];
    if (this.multiplierAnimationsAbortResolve) {
      try { this.multiplierAnimationsAbortResolve(); } catch {}
      this.multiplierAnimationsAbortResolve = null;
    }
  }

  public clearSkipMultipliers(): void {
    this.skipMultipliersActive = false;
    this.multiplierStaggerTimers = [];
    this.multiplierAnimationsAbortResolve = null;
  }

  /** True when current spinData's free-spin item is marked isMaxWin. */
  public isCurrentFreeSpinItemMaxWin(spinData?: any): boolean {
    try {
      const data = spinData ?? this.currentSpinData;
      const gameAPI = (this.scene as any)?.slotController?.gameAPI;
      if (gameAPI?.isFakeDataEnabled?.()) {
        const playedItem = gameAPI.getLastPlayedFreeSpinItem?.();
        if (playedItem) return (playedItem as any)?.isMaxWin === true;
      }

      const slot = data?.slot;
      const fs = slot?.freespin || slot?.freeSpin;
      const items = fs?.items;
      const area = slot?.area;
      if (!Array.isArray(items) || !Array.isArray(area)) return false;
      const areaJson = JSON.stringify(area);
      const item = items.find(
        (it: any) => Array.isArray(it?.area) && JSON.stringify(it.area) === areaJson,
      );
      return (item as any)?.isMaxWin === true;
    } catch {
      return false;
    }
  }

  /** Stop free-spin autoplay after max win; MaxWin dialog ends bonus (no congrats). */
  public stopFreeSpinsAfterMaxWin(): void {
    if (this.freeSpinAutoplayTimer) {
      try { this.freeSpinAutoplayTimer.destroy(); } catch {}
      this.freeSpinAutoplayTimer = null;
    }
    this.freeSpinAutoplayActive = false;
    this.freeSpinAutoplaySpinsRemaining = 0;
    this.freeSpinAutoplayWaitingForReelsStop = false;
    this.freeSpinAutoplayWaitingForWinlines = false;
    this.freeSpinAutoplayTriggered = false;
    this.freeSpinAutoplayAwaitingReelsStart = false;
    this.dialogListenerSetup = false;
    gameStateManager.bonusEndedByMaxWin = true;
    gameStateManager.isBonusFinished = true;
    gameStateManager.isAutoPlaying = false;
    gameStateManager.isAutoPlaySpinRequested = false;
    if (this.scene?.gameData) {
      this.scene.gameData.isAutoPlaying = false;
    }
    this.setTurboMode(false);
    gameEventManager.emit(GameEventType.AUTO_STOP);
  }

  public getFreeSpinAutoplayPerformedCount(): number {
    return this.freeSpinAutoplayPerformedCount;
  }

  private shouldEndFreeSpinBonusAfterCurrentSpin(): boolean {
    if (this.freeSpinAutoplayPerformedCount < 1) {
      return false;
    }
    try {
      const spin = this.scene?.gameAPI?.getCurrentSpinData?.() ?? this.currentSpinData;
      if (!spin?.slot) {
        return false;
      }
      const bonusHeader = (this.scene as any)?.bonusHeader;
      if (bonusHeader?.isMaxWinCapReached?.(spin)) {
        return true;
      }
      if (!SpinDataUtils.hasMaxWinPayload(spin)) {
        return false;
      }
      const finishedIdx = Math.max(0, (this.scene?.gameAPI?.getCurrentFreeSpinIndex?.() ?? 1) - 1);
      const cap = Number(this.scene?.gameAPI?.getMaxWinCapTotal?.() ?? 0);
      const capArg = cap > 0 ? cap : undefined;
      return (
        SpinDataUtils.isMaxWinTerminalFreespinItem(spin, finishedIdx)
        || SpinDataUtils.hasRunningWinReachedMaxWinCap(spin, capArg, finishedIdx)
      );
    } catch {
      return false;
    }
  }

  private completeMaxWinBonusEnd(): void {
    if (this.maxWinBonusEndHandled) {
      return;
    }
    this.maxWinBonusEndHandled = true;
    console.log('[Symbols] Max-win terminal spin — resolving remaining free spins and ending bonus');
    try {
      this.scene?.gameAPI?.resolveRemainingFreeSpinsOnMaxWin?.();
      const resolved = this.scene?.gameAPI?.getCurrentSpinData?.();
      if (resolved) {
        this.currentSpinData = resolved;
      }
    } catch { /* ignore */ }
    this.freeSpinAutoplaySpinsRemaining = 0;
    this.freeSpinAutoplayWaitingForWinlines = false;
    this.freeSpinAutoplayWaitingForReelsStop = false;
    if (this.freeSpinAutoplayTimer) {
      this.freeSpinAutoplayTimer.destroy();
      this.freeSpinAutoplayTimer = null;
    }
    this.stopFreeSpinsAfterMaxWin();
  }

  /** True while pre-spin clear or main reel drop is running (not tumbles). */
  public isReelDropSkipAllowedNow(): boolean {
    if (this.tumbleInProgress) return false;
    if (gameStateManager.isShowingWinDialog) return false;
    return !!(
      this.preSpinDropInProgress ||
      this.preSpinDropRowPromises.size > 0 ||
      this.preSpinDropPromise ||
      this.reelDropInProgress
    );
  }

  public isCriticalLockBlockingSkip(): boolean {
    return !!this.tumbleInProgress;
  }

  public beginReelDropSkipWindow(): void {
    try { this.reelDropSkipController?.beginSpinWindow(); } catch {}
  }

  public endReelDropSkipWindow(): void {
    try { this.reelDropSkipController?.endSpinWindow(); } catch {}
  }

  public canRequestSkipReelDropsNow(): boolean {
    if (gameStateManager.isBonus && !this.enableBonusModeSkip) return false;
    if (!this.isReelDropSkipAllowedNow()) return false;
    if (
      this.preSpinDropInProgress ||
      this.preSpinDropRowPromises.size > 0 ||
      this.preSpinDropPromise
    ) {
      return true;
    }
    if (!this.spinDataResponseReceivedForCurrentSpin) return false;
    if (!gameStateManager.isReelSpinning) return false;
    return !!this.reelDropInProgress;
  }

  public isTumbleSequenceInProgress(): boolean {
    return !!this.tumbleInProgress;
  }

  public tryRequestSkipReelDrops(): boolean {
    if (this.canRequestSkipReelDropsNow()) {
      this.requestSkipReelDrops();
      return true;
    }
    if (gameStateManager.isBonus && this.enableBonusModeSkip && this.tumbleInProgress) {
      this.requestSkipTumbles();
      return true;
    }
    return false;
  }

  private executeReelDropSkipFromRequest(): void {
    const preSpinOnlyWindow =
      !this.spinDataResponseReceivedForCurrentSpin && !this.reelDropInProgress;

    if (this.tumbleInProgress) return;
    if (!preSpinOnlyWindow && !this.isReelDropSkipAllowedNow()) return;

    if (preSpinOnlyWindow) {
      if (!this.skipRequestedForCurrentSpin) {
        this.skipRequestedForCurrentSpin = true;
      }
      this.skipReelDropsPending = true;
      this.skipDropModeForCurrentSpin = true;
      if (
        this.preSpinDropInProgress ||
        this.preSpinDropRowPromises.size > 0 ||
        !!this.preSpinDropPromise
      ) {
        this.acceleratePreSpinDropForSkip();
      }
      return;
    }

    // Fast-path reel drop already in progress — ignore duplicate skip (prevents a second full-grid drop).
    if (
      this.skipRequestedForCurrentSpin &&
      this.reelDropInProgress &&
      !this.dropReelsMainLoopStarted
    ) {
      return;
    }

    // Mid main-loop skip: only escalate to the unified restart once.
    if (
      this.skipRequestedForCurrentSpin &&
      this.reelDropInProgress &&
      this.dropReelsMainLoopStarted
    ) {
      if (this.skipReelDropRestartInProgress || this.skipReelDropRestartPromise) {
        return;
      }
      this.skipReelDropsPending = false;
      this.skipReelDropsActive = true;
      this.startSkipReelDropRestartIfPossible();
      this.accelerateActiveSymbolTweens(2.5);
      return;
    }

    if (!this.skipRequestedForCurrentSpin) {
      this.skipRequestedForCurrentSpin = true;
    }

    this.skipReelDropsPending = true;
    this.skipDropModeForCurrentSpin = true;

    if (this.reelDropInProgress) {
      this.skipReelDropsPending = false;
      this.skipReelDropsActive = true;
    }

    if (!this.skipVisualClearAppliedForCurrentSpin) {
      this.skipVisualClearAppliedForCurrentSpin = true;
      this.skipDropSoundTriggeredForCurrentReelDrop = true;
      this.skipDropStartTick = Date.now();

      try { this.hideWinningOverlay(); } catch {}
      this.accelerateActiveSymbolTweens(2);
    }

    if (this.newSymbols?.length) {
      // Mid main-loop skip: unified restart (see startSkipReelDropRestartIfPossible).
      if (this.reelDropInProgress && this.dropReelsMainLoopStarted) {
        this.startSkipReelDropRestartIfPossible();
      } else if (!this.reelDropInProgress) {
        // Spin data received, dropReels not started — snap for the upcoming fast path.
        try { this.snapNewSymbolsGridToDropSpawn(); } catch {}
      }
    }
    this.accelerateActiveSymbolTweens(2.5);
  }

  private async awaitPreSpinDropsSettled(): Promise<void> {
    const promises: Promise<void>[] = [];
    if (this.preSpinDropPromise) {
      promises.push(this.preSpinDropPromise);
    }
    for (const rowPromise of this.preSpinDropRowPromises.values()) {
      promises.push(rowPromise);
    }
    if (promises.length > 0) {
      await Promise.allSettled(promises);
    }
    this.preSpinDropInProgress = false;
    this.preSpinDropPromise = null;
    this.preSpinDropRowPromises.clear();
  }

  private ensureSkipDespawnVfxTargetsSelected(): void {
    if (this.skipDespawnVfxPlayedForCurrentSpin) return;
    if (!this.skipReelDropsActive && !this.skipReelDropsPending) return;
    if (!this.symbols || this.symbols.length === 0) return;

    const randomTargets = pickRandomSymbolsForSkipDespawnVfx(this.symbols, SKIP_DESPAWN_VFX_COUNT);
    this.skipDespawnVfxTargets = new WeakSet<any>(randomTargets);
    this.skipDespawnVfxPlayedForCurrentSpin = true;
    this.skipDespawnVfxSfxPending = randomTargets.length > 0;
  }

  public async clearOldSymbolsForSkip(): Promise<void> {
    if (!this.symbols || this.symbols.length === 0) return;

    this.ensureSkipDespawnVfxTargetsSelected();

    const numRows = this.symbols[0]?.length ?? 0;
    for (let row = 0; row < numRows; row++) {
      this.clearOldSymbolsRowForSkip(row);
    }
  }

  public clearOldSymbolsRowForSkip(row: number): void {
    if (!this.symbols || this.symbols.length === 0) return;

    this.ensureSkipDespawnVfxTargetsSelected();

    for (let col = 0; col < this.symbols.length; col++) {
      const symbol = this.symbols[col]?.[row];
      if (!symbol || symbol.destroyed) continue;

      const finishHide = () => {
        try {
          const overlayObj: any = symbol?.__overlayImage;
          try { if (overlayObj) this.scene.tweens.killTweensOf(overlayObj); } catch {}
          try { this.scene.tweens.killTweensOf(symbol); } catch {}
          try { symbol.setVisible?.(false); } catch {}
          try { symbol.setAlpha?.(0); } catch {}
          try { if (overlayObj) overlayObj.setVisible?.(false); } catch {}
          try { if (overlayObj) overlayObj.setAlpha?.(0); } catch {}
          this.skipClearedOldSymbols.push(symbol);
        } catch {}

        if (this.symbols[col]?.[row] === symbol) {
          this.symbols[col][row] = null as any;
        }
      };

      finishHide();
    }
  }

  private releaseSkipClearedOldSymbolsLater(): void {
    if (!this.skipClearedOldSymbols.length) return;

    const symbolsToRelease = this.skipClearedOldSymbols.splice(0);
    const release = () => {
      for (const symbol of symbolsToRelease) {
        try {
          if (!symbol || symbol.destroyed) continue;
          try { this.symbolPool.release(symbol); } catch {}
        } catch {}
      }
    };

    try {
      this.scene.time.delayedCall(Symbols.SKIP_CLEARED_SYMBOL_RELEASE_DELAY_MS, release);
    } catch {
      release();
    }
  }

  public snapNewSymbolCellToDropSpawn(col: number, row: number): void {
    const column = this.newSymbols?.[col];
    if (!Array.isArray(column)) return;

    const symbol = column[row];
    if (!symbol || symbol.destroyed) return;

    const overlayObj: any = symbol?.__overlayImage;
    try { if (overlayObj) this.scene.tweens.killTweensOf(overlayObj); } catch {}
    try { this.scene.tweens.killTweensOf(symbol); } catch {}

    const symbolTotalHeight = this.displayHeight + this.verticalSpacing;
    const spawnY = this.slotY - this.totalGridHeight * 0.5 - this.scene.scale.height
      + row * symbolTotalHeight + symbolTotalHeight * 0.5;
    try { symbol.setY?.(spawnY); } catch { symbol.y = spawnY; }
    try { if (overlayObj) overlayObj.y = spawnY; } catch {}

    // Symbol is now back at spawn — it has not settled at its final grid position.
    try { (symbol as any).__hasSettled = false; } catch {}

    const pendingResolve: ((() => void) | null) = (symbol as any).__skipDropResolve ?? null;
    if (typeof pendingResolve === 'function') {
      try { (symbol as any).__skipDropResolve = null; } catch {}
      this.startFastDropForCellAfterSkip(col, row, pendingResolve);
    }
  }

  public startFastDropForCellAfterSkipPublic(col: number, row: number, onDone: () => void): void {
    this.startFastDropForCellAfterSkip(col, row, onDone);
  }

  private getNewSymbolDropTargetY(row: number): number {
    const symbolTotalHeight = this.displayHeight + this.verticalSpacing;
    return (this.slotY - this.totalGridHeight * 0.5)
      + row * symbolTotalHeight + symbolTotalHeight * 0.5;
  }

  private isNewSymbolCellAtDropTarget(row: number, symbol: any): boolean {
    if (!symbol) return true;
    const targetY = this.getNewSymbolDropTargetY(row);
    return Math.abs((symbol.y ?? 0) - targetY) <= 0.5;
  }

  public startCatchUpDropForNewSymbolCellPublic(col: number, row: number, onDone: () => void): void {
    this.startCatchUpDropForNewSymbolCell(col, row, onDone);
  }

  /** Skip mid-drop: tween from current Y to final grid Y (no off-screen snap). */
  private startCatchUpDropForNewSymbolCell(col: number, row: number, onDone: () => void): void {
    const symbol = this.newSymbols?.[col]?.[row];
    if (!symbol || symbol.destroyed) {
      try { onDone(); } catch {}
      return;
    }

    if ((symbol as any).__hasSettled === true || this.isNewSymbolCellAtDropTarget(row, symbol)) {
      const targetY = this.getNewSymbolDropTargetY(row);
      try { symbol.setY?.(targetY); } catch { symbol.y = targetY; }
      const overlayObj: any = (symbol as any)?.__overlayImage;
      if (overlayObj) {
        try { overlayObj.y = targetY; } catch {}
      }
      try { (symbol as any).__hasSettled = true; } catch {}
      try { onDone(); } catch {}
      return;
    }

    const overlayObj: any = (symbol as any)?.__overlayImage;
    const tweenTargets: any = overlayObj ? [symbol, overlayObj] : symbol;
    try { if (overlayObj) this.scene.tweens.killTweensOf(overlayObj); } catch {}
    try { this.scene.tweens.killTweensOf(symbol); } catch {}

    const targetY = this.getNewSymbolDropTargetY(row);
    try { playDropAnimationIfAvailable(symbol); } catch {}

    const gameData: any = this.scene.gameData;
    const dropDuration = (gameData?.dropDuration ?? 250) * 0.9 * getSpinSkipTurboDurationMultiplier(this);

    try {
      this.scene.tweens.add({
        targets: tweenTargets,
        y: targetY,
        duration: dropDuration,
        ease: Phaser.Math.Easing.Cubic.Out,
        onComplete: () => {
          try { (symbol as any).__hasSettled = true; } catch {}
          try { onDone(); } catch {}
        },
      });
    } catch {
      try { symbol.setY?.(targetY); } catch { symbol.y = targetY; }
      if (overlayObj) {
        try { overlayObj.y = targetY; } catch {}
      }
      try { (symbol as any).__hasSettled = true; } catch {}
      try { onDone(); } catch {}
    }
  }

  private catchUpDropPromise(col: number, row: number): Promise<void> {
    return new Promise<void>((resolve) => {
      this.startCatchUpDropForNewSymbolCell(col, row, () => {
        try { resolve(); } catch { resolve(); }
      });
    });
  }

  private startFastDropForCellAfterSkip(col: number, row: number, onDone: () => void): void {
    const symbol = this.newSymbols?.[col]?.[row];
    if (!symbol || symbol.destroyed) {
      try { onDone(); } catch {}
      return;
    }

    const overlayObj: any = (symbol as any)?.__overlayImage;
    const tweenTargets: any = overlayObj ? [symbol, overlayObj] : symbol;

    const symbolTotalHeight = this.displayHeight + this.verticalSpacing;
    const targetY = (this.slotY - this.totalGridHeight * 0.5)
      + row * symbolTotalHeight + symbolTotalHeight * 0.5;

    const gameData: any = this.scene.gameData;
    const symbolHop = (gameData?.winUpHeight ?? 0) * 0.5;
    const winUpDuration = (gameData?.winUpDuration ?? 120) * getSpinSkipTurboDurationMultiplier(this);
    const dropDuration = (gameData?.dropDuration ?? 250) * 0.9 * getSpinSkipTurboDurationMultiplier(this);

    const now = Date.now();
    const targetStart = (this.skipDropStartTick || now) + Symbols.SKIP_DROP_SYNC_BUFFER_MS;
    const initialDelay = Math.max(0, targetStart - now);

    try {
      this.scene.tweens.chain({
        targets: tweenTargets,
        tweens: [
          {
            delay: initialDelay,
            y: `-= ${symbolHop}`,
            duration: winUpDuration,
            ease: Phaser.Math.Easing.Circular.Out,
          },
          {
            y: targetY,
            duration: dropDuration,
            ease: Phaser.Math.Easing.Cubic.Out,
            onComplete: () => {
              try { onDone(); } catch {}
            },
          },
        ],
      });
    } catch {
      try { onDone(); } catch {}
    }
  }

  public snapNewSymbolsGridToDropSpawn(): void {
    this.resetNewSymbolsToDropStartForSkip();
  }

  private resetNewSymbolsToDropStartForSkip(): void {
    if (!this.newSymbols || this.newSymbols.length === 0) return;

    for (let col = 0; col < this.newSymbols.length; col++) {
      const column = this.newSymbols[col];
      if (!Array.isArray(column)) continue;
      for (let row = 0; row < column.length; row++) {
        this.snapNewSymbolCellToDropSpawn(col, row);
      }
    }
  }

  public async awaitSkipReelDropRestart(): Promise<void> {
    const restartPromise = this.skipReelDropRestartPromise;
    if (!restartPromise) return;
    try { await restartPromise; } catch {}
  }

  /**
   * Mid-flight skip restart.
   *
   * When the player taps skip during a staggered drop, per-cell scheduling can't keep
   * all cells aligned. Instead: kill in-flight tweens, unblock pending dropOneColumn
   * promises, then run catch-up tweens from each symbol's current Y to its final grid
   * position (no off-screen snap / full re-drop).
   *
   * dropReels' finally-block awaits `skipReelDropRestartPromise` via
   * `awaitSkipReelDropRestart()`. Future row IIFEs abort via `skipReelDropRestartInProgress`.
   */
  public startSkipReelDropRestartIfPossible(): void {
    if (this.skipReelDropRestartInProgress) return;
    if (!this.newSymbols || this.newSymbols.length === 0) return;
    const firstCol = this.newSymbols[0];
    if (!Array.isArray(firstCol) || firstCol.length === 0) return;

    // Only act if dropReels' main loop is actually iterating row-IIFEs. State-based
    // gate (not timing-based) — checking __skipDropResolve on cells is fragile because
    // tween onComplete may have just nulled it for some cells even while the staggered
    // loop is mid-iteration; the gate could miss a real mid-flight scenario.
    //
    // dropReelsMainLoopStarted is set true just before the for-loop at the end of
    // dropReels and cleared in dropReels' finally (and in clearSkipReelDrops). It is
    // false during:
    //   - dropReels' entry block (line ~4891 escalation + applySkipVisualClearState)
    //   - dropReels' fast path (which has its own internal scheduling)
    //   - processSpinDataSymbols' lazy-init applySkipVisualClearState call
    //   - any other internal init call
    // So those internal callers can't trigger a duplicate restart on top of the
    // fast path's drop — only true mid-flight player skip clicks during the main
    // loop will pass this gate.
    if (!this.dropReelsMainLoopStarted) return;

    this.skipReelDropRestartInProgress = true;
    this.invalidateDropReelsRowPipeline();
    try { this.abortAllInFlightDropPrevForSkip(); } catch {}
    try { this.clearOldSymbolsForSkip(); } catch {}

    const restart = (async () => {
      try {
        await this.killAndCatchUpAllNewSymbolsForRestart();
      } catch (e) {
        console.warn('[Symbols] skip reel drop restart error:', e);
      }
    })();

    this.skipReelDropRestartPromise = restart.finally(() => {
      this.skipReelDropRestartInProgress = false;
      this.skipReelDropRestartPromise = null;
    });
  }

  /**
   * Kill in-flight tweens, unblock pending dropOneColumn promises, then catch-up tween
   * every unsettled cell from its current Y to its final grid position.
   */
  private async killAndCatchUpAllNewSymbolsForRestart(): Promise<void> {
    if (!this.newSymbols || this.newSymbols.length === 0) return;

    const catchUpPromises: Promise<void>[] = [];

    for (let col = 0; col < this.newSymbols.length; col++) {
      const column = this.newSymbols[col];
      if (!Array.isArray(column)) continue;
      for (let row = 0; row < column.length; row++) {
        const symbol = column[row];
        if (!symbol || symbol.destroyed) continue;

        if ((symbol as any).__hasSettled === true) continue;

        const overlayObj: any = (symbol as any)?.__overlayImage;
        try { if (overlayObj) this.scene.tweens.killTweensOf(overlayObj); } catch {}
        try { this.scene.tweens.killTweensOf(symbol); } catch {}

        const pendingResolve: ((() => void) | null) = (symbol as any).__skipDropResolve ?? null;
        if (typeof pendingResolve === 'function') {
          try { (symbol as any).__skipDropResolve = null; } catch {}
          try { pendingResolve(); } catch {}
        }

        if (this.isNewSymbolCellAtDropTarget(row, symbol)) {
          try { (symbol as any).__hasSettled = true; } catch {}
          continue;
        }

        try { (symbol as any).__hasSettled = false; } catch {}
        catchUpPromises.push(this.catchUpDropPromise(col, row));
      }
    }

    if (catchUpPromises.length > 0) {
      await Promise.all(catchUpPromises);
    }
  }

  /**
   * Speed up in-flight pre-spin old-symbol drops when skip is requested.
   * Keep the row promises alive so new symbols wait for the old grid to drop away.
   */
  private acceleratePreSpinDropForSkip(): void {
    if (!this.skipVisualClearAppliedForCurrentSpin) {
      this.skipVisualClearAppliedForCurrentSpin = true;
      this.skipDropSoundTriggeredForCurrentReelDrop = true;
      this.skipDropStartTick = Date.now();
      try { this.hideWinningOverlay(); } catch {}
    }

    this.accelerateActiveSymbolTweens(2.5);
  }

  public isDropReelsRowPipelineStale(pipelineGeneration: number): boolean {
    return pipelineGeneration !== this.dropReelsRowPipelineGeneration;
  }

  private invalidateDropReelsRowPipeline(): void {
    this.dropReelsRowPipelineGeneration++;
  }

  /** Abort in-flight dropPrevSymbols tweens when skip restart takes over. */
  private abortAllInFlightDropPrevForSkip(): void {
    const resolvers = Array.from(this.skipOldDropAbortResolvers);
    this.skipOldDropAbortResolvers.clear();
    for (const fn of resolvers) {
      try { fn(); } catch {}
    }
  }

  private resetSkipReelDropStateForNewSpin(): void {
    this.skipRequestedForCurrentSpin = false;
    this.skipVisualClearAppliedForCurrentSpin = false;
    this.preSpinDropAbortedBySkip = false;
    this.skipReelDropsActive = false;
    this.skipReelDropsPending = false;
    this.skipDropModeForCurrentSpin = false;
    this.skipReelDropRestartPromise = null;
    this.skipReelDropRestartInProgress = false;
    this.skipDropSoundTriggeredForCurrentReelDrop = false;
    this.skipDespawnVfxPlayedForCurrentSpin = false;
    this.skipDespawnVfxTargets = null;
    this.skipDropStartTick = 0;
    this.skipOldDropAbortResolvers.clear();
    this.dropReelsRowPipelineGeneration = 0;
  }

  private initReelDropSkipController(): void {
    try {
      try { this.reelDropSkipController?.destroy(); } catch {}
      this.reelDropSkipController = new ReelDropSkipController(this.scene, this);
      this.reelDropSkipController.attach();

      const onReelsStart = () => {
        try { this.reelDropSkipController?.beginSpinWindow({ preserveSkipHandled: true }); } catch {}
      };
      gameEventManager.on(GameEventType.REELS_START, onReelsStart);

      this.scene.events.once('shutdown', () => {
        try { gameEventManager.off(GameEventType.REELS_START, onReelsStart); } catch {}
        try { this.reelDropSkipController?.destroy(); } catch {}
        this.reelDropSkipController = null;
      });
    } catch {}
  }

  private accelerateActiveSymbolTweens(timeScale: number): void {
    const scale = Math.max(1, Number(timeScale) || 1);
    const accel = (obj: any) => {
      try {
        const tweens = this.scene.tweens.getTweensOf(obj) as any[];
        if (Array.isArray(tweens)) {
          for (const t of tweens) {
            try { (t as any).timeScale = scale; } catch { }
          }
        }
      } catch { }
    };
    try {
      if (this.symbols) {
        for (let c = 0; c < this.symbols.length; c++) {
          const col = this.symbols[c];
          if (!Array.isArray(col)) continue;
          for (let r = 0; r < col.length; r++) {
            const obj = col[r];
            if (obj) accel(obj);
          }
        }
      }
    } catch { }
    try {
      if (this.newSymbols) {
        for (let c = 0; c < this.newSymbols.length; c++) {
          const col = this.newSymbols[c];
          if (!Array.isArray(col)) continue;
          for (let r = 0; r < col.length; r++) {
            const obj = col[r];
            if (obj) accel(obj);
          }
        }
      }
    } catch { }
    try {
      const list: any[] = (this.container as any)?.list || [];
      for (const child of list) accel(child);
    } catch { }
  }

  /**
   * Create semi-transparent rectangle overlay above symbols
   */
  private createOverlayRect(): void {
    if (this.overlayRect) {
      this.overlayRect.destroy();
    }
    
    // Create overlay graphics
    this.overlayRect = this.scene.add.graphics();
    
    // Set semi-transparent black fill
    this.overlayRect.fillStyle(0x000000, 0.7);
    
    // Fill rectangle covering the symbol grid area
    const gridBounds = this.getSymbolGridBounds();
    this.overlayRect.fillRect(
      gridBounds.x, 
      gridBounds.y, 
      gridBounds.width, 
      gridBounds.height
    );
    
    // Set depth to be above symbols but below winning symbols
    this.overlayRect.setDepth(500);
    
    // Hide by default
    this.overlayRect.setVisible(false);
    
    console.log('[Symbols] Semi-transparent overlay rectangle created (hidden by default)');
  }

  /**
   * Show overlay for winning patterns with fade in animation
   */
  public showWinningOverlay(): void {
    if (!this.overlayRect) {
      this.createOverlayRect();
    }
    if (this.overlayRect) {
      // Stop any existing tweens on the overlay
      this.scene.tweens.killTweensOf(this.overlayRect);
      
      // If already visible, ensure full opacity and avoid re-tweening to prevent flicker
      if (this.overlayRect.visible && this.overlayRect.alpha >= 1) {
        this.overlayRect.setAlpha(1);
        console.log('[Symbols] Winning overlay already visible - ensuring alpha 1');
        return;
      }
      
      // Set initial state for fade in
      this.overlayRect.setVisible(true);
      this.overlayRect.setAlpha(0);
      
      // Animate fade in
      this.scene.tweens.add({
        targets: this.overlayRect,
        alpha: 1,
        duration: 300,
        ease: 'Power2.easeOut',
        onComplete: () => {
          console.log('[Symbols] Winning overlay fade in completed');
        }
      });
    }
    console.log('[Symbols] Winning overlay fade in started');
  }

  /**
   * Hide the overlay with fade out animation
   */
  public hideWinningOverlay(): void {
    if (this.overlayRect && this.overlayRect.visible) {
      // Stop any existing tweens on the overlay
      this.scene.tweens.killTweensOf(this.overlayRect);
      
      // Animate fade out
      this.scene.tweens.add({
        targets: this.overlayRect,
        alpha: 0,
        duration: 200,
        ease: 'Power2.easeIn',
        onComplete: () => {
          if (this.overlayRect) {
            this.overlayRect.setVisible(false);
          }
          console.log('[Symbols] Winning overlay fade out completed');
        }
      });
      console.log('[Symbols] Winning overlay fade out started');
    }
  }


  /**
   * Move winning symbols to appear in front of the overlay
   */
  public moveWinningSymbolsToFront(data: Data): void {
    if (!data.wins || data.wins.allMatching.size === 0) {
      console.log('[Symbols] No wins to move to front');
      return;
    }

    // Collect all unique winning grids from all win patterns
    const allWinningGrids = new Set<string>();
    const uniqueGrids: { x: number, y: number }[] = [];

    for (const winningGrids of data.wins.allMatching.values()) {
      for (const grid of winningGrids) {
        const gridKey = `${grid.x},${grid.y}`;
        if (!allWinningGrids.has(gridKey)) {
          allWinningGrids.add(gridKey);
          uniqueGrids.push({ x: grid.x, y: grid.y });
        }
      }
    }

    console.log(`[Symbols] Found ${uniqueGrids.length} unique winning symbols to move to front`);

    // Set depth of winning symbols to be above the overlay
    let movedCount = 0;
    for (const grid of uniqueGrids) {
      if (this.symbols && this.symbols[grid.y] && this.symbols[grid.y][grid.x] && !this.symbols[grid.y][grid.x].destroyed) {
        const symbol = this.symbols[grid.y][grid.x];
        console.log(`[Symbols] Moving symbol at (${grid.x}, ${grid.y}) to front, current depth:`, symbol.depth);
        
        // Remove symbol from container and add directly to scene for independent depth control
        this.container.remove(symbol);
        this.scene.add.existing(symbol);
        
        if (typeof symbol.setDepth === 'function') {
          symbol.setDepth(600); // Above overlay (500) but below win lines (1000)
        }
        // If symbol has an overlay, move it to scene and keep above the symbol
        try {
          const overlayObj: any = (symbol as any).__overlayImage;
          if (overlayObj) {
            try { this.scene.tweens.killTweensOf(overlayObj); } catch {}
            if (overlayObj.parentContainer === this.container) {
              this.container.remove(overlayObj);
            } else {
              this.scene.children.remove(overlayObj);
            }
            this.scene.add.existing(overlayObj);
            overlayObj.setDepth((symbol.depth || 600) + 1);
          }
        } catch {}
        console.log(`[Symbols] Symbol at (${grid.x}, ${grid.y}) moved to scene with depth:`, symbol.depth);
        movedCount++;
      } else {
        console.warn(`[Symbols] Symbol at (${grid.x}, ${grid.y}) not found or invalid`);
      }
    }

    console.log(`[Symbols] Successfully moved ${movedCount} out of ${uniqueGrids.length} winning symbols to front`);
  }

  /**
   * Reset all symbol depths to default and move them back to container
   */
  public resetSymbolDepths(): void {
    if (!this.symbols || this.symbols.length === 0) {
      return;
    }

    let resetCount = 0;
    for (let col = 0; col < this.symbols.length; col++) {
      for (let row = 0; row < this.symbols[col].length; row++) {
        const symbol = this.symbols[col][row];
        if (symbol) {
          // Move symbol back to container if it's not already there
          if (symbol.parentContainer !== this.container) {
            this.scene.children.remove(symbol);
            this.container.add(symbol);
          }
          if (typeof symbol.setDepth === 'function') {
            symbol.setDepth(0); // Reset to default depth
          }
          // Move overlay (if any) back to container and keep above the symbol
          try {
            const overlayObj: any = (symbol as any).__overlayImage;
            if (overlayObj) {
              // Do not kill overlay tweens while pre-spin drop chains are running — that
              // interrupts multiplier dropPrevSymbols and leaves bottom-row symbols stuck.
              if (!this.preSpinDropInProgress) {
                try { this.scene.tweens.killTweensOf(overlayObj); } catch {}
              }
              if (overlayObj.parentContainer !== this.container) {
                this.scene.children.remove(overlayObj);
                this.container.add(overlayObj);
              }
              overlayObj.setDepth(1);
            }
          } catch {}
          resetCount++;
        }
      }
    }
    console.log(`[Symbols] Reset depths and container for ${resetCount} symbols`);
  }

  /**
   * Move scatter symbols to front (above overlay) - similar to winning symbols
   */
  public moveScatterSymbolsToFront(data: Data, scatterGrids: any[]): void {
    if (scatterGrids.length === 0) {
      console.log('[Symbols] No scatter symbols to move to front');
      return;
    }

    console.log(`[Symbols] Moving ${scatterGrids.length} scatter symbols to front`);

    // Set depth of scatter symbols to be above the overlay
    let movedCount = 0;
    for (const grid of scatterGrids) {
      if (this.symbols && this.symbols[grid.y] && this.symbols[grid.y][grid.x]) {
        const symbol = this.symbols[grid.y][grid.x];
        console.log(`[Symbols] Moving scatter symbol at (${grid.x}, ${grid.y}) to front, current depth:`, symbol.depth);
        
        // Remove symbol from container and add directly to scene for independent depth control
        this.container.remove(symbol);
        this.scene.add.existing(symbol);
        
        if (typeof symbol.setDepth === 'function') {
          symbol.setDepth(600); // Above overlay (500) but below win lines (1000)
        }
        // If symbol has an overlay, move it to scene and keep above the symbol
        try {
          const overlayObj: any = (symbol as any).__overlayImage;
          if (overlayObj) {
            if (overlayObj.parentContainer === this.container) {
              this.container.remove(overlayObj);
            } else {
              this.scene.children.remove(overlayObj);
            }
            this.scene.add.existing(overlayObj);
            overlayObj.setDepth((symbol.depth || 600) + 1);
          }
        } catch {}
        console.log(`[Symbols] Scatter symbol at (${grid.x}, ${grid.y}) moved to scene with depth:`, symbol.depth);
        movedCount++;
      } else {
        console.warn(`[Symbols] Scatter symbol at (${grid.x}, ${grid.y}) not found or invalid`);
      }
    }

    console.log(`[Symbols] Successfully moved ${movedCount} out of ${scatterGrids.length} scatter symbols to front`);
  }

  /**
   * Sugar Wonderland scatter pay from grid (same multipliers as processSpinDataSymbols).
   * Table applies for 4+ scatters (3x / 5x / 100x bet); 3-scatter retriggers use 0 here.
   * Backend freespin.totalWin often omits this; add for cached/congrats totals.
   */
  private getScatterTablePayoutFromSpinData(spinData: any): number {
    try {
      if (!spinData?.slot?.area) return 0;
      const area = spinData.slot.area as number[][];
      if (!Array.isArray(area) || area.length === 0) return 0;
      const scatterId = Data.SCATTER[0];
      let count = 0;
      for (let y = 0; y < area.length; y++) {
        const row = area[y];
        if (!Array.isArray(row)) continue;
        for (let x = 0; x < row.length; x++) {
          if (row[x] === scatterId) count++;
        }
      }
      if (count < 4) return 0;
      const betAmount = parseFloat(String(spinData.bet));
      const scatterMultiplier =
        count >= 6 ? 100 :
        count === 5 ? 5 :
        3;
      return (isNaN(betAmount) ? 0 : betAmount) * scatterMultiplier;
    } catch {
      return 0;
    }
  }

  /**
   * Session total from spin payload (`slot.totalWin`) for congrats / header caching.
   */
  private calculateTotalWinFromSpinData(): number {
    return SpinDataUtils.getSlotTotalWin(this.currentSpinData);
  }

  /**
   * Start the scatter animation sequence (called after win dialog closes or immediately if no dialog)
   */
  public startScatterAnimationSequence(mockData: any): void {
    console.log('[Symbols] Starting scatter animation sequence');
    
    // Scatter pay from this grid (for congrats fallback when currentSpinData later points at last free spin)
    this.cachedScatterTriggerPayout = this.getScatterTablePayoutFromSpinData(this.currentSpinData);

    // Cache session total from this trigger spin (always refresh for a new bonus session).
    this.cachedTotalWin = this.calculateTotalWinFromSpinData();
    console.log(`[Symbols] Cached total win before freespin dialog: ${this.cachedTotalWin}`);
    
    // Keep animations running and symbols visible during scatter; do not stop or hide
    this.hideWinningOverlay();
    this.clearWinLines();
    
    // Do NOT hide the winnings display on scatter; keep it visible until bonus header takes over
    
    // Then trigger the scatter animation sequence (spinner, dialog, etc.)
    if (this.scatterAnimationManager) {
      console.log('[Symbols] Starting scatter animation sequence');
      this.scatterAnimationManager.playScatterAnimation(mockData);
    } else {
      console.warn('[Symbols] ScatterAnimationManager not available');
    }
  }

  /**
   * Animate scatter symbols with Spine animations (no winlines)
   */
  public async animateScatterSymbols(data: Data, scatterGrids: any[]): Promise<void> {
    if (scatterGrids.length === 0) {
      console.log('[Symbols] No scatter symbols to animate');
      return;
    }

    console.log(`[Symbols] Starting scatter symbol Spine animation for ${scatterGrids.length} symbols`);

    // Ensure we only trigger the scatter win "nom nom" SFX once for this sequence
    let scatterWinNomnomPlayed: boolean = false;

    // Replace scatter symbols with Spine animations
    const animationPromises = scatterGrids.map(grid => {
      return new Promise<void>((resolve) => {
        // Note: scatterGrids coordinates are [row][col] from transposed data
        // but this.symbols array is [col][row] format, so we need to swap coordinates
        const col = grid.x; // grid.x is actually the column in transposed data
        const row = grid.y; // grid.y is actually the row in transposed data
        
        console.log(`[Symbols] ScatterGrid coordinates: grid.x=${grid.x}, grid.y=${grid.y} -> col=${col}, row=${row}`);
        console.log(`[Symbols] Accessing this.symbols[${col}][${row}]`);
        
        if (this.symbols && this.symbols[col] && this.symbols[col][row]) {
          const currentSymbol = this.symbols[col][row];
          
          try {
            // Use sugar scatter spine (Symbol0) and play Idle animation
            const symbolValue = 0; // Scatter
            const spineKey = `symbol_${symbolValue}_sugar_spine`;
            const spineAtlasKey = spineKey + '-atlas';
            const idleAnimationName = `Symbol${symbolValue}_SW_Idle`;
            
            // Store original position and scale
            const x = currentSymbol.x;
            const y = currentSymbol.y;
            const displayWidth = currentSymbol.displayWidth;
            const displayHeight = currentSymbol.displayHeight;
            
            console.log(`[Symbols] Replacing scatter sprite with sugar Spine animation: ${spineKey} at column ${col}, row ${row}`);
            
            // Remove the current sprite
            this.symbolPool.release(currentSymbol);

            const attemptCreate = (attempts: number) => {
              try {
                if (!(this.scene.cache.json as any).has(spineKey)) {
                  if (attempts < 5) {
                    console.warn(`[Symbols] Spine json '${spineKey}' not ready. Retrying (${attempts + 1}/5)...`);
                    this.scene.time.delayedCall(150, () => attemptCreate(attempts + 1));
                    return;
                  }
                }
                // Create Spine animation in its place
                enableSymbolSpineAtlasMipmaps(this.scene);
                const spineSymbol = this.symbolPool.acquire(spineKey, spineAtlasKey, x, y);
                spineSymbol.setOrigin(0.5, 0.5);
                try { (spineSymbol as any).symbolValue = 0; } catch {}
                // Fit to symbol box for consistent sizing
                try { fitSpineToSymbolBox(this, spineSymbol); } catch {}
                try { enableMipmapsOnSpineSkeleton(spineSymbol.skeleton, this.scene); } catch {}
                
                // Add to scene directly (not container) to maintain elevated depth above overlay
                this.scene.add.existing(spineSymbol);
                this.symbols[col][row] = spineSymbol;
                
                // Register the scatter symbol with the ScatterAnimationManager
                if (this.scatterAnimationManager) {
                  this.scatterAnimationManager.registerScatterSymbol(spineSymbol);
                  this.symbolPool.onRelease(spineSymbol, () => this.scatterAnimationManager.unregisterScatterSymbol(spineSymbol));
                }
                
                // Ensure the Spine animation maintains the elevated depth
                spineSymbol.setDepth(600); // Above overlay (500) but below win lines (1000)
                
                console.log(`[Symbols] Successfully replaced scatter sprite with Spine animation at column ${col}, row ${row} with depth:`, spineSymbol.depth);
                
                // Play the sugar Idle animation (looped)
                spineSymbol.animationState.setAnimation(0, idleAnimationName, true);
                console.log(`[Symbols] Playing looped scatter animation: ${idleAnimationName}`);
                
                // Create smooth scale tween to increase size by 20%
                // Determine current scale after fit and scale up
                const currentScaleX = (spineSymbol as any)?.scaleX ?? 1;
                const currentScaleY = (spineSymbol as any)?.scaleY ?? 1;
                const enlargedScaleX = currentScaleX * 1.8;
                const enlargedScaleY = currentScaleY * 1.8;
                this.scene.tweens.add({
                  targets: spineSymbol,
                  scaleX: enlargedScaleX,
                  scaleY: enlargedScaleY,
                  duration: 500, // Smooth 500ms transition
                  ease: 'Power2.easeOut', // Smooth easing
                  onComplete: () => {
                    console.log(`[Symbols] Scatter symbol scale tween completed`);
                  }
                });
                
                console.log(`[Symbols] Applied smooth scale tween to scatter symbol ${symbolValue}`);
                
                // Resolve after a short delay to allow animation to start
                setTimeout(() => resolve(), 100);
              } catch (e) {
                if (attempts < 5) {
                  this.scene.time.delayedCall(150, () => attemptCreate(attempts + 1));
                  return;
                }
                throw e;
              }
            };
            attemptCreate(0);
            
          } catch (error) {
            console.warn(`[Symbols] Failed to replace scatter sprite with Spine animation at column ${col}, row ${row}:`, error);
            
            // Fallback to the old pulse method if Spine replacement fails
            if (this.symbols[col] && this.symbols[col][row]) {
              const symbol = this.symbols[col][row];
              
              // Pulse effect: scale up and down with glow
              this.scene.tweens.add({
                targets: symbol,
                scaleX: 1.2,
                scaleY: 1.2,
                duration: 300,
                ease: 'Sine.easeInOut',
                yoyo: true,
                repeat: 2, // Pulse 3 times total
                onComplete: () => {
                  resolve();
                }
              });
              
              // Add glow effect - check if methods exist before calling
              if (typeof symbol.setTint === 'function') {
                symbol.setTint(0x00FFFF); // Cyan tint for scatter
              }
              if (typeof symbol.setBlendMode === 'function') {
                symbol.setBlendMode(Phaser.BlendModes.ADD);
              }
            } else {
              resolve();
            }
          }
        } else {
          resolve();
        }
      });
    });
    
    // Wait for all Spine animations to start
    await Promise.all(animationPromises);
    
    // Keep idle on hit, then after 0.5s gather all scatters to screen center while playing drop once
    await this.delay(500);
    try {
      // Center on the symbols grid (not the screen center)
      const centerX = this.slotX + 10;
      const centerY = this.slotY;
      const gatherDuration = 600;
      const symbolValue = 0; // Scatter symbol index
      const dropAnimationName = `Symbol${symbolValue}_SW_Drop`;
      const idleAnimationName = `Symbol${symbolValue}_SW_Idle`;
      
      // Create candy overlay that appears and rotates while scatters gather
      let candyOverlay: Phaser.GameObjects.Image | null = null;
      try {
        // Clean up any existing overlay before creating a new one
        try {
          if (this.scatterCandyOverlay) {
            this.scene.tweens.killTweensOf(this.scatterCandyOverlay);
            this.scatterCandyOverlay.destroy();
            this.scatterCandyOverlay = null;
          }
        } catch {}
        candyOverlay = this.scene.add.image(centerX, centerY, 'candy-overlay')
          .setOrigin(0.5, 0.5)
          .setAlpha(0)
          .setScale(0.4);
        // Place overlay outside the masked container to avoid masking, but set depth between overlayRect (500) and symbols (600)
        candyOverlay.setDepth(550);
        // Store reference for cleanup on next reset
        this.scatterCandyOverlay = candyOverlay;
        // Fade in during gather
        this.scene.tweens.add({
          targets: candyOverlay,
          alpha: 1,
          duration: gatherDuration,
          ease: 'Sine.easeInOut'
        });
        // Continuous rotation (keeps spinning during and after enlargement)
        this.scene.tweens.add({
          targets: candyOverlay,
          rotation: '-=6.283185307179586', // 2 * PI
          duration: 4000,
          ease: 'Linear',
          repeat: -1
        });
      } catch {}
      
      const gatherPromises = scatterGrids.map(grid => {
        return new Promise<void>((resolve) => {
          const col = grid.x;
          const row = grid.y;
          const symbol: any = this.symbols?.[col]?.[row];
          this.symbolPool.onRelease(symbol, resolve);
          if (!symbol) {
            resolve();
            return;
          }
          
          // Play drop animation once if available, then return to idle
          let dropCompleted = false;
          let tweenCompleted = false;
          const maybeResolve = () => {
            if (dropCompleted && tweenCompleted) resolve();
          };
          
          try {
            const hasDrop = !!(symbol as any)?.skeleton?.data?.findAnimation?.(dropAnimationName);
            if (hasDrop && symbol.animationState?.setAnimation) {
              symbol.animationState.setAnimation(0, dropAnimationName, false);
              if (symbol.animationState.addListener) {
                symbol.animationState.addListener({
                  complete: (entry: any) => {
                    try {
                      if (!entry || entry.animation?.name !== dropAnimationName) return;
                    } catch {}
                    // Return to idle loop after drop finishes
                    try {
                      symbol.animationState.setAnimation(0, idleAnimationName, true);
                    } catch {}
                    dropCompleted = true;
                    maybeResolve();
                  }
                });
              } else {
                // If we can't listen for completion, set a conservative timeout
                this.symbolPool.delay(symbol, 600, () => {
                  try { symbol.animationState.setAnimation(0, idleAnimationName, true); } catch {}
                  dropCompleted = true;
                  maybeResolve();
                });
              }
            } else {
              // No drop animation; consider drop done immediately
              dropCompleted = true;
            }
          } catch {
            dropCompleted = true;
          }
          
          // Tween the symbol to the center
          this.scene.tweens.add({
            targets: symbol,
            x: centerX,
            y: centerY,
            duration: gatherDuration,
            ease: 'Sine.easeInOut',
            onComplete: () => {
              tweenCompleted = true;
              maybeResolve();
            }
          });
        });
      });
      
      await Promise.all(gatherPromises);
      console.log('[Symbols] Scatter symbols gathered to center and drop animation played once');
      
      // After gathering: scale each scatter by +100% (2x) then play the win animation
      try {
        const winAnimationName = `Symbol${symbolValue}_SW_Win`;
        const scaleTweens: Promise<void>[] = scatterGrids.map(grid => {
          return new Promise<void>((resolve) => {
            const col = grid.x;
            const row = grid.y;
            const symbol: any = this.symbols?.[col]?.[row];
            this.symbolPool.onRelease(symbol, resolve);
            if (!symbol) {
              resolve();
              return;
            }
            const currentScaleX = (symbol as any)?.scaleX ?? 1;
            const currentScaleY = (symbol as any)?.scaleY ?? 1;
            const targetScaleX = currentScaleX * 2.5;
            const targetScaleY = currentScaleY * 2.5;
            
            this.scene.tweens.add({
              targets: symbol,
              scaleX: targetScaleX,
              scaleY: targetScaleY,
              duration: 400,
              ease: 'Sine.easeOut',
              onComplete: () => {
                try {
                  const state: any = symbol.animationState;
                  const canAnimate = state && typeof state.setAnimation === 'function';
                  if (canAnimate) {
                    let finished = false;
                    let listenerRef: any = null;
                    // Attach listener so that after Win plays once, we return to Idle loop
                    try {
                      if (typeof state.addListener === 'function') {
                        listenerRef = {
                          complete: (entry: any) => {
                            try {
                              if (!entry || entry.animation?.name !== winAnimationName) return;
                            } catch {}
                            if (finished) return;
                            finished = true;
                            // Return to idle loop after win animation completes
                            try { state.setAnimation(0, idleAnimationName, true); } catch {}
                            try { if (state.removeListener && listenerRef) state.removeListener(listenerRef); } catch {}
                          }
                        };
                        state.addListener(listenerRef);
                      }
                    } catch {}

                    const entry = state.setAnimation(0, winAnimationName, false);
                    if (entry) {
                      // Speed up this track slightly
                      try {
                        const base = (typeof (entry as any).timeScale === 'number' && (entry as any).timeScale > 0)
                          ? (entry as any).timeScale
                          : 1;
                        const newScale = base * 1.3; // +30% speed
                        (entry as any).timeScale = newScale;
                      } catch {}
                    } else {
                      // Fallback: speed up the whole state if entry not available
                      try {
                        const baseState = (typeof state.timeScale === 'number' && state.timeScale > 0)
                          ? state.timeScale
                          : 1;
                        const newStateScale = baseState * 1.5;
                        state.timeScale = newStateScale;
                      } catch {}
                    }

                    // Play the scatter "nom nom" SFX once for this sequence.
                    // Use the global game timeScale (so it respects turbo/slow-mo) but
                    // do NOT inherit the extra per-symbol animation speed-up, to avoid
                    // the SFX sounding too fast.
                    if (!scatterWinNomnomPlayed) {
                      scatterWinNomnomPlayed = true;
                      try {
                        const audio = (window as any)?.audioManager;
                        if (audio && typeof audio.playSoundEffect === 'function') {
                          const globalScale = (typeof (gameStateManager as any)?.timeScale === 'number'
                            ? (gameStateManager as any).timeScale || 1
                            : 1);
                          const clampedScale = Math.max(0.5, Math.min(1.25, globalScale));
                          audio.playSoundEffect(SoundEffectType.SCATTER_NOMNOM, clampedScale);
                          console.log('[Symbols] Played scatter nomnom SFX with global timescale:', clampedScale);
                        }
                      } catch (e) {
                        console.warn('[Symbols] Failed to play scatter nomnom SFX:', e);
                      }
                    }

                    // Safety timeout: if complete never fires, still return to idle
                    this.symbolPool.delay(symbol, 2500, () => {
                      if (finished) return;
                      finished = true;
                      try { state.setAnimation(0, idleAnimationName, true); } catch {}
                      try { if (state.removeListener && listenerRef) state.removeListener(listenerRef); } catch {}
                    });
                  }
                } catch {}
                resolve();
              }
            });
          });
        });
        // Also scale the candy overlay to its final size in the same time window
        if ((this as any) && (this.scene) && typeof this.scene.tweens?.add === 'function') {
          const overlayTween = new Promise<void>((resolve) => {
            try {
              const overlayRef = (this.scatterCandyOverlay ?? ((typeof candyOverlay !== 'undefined') ? candyOverlay : null));
              if (overlayRef) {
                this.scene.tweens.add({
                  targets: overlayRef,
                  scaleX: 0.95,
                  scaleY: 0.95,
                  duration: 400,
                  ease: 'Sine.easeOut',
                  onComplete: () => resolve()
                });
              } else {
                resolve();
              }
            } catch {
              resolve();
            }
          });
          scaleTweens.push(overlayTween);
        }
        await Promise.all(scaleTweens);
        console.log('[Symbols] Scatter symbols scaled up and win animation started');
      } catch (e2) {
        console.warn('[Symbols] Failed to scale scatters or start win animation:', e2);
      }
    } catch (e) {
      console.warn('[Symbols] Failed to gather scatter symbols to center:', e);
    }
    
    console.log('[Symbols] Scatter symbol Spine animation completed');
  }

  /**
   * During bonus mode, after all other wins/tumbles/multipliers complete (WIN_STOP),
   * play a lightweight retrigger animation on each scatter and then show dialog (+spins).
   * - Scale each visible scatter by +20%
   * - Play the scatter "win" animation once
   */
  private async playScatterRetriggerSequence(scatterGrids: Array<{ x: number; y: number }>): Promise<void> {
    if (!Array.isArray(scatterGrids) || scatterGrids.length === 0) {
      return;
    }
    console.log(`[Symbols] Playing scatter retrigger sequence for ${scatterGrids.length} symbol(s)`);
    
    const symbolValue = 0; // Scatter symbol id
    const winAnimationName = `Symbol${symbolValue}_SW_Win`;
    const idleAnimationName = `Symbol${symbolValue}_SW_Idle`;

    // Ensure we only trigger the scatter win "nom nom" SFX once for this retrigger sequence
    let retriggerNomnomPlayed: boolean = false;
    
    // Prepare overlay container (above mask) and restore tracking
    if (!this.overlayContainer) {
      try {
        this.overlayContainer = this.scene.add.container(0, 0);
        this.overlayContainer.setDepth(930);
      } catch {}
    }
    const restoreEntries: Array<{ obj: any; parent: Phaser.GameObjects.Container | null; x: number; y: number; isCurrent: () => boolean }> = [];
    
    const tweens: Promise<void>[] = scatterGrids.map(grid => {
      return new Promise<void>((resolve) => {
        try {
          const col = grid.x;
          const row = grid.y;
          let symbol: any = this.symbols?.[col]?.[row];
          if (!symbol) {
            resolve();
            return;
          }
          
          // Ensure scatter at this cell is a Spine symbol so we can play win animation
          try {
            const isScatter = (symbol as any)?.symbolValue === 0 || (symbol?.texture?.key === 'symbol_0');
            const hasSpine = !!(symbol as any)?.animationState;
            if (isScatter && !hasSpine) {
              // Replace PNG with Spine scatter
              const x = symbol.x;
              const y = symbol.y;
              try { this.symbolPool.release(symbol); } catch {}
              const spineKey = `symbol_0_sugar_spine`;
              const spineAtlasKey = spineKey + '-atlas';
              enableSymbolSpineAtlasMipmaps(this.scene);
              const spineSymbol = this.symbolPool.acquire(spineKey, spineAtlasKey, x, y);
              try { (spineSymbol as any).symbolValue = 0; } catch {}
              spineSymbol.setOrigin(0.5, 0.5);
              // Apply configured scale for scatter
              spineSymbol.setScale(this.getSpineSymbolScale(0));
              try { enableMipmapsOnSpineSkeleton(spineSymbol.skeleton, this.scene); } catch {}
              // Store back into grid
              this.symbols[col][row] = spineSymbol;
              symbol = spineSymbol;
            }
          } catch {}
          
          // Lift symbol above the masked grid: move to overlay at world coordinates
          try {
            if (this.overlayContainer) {
              const originalParent: any = (symbol as any)?.parentContainer || null;
              // Compute world coordinates to preserve on reparent
              let worldX = symbol.x, worldY = symbol.y;
              try {
                const m: any = symbol.getWorldTransformMatrix ? symbol.getWorldTransformMatrix() : null;
                if (m && typeof m.tx === 'number' && typeof m.ty === 'number') {
                  worldX = m.tx; worldY = m.ty;
                } else if (originalParent) {
                  worldX = symbol.x + (originalParent.x || 0);
                  worldY = symbol.y + (originalParent.y || 0);
                }
              } catch {}
              // Track restore info
              restoreEntries.push({ obj: symbol, parent: originalParent, x: symbol.x, y: symbol.y, isCurrent: this.symbolPool.currentUse(symbol) });
              // Detach from original parent and add to overlay (unmasked)
              try { if (originalParent) originalParent.remove(symbol); } catch {}
              this.overlayContainer.add(symbol);
              symbol.x = worldX;
              symbol.y = worldY;
              try { symbol.setDepth(931); } catch {}
            }
          } catch {}
          
          this.symbolPool.onRelease(symbol, resolve);
          const currentScaleX = (symbol as any)?.scaleX ?? 1;
          const currentScaleY = (symbol as any)?.scaleY ?? 1;
          const targetScaleX = currentScaleX * 1.5;
          const targetScaleY = currentScaleY * 1.5;
          
          this.scene.tweens.add({
            targets: symbol,
            scaleX: targetScaleX,
            scaleY: targetScaleY,
            duration: 300,
            ease: 'Sine.easeOut',
            onComplete: () => {
              try {
                // If we have a Spine animation state, play the win animation once and wait for completion
                const state: any = symbol.animationState;
                const canAnimate = state && typeof state.setAnimation === 'function';
                if (canAnimate) {
                  try { if (typeof state.clearTracks === 'function') state.clearTracks(); } catch {}
                  let finished = false;
                  let listenerRef: any = null;
                  try {
                    if (typeof state.addListener === 'function') {
                      listenerRef = {
                        complete: (entry: any) => {
                          try {
                            if (!entry || entry.animation?.name !== winAnimationName) return;
                          } catch {}
                          if (finished) return;
                          finished = true;
                          // Return to idle loop after win animation completes
                          try { state.setAnimation(0, idleAnimationName, true); } catch {}
                          try { if (state.removeListener && listenerRef) state.removeListener(listenerRef); } catch {}
                          resolve();
                        }
                      };
                      state.addListener(listenerRef);
                    }
                  } catch {}
                  // Start the win animation
                  try {
                    state.setAnimation(0, winAnimationName, false);
                  } catch {}

                  // Play the scatter "nom nom" SFX once for the retrigger sequence.
                  // Use the global game timeScale (turbo/slow-mo) but do NOT inherit
                  // any extra per-symbol animation speed-up, to keep SFX at a natural pace.
                  if (!retriggerNomnomPlayed) {
                    retriggerNomnomPlayed = true;
                    try {
                      const audio = (window as any)?.audioManager;
                      if (audio && typeof audio.playSoundEffect === 'function') {
                        const globalScale = (typeof (gameStateManager as any)?.timeScale === 'number'
                          ? (gameStateManager as any).timeScale || 1
                          : 1);
                        const clampedScale = Math.max(0.5, Math.min(1.25, globalScale));
                        audio.playSoundEffect(SoundEffectType.SCATTER_NOMNOM, clampedScale);
                        console.log('[Symbols] Played scatter nomnom SFX (retrigger) with global timescale:', clampedScale);
                      }
                    } catch (e) {
                      console.warn('[Symbols] Failed to play scatter nomnom SFX (retrigger):', e);
                    }
                  }
                  // Safety timeout in case 'complete' never fires
                  this.symbolPool.delay(symbol, 2500, () => {
                    if (finished) return;
                    finished = true;
                    // Ensure we return to idle even if complete doesn't fire
                    try { state.setAnimation(0, idleAnimationName, true); } catch {}
                    try { if (state.removeListener && listenerRef) state.removeListener(listenerRef); } catch {}
                    resolve();
                  });
                } else {
                  // No animation available; just resolve after the scale tween
                  resolve();
                }
              } catch {
                resolve();
              }
            }
          });
        } catch {
          resolve();
        }
      });
    });
    
    await Promise.all(tweens);
    console.log('[Symbols] Scatter retrigger animation completed');
    
    // Restore lifted symbols to original parents/positions
    try {
      for (const entry of restoreEntries) {
        if (!entry.isCurrent()) continue;
        const obj = entry.obj;
        try { if (this.overlayContainer) this.overlayContainer.remove(obj); } catch {}
        if (entry.parent) {
          try { entry.parent.add(obj); } catch {}
          obj.x = entry.x;
          obj.y = entry.y;
        } else {
          // Original parent was root; return to root display list
          try { this.scene.children.add(obj); } catch {}
          obj.x = entry.x;
          obj.y = entry.y;
        }
        try { obj.setDepth(0); } catch {}
      }
    } catch {}
  }
  /**
   * Helper method for delays
   */
  private delay(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      this.scene.time.delayedCall(ms, () => {
        resolve();
      });
    });
  }

  /**
   * Hide all symbols (including scatter symbols) by setting container alpha to 0
   */
  public hideAllSymbols(): void {
    if (this.container) {
      console.log('[Symbols] Hiding all symbols by setting container alpha to 0');
      this.container.setAlpha(0);
    }
  }

  /**
   * Hide scatter symbols specifically (ensure they are manageable via container), no PNG reversion
   */
  public hideScatterSymbols(scatterGrids: any[]): void {
    if (!scatterGrids || scatterGrids.length === 0) {
      return;
    }

    console.log(`[Symbols] Hiding ${scatterGrids.length} scatter symbols (no PNG reversion)`);
    
    let hiddenCount = 0;
    
    for (const grid of scatterGrids) {
      if (this.symbols && this.symbols[grid.y] && this.symbols[grid.y][grid.x]) {
        const symbol = this.symbols[grid.y][grid.x];
        
        // Ensure symbol is managed under container for consistent hiding
        if (symbol.parentContainer !== this.container) {
          this.scene.children.remove(symbol);
          this.container.add(symbol);
        }

        // Now hide the symbol in place
        const currentSymbol = this.symbols[grid.y][grid.x];
        if (currentSymbol && typeof currentSymbol.setVisible === 'function') {
          currentSymbol.setVisible(false);
          hiddenCount++;
          console.log(`[Symbols] Hidden symbol at (${grid.x}, ${grid.y}), visible: ${currentSymbol.visible}`);
        }
      }
    }
    
    console.log(`[Symbols] Hidden ${hiddenCount} scatter symbols (no PNG reversion)`);
  }

  /**
   * Get the bounds of the symbol grid
   */
  private getSymbolGridBounds(): { x: number, y: number, width: number, height: number } {
    // Add padding to make the overlay slightly larger than the symbol grid
    const paddingX = 9;
    const paddingY = 8;

    const offsetX = 1;
    const offsetY = 0.7;
    
    const x = this.slotX - this.totalGridWidth * 0.5 - paddingX + offsetX;
    const y = this.slotY - this.totalGridHeight * 0.5 - paddingY + offsetY;
    
    return {
      x: x + offsetX,
      y: y + offsetY,
      width: this.totalGridWidth + (paddingX * 2),
      height: this.totalGridHeight + (paddingY * 2)
    };
  }

  /**
   * Apply turbo mode to winline animations
   */
  public setTurboMode(isEnabled: boolean): void {
    if (this.winLineDrawer) {
      this.winLineDrawer.setTurboMode(isEnabled);
      console.log(`[Symbols] Turbo mode ${isEnabled ? 'enabled' : 'disabled'} for winline animations`);
    } else {
      console.warn('[Symbols] WinLineDrawer not available for turbo mode');
    }
  }

  /**
   * Reset winline animations to default timing
   */
  public resetWinlineTiming(): void {
    if (this.winLineDrawer) {
      this.winLineDrawer.resetToDefaultTiming();
      console.log('[Symbols] Winline timing reset to default values');
    } else {
      console.warn('[Symbols] WinLineDrawer not available for timing reset');
    }
  }

  /**
   * Ensure symbols remain visible and in their current state after autoplay is stopped
   */
  public ensureSymbolsVisibleAfterAutoplayStop(): void {
    console.log('[Symbols] Ensuring symbols remain visible after autoplay stop');
    
    // Ensure container is visible
    if (this.container) {
      this.container.setAlpha(1);
      this.container.setVisible(true);
      console.log('[Symbols] Container visibility ensured after autoplay stop');
    }
    
    // Ensure all symbols are visible
    if (this.symbols && this.symbols.length > 0) {
      let visibleCount = 0;
      for (let col = 0; col < this.symbols.length; col++) {
        for (let row = 0; row < this.symbols[col].length; row++) {
          const symbol = this.symbols[col][row];
          if (symbol && typeof symbol.setVisible === 'function') {
            symbol.setVisible(true);
            visibleCount++;
          }
        }
      }
      console.log(`[Symbols] Ensured ${visibleCount} symbols are visible after autoplay stop`);
    }
    
    // Clear any winlines that might be showing
    if (this.winLineDrawer) {
      this.winLineDrawer.clearLines();
      console.log('[Symbols] Cleared winlines after autoplay stop');
    }
    
    // Hide any winning overlay that might be showing
    this.hideWinningOverlay();
    console.log('[Symbols] Hidden winning overlay after autoplay stop');
  }

  /**
   * Trigger autoplay for free spins if available
   */
  private triggerAutoplayForFreeSpins(): void {
    // Prevent duplicate triggering - multiple checks for safety
    if (this.freeSpinAutoplayTriggered) {
      console.log('[Symbols] Free spin autoplay already triggered, skipping duplicate trigger');
      return;
    }
    
    // Additional check: if autoplay is already active, don't start another one
    if (this.freeSpinAutoplayActive) {
      console.log('[Symbols] Free spin autoplay already active, skipping duplicate trigger');
      return;
    }
    
    // Additional check: if we're not in bonus mode, don't start free spin autoplay
    if (!gameStateManager.isBonus) {
      console.log('[Symbols] Not in bonus mode, skipping free spin autoplay trigger');
      return;
    }

    let freeSpinsCount = 0;
    
    console.log('[Symbols] ===== TRIGGERING AUTOPLAY FOR FREE SPINS =====');
    console.log('[Symbols] Current state:');
    console.log('  - isBonus:', gameStateManager.isBonus);
    console.log('  - pendingFreeSpinsData:', this.pendingFreeSpinsData);
    console.log('  - currentSpinData:', this.currentSpinData);
    console.log('  - currentSpinData.slot:', this.currentSpinData?.slot);
    console.log('  - currentSpinData.slot.freespin:', this.currentSpinData?.slot?.freespin);
    console.log('  - freeSpinAutoplayActive:', this.freeSpinAutoplayActive);
    console.log('  - freeSpinAutoplayTriggered:', this.freeSpinAutoplayTriggered);
    
    // Check if we have pending free spins data (from scatter bonus activation)
    if (this.pendingFreeSpinsData) {
      // Only trust pending data if it's a positive number; otherwise, fall back to spinData
      if (this.pendingFreeSpinsData.actualFreeSpins > 0) {
        freeSpinsCount = this.pendingFreeSpinsData.actualFreeSpins;
        console.log(`[Symbols] Using pending free spins data: ${freeSpinsCount} free spins`);
        // Clear the pending data after use
        this.pendingFreeSpinsData = null;
      } else {
        console.log('[Symbols] Pending free spins data is 0; ignoring and falling back to spinData');
        // Clear to prevent blocking future detections
        this.pendingFreeSpinsData = null;
      }
    } 
    // Check if we're in bonus mode and have current spin data with free spins
    else if (gameStateManager.isBonus) {
      const fsLegacy = this.currentSpinData?.slot?.freespin?.count || 0;
      // Prefer the new format's first item's spinsLeft when available
      const fsItems = this.currentSpinData?.slot?.freeSpin?.items || this.currentSpinData?.slot?.freespin?.items || [];
      const firstItemSpinsLeft = Array.isArray(fsItems) && fsItems.length > 0 && typeof fsItems[0]?.spinsLeft === 'number'
        ? fsItems[0].spinsLeft
        : 0;
      // Fallback to items length if spinsLeft is not present
      const fsItemsLen = Array.isArray(fsItems) ? fsItems.length : 0;
      freeSpinsCount = Math.max(firstItemSpinsLeft, fsLegacy, fsItemsLen);
      if (freeSpinsCount > 0) {
        console.log(`[Symbols] Using free spins from spin data: ${freeSpinsCount} (legacy count=${fsLegacy}, firstItem.spinsLeft=${firstItemSpinsLeft}, items len=${fsItemsLen})`);
      }
    }
    
    if (freeSpinsCount > 0) {
      console.log(`[Symbols] Free spins available: ${freeSpinsCount}. Starting free spin autoplay.`);
      
      // Mark as triggered to prevent duplicates
      this.freeSpinAutoplayTriggered = true;
      
      // Start our custom free spin autoplay system
      this.startFreeSpinAutoplay(freeSpinsCount);
    } else {
      console.log('[Symbols] No free spins data available, not triggering autoplay.');
    }
    console.log('[Symbols] ===== END TRIGGERING AUTOPLAY FOR FREE SPINS =====');
  }

  /**
   * Start free spin autoplay using our custom system
   */
  public async startFreeSpinAutoplay(spinCount: number): Promise<void> {
    console.log(`[Symbols] ===== STARTING FREE SPIN AUTOPLAY =====`);
    console.log(`[Symbols] Starting free spin autoplay with ${spinCount} spins`);
    
    // Set free spin autoplay state
    this.freeSpinAutoplayActive = true;
    this.freeSpinAutoplaySpinsRemaining = spinCount;
    this.freeSpinAutoplayPerformedCount = 0;
    this.maxWinBonusEndHandled = false;
    
    // Set global autoplay state
    gameStateManager.isAutoPlaying = true;
    gameStateManager.isAutoPlaySpinRequested = true;
    this.scene.gameData.isAutoPlaying = true;
    
    // Apply turbo mode to winline animations if turbo is enabled (same as normal autoplay)
    if (gameStateManager.isTurbo) {
      console.log('[Symbols] Applying turbo mode to winline animations for free spin autoplay');
      this.setTurboMode(true);
    }

    try {
      const gameSceneAny: any = this.scene as any;
      const slotController = gameSceneAny?.slotController;
      if (slotController && spinCount > 0) {
        if (typeof slotController.clearFreeSpinDisplaySuppression === 'function') {
          slotController.clearFreeSpinDisplaySuppression();
        }
        if (typeof slotController.showFreeSpinDisplayWithActualValue === 'function') {
          slotController.showFreeSpinDisplayWithActualValue(spinCount);
        }
      }
    } catch (e) {
      console.warn('[Symbols] Failed to force SlotController free spin display at start of free spin autoplay:', e);
    }
    
    // Before starting autoplay, reset any scatter animations back to their grid positions and original scaling
    try {
      await this.resetScatterSymbolsToGrid();
    } catch (e) {
      console.warn('[Symbols] Failed to reset scatter symbols before free spin autoplay:', e);
    }
    
    // Start the first free spin immediately
    this.performFreeSpinAutoplay();
    
    console.log(`[Symbols] Free spin autoplay started with ${spinCount} spins`);
    console.log(`[Symbols] ===== FREE SPIN AUTOPLAY STARTED =====`);
  }

  public resetFreeSpinAutoplayState(): void {
    console.log('[Symbols] Resetting free spin autoplay state flags');
    this.freeSpinAutoplayActive = false;
    this.freeSpinAutoplayTriggered = false;
    this.freeSpinAutoplayWaitingForReelsStop = false;
    this.freeSpinAutoplayAwaitingReelsStart = false;
    this.freeSpinAutoplayPerformedCount = 0;
    this.maxWinBonusEndHandled = false;
  }

  /**
   * Reset scatter Spine symbols back to their original grid positions and scaling
   * so free spin autoplay starts from a clean board state.
   */
  private async resetScatterSymbolsToGrid(): Promise<void> {
    if (!this.symbols || !this.symbols.length || !this.symbols[0] || !this.symbols[0].length) {
      console.warn('[Symbols] resetScatterSymbolsToGrid: symbols grid not initialized');
      return;
    }
    
    const symbolTotalWidth = this.displayWidth + this.horizontalSpacing;
    const symbolTotalHeight = this.displayHeight + this.verticalSpacing;
    const startX = this.slotX - this.totalGridWidth * 0.5;
    const startY = this.slotY - this.totalGridHeight * 0.5;
    
    // Durations used for synchronized overlay and scatter resets
    const shrinkDuration = 350;
    const moveDuration = 500;
    
    let resetCount = 0;
    const tweenPromises: Promise<void>[] = [];
    
    let overlayTweenStarted = false;
    
    for (let col = 0; col < this.symbols.length; col++) {
      for (let row = 0; row < this.symbols[col].length; row++) {
        const symbol: any = this.symbols[col][row];
        if (!symbol) continue;
        
        // Only adjust scatter spine symbols
        const isScatter = (symbol as any)?.symbolValue === 0;
        const isSpine = !!(symbol as any)?.animationState;
        if (!isSpine || !isScatter) continue;
        
        // Start overlay shrink/fade once, in sync with the first scatter reset tween
        if (!overlayTweenStarted) {
          overlayTweenStarted = true;
          try {
            const ov = this.scatterCandyOverlay;
            if (ov) {
              // Shrink during scatter shrink phase
              this.scene.tweens.add({
                targets: ov,
                scaleX: 0.4,
                scaleY: 0.4,
                duration: shrinkDuration,
                ease: 'Sine.easeInOut',
                onComplete: () => {
                  // Then fade out while scatters return to grid
                  this.scene.tweens.add({
                    targets: ov,
                    alpha: 0,
                    duration: moveDuration,
                    ease: 'Sine.easeInOut',
                    onComplete: () => {
                      try { ov.destroy(); } catch {}
                      this.scatterCandyOverlay = null;
                    }
                  });
                }
              });
            }
          } catch {}
        }
        
        // Stop any running tweens on this symbol
        this.scene.tweens.killTweensOf(symbol);
        
        // Compute grid position
        const targetX = startX + col * symbolTotalWidth + symbolTotalWidth * 0.5;
        const targetY = startY + row * symbolTotalHeight + symbolTotalHeight * 0.5;
        
        // Reset animation speed and play idle
        try {
          if ((symbol.animationState as any).setAnimation) {
            const idleName = 'Symbol0_SW_Idle';
            const entry = symbol.animationState.setAnimation(0, idleName, true);
            if (entry && typeof (entry as any).timeScale === 'number') {
              (entry as any).timeScale = 1;
            }
          }
          if (typeof (symbol.animationState as any).timeScale === 'number') {
            (symbol.animationState as any).timeScale = 1;
          }
        } catch {}
        
        // Ensure reasonable depth
        try { if (typeof symbol.setDepth === 'function') symbol.setDepth(600); } catch {}
        
        // Compute baseline scale (fit to box + scatter padding) without applying immediately
        let targetScale = this.getSpineSymbolScale(0);
        try {
          const prevScaleX = (symbol as any)?.scaleX ?? 1;
          const prevScaleY = (symbol as any)?.scaleY ?? 1;
          if (typeof symbol.setScale === 'function') symbol.setScale(1);
          try {
            if (symbol.skeleton && typeof symbol.skeleton.setToSetupPose === 'function') {
              symbol.skeleton.setToSetupPose();
            }
            if (symbol.updateWorldTransform) {
              symbol.updateWorldTransform();
            }
          } catch {}
          let boundsW = 0, boundsH = 0;
          try {
            if (typeof symbol.getBounds === 'function') {
              const b = symbol.getBounds();
              if (b && b.size) {
                boundsW = Math.max(1, b.size.x || b.size.width || 0);
                boundsH = Math.max(1, b.size.y || b.size.height || 0);
              }
            }
          } catch {}
          if (!boundsW || !boundsH) {
            boundsW = Math.max(1, (symbol.width as number) || 0);
            boundsH = Math.max(1, (symbol.height as number) || 0);
          }
          const fitScale = Math.min(
            Math.max(1, this.displayWidth) / boundsW,
            Math.max(1, this.displayHeight) / boundsH
          ) * 0.98;
          targetScale = isFinite(fitScale) && fitScale > 0 ? fitScale * 1.2 : targetScale;
          if (typeof symbol.setScale === 'function') symbol.setScale(prevScaleX, prevScaleY);
        } catch {}
        
        // First tween: shrink back to baseline scale at current position (center), then move back
        tweenPromises.push(new Promise<void>((resolve) => {
          this.symbolPool.onRelease(symbol, resolve);
          this.scene.tweens.add({
            targets: symbol,
            scaleX: targetScale,
            scaleY: targetScale,
            duration: shrinkDuration,
            ease: 'Sine.easeInOut',
            onComplete: () => {
              this.scene.tweens.add({
                targets: symbol,
                x: targetX,
                y: targetY,
                duration: moveDuration,
                ease: 'Sine.easeInOut',
                onComplete: () => resolve()
              });
            }
          });
        }));
        
        resetCount++;
      }
    }
    
    await Promise.all(tweenPromises);
    console.log(`[Symbols] resetScatterSymbolsToGrid: reset ${resetCount} scatter symbols to grid and original scaling with tween`);
  }

  /**
   * Perform a single free spin autoplay
   */
  private async performFreeSpinAutoplay(): Promise<void> {
    if (!this.freeSpinAutoplayActive || this.freeSpinAutoplaySpinsRemaining <= 0) {
      console.log('[Symbols] Free spin autoplay stopped or no spins remaining');
      this.stopFreeSpinAutoplay();
      return;
    }

    if (this.shouldEndFreeSpinBonusAfterCurrentSpin()) {
      console.log('[Symbols] Max-win cap reached — stopping free spin autoplay before next spin');
      this.completeMaxWinBonusEnd();
      return;
    }

    console.log(`[Symbols] ===== PERFORMING FREE SPIN AUTOPLAY =====`);
    console.log(`[Symbols] Free spin autoplay: ${this.freeSpinAutoplaySpinsRemaining} spins remaining`);
    
    // Check if we're still in bonus mode
    if (!gameStateManager.isBonus) {
      console.log('[Symbols] No longer in bonus mode - stopping free spin autoplay');
      this.stopFreeSpinAutoplay();
      return;
    }

    // Check if win dialog is showing - pause autoplay if so
    if (gameStateManager.isShowingWinDialog) {
      console.log('[Symbols] Win dialog is showing - pausing free spin autoplay');
      // Wait for dialog animations to complete instead of using a fixed delay
      console.log('[Symbols] Waiting for dialogAnimationsComplete event before continuing free spin autoplay');
      this.scene.events.once('dialogAnimationsComplete', () => {
        console.log('[Symbols] Dialog animations complete - continuing free spin autoplay');
        // Use the same timing as normal autoplay (1000ms base with turbo multiplier)
        const baseDelay = 0;
        const turboDelay = gameStateManager.isTurbo ? 
          baseDelay * TurboConfig.TURBO_DELAY_MULTIPLIER : baseDelay;
        console.log(`[Symbols] Scheduling free spin retry in ${turboDelay}ms (base: ${baseDelay}ms, turbo: ${gameStateManager.isTurbo})`);
        this.scene.time.delayedCall(turboDelay, () => {
          this.performFreeSpinAutoplay();
        });
      });
      return;
    }

    try {
      // Use our free spin simulation instead of the old backend
      console.log('[Symbols] Triggering free spin via SlotController...');
      
      // Emit a custom event that SlotController will handle
      gameEventManager.emit(GameEventType.FREE_SPIN_AUTOPLAY);
      
      // Mark that we are awaiting reels start to safely decrement once spin actually begins
      this.freeSpinAutoplayAwaitingReelsStart = true;
      console.log('[Symbols] Awaiting REELS_START to decrement free spin counter safely');
      
      // Set flag to wait for reels to stop before continuing
      this.freeSpinAutoplayWaitingForReelsStop = true;
      console.log('[Symbols] Waiting for reels to stop before continuing free spin autoplay');
      
    } catch (error) {
      console.error('[Symbols] Free spin autoplay error:', error);
      this.stopFreeSpinAutoplay();
    }
    
    console.log(`[Symbols] ===== FREE SPIN AUTOPLAY COMPLETED =====`);
  }

  /**
   * Continue free spin autoplay after reels stop
   */
  private continueFreeSpinAutoplay(): void {
    console.log(`[Symbols] ===== CONTINUING FREE SPIN AUTOPLAY =====`);
    console.log(`[Symbols] Free spin autoplay: ${this.freeSpinAutoplaySpinsRemaining} spins remaining`);

    if (this.shouldEndFreeSpinBonusAfterCurrentSpin()) {
      console.log('[Symbols] Max-win cap reached on REELS_STOP — ending free spin bonus');
      this.completeMaxWinBonusEnd();
      return;
    }
    
    // Check if we still have spins remaining
    if (this.freeSpinAutoplaySpinsRemaining > 0) {
      // Wait for WIN_STOP event to ensure winlines complete before next spin
      // This is the same approach as normal autoplay - no safety timer needed
      console.log('[Symbols] Waiting for WIN_STOP event before continuing free spin autoplay');
      console.log('[Symbols] Setting freeSpinAutoplayWaitingForWinlines to true');
      this.freeSpinAutoplayWaitingForWinlines = true;
      console.log('[Symbols] freeSpinAutoplayWaitingForWinlines is now:', this.freeSpinAutoplayWaitingForWinlines);
    } else {
      console.log('[Symbols] All free spins completed');
      this.stopFreeSpinAutoplay();
    }
    
    console.log(`[Symbols] ===== FREE SPIN AUTOPLAY CONTINUED =====`);
  }

  /**
   * Handle WIN_STOP for free spin autoplay (similar to normal autoplay)
   */
  private handleFreeSpinAutoplayWinStop(): void {
    console.log('[Symbols] handleFreeSpinAutoplayWinStop called - freeSpinAutoplayWaitingForWinlines:', this.freeSpinAutoplayWaitingForWinlines);
    if (!this.freeSpinAutoplayWaitingForWinlines) {
      console.log('[Symbols] Not waiting for winlines - skipping free spin autoplay continuation');
      return;
    }

    if (this.shouldEndFreeSpinBonusAfterCurrentSpin()) {
      console.log('[Symbols] Max-win cap reached on WIN_STOP — ending free spin bonus');
      this.freeSpinAutoplayWaitingForWinlines = false;
      this.completeMaxWinBonusEnd();
      return;
    }

    console.log('[Symbols] WIN_STOP received - continuing free spin autoplay after winlines complete');
    this.freeSpinAutoplayWaitingForWinlines = false;

    // Clear any existing timer since WIN_STOP fired properly
    if (this.freeSpinAutoplayTimer) {
      this.freeSpinAutoplayTimer.destroy();
      this.freeSpinAutoplayTimer = null;
    }
    
    // Use the same timing as normal autoplay (500ms base with turbo multiplier)
    const baseDelay = 500;
    const turboDelay = gameStateManager.isTurbo ? 
      baseDelay * TurboConfig.TURBO_DELAY_MULTIPLIER : baseDelay;
    console.log(`[Symbols] Scheduling next free spin in ${turboDelay}ms (base: ${baseDelay}ms, turbo: ${gameStateManager.isTurbo})`);
    
    this.freeSpinAutoplayTimer = this.scene.time.delayedCall(turboDelay, () => {
      this.performFreeSpinAutoplay();
    });
  }

  /**
   * Wait until no dialogs are showing anymore, then resume free spin autoplay.
   * This will tolerate multiple back-to-back dialogs (e.g., queued win dialogs).
   */
  private waitForAllDialogsToCloseThenResume(): void {
    const gameScene: any = this.scene as any;
    const dialogs = gameScene?.dialogs;

    // Defer the initial check to the next tick so Game.ts can process the event
    this.scene.time.delayedCall(0, () => {
      const anyDialogShowing = !!(dialogs && typeof dialogs.isDialogShowing === 'function' && dialogs.isDialogShowing());
      const winDialogShowing = !!gameStateManager.isShowingWinDialog;

      if (anyDialogShowing || winDialogShowing) {
        console.log('[Symbols] Waiting for all dialogs to close before resuming free spin autoplay...');
        this.scene.events.once('dialogAnimationsComplete', () => {
          // After a dialog closes, check again in case there are more queued
          this.waitForAllDialogsToCloseThenResume();
        });
        return;
      }

      // No dialog showing right now. Listen for a newly shown dialog within a grace window.
      let settled = false;
      const onDialogShown = () => {
        if (settled) return;
        settled = true;
        console.log('[Symbols] A dialog was shown during grace window - waiting for it to close');
        this.scene.events.once('dialogAnimationsComplete', () => {
          this.waitForAllDialogsToCloseThenResume();
        });
      };

      this.scene.events.once('dialogShown', onDialogShown);

      // Grace window for a subsequently queued dialog to appear
      this.scene.time.delayedCall(0, () => {
        if (settled) return;
        const showingNow = !!(dialogs && typeof dialogs.isDialogShowing === 'function' && dialogs.isDialogShowing());
        const winNow = !!gameStateManager.isShowingWinDialog;
        if (showingNow || winNow) {
          settled = true;
          console.log('[Symbols] Dialog detected at end of grace window - continuing to wait');
          this.waitForAllDialogsToCloseThenResume();
          return;
        }
        // All dialogs closed and none appeared in the grace window; resume autoplay
        settled = true;
        this.scene.time.delayedCall(120, () => this.performFreeSpinAutoplay());
      });
    });
  }

  /**
   * Schedule congrats dialog after free spin autoplay ends
   * Waits for any win dialogs to auto-close (2.5s) plus additional buffer time
   */
  private scheduleCongratsDialogAfterAutoplay(): void {
    console.log('[Symbols] Scheduling congrats dialog after free spin autoplay ends');

    const gameScene = this.scene as any;
    const dialogs = gameScene.dialogs;

    // Helper to detect if a win dialog is currently active
    const isWinDialogActive = (): boolean => {
      try {
        const hasDialog =
          dialogs &&
          typeof dialogs.isDialogShowing === 'function' &&
          dialogs.isDialogShowing();
        const isWin =
          hasDialog &&
          typeof dialogs.isWinDialog === 'function' &&
          dialogs.isWinDialog();
        const flagWin = !!gameStateManager.isShowingWinDialog;
        return (!!isWin) || flagWin;
      } catch {
        return !!gameStateManager.isShowingWinDialog;
      }
    };

    // If a win dialog is already active at the moment bonus autoplay ends,
    // don't schedule congrats here – the global WIN_DIALOG_CLOSED handler
    // will show congrats once the win dialog auto-closes / is clicked.
    if (isWinDialogActive()) {
      console.log('[Symbols] Win dialog already active at bonus end - deferring congrats to WIN_DIALOG_CLOSED handler');
      return;
    }

    // Otherwise, wait a short grace window to see if a win dialog appears.
    // If a win dialog shows within this window, we again defer to WIN_DIALOG_CLOSED.
    // If no win dialog appears, we show congrats directly after the grace period.
    let settled = false;

    const onDialogShown = (dialogType?: string) => {
      if (settled) return;

      const type = (dialogType || '').toString();
      const looksLikeWinDialog =
        type === 'SmallW_KA' ||
        type === 'MediumW_KA' ||
        type === 'LargeW_KA' ||
        type === 'SuperW_KA';

      if (!looksLikeWinDialog) {
        return;
      }

      console.log('[Symbols] Win dialog shown during congrats grace window - deferring to WIN_DIALOG_CLOSED handler');
      settled = true;
      this.scene.events.off('dialogShown', onDialogShown);
      // No further action: WIN_DIALOG_CLOSED listener will call showCongratsDialogAfterDelay().
    };

    this.scene.events.on('dialogShown', onDialogShown);

    // Grace window duration (ms) for a potential win dialog to appear
    const graceMs = 1200;

    this.scene.time.delayedCall(graceMs, () => {
      if (settled) {
        return;
      }

      this.scene.events.off('dialogShown', onDialogShown);

      if (isWinDialogActive()) {
        console.log('[Symbols] Win dialog became active during grace window - congrats will be shown on WIN_DIALOG_CLOSED');
        return;
      }

      // If scatter retrigger is pending (+5 spins), do not show congrats – bonus autoplay will resume
      if (this.hasPendingScatterRetrigger()) {
        console.log('[Symbols] Pending scatter retrigger at grace window end - skipping congrats, bonus will continue');
        return;
      }

      if (gameStateManager.isBonusFinished) {
        console.log('[Symbols] Grace window expired with no win dialog - showing congrats now');
        this.showCongratsDialogAfterDelay();
      } else {
        console.log('[Symbols] Skipping scheduled congrats - bonusFinished already cleared');
      }
    });
  }

  /**
   * Show congrats dialog after the delay period
   */
  private showCongratsDialogAfterDelay(): void {
    console.log('[Symbols] Showing congrats dialog after delay');
    
    // If there is a pending scatter retrigger (+5 spins), do not show congrats – bonus will continue
    if (this.hasPendingScatterRetrigger()) {
      console.log('[Symbols] Pending scatter retrigger - skipping congrats, bonus will continue');
      return;
    }
    
    // If multiplier animations are in progress, wait for them to complete before showing congrats
    if (this.multiplierAnimationsInProgress) {
      console.log('[Symbols] Multiplier animations in progress - waiting for MULTIPLIER_ANIMATIONS_COMPLETE before showing congrats');
      // Set up one-time listener for multiplier animations completion
      gameEventManager.once(GameEventType.MULTIPLIER_ANIMATIONS_COMPLETE, () => {
        console.log('[Symbols] MULTIPLIER_ANIMATIONS_COMPLETE received - now showing congrats');
        this.showCongratsDialogAfterDelay();
      });
      return;
    }
    
    const gameScene = this.scene as any;
    // Defer so that when MULTIPLIER_ANIMATIONS_COMPLETE fires, processWinQueue has a chance to
    // show the deferred win dialog first. If a win dialog appears, we skip congrats here and
    // let WIN_DIALOG_CLOSED show congrats when the user closes the win dialog.
    const deferMs = 150;
    this.scene.time.delayedCall(deferMs, () => {
      const dialogs = gameScene.dialogs;
      const winDialogShowing =
        dialogs &&
        typeof dialogs.isDialogShowing === 'function' &&
        dialogs.isDialogShowing() &&
        typeof dialogs.isWinDialog === 'function' &&
        dialogs.isWinDialog();
      if (winDialogShowing) {
        console.log('[Symbols] Win dialog is showing after defer - skipping congrats here, WIN_DIALOG_CLOSED will show congrats');
        return;
      }
      if (this.hasPendingScatterRetrigger()) {
        console.log('[Symbols] Pending scatter retrigger after defer - skipping congrats, bonus will continue');
        return;
      }
      this.showCongratsDialogAfterDelayImmediate(gameScene);
    });
  }

  /**
   * Actually show congrats (called after optional defer so deferred win dialog can appear first).
   */
  private showCongratsDialogAfterDelayImmediate(gameScene: any): void {
    if (this.hasPendingScatterRetrigger()) {
      console.log('[Symbols] Pending scatter retrigger in immediate - skipping congrats, bonus will continue');
      return;
    }
    // Close any open win dialogs first (safety check)
    if (gameScene.dialogs && typeof gameScene.dialogs.hideDialog === 'function') {
      if (gameScene.dialogs.isDialogShowing()) {
        console.log('[Symbols] Closing any remaining win dialogs before showing congrats');
        gameScene.dialogs.hideDialog();
      }
    }
    
    // Authoritative session total from bet response; Dialogs re-resolves on show.
    const gameSceneAny = gameScene as any;
    const gameAPI = gameSceneAny?.slotController?.gameAPI ?? gameSceneAny?.gameAPI;
    let totalWin = SpinDataUtils.resolveAuthoritativeSlotTotalWinForDisplay({
      gameAPI,
      symbolsSpinData: this.currentSpinData,
    });
    if (totalWin <= 0) {
      totalWin = this.cachedTotalWin;
    }
    this.cachedTotalWin = 0;
    this.cachedScatterTriggerPayout = 0;

    if (totalWin > 0) {
      console.log(`[Symbols] Congrats total win from slot.totalWin: ${totalWin}`);
    }

    try {
      const slotController = gameScene?.slotController;
      if (slotController && totalWin > 0) {
        slotController.capturedBonusTotalWin = totalWin;
      }
    } catch {}
    
    // Derive how many free spins were used for this bonus (total spins played, including retriggers)
    let freeSpinCount = 0;
    try {
      if (this.currentSpinData && this.currentSpinData.slot) {
        const freespinData = this.currentSpinData.slot.freespin || this.currentSpinData.slot.freeSpin;
        if (freespinData) {
          // Prefer explicit count if present and > 0 (often original total from API)
          if (typeof freespinData.count === 'number' && freespinData.count > 0) {
            freeSpinCount = freespinData.count;
            console.log(`[Symbols] Using freespin.count for congrats free spin total: ${freeSpinCount}`);
          } else if (Array.isArray(freespinData.items)) {
            // Fallback: use number of free spin items as "spins taken"
            freeSpinCount = freespinData.items.length;
            console.log(`[Symbols] Using freespin.items.length for congrats free spin total: ${freeSpinCount}`);
          }
        }
      }
    } catch (e) {
      console.warn('[Symbols] Failed to derive freespin count for congrats display', e);
    }

    // Switch bonus header winnings display to "TOTAL WIN" before congrats dialog appears
    try {
      const bonusHeader = gameScene.bonusHeader;
      if (bonusHeader && typeof (bonusHeader as any).showTotalWinBeforeCongrats === 'function' && totalWin > 0) {
        (bonusHeader as any).showTotalWinBeforeCongrats(totalWin);
      }
    } catch (e) {
      console.warn('[Symbols] Failed to show TOTAL WIN in bonus header before congrats', e);
    }

    // Brief delay so "TOTAL WIN" is visible before the congrats overlay appears
    const totalWinDwellMs = 500;
    this.scene.time.delayedCall(totalWinDwellMs, () => {
      if (gameScene.dialogs && typeof gameScene.dialogs.showCongrats === 'function') {
        const dialogConfig: any = { winAmount: totalWin };
        if (freeSpinCount > 0) {
          dialogConfig.freeSpins = freeSpinCount;
        }
        gameScene.dialogs.showCongrats(this.scene, dialogConfig);
        console.log(`[Symbols] Congrats dialog shown with total win: ${totalWin}, freeSpins: ${freeSpinCount}`);
      } else {
        console.warn('[Symbols] Dialogs component not available for congrats dialog');
      }
    });
  }

  /**
   * Stop free spin autoplay
   */
  private stopFreeSpinAutoplay(): void {
    console.log('[Symbols] ===== STOPPING FREE SPIN AUTOPLAY =====');
    
    // Clear timer
    if (this.freeSpinAutoplayTimer) {
      this.freeSpinAutoplayTimer.destroy();
      this.freeSpinAutoplayTimer = null;
    }
    
    // Reset state
    this.freeSpinAutoplayActive = false;
    this.freeSpinAutoplaySpinsRemaining = 0;
    this.freeSpinAutoplayWaitingForReelsStop = false;
    this.freeSpinAutoplayWaitingForWinlines = false;
    this.freeSpinAutoplayTriggered = false;
    this.freeSpinAutoplayAwaitingReelsStart = false;
    this.dialogListenerSetup = false; // Reset dialog listener setup flag
    
    // Reset global autoplay state
    gameStateManager.isAutoPlaying = false;
    gameStateManager.isAutoPlaySpinRequested = false;
    
    // Show congrats dialog after free spin autoplay ends
    this.scheduleCongratsDialogAfterAutoplay();
    this.scene.gameData.isAutoPlaying = false;
    
    // Restore winline animation timing to normal mode (same as normal autoplay)
    console.log('[Symbols] Restoring winline animation timing to normal mode');
    this.setTurboMode(false);
    
    // Emit AUTO_STOP event to notify other systems
    gameEventManager.emit(GameEventType.AUTO_STOP);
    
    console.log('[Symbols] Free spin autoplay stopped');
    console.log('[Symbols] ===== FREE SPIN AUTOPLAY STOPPED =====');
  }

  /**
   * Check if free spin autoplay is currently active
   */
  public isFreeSpinAutoplayActive(): boolean {
    return this.freeSpinAutoplayActive;
  }

  /**
   * Process spin data directly (for free spin autoplay)
   */
  public async processSpinData(spinData: any): Promise<void> {
    console.log('[Symbols] Processing spin data directly:', spinData);
    
    if (!spinData || !spinData.slot || !spinData.slot.area) {
      console.error('[Symbols] Invalid SpinData received - missing slot.area');
      return;
    }
    
    // Store the current spin data for access by other components
    this.currentSpinData = spinData;
    console.log('[Symbols] Stored current spin data for access by other components');
    
    // Use the slot.area from SpinData
    const symbols = spinData.slot.area;
    console.log('[Symbols] Using symbols from SpinData slot.area:', symbols);
    
    // Process the symbols using the same logic as before
    await processSpinDataSymbols(this, symbols, spinData);
  }
}

// preload()
function initVariables(self: Symbols) {
  let centerX = self.scene.scale.width * 0.5 - 5;
  let centerY = self.scene.scale.height * 0.445;

  self.symbols = [];
  self.newSymbols = [];
  self.displayWidth = 62;
  self.displayHeight = 62;
  self.horizontalSpacing = 9;
  self.verticalSpacing = 4;

  let spacingX = self.horizontalSpacing * (SLOT_ROWS - 1);
  let spacingY = self.verticalSpacing * (SLOT_COLUMNS - 1);
  self.totalGridWidth = (self.displayWidth * SLOT_ROWS) + spacingX;
  self.totalGridHeight = (self.displayHeight * SLOT_COLUMNS) + spacingY;

  self.slotX = centerX;
  self.slotY = centerY;
}

function createContainer(self: Symbols) {
  self.container = self.scene.add.container(0, 0);

  const maskShape = self.scene.add.graphics();
  
  // Add padding to prevent sprite cutoff, especially on the right side
  const maskPaddingLeft = 14;
  const maskPaddingRight = 14;
  const maskPaddingTop = 20;
  const maskPaddingBottom = 50;
  
  maskShape.fillRect(
    self.slotX - self.totalGridWidth * 0.5 - maskPaddingLeft, 
    self.slotY - self.totalGridHeight * 0.5 - maskPaddingTop, 
    self.totalGridWidth + maskPaddingLeft + maskPaddingRight, 
    self.totalGridHeight + maskPaddingTop + maskPaddingBottom
  );

  const mask = maskShape.createGeometryMask();
  self.container.setMask(mask);
  maskShape.setVisible(false);
  
  console.log(`[Symbols] Mask created with padding - Left: ${maskPaddingLeft}, Right: ${maskPaddingRight}, Top: ${maskPaddingTop}, Bottom: ${maskPaddingBottom}`);
}

function onStart(self: Symbols) {
  console.log('[Symbols] onStart called');
  
  // Listen for START event to create initial symbols
  gameEventManager.on(GameEventType.START, () => {
    console.log('[Symbols] START event received, creating initial symbols...');
    
    // Create initial symbols with default data
    createInitialSymbols(self);
  });
}

function killSymbolGridTweens(self: Symbols, grid: any[][] | null | undefined): void {
  if (!Array.isArray(grid)) return;
  for (const col of grid) {
    if (!Array.isArray(col)) continue;
    for (const symbol of col) {
      if (!symbol || symbol.destroyed) continue;
      try {
        self.scene.tweens.killTweensOf(symbol);
        const overlay = (symbol as any).__overlayImage;
        if (overlay) self.scene.tweens.killTweensOf(overlay);
      } catch {}
    }
  }
}

function cloneSymbolData(grid: number[][] | null): number[][] | null {
  if (!Array.isArray(grid)) {
    return null;
  }
  return grid.map((row) => (Array.isArray(row) ? [...row] : []));
}

function captureRestingGridSnapshot(self: Symbols): number[][] | null {
  if (self.currentSymbolData && self.currentSymbolData.length > 0) {
    return cloneSymbolData(self.currentSymbolData);
  }

  const numCols = self.symbols?.length || 0;
  const numRows = numCols > 0 ? (self.symbols[0]?.length || 0) : 0;
  if (numCols <= 0 || numRows <= 0) {
    return null;
  }

  const rowMajor: number[][] = [];
  for (let row = 0; row < numRows; row++) {
    rowMajor[row] = [];
    for (let col = 0; col < numCols; col++) {
      const symbolObj: any = self.symbols[col]?.[row];
      rowMajor[row][col] = typeof symbolObj?.symbolValue === 'number' ? symbolObj.symbolValue : 0;
    }
  }
  return rowMajor;
}

function scheduleRestingGridRestoreRetry(self: Symbols): void {
  const retry = () => {
    try {
      restoreRestingGridFromSymbolData(self);
    } catch {}
    try {
      self.restoreSymbolVisibility();
    } catch {}
    self.suppressStalePreSpinRowCleanup = false;
  };
  try {
    self.scene?.time?.delayedCall?.(150, retry);
  } catch {
    setTimeout(retry, 150);
  }
}

function restoreRestingGridFromSymbolData(self: Symbols): void {
  const data = cloneSymbolData(self.restingGridSnapshot) ?? cloneSymbolData(self.currentSymbolData);
  if (!data || !Array.isArray(data) || data.length === 0) {
    return;
  }

  if (self.symbols?.length) {
    disposeSymbols(self, self.symbols);
    self.symbols = [];
  }

  const symbolTotalWidth = self.displayWidth + self.horizontalSpacing;
  const symbolTotalHeight = self.displayHeight + self.verticalSpacing;
  const startX = self.slotX - self.totalGridWidth * 0.5;
  const startY = self.slotY - self.totalGridHeight * 0.5;

  const rowCount = data.length;
  const colCount = data[0]?.length ?? 0;
  if (colCount <= 0) {
    return;
  }

  for (let col = 0; col < colCount; col++) {
    const rows: any[] = [];
    for (let row = 0; row < rowCount; row++) {
      const rawValue = data[row]?.[col];
      if (rawValue == null || !Number.isFinite(Number(rawValue))) {
        rows.push(null);
        continue;
      }
      const x = startX + col * symbolTotalWidth + symbolTotalWidth * 0.5;
      const y = startY + row * symbolTotalHeight + symbolTotalHeight * 0.5;
      rows.push(createSugarOrPngSymbol(self, Number(rawValue), x, y, 1));
    }
    self.symbols.push(rows);
  }

  self.currentSymbolData = data;
  try { self.restoreSymbolVisibility(); } catch {}
}

function createInitialSymbols(self: Symbols) {
  let scene = self.scene;

  // Check if Spine symbol assets are available (no longer checking PNG textures)
  const testSpineKey = 'symbol_0_sugar_spine';
  const testAtlasKey = `${testSpineKey}-atlas`;
  if (!scene.textures.exists(testAtlasKey)) {
    console.warn('[Symbols] Spine symbol assets may not be loaded yet. Continuing anyway...');
  } else {
    console.log('[Symbols] Spine symbol assets are available');
  }

  // Use fixed symbols for testing (row-major: [row][col])
  const initialRowMajor = [
    [0, 1, 3, 1, 0, 2],
    [1, 5, 2, 5, 2, 4],
    [2, 5, 5, 1, 5, 3],
    [3, 4, 1, 2, 4, 1],
    [4, 2, 0, 3, 1, 5],
  ];
  console.log('[Symbols] Using fixed initial symbols (row-major):', initialRowMajor);
  
  // Store current symbol data for reset purposes (keep row-major for tumble logic)
  self.currentSymbolData = initialRowMajor;
  
  const symbolTotalWidth = self.displayWidth + self.horizontalSpacing;
  const symbolTotalHeight = self.displayHeight + self.verticalSpacing;

  const startX = self.slotX - self.totalGridWidth * 0.5;
  const startY = self.slotY - self.totalGridHeight * 0.5;
  
  const rowCount = initialRowMajor.length;      // 5 rows
  const colCount = initialRowMajor[0].length;   // 6 columns
  
  // Build symbols as column-major [col][row] for rendering
  for (let col = 0; col < colCount; col++) {
    let rows: any[] = [];
    for (let row = 0; row < rowCount; row++) {
      const x = startX + col * symbolTotalWidth + symbolTotalWidth * 0.5;
      const y = startY + row * symbolTotalHeight + symbolTotalHeight * 0.5;

      const value = initialRowMajor[row][col];
      const created = createSugarOrPngSymbol(self, value, x, y, 1);
      rows.push(created);
    }
    self.symbols.push(rows);
  }
  console.log('[Symbols] Initial symbols created successfully');
}

/**
 * Process symbols from SpinData (GameAPI response)
 */
async function processSpinDataSymbols(self: Symbols, symbols: number[][], spinData: any) {
  console.log('[Symbols] Processing SpinData symbols:', symbols);
  
  // Reset per-item win tracker
  try { (self as any).hadWinsInCurrentItem = false; } catch {}

  // Clear all scatter symbols from previous spin
  if (self.scatterAnimationManager) {
    self.scatterAnimationManager.clearScatterSymbols();
  }
  
  // Reset symbols and clear previous state before starting new spin
    console.log('[Symbols] Resetting symbols and clearing previous state for new spin');
    self.ensureCleanSymbolState();
    self.resetSymbolsState();
    
    // Always clear win lines and overlay when a new spin starts
    console.log('[Symbols] Clearing win lines and overlay for new spin');
    self.clearWinLines();
    self.hideWinningOverlay();
    
    self.resetSymbolDepths();
    self.restoreSymbolVisibility();

    if (self.skipRequestedForCurrentSpin && !self.skipReelDropsPending && !self.skipReelDropsActive) {
      self.skipReelDropsPending = true;
      self.skipDropModeForCurrentSpin = true;
      self.skipDropSoundTriggeredForCurrentReelDrop = true;
    }

    const skipRequestedAtResponse = self.isSkipReelDropsActive() || self.skipReelDropsPending;
    if (skipRequestedAtResponse) {
      self.applySkipVisualClearState();
    }

    // Only drain pre-spin on skip — normal spins overlap: dropReels awaits each row's
    // pre-spin promise before that row's new symbols drop (bottom rows first).
    if (self.preSpinDropAbortedBySkip || skipRequestedAtResponse) {
      await self.awaitPreSpinDropsSettled();
    }
  
  // Create a mock Data object to use with existing functions (wins/winlines no longer used)
  const mockData = new Data();
  mockData.symbols = symbols;
  mockData.balance = 0; // Not used in symbol processing
  mockData.bet = parseFloat(spinData.bet);
  mockData.freeSpins = (
    (spinData?.slot?.freeSpin?.items && Array.isArray(spinData.slot.freeSpin.items))
      ? spinData.slot.freeSpin.items.length
      : (spinData?.slot?.freespin?.count || 0)
  );
  
  // Set proper timing for animations
  const baseDelay = DELAY_BETWEEN_SPINS; // 2500ms default
  const adjustedDelay = gameStateManager.isTurbo ? 
    baseDelay * TurboConfig.TURBO_SPEED_MULTIPLIER : baseDelay;
  
  console.log('[Symbols] Setting animation timing:', {
    baseDelay,
    isTurbo: gameStateManager.isTurbo,
    adjustedDelay
  });
  
  // Set the timing in the mock data
  mockData.delayBetweenSpins = adjustedDelay;
  
  // Apply timing to GameData for animations
  setSpeed(self.scene.gameData, adjustedDelay);
  
  // Set spinning state
  gameStateManager.isReelSpinning = true;
  
  // Use the existing createNewSymbols function
  createNewSymbols(self, mockData);

  // Ensure loading spinner is gone before new symbols drop (belt-and-suspenders for slow API paths).
  try {
    (self.scene as any)?.slotController?.hideLoadingSpinner?.();
  } catch {}

  // Use the existing dropReels function
  await dropReels(self, mockData);
  
  // Update symbols after animation
    disposeSymbols(self, self.symbols);
    self.symbols = self.newSymbols;
    self.newSymbols = [];
  
  // Re-evaluate wins after initial drop completes using tumble data only.
  // Legacy winline/payline-based checking has been removed for this game.
  try {
    const tumblesFromSpin = spinData?.slot?.tumbles;
    let winsFromSpin = false;
    if (Array.isArray(tumblesFromSpin) && tumblesFromSpin.length > 0) {
      winsFromSpin = tumblesFromSpin.some((t: any) => {
        const outArr = Array.isArray(t?.symbols?.out) ? t.symbols.out as Array<{ count?: number; win?: number }> : [];
        const hasOutWin = outArr.some(o => (Number(o?.win) || 0) > 0);
        const hasWin = Number(t?.win) > 0;
        return hasOutWin || hasWin;
      });
    }
    if (winsFromSpin) {
      (self as any).hadWinsInCurrentItem = true;
    }
  } catch {}

  // Apply tumble steps if provided by backend
  try {
    const tumbles = spinData?.slot?.tumbles;
    if (Array.isArray(tumbles) && tumbles.length > 0) {
      console.log(`[Symbols] Applying ${tumbles.length} tumble step(s) from SpinData`);
      let freeSpinItem: any = null;
      try {
        const gameAPI = (self.scene as any)?.slotController?.gameAPI;
        if (gameAPI?.isFakeDataEnabled?.()) {
          freeSpinItem = gameAPI.getLastPlayedFreeSpinItem?.() ?? null;
        }
        if (!freeSpinItem) {
          const slotAny = spinData?.slot;
          const fs = slotAny?.freespin || slotAny?.freeSpin;
          const items = Array.isArray(fs?.items) ? fs.items : [];
          const area = slotAny?.area;
          if (items.length > 0 && Array.isArray(area)) {
            const areaJson = JSON.stringify(area);
            freeSpinItem = items.find(
              (item: any) => Array.isArray(item?.area) && JSON.stringify(item.area) === areaJson,
            ) ?? null;
          }
        }
      } catch {}
      const slotHasMaxWin = spinData?.slot?.hasMaxWin === true;
      const maxWinCapTotal = slotHasMaxWin ? resolveMaxWinCapTotal(self, spinData) : 0;
      await applyTumbles(self, tumbles, {
        isMaxWinItem: slotHasMaxWin,
        maxWinCapTotal,
      });
      console.log('[Symbols] Tumbles applied');
    }
  } catch (e) {
    console.warn('[Symbols] Failed applying tumbles:', e);
  }

  // Replace with spine animations if needed (disabled while using symbol-count logic)
  if (!(Symbols as any).WINLINE_CHECKING_DISABLED) {
    replaceWithSpineAnimations(self, mockData);
  }
  
  
  
  // Check for scatter symbols and trigger scatter bonus if found
  console.log('[Symbols] Checking for scatter symbols...');
  
  // Build scatter data from live grid if tumbles were applied, otherwise use mockData
  // This ensures we detect scatter that appears during tumbles
  const tumbles = spinData?.slot?.tumbles;
  const hadTumbles = Array.isArray(tumbles) && tumbles.length > 0;
  
  let symbolsForScatter: number[][];
  if (hadTumbles) {
    // Extract symbol values from live grid after tumbles
    console.log('[Symbols] Extracting symbols from live grid after tumbles for scatter detection');
    symbolsForScatter = [];
    if (self.symbols && self.symbols.length > 0) {
      const numRows = self.symbols[0]?.length || 0;
      for (let row = 0; row < numRows; row++) {
        symbolsForScatter[row] = [];
        for (let col = 0; col < self.symbols.length; col++) {
          const obj: any = self.symbols[col]?.[row];
          if (obj) {
            // Extract symbol value from the object
            const symbolValue = (obj as any)?.symbolValue ?? 
                               (obj?.texture?.key?.startsWith('symbol_') ? 
                                parseInt(obj.texture.key.replace('symbol_', '')) : -1);
            symbolsForScatter[row][col] = symbolValue;
          } else {
            symbolsForScatter[row][col] = -1; // Empty cell
          }
        }
      }
    }
    console.log('[Symbols] Extracted symbols from live grid:', symbolsForScatter);
  } else {
    // Use mockData symbols (transpose from [col][row] to [row][col] format)
    console.log('[Symbols] Using MockData symbols for scatter detection:', mockData.symbols);
    symbolsForScatter = [];
    for (let row = 0; row < mockData.symbols[0].length; row++) {
      symbolsForScatter[row] = [];
      for (let col = 0; col < mockData.symbols.length; col++) {
        // Invert vertical order when transposing: SpinData area uses bottom->top
        const colLen = mockData.symbols[col].length;
        symbolsForScatter[row][col] = mockData.symbols[col][colLen - 1 - row];
      }
    }
    console.log('[Symbols] Transposed symbols for scatter detection:', symbolsForScatter);
  }
  
  // Create a temporary Data object for scatter detection
  const scatterData = new Data();
  scatterData.symbols = symbolsForScatter;
  
  const scatterGrids = self.symbolDetector.getScatterGrids(scatterData);
  console.log('[Symbols] ScatterGrids found:', scatterGrids);
  console.log('[Symbols] ScatterGrids length:', scatterGrids.length);
  
  // Predict whether Game.ts will show a win dialog so scatter animation can wait
  // for it. Keep this threshold in sync with Game.checkAndShowWinDialog().
  try {
    const tumbles: any[] = Array.isArray((spinData.slot as any)?.tumbles) ? (spinData.slot as any).tumbles : [];
    const totalWinFromTumbles = tumbles.reduce((sum: number, t: any) => sum + (Number(t?.win) || 0), 0);
    const betAmount = parseFloat(String(spinData.bet));
    const multiplier = betAmount > 0 ? (totalWinFromTumbles / betAmount) : 0;

    if (multiplier >= 20) {
      console.log(`[Symbols] Tumble win meets dialog threshold (${multiplier.toFixed(2)}x) - pausing autoplay immediately`);
      gameStateManager.isShowingWinDialog = true;
    } else {
      console.log(`[Symbols] Tumble win below dialog threshold (${multiplier.toFixed(2)}x) - autoplay continues`);
    }
  } catch (e) {
    console.warn('[Symbols] Failed to evaluate tumble-based win dialog threshold:', e);
  }

  // Ignore paylines entirely — use tumble (cluster) wins to drive WinTracker
  if (self.winLineDrawer) {
    // Defer WinTracker display to align with when win text appears (see delayedCall below)
  } else {
    // Same behavior when win line drawer isn't present
    // Defer WinTracker display to align with when win text appears (see delayedCall below)
  }

  // NOW handle scatter symbols AFTER winlines are drawn
  // Once the max-win cap (slot.totalWin) is reached the bonus is ending via max win — suppress the
  // retrigger so it doesn't defer the max-win finalize (shouldDeferMaxWinForBonusEntry →
  // hasPendingScatterRetrigger) or show a 0-free-spin retrigger dialog.
  const maxWinCapReached =
    spinData?.slot?.hasMaxWin === true &&
    !!((self.scene as any)?.bonusHeader?.isMaxWinCapReached?.(spinData));
  const isRetrigger = gameStateManager.isBonus && scatterGrids.length >= 3;
  if (isRetrigger || scatterGrids.length >= 4) {
    console.log(`[Symbols] Scatter detected! Found ${scatterGrids.length} scatter symbols`);
    gameStateManager.isScatter = true;

    // Compute scatter base payout and update winnings display(s)
    try {
      const scatterCount = scatterGrids.length;
      const betAmount = parseFloat(String(spinData.bet));
      // In-bonus retriggers (+spins): no scatter paytable win — only extra spins (avoid bet×multiplier on total win).
      // Base-game / initial bonus entry still uses full table for 4+ scatters.
      const scatterMultiplier = isRetrigger ? 0 : (
        scatterCount >= 6 ? 100 :
        scatterCount === 5 ? 5 :
        scatterCount === 4 ? 3 : 0
      );
      const scatterBaseWin = (isNaN(betAmount) ? 0 : betAmount) * scatterMultiplier;
      // Current spin/tumble win (excluding free spin wins) for total display
      const tumbleWinForSeed = (() => {
        try {
          const tumblesArr: any[] = Array.isArray((spinData?.slot as any)?.tumbles) ? (spinData.slot as any).tumbles : [];
          return tumblesArr.reduce((sum: number, t: any) => {
            const w = Number(t?.win ?? 0);
            if (!isNaN(w) && w > 0) return sum + w;
            const outs = Array.isArray(t?.symbols?.out) ? (t.symbols.out as Array<{ win?: number }>) : [];
            const outSum = outs.reduce((s, o) => s + (Number(o?.win) || 0), 0);
            return sum + outSum;
          }, 0);
        } catch {
          return 0;
        }
      })();
      // Total win for normal header: base bet × scatter multiplier + current spin/tumble win (excluding free spin wins)
      let totalForHeader = (scatterBaseWin || 0) + tumbleWinForSeed;
      // When this trigger spin is a max-win sequence, the seeded win must not exceed slot.totalWin.
      if (spinData?.slot?.hasMaxWin === true) {
        const cap = resolveMaxWinCapTotal(self, spinData);
        if (cap > 0) totalForHeader = Math.min(totalForHeader, cap);
      }
      const totalForBonusSeed = totalForHeader;
      
      // Update normal header winnings display immediately on scatter trigger.
      // Show: base bet × multiplier (by scatter count) + current spin/tumble win (excluding free spin wins).
      try {
        const header = (self.scene as any)?.header;
        // During bonus retriggers the visible total is BonusHeader/TUMBLE paths only — skip main header churn.
        if (!isRetrigger && header && typeof header.showWinningsDisplay === 'function' && totalForHeader > 0) {
          header.showWinningsDisplay(totalForHeader);
          console.log(`[Symbols] Header winnings updated for scatter: total=$${totalForHeader} (scatter ${scatterMultiplier}x bet + tumble $${tumbleWinForSeed})`);
        }
      } catch (e) {
        console.warn('[Symbols] Failed to update Header winnings for scatter', e);
      }
      
      // Update bonus header cumulative total with scatter base amount
      try {
        const bonusHeader = (self.scene as any)?.bonusHeader;
        if (bonusHeader) {
          if (isRetrigger) {
            // Do not add here: tumble wins already went into cumulativeBonusWin on TUMBLE_SEQUENCE_DONE,
            // and WIN_STOP catches spins with no tumble list. Previously addToCumulativeWin(totalForHeader)
            // double-counted the same spin when retriggers landed with cluster wins.
            console.log('[Symbols] Bonus retrigger: skipping BonusHeader cumulative add (no scatter pay; spin wins from tumble/WIN_STOP only)');
          } else if (totalForHeader > 0 && typeof bonusHeader.seedCumulativeWin === 'function') {
            bonusHeader.seedCumulativeWin(totalForBonusSeed);
            console.log(`[Symbols] BonusHeader seeded with total win at scatter: $${totalForBonusSeed} (scatter + tumble)`);
          }
        }
      } catch (e) {
        console.warn('[Symbols] Failed to update BonusHeader with scatter base win', e);
      }
    } catch (e) {
      console.warn('[Symbols] Error computing/updating scatter base payout', e);
    }
 
    // If there are no other wins (no tumble wins), play scatter SFX now
    try {
      let hasWins = false;
      const tumblesArr = Array.isArray(spinData.slot?.tumbles) ? spinData.slot.tumbles : [];
      for (const t of tumblesArr) {
        const outs = Array.isArray(t?.symbols?.out) ? t.symbols.out as Array<{ count?: number; win?: number }> : [];
        const anyCount = outs.some(o => (Number(o?.count) || 0) >= 8);
        const tw = Number((t as any)?.win ?? 0);
        if (anyCount || (!isNaN(tw) && tw > 0)) { hasWins = true; break; }
      }
      if (!hasWins) {
        const audio = (window as any)?.audioManager;
        if (audio && typeof audio.playSoundEffect === 'function') {
          audio.playSoundEffect(SoundEffectType.SCATTER);
          console.log('[Symbols] Played scatter SFX for scatter-only hit');
        }
      }
    } catch {}
    
    // Pause normal autoplay immediately when scatter is detected.
    // This preserves remaining spins so autoplay can resume after bonus exit.
    if (gameStateManager.isAutoPlaying) {
      console.log('[Symbols] Scatter detected during autoplay - pausing normal autoplay');
      const slotController = (self.scene as any).slotController;
      if (slotController && typeof slotController.pauseAutoplay === 'function') {
        slotController.pauseAutoplay('scatter_triggered_bonus');
        console.log('[Symbols] Normal autoplay paused due to scatter detection');
      } else if (slotController && typeof slotController.stopAutoplay === 'function') {
        // Fallback for older controllers without pause support
        slotController.stopAutoplay();
        console.log('[Symbols] Fallback autoplay stop used due to scatter detection');
      } else {
        console.warn('[Symbols] SlotController not available to pause/stop autoplay');
      }
    }
    
    // Do not enable the black overlay during scatter animations
    self.hideWinningOverlay();
    console.log('[Symbols] Skipping winning overlay for scatter symbols');
    
    if (isRetrigger) {
      if (maxWinCapReached) {
        console.log('[Symbols] Max-win cap reached - suppressing retrigger so max win can finalize');
      } else {
        console.log('[Symbols] Bonus retrigger detected - deferring scatter animations/dialog until WIN_STOP');
        self.setPendingScatterRetrigger(scatterGrids);
      }
    } else {
      // Animate the individual scatter symbols with their hit animations (base trigger)
      console.log('[Symbols] Preparing scatter animations (base trigger)...');
      // If a win dialog will/does appear, wait for it to auto-close before animating scatters
      if (gameStateManager.isShowingWinDialog) {
        console.log('[Symbols] Win dialog active - deferring scatter symbol animations until dialog auto-closes');
        const onWinDialogClosed = async () => {
          console.log('[Symbols] WIN_DIALOG_CLOSED received - animating scatter symbols and proceeding to scatter sequence');
          gameEventManager.off(GameEventType.WIN_DIALOG_CLOSED, onWinDialogClosed);
          try {
            await self.animateScatterSymbols(mockData, scatterGrids);
            console.log('[Symbols] Scatter symbol hit animations completed (after dialog close)');
          } catch (error) {
            console.error('[Symbols] Error animating scatter symbols after dialog close:', error);
          }
          self.startScatterAnimationSequence(mockData);
        };
        gameEventManager.on(GameEventType.WIN_DIALOG_CLOSED, onWinDialogClosed);
      } else {
        console.log('[Symbols] No win dialog showing - animating scatter symbols now');
        try {
          await self.animateScatterSymbols(mockData, scatterGrids);
          console.log('[Symbols] Scatter symbol hit animations completed');
        } catch (error) {
          console.error('[Symbols] Error animating scatter symbols:', error);
        }
        self.startScatterAnimationSequence(mockData);
      }
    }
  } else {
    console.log(`[Symbols] No scatter detected (found ${scatterGrids.length} scatter symbols, need 4+)`);
  }
  
  // Set spinning state to false
  gameStateManager.isReelSpinning = false;
  
  console.log('[Symbols] SpinData symbols processed successfully');
  
  // Since this game has no winlines, mark spin as done after all animations and tumbles finish
  // Emit REELS_STOP and WIN_STOP here when winline drawer is disabled/not used
  if (!self.winLineDrawer || (Symbols as any).WINLINE_CHECKING_DISABLED) {
    // In bonus mode, trigger all multiplier Win animations after the full tumble/win cycle
    try {
      await triggerAllMultiplierWinsAfterBonusSpin(self);
    } catch {}
    console.log('[Symbols] Emitting REELS_STOP and WIN_STOP after symbol animations, tumbles, and bonus multiplier wins (no winlines flow)');
    try {
      gameEventManager.emit(GameEventType.REELS_STOP);
      gameEventManager.emit(GameEventType.WIN_STOP);
    } catch (e) {
      console.warn('[Symbols] Failed to emit REELS_STOP/WIN_STOP:', e);
    }
  }
}

// Legacy helpers for converting paylines/winlines to internal win formats have been
// removed. This game now uses cluster/tumble logic exclusively; payline-based
// evaluation and winline drawing are no longer part of the runtime flow.



function onSpinDataReceived(self: Symbols) {
  // Listen for the new SPIN_DATA_RESPONSE event from GameAPI
  gameEventManager.on(GameEventType.SPIN_DATA_RESPONSE, async (data: any) => {
    console.log('[Symbols] SPIN_DATA_RESPONSE received:', data);
    console.log('[Symbols] SpinData:', data.spinData);
    
    if (!data.spinData || !data.spinData.slot || !data.spinData.slot.area) {
      console.error('[Symbols] Invalid SpinData received - missing slot.area');
      return;
    }

    self.spinDataResponseReceivedForCurrentSpin = true;
    self.restingGridSnapshot = null;
    
    // Store the current spin data for access by other components
    self.currentSpinData = data.spinData;
    console.log('[Symbols] Stored current spin data for access by other components');
    
    // Use the slot.area from SpinData instead of data.symbols
    const symbols = data.spinData.slot.area;
    console.log('[Symbols] Using symbols from SpinData slot.area:', symbols);
    
    // Process the symbols using the same logic as before
    await processSpinDataSymbols(self, symbols, data.spinData);
  });
}

/**
 * Attempt to scale a Spine object so it visually fits within the PNG dimensions
 * used by symbols (self.displayWidth x self.displayHeight).
 */
function fitSpineToSymbolBox(self: Symbols, spineObj: any): void {
  if (!spineObj) return;
  try {
    // Reset to a known baseline before measuring
    if (typeof spineObj.setScale === 'function') spineObj.setScale(1);
    try {
      // Ensure we are in setup pose before measuring
      if (spineObj.skeleton && typeof spineObj.skeleton.setToSetupPose === 'function') {
        spineObj.skeleton.setToSetupPose();
      }
      if (spineObj.updateWorldTransform) {
        spineObj.updateWorldTransform();
      }
    } catch {}

    let boundsWidth = 0;
    let boundsHeight = 0;

    try {
      if (typeof spineObj.getBounds === 'function') {
        const b = spineObj.getBounds();
        if (b && b.size) {
          boundsWidth = Math.max(1, b.size.x || b.size.width || 0);
          boundsHeight = Math.max(1, b.size.y || b.size.height || 0);
        }
      }
    } catch {}

    if (!boundsWidth || !boundsHeight) {
      // Fallback to width/height properties if available
      boundsWidth = Math.max(1, (spineObj.width as number) || 0);
      boundsHeight = Math.max(1, (spineObj.height as number) || 0);
    }

    // Compute uniform scale to fit within target box
    const targetW = Math.max(1, self.displayWidth);
    const targetH = Math.max(1, self.displayHeight);
    const scale = Math.min(targetW / boundsWidth, targetH / boundsHeight) * 0.98; // small padding
    if (isFinite(scale) && scale > 0) {
      spineObj.setScale(scale);
    } else {
      // Fallback: use existing per-symbol scale logic
      spineObj.setScale( self.getSpineSymbolScale(0) );
    }
    // Apply additional per-symbol adjustments after fitting
    try {
      const val = (spineObj as any)?.symbolValue;
      if (val === 0) {
        const sx = (spineObj as any)?.scaleX ?? 1;
        const sy = (spineObj as any)?.scaleY ?? 1;
        if (typeof spineObj.setScale === 'function') {
          spineObj.setScale(sx * 1.2, sy * 1.2); // +20% for scatter
        }
      }
    } catch {}
  } catch {}
}

/**
 * Schedule a scale-up effect (+30%) after a delay (default 500ms)
 */
function scheduleScaleUp(self: Symbols, obj: any, delayMs: number = 500): void {
  try {
    const baseX = obj?.scaleX ?? 1;
    const baseY = obj?.scaleY ?? 1;
    const targetX = baseX * 1.6;
    const targetY = baseY * 1.6;
    self.symbolPool.delay(obj, delayMs, () => {
      try {
        self.scene.tweens.add({
          targets: obj,
          scaleX: targetX,
          scaleY: targetY,
          duration: 200,
          ease: Phaser.Math.Easing.Cubic.Out,
        });
      } catch {}
    });
  } catch {}
}

// Visual boost for multiplier symbols (applied on top of fit-to-box scale)
const MULTIPLIER_VISUAL_SCALE = 1.6;
// Stagger between triggering multiplier symbols (ms)
const MULTIPLIER_TRIGGER_STAGGER_MS = 800;

/**
 * Disable a symbol object so it no longer interacts or animates.
 * Keeps it visible; removal/visibility is handled elsewhere.
 */
function disableSymbolObject(self: Symbols, obj: any): void {
  try { self.scene.tweens.killTweensOf(obj); } catch {}
  try {
    const overlayObj: any = (obj as any)?.__overlayImage;
    const bounceTween: any = (overlayObj as any)?.__bounceTween;
    try { bounceTween?.stop?.(); } catch {}
    try { self.scene.tweens.killTweensOf(overlayObj); } catch {}
  } catch {}
  try { if (typeof obj.disableInteractive === 'function') obj.disableInteractive(); } catch {}
  try { (obj as any).active = false; } catch {}
}

/** Stop overlay bounce / prior tweens so dropPrevSymbols chains complete (multipliers). */
function prepareSymbolForPrevDrop(self: Symbols, obj: any): void {
  try { self.scene.tweens.killTweensOf(obj); } catch {}
  try {
    const overlayObj: any = (obj as any)?.__overlayImage;
    if (!overlayObj) return;
    const bounceTween: any = (overlayObj as any)?.__bounceTween;
    try { bounceTween?.stop?.(); } catch {}
    try { delete (overlayObj as any).__bounceTween; } catch {}
    try { self.scene.tweens.killTweensOf(overlayObj); } catch {}
  } catch {}
}

/** Destroy old row symbols after dropPrevSymbols finishes (including safety-timeout path). */
function cleanupDroppedOldSymbolRow(self: Symbols, row: number): void {
  if (self.suppressStalePreSpinRowCleanup) {
    return;
  }
  if (!self.symbols?.length) return;
  for (let col = 0; col < self.symbols.length; col++) {
    const symbol = self.symbols[col]?.[row];
    if (self.newSymbols?.[col]?.[row] === symbol) {
      if (self.symbols[col]) self.symbols[col][row] = null as any;
      continue;
    }
    if (!symbol || (symbol as any).destroyed) {
      if (self.symbols[col]) self.symbols[col][row] = null as any;
      continue;
    }
    self.symbolPool.release(symbol);
    self.symbols[col][row] = null as any;
  }
}

/**
 * Map multiplier symbol value (10–22) to its animation base inside SymbolBombs_SW
 * Returns one of: 'Symbols11_SW', 'Symbols10_SW', 'Symbols12_SW', or null if not a multiplier
 */
function getMultiplierAnimationBase(value: number): string | null {
  if (value >= 10 && value <= 16) return 'Symbols11_SW';
  if (value >= 17 && value <= 20) return 'Symbols10_SW';
  if (value >= 21 && value <= 22) return 'Symbols12_SW';
  return null;
}

/**
 * Map multiplier symbol value (10–22) to its numeric multiplier for ordering
 * 10->2, 11->3, 12->4, 13->5, 14->6, 15->8, 16->10,
 * 17->12, 18->15, 19->20, 20->25, 21->50, 22->100
 */
function getMultiplierNumeric(value: number): number {
  switch (value) {
    case 10: return 2;
    case 11: return 3;
    case 12: return 4;
    case 13: return 5;
    case 14: return 6;
    case 15: return 8;
    case 16: return 10;
    case 17: return 12;
    case 18: return 15;
    case 19: return 20;
    case 20: return 25;
    case 21: return 50;
    case 22: return 100;
    default: return 0;
  }
}

/**
 * Map multiplier symbol value (10–22) to its PNG overlay key
 * Example keys: 'multiplier_overlay_10', 'multiplier_overlay_22'
 */
function getMultiplierOverlayKey(value: number): string | null {
  switch (value) {
    case 10: return 'multiplier_overlay_10';
    case 11: return 'multiplier_overlay_11';
    case 12: return 'multiplier_overlay_12';
    case 13: return 'multiplier_overlay_13';
    case 14: return 'multiplier_overlay_14';
    case 15: return 'multiplier_overlay_15';
    case 16: return 'multiplier_overlay_16';
    case 17: return 'multiplier_overlay_17';
    case 18: return 'multiplier_overlay_18';
    case 19: return 'multiplier_overlay_19';
    case 20: return 'multiplier_overlay_20';
    case 21: return 'multiplier_overlay_21';
    case 22: return 'multiplier_overlay_22';
    default: return null;
  }
}

/**
 * Create a centered win text using Poppins-Bold and white color with dark stroke.
 * Returns the Phaser.Text object (already origin-centered).
 */
function createWinText(self: Symbols, amount: number, x: number, y: number): Phaser.GameObjects.Text {
  const px = Math.max(40, Math.round(self.displayHeight * 0.5));
  let textValue = '';
  try {
    const formattedAmount = formatCurrencyNumber(amount);
    textValue = formattedAmount;
  } catch {
    // Fallback to basic formatting if anything fails
    textValue = `${amount}`;
  }
  const txt = self.scene.add.text(x, y, textValue, {
    fontFamily: 'Poppins-Bold',
    fontSize: `${px}px`,
    color: '#FFFFFF',
    align: 'center'
  } as any);
  txt.setOrigin(0.5, 0.5);
  try {
    (txt as any).setStroke?.('#FA2A55', Math.max(2, Math.round(px * 0.12)));
    (txt as any).setShadow?.(0, 2, '#000000', Math.max(2, Math.round(px * 0.15)), true, true);
  } catch {}
  return txt;
}

/**
 * Gather tween targets for a symbol: include overlay image if present.
 * Win text is animated separately and excluded here to avoid double-tweening.
 */
function getSymbolTweenTargets(baseObj: any): any {
  try {
    const overlayObj: any = (baseObj as any)?.__overlayImage;
    if (overlayObj) return [baseObj, overlayObj];
  } catch {}
  return baseObj;
}

/**
 * Attach a number PNG overlay in front of multiplier symbols (10–22)
 * The overlay is added to the same container and stored on the base object for lifecycle/tween syncing.
 */
function attachMultiplierOverlay(self: Symbols, baseObj: any, value: number, x: number, y: number): void {
  const key = getMultiplierOverlayKey(value);
  if (!key) return;
  try {
    if (!self.scene.textures.exists(key)) return;
    const overlay = self.scene.add.image(x, y, key);
    if (!overlay) return;
    overlay.setOrigin(0.5, 0.5);
    // Scale overlay relative to symbol box size for consistent visuals (+50% larger)
    const desiredWidth = Math.max(3, self.displayWidth * 1.3);
    const texW = Math.max(1, overlay.width);
    const scale = desiredWidth / texW;
    overlay.setScale(scale);
    // Add a subtle looping bounce (scale pulse) that won't conflict with Y-move tweens
    try {
      const bounceTween = self.scene.tweens.add({
        targets: overlay,
        scaleX: scale * 0.88,
        scaleY: scale * 0.88,
        duration: 300,
        yoyo: true,
        repeat: -1,
        ease: Phaser.Math.Easing.Sine.InOut,
      });
      try { (overlay as any).__bounceTween = bounceTween; } catch {}
    } catch {}
    // Ensure overlay renders above its base symbol
    try {
      const baseDepth = (baseObj && typeof baseObj.depth === 'number') ? baseObj.depth : 0;
      overlay.setDepth(baseDepth + 1);
    } catch {}
    // Add to same container so global visibility/alpha applies uniformly
    self.container.add(overlay);
    // Store reference on base object for tweening and cleanup
    try { (baseObj as any).__overlayImage = overlay; } catch {}
  } catch {}
}

/**
 * Create a sugar Spine symbol (Symbol1–Symbol9) playing idle, or PNG fallback
 */
function createSugarOrPngSymbol(self: Symbols, value: number, x: number, y: number, alpha: number = 1): any {
  // Try sugar spine for Symbol0–Symbol9
  if (value >= 0 && value <= 9) {
    try {
      enableSymbolSpineAtlasMipmaps(self.scene);
      const sugarKey = `symbol_${value}_sugar_spine`;
      const sugarAtlasKey = `${sugarKey}-atlas`;
      const go: any = self.symbolPool.acquire(sugarKey, sugarAtlasKey, x, y);
      if (go) {
        try { (go as any).symbolValue = value; } catch {}
        if (typeof go.setOrigin === 'function') go.setOrigin(0.5, 0.5);
        fitSpineToSymbolBox(self, go);
        try { enableMipmapsOnSpineSkeleton(go.skeleton, self.scene); } catch {}
        if (typeof go.setAlpha === 'function') go.setAlpha(alpha);
        // Play idle animation if available
        try {
          const idle = `Symbol${value}_SW_Idle`;
          const drop = `Symbol${value}_SW_Drop`;
          if (go.animationState && go.animationState.setAnimation) {
            // Try to play drop first, then transition to idle on complete
            let playedDrop = false;
            try {
              const hasDrop = !!(go as any)?.skeleton?.data?.findAnimation?.(drop);
              if (hasDrop) {
                const dropEntry = go.animationState.setAnimation(0, drop, false);
                playedDrop = true;
                if (go.animationState.addListener) {
                  const listener = {
                    complete: (entry: any) => {
                      try {
                        if (!entry || entry.animation?.name !== drop) return;
                      } catch {}
                      // Switch to idle loop with random offset and slight speed jitter
                      try {
                        const idleEntry = go.animationState.setAnimation(0, idle, true);
                        const duration = (go as any)?.skeleton?.data?.findAnimation?.(idle)?.duration;
                        if (typeof duration === 'number' && duration > 0 && idleEntry) {
                          (idleEntry as any).trackTime = Math.random() * duration;
                        }
                        const speedJitter = 0.95 + Math.random() * 0.1;
                        if (go.animationState) (go.animationState as any).timeScale = speedJitter;
                        else if ((go as any).timeScale !== undefined) (go as any).timeScale = speedJitter;
                      } catch {}
                    }
                  } as any;
                  go.animationState.addListener(listener);
                }
              }
            } catch {}
            if (!playedDrop) {
              // Fallback: play idle immediately with desync tweaks
              const idleEntry = go.animationState.setAnimation(0, idle, true);
              try {
                const duration = (go as any)?.skeleton?.data?.findAnimation?.(idle)?.duration;
                if (typeof duration === 'number' && duration > 0 && idleEntry) {
                  (idleEntry as any).trackTime = Math.random() * duration;
                }
              } catch {}
              try {
                const speedJitter = 0.95 + Math.random() * 0.1;
                if (go.animationState) (go.animationState as any).timeScale = speedJitter;
                else if ((go as any).timeScale !== undefined) (go as any).timeScale = speedJitter;
              } catch {}
            }
          }
        } catch {}
        self.container.add(go);
        // Attach overlay PNG in front for multipliers
        try { attachMultiplierOverlay(self, go, value, x, y); } catch {}
        return go;
      }
    } catch {}
  }

  // Try multiplier shared Spine (SymbolBombs_SW) for 10–22 (no drop animation)
  const multiBase = getMultiplierAnimationBase(value);
  if (multiBase) {
    try {
      enableSymbolSpineAtlasMipmaps(self.scene);
      const multiKey = `symbol_bombs_sw`;
      const multiAtlasKey = `${multiKey}-atlas`;
      const go: any = self.symbolPool.acquire(multiKey, multiAtlasKey, x, y);
      if (go) {
        try { (go as any).symbolValue = value; } catch {}
        if (typeof go.setOrigin === 'function') go.setOrigin(0.5, 0.5);
        fitSpineToSymbolBox(self, go);
        try { enableMipmapsOnSpineSkeleton(go.skeleton, self.scene); } catch {}
        // Apply small visual boost so multipliers appear larger
        try {
          const sx = (go as any)?.scaleX ?? 1;
          const sy = (go as any)?.scaleY ?? 1;
          if (typeof go.setScale === 'function') go.setScale(sx * MULTIPLIER_VISUAL_SCALE, sy * MULTIPLIER_VISUAL_SCALE);
        } catch {}
        if (typeof go.setAlpha === 'function') go.setAlpha(alpha);
        // Play idle loop; no drop exists for multipliers
        try {
          const idle = `${multiBase}_Idle`;
          if (go.animationState && go.animationState.setAnimation) {
            const idleEntry = go.animationState.setAnimation(0, idle, true);
            // Desync and slight speed jitter for variety
            try {
              const duration = (go as any)?.skeleton?.data?.findAnimation?.(idle)?.duration;
              if (typeof duration === 'number' && duration > 0 && idleEntry) {
                (idleEntry as any).trackTime = Math.random() * duration;
              }
            } catch {}
            try {
              const speedJitter = 0.95 + Math.random() * 0.1;
              if (go.animationState) (go.animationState as any).timeScale = speedJitter;
              else if ((go as any).timeScale !== undefined) (go as any).timeScale = speedJitter;
            } catch {}
          }
        } catch {}
        self.container.add(go);
        // Attach overlay PNG in front for multipliers
        try { attachMultiplierOverlay(self, go, value, x, y); } catch {}
        return go;
      }
    } catch {}
  }

  // Fallback to PNG sprite (if available)
  const spriteKey = 'symbol_' + value;
  if (self.scene.textures.exists(spriteKey)) {
    const sprite = self.scene.add.sprite(x, y, spriteKey);
    try { (sprite as any).symbolValue = value; } catch {}
    sprite.displayWidth = self.displayWidth;
    sprite.displayHeight = self.displayHeight;
    if (typeof sprite.setAlpha === 'function') sprite.setAlpha(alpha);
    self.container.add(sprite);
    // Attach overlay PNG in front for multipliers
    try { attachMultiplierOverlay(self, sprite, value, x, y); } catch {}
    return sprite;
  }
  
  // If no PNG fallback available, create a placeholder rectangle
  console.warn(`[Symbols] No sprite or Spine available for symbol ${value}, creating placeholder`);
  const placeholder = self.scene.add.rectangle(x, y, self.displayWidth, self.displayHeight, 0x888888, 0.5);
  try { (placeholder as any).symbolValue = value; } catch {}
  if (typeof placeholder.setAlpha === 'function') placeholder.setAlpha(alpha);
  self.container.add(placeholder);
  return placeholder;
}

/**
 * Play the multiplier "Win" animation once (non-looping) without returning to Idle.
 * Times out safely in case the animation is missing to avoid blocking flow.
 */
async function playMultiplierWinThenIdle(self: Symbols, obj: any, base: string): Promise<void> {
  return new Promise<void>((resolve) => {
    let finished = false;
    const safeResolve = () => { if (!finished) { finished = true; resolve(); } };
    self.symbolPool.onRelease(obj, safeResolve);
    if ((self as any).skipMultipliersActive) {
      return safeResolve();
    }
    const isTurbo = !!self.scene.gameData?.isTurbo;
    const multiplierValue = obj?.symbolValue;
    const isCurrentSymbol = self.symbolPool.currentUse(obj);
    // Fire dedicated multiplier trigger SFX right as the Win animation starts
    try {
      const audio = (window as any)?.audioManager;
      if (audio && typeof audio.playSoundEffect === 'function' && gameStateManager.isBonus) {
        try {
          audio.playSoundEffect(SoundEffectType.MULTIPLIER_TRIGGER);
        } catch {}
      }
    } catch {}
    try {
      const animState = obj?.animationState;
      if (!animState || !animState.setAnimation) return safeResolve();
      const winAnim = `${base}_Win`;
      // Note: We do NOT resolve when the Win animation completes.
      // The promise must wait for the overlay PNG animation to fully complete (travel + pop + fade).
      // Resolution happens in the overlay animation's fade complete callback (line 3766).
      // Start the Win animation
      let entry: any = null;
      try { if (animState.clearTracks) animState.clearTracks(); } catch {}
      entry = animState.setAnimation(0, winAnim, false);
      // Smoothly enlarge the overlay by 30% when win animation starts
      try {
        const overlayObj: any = (obj as any)?.__overlayImage;
        if (overlayObj) {
          const currentScaleX = (overlayObj.scaleX ?? 1);
          const currentScaleY = (overlayObj.scaleY ?? 1);
          const targetScaleX = currentScaleX * 1.8;
          const targetScaleY = currentScaleY * 1.8;
          // Stop any existing bounce tween before enlarging
          try { (overlayObj as any)?.__bounceTween?.stop?.(); } catch {}
          // Smoothly tween to enlarged size
          self.scene.tweens.add({
            targets: overlayObj,
            scaleX: targetScaleX,
            scaleY: targetScaleY,
            duration: 250,
            ease: Phaser.Math.Easing.Cubic.Out,
          });
        }
      } catch {}
      // Apply the same visual scale-up used for normal symbol win animations
      try { scheduleScaleUp(self, obj, 500); } catch {}
      // Pause a few frames before the end of the Win animation (non-turbo only), then resolve so flow can continue
      try {
        // Compute pause time near the end of the animation (0.5s before end)
        const animData = (obj as any)?.skeleton?.data?.findAnimation?.(winAnim);
        const durationSec = typeof animData?.duration === 'number' ? animData.duration : 0;
        // In turbo mode, pause a bit closer to the end so things still feel fast
        const pauseDeltaSec = isTurbo ? 0.25 : 0.5;
        const pauseAtSec = Math.max(0, durationSec > 0 ? Math.max(0, durationSec - pauseDeltaSec) : 0);
        const delayMs = Math.max(0, pauseAtSec * 1000);
        // Schedule the pause shortly before the end
        self.symbolPool.delay(obj, delayMs, () => {
          try {
            if ((self as any).skipMultipliersActive) {
              safeResolve();
              return;
            }
            // Always pause the Win animation briefly near the end so the multiplier
            // appears to "freeze" before the overlay flies toward the winnings display.
            const e = entry || (animState?.getCurrent && animState.getCurrent(0));
            if (e) {
              try { (e as any).timeScale = 0; } catch {}
            } else {
              try { (animState as any).timeScale = 0; } catch {}
            }
            // After pausing near the end, disable the symbol so it won't interact/animate further
            try { disableSymbolObject(self, obj); } catch {}
          } catch {}
          // Move multiplier PNG overlay toward the center of the winnings display
          try {
            const overlayObj: any = (obj as any)?.__overlayImage;
            // Create overlay if missing (derive from symbolValue)
            if (!overlayObj) {
              try {
                const value = (obj as any)?.symbolValue;
                if (typeof value === 'number') {
                  attachMultiplierOverlay(self, obj, value, obj.x, obj.y);
                }
              } catch {}
            }
            const ov: any = (obj as any)?.__overlayImage;
            // Stop bounce and any ongoing tweens on original overlay
            try { (ov as any)?.__bounceTween?.stop?.(); } catch {}
            try { if (ov) self.scene.tweens.killTweensOf(ov); } catch {}
            // Compute world coordinates for starting point
            let worldX = obj.x, worldY = obj.y;
            try {
              const source = (ov && ov.getWorldTransformMatrix) ? ov : (obj && obj.getWorldTransformMatrix ? obj : null);
              const m: any = source ? source.getWorldTransformMatrix() : null;
              if (m && typeof m.tx === 'number' && typeof m.ty === 'number') {
                worldX = m.tx; worldY = m.ty;
              } else {
                worldX = (ov ? ov.x : obj.x) + (self.container?.x || 0);
                worldY = (ov ? ov.y : obj.y) + (self.container?.y || 0);
              }
            } catch {}
            // Determine texture key and scale for the flying overlay
            let textureKey: string | null = null;
            let scaleX = 1, scaleY = 1;
            try { textureKey = ov?.texture?.key || null; } catch {}
            if (!textureKey) {
              try {
                const value = (obj as any)?.symbolValue;
                textureKey = getMultiplierOverlayKey(value);
              } catch {}
            }
            try {
              scaleX = (ov && typeof ov.scaleX === 'number') ? ov.scaleX : scaleX;
              scaleY = (ov && typeof ov.scaleY === 'number') ? ov.scaleY : scaleY;
            } catch {}
            // The overlay has been enlarged by 30% during win animation, so current scale is enlarged
            // Calculate original scale by dividing by 1.3, and use current scale as enlarged scale
            const enlargedScaleX = scaleX;
            const enlargedScaleY = scaleY;
            const originalScaleX = scaleX / 1.8;
            const originalScaleY = scaleY / 1.8;
            // Hide/detach original overlay to avoid double-visibility and mask effects
            try {
              if (ov) {
                ov.setVisible(false);
                // Keep reference for cleanup but ensure it doesn't render
              }
            } catch {}
            // Create an unmasked overlay at world coordinates in the root display list
            if (textureKey) {
              try {
                const fly = self.scene.add.image(worldX, worldY, textureKey);
                fly.setOrigin(0.5, 0.5);
                // Start at enlarged scale (30% larger)
                try { fly.setScale(enlargedScaleX, enlargedScaleY); } catch {}
                try { fly.setDepth(920); } catch {}
                // Compute target center (win bar text middle)
                const cx = self.scene.scale.width * 0.5;
                const baseY = self.scene.scale.height * 0.215;
                const cy = baseY + 18;
                // Travel tween - tween both position and scale back to original size
                self.scene.tweens.add({
                  targets: fly,
                  x: cx,
                  y: cy,
                  scaleX: originalScaleX,
                  scaleY: originalScaleY,
                  duration: Math.max(200, self.scene.gameData.dropDuration),
                  ease: Phaser.Math.Easing.Cubic.InOut,
                  onComplete: () => {
                    // Notify bonus header that one multiplier reached center (accumulate display)
                    if (!isCurrentSymbol()) { fly.destroy(); safeResolve(); return; }
                    try {
                      // Determine multiplier weight from symbol value
                      let weight = 0;
                      try {
                        const value = multiplierValue;
                        if (typeof value === 'number') weight = getMultiplierNumeric(value);
                      } catch {}
                      // Compute spin total for this spin BEFORE multipliers are applied:
                      // Prefer a true base from raw win components (paylines + tumbles).
                      // Note: backend freespin items' totalWin commonly already includes multipliers.
                      let spinTotal = 0;
                      try {
                        const spinData: any = (self as any)?.currentSpinData;

                        if (spinData?.slot?.paylines && Array.isArray(spinData.slot.paylines)) {
                          for (const pl of spinData.slot.paylines) {
                            const w = Number(pl?.win || 0);
                            if (!isNaN(w)) spinTotal += w;
                          }
                        }
                        if (Array.isArray(spinData?.slot?.tumbles)) {
                          for (const t of spinData.slot.tumbles) {
                            const w = Number((t as any)?.win ?? 0);
                            if (!isNaN(w)) spinTotal += w;
                          }
                        }

                        // Fallback: if base can't be derived, attempt to back-calc from item total.
                        // Compute multiplierSum from current grid so we can divide it out.
                        if (spinTotal === 0) {
                          let multiplierSum = 0;
                          try {
                            if (self.symbols && self.symbols.length) {
                              for (let c = 0; c < self.symbols.length; c++) {
                                const col = self.symbols[c] || [];
                                for (let r = 0; r < col.length; r++) {
                                  const o: any = col[r];
                                  const v = Number(o?.symbolValue);
                                  if (v >= 10 && v <= 22) {
                                    multiplierSum += getMultiplierNumeric(v);
                                  }
                                }
                              }
                            }
                          } catch {}

                          const slotAny: any = spinData?.slot || {};
                          const fs = slotAny?.freespin || slotAny?.freeSpin;
                          const items = Array.isArray(fs?.items) ? fs.items : [];
                          const area = slotAny?.area;
                          if (items.length > 0 && Array.isArray(area)) {
                            const areaJson = JSON.stringify(area);
                            const currentFreeSpinItem = items.find((item: any) =>
                              Array.isArray(item?.area) && JSON.stringify(item.area) === areaJson
                            );
                            if (currentFreeSpinItem) {
                              const raw =
                                (currentFreeSpinItem as any).totalWin ??
                                (currentFreeSpinItem as any).subTotalWin ??
                                0;
                              const totalMaybeMultiplied = Number(raw);
                              if (!isNaN(totalMaybeMultiplied) && totalMaybeMultiplied > 0) {
                                spinTotal =
                                  multiplierSum > 0
                                    ? (totalMaybeMultiplied / multiplierSum)
                                    : totalMaybeMultiplied;
                              }
                            }
                          }
                        }
                      } catch {}
                      gameEventManager.emit(GameEventType.MULTIPLIER_ARRIVED, { spinTotal, weight } as any);
                    } catch {}
                    // Soft pop + fade out then destroy
                    try {
                      const sx = (fly as any)?.scaleX ?? 1;
                      const sy = (fly as any)?.scaleY ?? 1;
                      self.scene.tweens.chain({
                        targets: fly,
                        tweens: [
                          { scaleX: sx * 1.1, scaleY: sy * 1.1, duration: 120, ease: Phaser.Math.Easing.Cubic.Out },
                          { alpha: 0, duration: 260, ease: Phaser.Math.Easing.Cubic.In, onComplete: () => {
                            try { fly.destroy(); } catch {}
                            // Resolve after the fly completes its arrival + fade sequence
                            safeResolve();
                          }}
                        ]
                      });
                    } catch {
                      try { fly.destroy(); } catch {}
                      // Ensure resolution even if fade chain fails
                      safeResolve();
                    }
                  }
                });
              } catch {
                // If overlay creation fails, resolve after a short delay
                safeResolve();
              }
            } else {
              // No overlay texture available - resolve immediately since there's nothing to animate
              safeResolve();
            }
          } catch {}
          // Do not resolve here; wait for the fly tween to complete so arrival is processed before continuing
        });
      } catch {
        // If anything fails, just resolve after a short safety delay
        self.scene.time.delayedCall(300, () => safeResolve());
      }
      // After 0.5s, move multiplier behind other symbols (lower depth)
      try {
        self.symbolPool.delay(obj, 500, () => {
          try {
            // Reorder within container so multiplier renders behind other symbols
            const overlayObj: any = (obj as any)?.__overlayImage;
            // Temporarily remove overlay if present so we can place it right after the base
            if (overlayObj && self.container?.remove) {
              self.container.remove(overlayObj, false);
            }
            if (self.container?.sendToBack) {
              self.container.sendToBack(obj);
            }
            // Place overlay right above its base symbol, but still behind all other symbols
            if (overlayObj && self.container?.addAt && self.container?.getIndex) {
              const baseIndex = self.container.getIndex(obj);
              self.container.addAt(overlayObj, baseIndex + 1);
            }
          } catch {}
        });
      } catch {}
    } catch {
      safeResolve();
    }
  });
}

/**
 * During bonus mode, after wins and tumbles have fully completed for the
 * current free spin item, trigger Win animations on all multiplier symbols
 * currently present on the grid.
 */
function hasAnyWinsBySymbolCount(self: Symbols): boolean {
  try {
    const dt = new Data();
    if (!self.currentSymbolData) {
      const numCols = self.symbols?.length || 0;
      const numRows = numCols > 0 ? (self.symbols[0]?.length || 0) : 0;
      const rowMajor: number[][] = [];
      for (let row = 0; row < numRows; row++) {
        rowMajor[row] = [];
        for (let col = 0; col < numCols; col++) {
          try {
            const obj: any = self.symbols[col][row];
            const val = self.currentSymbolData?.[row]?.[col];
            rowMajor[row][col] = typeof val === 'number' ? val : (obj?.symbolValue ?? 0);
          } catch {
            rowMajor[row][col] = 0;
          }
        }
      }
      dt.symbols = rowMajor;
    } else {
      dt.symbols = self.currentSymbolData;
    }
    const wins = self.symbolDetector.getWins(dt);
    return !!(wins && wins.allMatching && wins.allMatching.size > 0);
  } catch {
    return false;
  }
}

async function triggerAllMultiplierWinsAfterBonusSpin(self: Symbols): Promise<void> {
  try {
    if (!gameStateManager.isBonus) return;
    // Only animate multipliers if this item (spin + its tumbles) had any wins
    if (!(self as any).hadWinsInCurrentItem) return;
    if (!self.symbols || !self.symbols.length || !self.symbols[0]?.length) return;
    type MultiItem = { obj: any; base: string; weight: number };
    const items: MultiItem[] = [];
    for (let col = 0; col < self.symbols.length; col++) {
      for (let row = 0; row < self.symbols[col].length; row++) {
        const obj: any = self.symbols[col][row];
        if (!obj) continue;
        let value: number | null = null;
        try { value = (obj as any).symbolValue ?? null; } catch {}
        if (typeof value !== 'number') continue;
        const base = getMultiplierAnimationBase(value);
        if (!base) continue;
        const canAnimate = !!(obj?.animationState && obj.animationState.setAnimation);
        if (!canAnimate) continue;
        const weight = getMultiplierNumeric(value);
        items.push({ obj, base, weight });
      }
    }
    if (items.length === 0) return;

    self.clearSkipMultipliers();
    let multiplierBatchAborted = false;
    const abortPromise = new Promise<void>((resolve) => {
      self.multiplierAnimationsAbortResolve = () => {
        multiplierBatchAborted = true;
        resolve();
      };
    });

    // Compute total multiplier sum and spin total BEFORE multipliers are applied
    try {
      const multiplierSum = items.reduce((sum, it) => sum + (Number(it.weight) || 0), 0);
      let spinTotal = 0;
      try {
        const spinData: any = (self as any)?.currentSpinData;

        // Prefer a true base total from raw win components (paylines + tumbles).
        // Note: backend freespin items' totalWin commonly already includes multipliers.
        if (spinData?.slot?.paylines && Array.isArray(spinData.slot.paylines)) {
          for (const pl of spinData.slot.paylines) {
            const w = Number(pl?.win || 0);
            if (!isNaN(w)) spinTotal += w;
          }
        }
        if (Array.isArray(spinData?.slot?.tumbles)) {
          for (const t of spinData.slot.tumbles) {
            const w = Number((t as any)?.win ?? 0);
            if (!isNaN(w)) spinTotal += w;
          }
        }

        // Fallback: if we cannot derive a base from components, back-calculate from item total.
        // If multiplierSum is known, assume item total is already multiplied and divide it out.
        if (spinTotal === 0) {
          const slotAny: any = spinData?.slot || {};
          const fs = slotAny?.freespin || slotAny?.freeSpin;
          const itemsArr = Array.isArray(fs?.items) ? fs.items : [];
          const area = slotAny?.area;
          if (itemsArr.length > 0 && Array.isArray(area)) {
            const areaJson = JSON.stringify(area);
            const currentFreeSpinItem = itemsArr.find((item: any) =>
              Array.isArray(item?.area) && JSON.stringify(item.area) === areaJson
            );
            if (currentFreeSpinItem) {
              const raw =
                (currentFreeSpinItem as any).totalWin ??
                (currentFreeSpinItem as any).subTotalWin ??
                0;
              const totalMaybeMultiplied = Number(raw);
              if (!isNaN(totalMaybeMultiplied) && totalMaybeMultiplied > 0) {
                spinTotal =
                  multiplierSum > 0
                    ? (totalMaybeMultiplied / multiplierSum)
                    : totalMaybeMultiplied;
              }
            }
          }
        }
      } catch {}
      // Emit event so BonusHeader can show "YOU WON: $spinTotal x multiplierSum"
      try {
        gameEventManager.emit(GameEventType.MULTIPLIERS_TRIGGERED, { spinTotal, multiplierSum } as any);
      } catch {}
    } catch {}
    // Sort by highest multiplier first; randomize order among equals
    items.sort((a, b) => {
      if (b.weight !== a.weight) return b.weight - a.weight;
      return Math.random() - 0.5;
    });
    // Start each with a stagger, allowing overlap; wait for all to complete
    const startDelayMs = MULTIPLIER_TRIGGER_STAGGER_MS;
    const runPromises: Promise<void>[] = items.map((it, idx) => {
      return new Promise<void>((resolve) => {
        try {
          if (self.skipMultipliersActive || multiplierBatchAborted) {
            resolve();
            return;
          }
          const delayMs = Math.max(0, startDelayMs * idx);
          self.symbolPool.onRelease(it.obj, resolve);
          const timer = self.symbolPool.delay(it.obj, delayMs, async () => {
            try {
              if (self.skipMultipliersActive || multiplierBatchAborted) {
                resolve();
                return;
              }
              await playMultiplierWinThenIdle(self, it.obj, it.base);
            } catch {}
            resolve();
          });
          self.multiplierStaggerTimers.push(timer);
        } catch {
          resolve();
        }
      });
    });
    await Promise.race([Promise.allSettled(runPromises), abortPromise]);
    self.multiplierStaggerTimers = [];
    self.multiplierAnimationsAbortResolve = null;
    // Wait after all multiplier PNGs have reached the center of the winnings display
    if (!multiplierBatchAborted && !self.skipMultipliersActive) {
      await new Promise<void>((resolve) => {
        self.scene.time.delayedCall(800, () => {
          resolve();
        });
      });
    }
    // Emit event that all multiplier animations have completed
    try {
      gameEventManager.emit(GameEventType.MULTIPLIER_ANIMATIONS_COMPLETE);
      console.log('[Symbols] Emitted MULTIPLIER_ANIMATIONS_COMPLETE event');
    } catch {}
    self.clearSkipMultipliers();
  } catch {}
}

function createNewSymbols(self: Symbols, data: Data) {
  let scene = self.scene;
  disposeSymbols(self, self.newSymbols);
  self.newSymbols = [];

  const symbolTotalWidth = self.displayWidth + self.horizontalSpacing;
  const symbolTotalHeight = self.displayHeight + self.verticalSpacing;

  const adjY = self.scene.scale.height * -1.0;

  const startX = self.slotX - self.totalGridWidth * 0.5;
  const startY = self.slotY - self.totalGridHeight * 0.5 + adjY;

  let symbols = data.symbols; // expected column-major [col][row]
  console.log('[Symbols] New symbols from spin response (column-major):', symbols);
  
  // Update current symbol data for reset purposes (store as row-major for tumble logic)
  try {
    const colCount = symbols.length;
    const rowCount = colCount > 0 ? symbols[0].length : 0;
    const rowMajor: number[][] = [];
    for (let row = 0; row < rowCount; row++) {
      rowMajor[row] = [];
      for (let col = 0; col < colCount; col++) {
        // Invert vertical order: SpinData area is bottom->top; row 0 is top visually
        rowMajor[row][col] = symbols[col][rowCount - 1 - row];
      }
    }
    self.currentSymbolData = rowMajor;
  } catch {
    self.currentSymbolData = symbols;
  }
  
  self.newSymbols = [];

  for (let col = 0; col < symbols.length; col++) {
    let rows: any[] = [];
    for (let row = 0; row < symbols[col].length; row++) {
      const x = startX + col * symbolTotalWidth + symbolTotalWidth * 0.5;
      const y = startY + row * symbolTotalHeight + symbolTotalHeight * 0.5;

      // Invert vertical order for display
      const value = symbols[col][symbols[col].length - 1 - row];
      const created = createSugarOrPngSymbol(self, value, x, y, 1);
      rows.push(created);
    }
    self.newSymbols.push(rows);
  }
}

async function dropReels(self: Symbols, data: Data): Promise<void> {
  self.reelDropInProgress = true;
  if (self.skipReelDropsPending) {
    self.skipReelDropsPending = false;
    self.skipReelDropsActive = true;
    self.skipDropModeForCurrentSpin = true;
    self.skipDropSoundTriggeredForCurrentReelDrop = true;
    self.applySkipVisualClearState();
  }
  // Remove init check since we're not using it anymore
  console.log('[Symbols] dropReels called with data:', data);
  console.log('[Symbols] SLOT_ROWS (config columns):', SLOT_ROWS);

  // Stagger reel starts at a fixed interval and let them overlap

  // Anticipation disabled: do not check columns for scatter, no reel extension
  const extendLastReelDrop = false;

  const reelPromises: Promise<void>[] = [];
  // Adjustable gap between clearing previous symbols and spawning new ones per row

  // Determine the actual number of visible rows from the current grid.
  // This ensures we clear/drop every row even if config/constants change.
  const numRows = (self.symbols && self.symbols[0] && self.symbols[0].length)
    ? self.symbols[0].length
    : SLOT_COLUMNS;
  const isTurbo = !!self.scene.gameData?.isTurbo;

  if (self.skipReelDropsActive || self.skipReelDropsPending) {
    self.markSkipDropStartNow();
    try { self.snapNewSymbolsGridToDropSpawn(); } catch {}
    await self.awaitPreSpinDropsSettled();
    const dropPromises: Promise<void>[] = [];

    // Defer the row-loop tween creation by yielding to Phaser's next tick via
    // delayedCall(0). This gives Phaser a clean frame boundary so every cell's
    // scene.tweens.chain(...) call inside the row loop lands in the same rendering
    // window. Combined with dropOneColumn falling through to the turbo tween (via
    // turboOverride=true bypassing the skip branch above), every cell gets:
    //   - delay: 0
    //   - Symbol{N}_SW_Drop Spine clip via playDropAnimationIfAvailable
    //   - Cubic.Out ease, no bounce
    // ...visually identical to turbo's drop, with no per-cell sync-buffer math and
    // no row lag regardless of device speed.
    await new Promise<void>((resolve) => {
      const fire = () => {
        try {
          for (let step = 0; step < numRows; step++) {
            const actualRow = (numRows - 1) - step;
            dropPromises.push(dropNewSymbols(self, actualRow, false, true));
          }
        } finally {
          resolve();
        }
      };
      if (self.scene?.time?.delayedCall) {
        self.scene.time.delayedCall(0, fire);
      } else {
        fire();
      }
    });

    try {
      await Promise.all(dropPromises);
      console.log('[Symbols] All reels have completed animation (skip fast path)');
    } finally {
      await self.awaitSkipReelDropRestart();
      self.clearSkipReelDrops();
      self.reelDropInProgress = false;
      self.preSpinDropRowPromises.clear();
    }

    if ((isTurbo || self.skipDropSoundTriggeredForCurrentReelDrop) && (window as any).audioManager) {
      try {
        (window as any).audioManager.playSoundEffect(SoundEffectType.TURBO_DROP);
      } catch (e) {
        console.warn('[Symbols] Failed to play turbo drop sound effect after skip reel completion:', e);
      }
    }
    return;
  }

  // Signal that the main loop is about to start iterating row-IIFEs. This is the gate
  // startSkipReelDropRestartIfPossible uses to decide whether a mid-flight skip click
  // should trigger the unified-restart pattern. Without this flag, the gate has no
  // reliable way to distinguish "dropReels is mid-iteration" from "dropReels just
  // entered and the fast path or some internal applySkipVisualClearState path is
  // running" — the previous __skipDropResolve-based gate was timing-fragile.
  self.dropReelsMainLoopStarted = true;

  // Reverse the sequence: start from bottom row to top row
  for (let step = 0; step < numRows; step++) {
    const actualRow = (numRows - 1) - step;
    const isLastReel = actualRow === 0;
    // In bonus mode, add a small pre-drop delay before any new symbols start falling.
    // Use winUpDuration so this delay is automatically affected by turbo settings.
    const bonusPreDropDelay =
      gameStateManager.isBonus
        ? (self.scene.gameData.winUpDuration * 2)
        : 0.5;
    // In turbo or manual skip mode, remove row-level stagger so all rows drop together,
    // but still honor the bonus pre-drop delay calculated above.
    const unifiedDropMode = shouldUseUnifiedDropMode(self);
    const startDelay =
      (bonusPreDropDelay * NEW_SYMBOL_DROP_DELAY_MULTIPLIER) +
      (unifiedDropMode ? 0 : self.scene.gameData.dropReelsDelay * NEW_SYMBOL_DROP_DELAY_MULTIPLIER * step);
    const p = (async () => {
      const pipelineGen = self.dropReelsRowPipelineGeneration;
      const abortRowPipeline = () =>
        self.isDropReelsRowPipelineStale(pipelineGen) ||
        self.skipReelDropRestartInProgress ||
        self.skipDropModeForCurrentSpin;
      const skipDelayMultiplier = (self.skipReelDropsActive || self.skipReelDropsPending) ? 0.2 : 1;
      await delayOrSkip(self, startDelay * skipDelayMultiplier);
      if (abortRowPipeline()) return;
      console.log(`[Symbols] Processing row ${actualRow}/${numRows - 1} (clear old + drop new symbols)`);
      const skipOldRowClear = self.preSpinDropAbortedBySkip;
      const preSpinRowDone = self.preSpinDropRowPromises.get(actualRow);
      if (preSpinRowDone) {
        try { await preSpinRowDone; } catch {}
      }
      if (abortRowPipeline()) return;
      try {
        if (!skipOldRowClear && !preSpinRowDone) {
          await dropPrevSymbols(self, actualRow, isLastReel && extendLastReelDrop, pipelineGen);
        }
      } catch (e) {
        console.warn('[Symbols] dropReels: failed to clear previous symbols for row', actualRow, e);
      }
      if (abortRowPipeline()) return;
      await dropNewSymbols(self, actualRow, isLastReel && extendLastReelDrop, undefined, pipelineGen);
    })();
    reelPromises.push(p);
  }
  console.log('[Symbols] Waiting for all reels to complete animation...');
  try {
    await Promise.all(reelPromises);
    console.log('[Symbols] All reels have completed animation');
  } finally {
    await self.awaitSkipReelDropRestart();
    self.clearSkipReelDrops();
    self.reelDropInProgress = false;
    self.dropReelsMainLoopStarted = false;
    self.preSpinDropRowPromises.clear();
  }

  // Turbo mode: play turbo drop sound effect once when all new symbols have finished dropping
  if (isTurbo && (window as any).audioManager) {
    try {
      (window as any).audioManager.playSoundEffect(SoundEffectType.TURBO_DROP);
      console.log('[Symbols] Playing turbo drop sound effect after all reels have completed (turbo mode)');
    } catch (e) {
      console.warn('[Symbols] Failed to play turbo drop sound effect after reel completion:', e);
    }
  }
}

function dropPrevSymbols(
  self: Symbols,
  index: number,
  extendDuration: boolean = false,
  pipelineGeneration?: number,
): Promise<void> {
  return new Promise<void>((resolve) => {
  let resolved = false;
  const resolveOnce = () => {
    if (resolved) return;
    resolved = true;
    cleanupDroppedOldSymbolRow(self, index);
    resolve();
  };

  const pipelineStale = () =>
    typeof pipelineGeneration === 'number' && self.isDropReelsRowPipelineStale(pipelineGeneration);
  const skipTakeover = () =>
    self.skipReelDropsActive ||
    self.skipReelDropsPending ||
    self.skipDropModeForCurrentSpin ||
    self.skipReelDropRestartInProgress ||
    pipelineStale();

  if (skipTakeover()) {
    try { self.clearOldSymbolsRowForSkip(index); } catch {}
    resolveOnce();
    return;
  }

  if (self.symbols === undefined || self.symbols === null) {
    resolveOnce();
    return;
  }
  
  // Check if symbols array has valid structure
  if (!self.symbols[0] || !self.symbols[0][0]) {
    console.warn('[Symbols] dropPrevSymbols: symbols array structure is invalid, skipping');
    resolveOnce();
    return;
  }

  const height = self.symbols[0][0].displayHeight + self.verticalSpacing;
  const extraMs = extendDuration ? 3000 : 0;
  // Drop previous symbols far enough to be fully off-screen regardless of starting row
  const gridBottomY = self.slotY + self.totalGridHeight * 0.5;
  const distanceToScreenBottom = Math.max(0, self.scene.scale.height - gridBottomY);
  const DROP_DISTANCE = distanceToScreenBottom + self.totalGridHeight + (height * 2) + self.scene.gameData.winUpHeight;
  const totalAnimations = self.symbols.reduce((count, col) => {
    return (col && col[index]) ? count + 1 : count;
  }, 0);
  if (totalAnimations === 0) {
    resolveOnce();
    return;
  }
  let completedAnimations = 0;
  let settled = false;
  const abortForSkip = () => {
    if (settled) return;
    settled = true;
    self.skipOldDropAbortResolvers.delete(abortForSkip);
    resolveOnce();
  };
  self.skipOldDropAbortResolvers.add(abortForSkip);

  const STAGGER_MS = 50; // match dropNewSymbols stagger (left-to-right, one by one feel)
  const clearHop = self.scene.gameData.winUpHeight * 0.2;
  const isSkipping = self.skipReelDropsActive || self.skipReelDropsPending;
  const durationMultiplier = isSkipping
    ? SKIP_UNIFIED_DROP_DURATION_MULTIPLIER
    : PRE_SPIN_DROP_DURATION_MULTIPLIER;

  for (let i = 0; i < self.symbols.length; i++) {
    if (skipTakeover()) {
      try { self.clearOldSymbolsRowForSkip(index); } catch {}
      resolveOnce();
      return;
    }
    // Check if the current row exists and has the required index
    if (!self.symbols[i] || !self.symbols[i][index]) {
      console.warn(`[Symbols] dropPrevSymbols: skipping invalid row ${i} or index ${index}`);
      continue;
    }
    
    const baseObj: any = self.symbols[i][index];
    if (self.newSymbols?.[i]?.[index] === baseObj) {
      console.warn(`[Symbols] dropPrevSymbols: symbols grid shares ref with newSymbols, skipping cell col=${i} row=${index}`);
      continue;
    }
    prepareSymbolForPrevDrop(self, baseObj);

    // Trigger drop animation on the symbol if available (sugar Spine)
    try { playDropAnimationIfAvailable(baseObj); } catch {}

    const overlayObj: any = (baseObj as any)?.__overlayImage;
    const tweenTargets: any = getSymbolTweenTargets(baseObj);
    const unifiedDropMode = shouldUseUnifiedDropMode(self);
    const tweens: any[] = [
      {
        // In turbo or manual skip mode, drop all symbols at the same time (no per-column stagger)
        delay: unifiedDropMode ? 0 : STAGGER_MS * i,
        y: `-= ${clearHop}`,
        duration: self.scene.gameData.winUpDuration * durationMultiplier,
        ease: Phaser.Math.Easing.Circular.Out,
      },
      {
        y: `+= ${DROP_DISTANCE}`,
        duration: ((self.scene.gameData.dropDuration * 0.9) + extraMs) * durationMultiplier,
        ease: Phaser.Math.Easing.Linear,
      },
    ];

    // In turbo or manual skip mode, skip post-drop bounce tweens to keep drops snappy
    if (!unifiedDropMode) {
      tweens.push(
        {
          y: `+= ${5}`,
          duration: self.scene.gameData.dropDuration * 0.05 * durationMultiplier,
          ease: Phaser.Math.Easing.Linear,
        },
        {
          y: `-= ${5}`,
          duration: self.scene.gameData.dropDuration * 0.05 * durationMultiplier,
          ease: Phaser.Math.Easing.Linear,
        },
      );
    }

    const last = tweens[tweens.length - 1];
    const prevOnComplete = last.onComplete;
    last.onComplete = () => {
      try { if (prevOnComplete) prevOnComplete(); } catch {}
      if (settled) return;
      completedAnimations++;
      if (completedAnimations >= totalAnimations) {
        settled = true;
        self.skipOldDropAbortResolvers.delete(abortForSkip);
        resolveOnce();
      }
    };

    self.scene.tweens.chain({
      targets: tweenTargets,
      tweens,
    });
  }

  // Safety net: avoid hanging a row forever if a tween target is destroyed mid-chain.
  const unifiedDropMode = shouldUseUnifiedDropMode(self);
  const maxStartDelay = unifiedDropMode ? 0 : STAGGER_MS * Math.max(0, totalAnimations - 1);
  const settleMs = (self.scene.gameData.winUpDuration + ((self.scene.gameData.dropDuration * 0.9) + extraMs)) * durationMultiplier;
  const bounceMs = unifiedDropMode ? 0 : (self.scene.gameData.dropDuration * 0.1 * durationMultiplier);
  const fallbackMs = Math.max(80, Math.round((maxStartDelay + settleMs + bounceMs) * 1.5));
  self.scene.time.delayedCall(fallbackMs, abortForSkip);
  });
}

function dropFillers(self: Symbols, index: number, extendDuration: boolean = false) {
  // Check if symbols array has valid structure
  if (!self.symbols || !self.symbols[0] || !self.symbols[0][0]) {
    console.warn('[Symbols] dropFillers: symbols array structure is invalid, skipping');
    return;
  }
  
  const height = self.symbols[0][0].displayHeight + self.verticalSpacing;
  const baseTotal = Symbols.FILLER_COUNT + SLOT_COLUMNS;
  const baseDropDistance = baseTotal * height + GameData.WIN_UP_HEIGHT;
  const extraMs = extendDuration ? 3000 : 0;
  const baseDropMs = self.scene.gameData.dropDuration * 0.9;
  const extraPixels = extraMs > 0 && baseDropMs > 0 ? (baseDropDistance * (extraMs / baseDropMs)) : 0;
  const extraRows = extraPixels > 0 ? Math.ceil(extraPixels / height) : 0;
  const TOTAL_ITEMS = Symbols.FILLER_COUNT + SLOT_COLUMNS + extraRows;
  const DROP_DISTANCE = TOTAL_ITEMS * height + GameData.WIN_UP_HEIGHT;
  const fillerSymbols: GameObjects.Sprite[] = [];
  for (let i = 0; i < TOTAL_ITEMS - SLOT_COLUMNS; i++) {

    const symbolTotalWidth = self.displayWidth + self.horizontalSpacing;
    const startX = self.slotX - self.totalGridWidth * 0.5;

    const START_INDEX_Y = -(TOTAL_ITEMS - SLOT_COLUMNS);
    const x = startX + index * symbolTotalWidth + symbolTotalWidth * 0.5;
    const y = getYPos(self, i + START_INDEX_Y)


    const value = Math.floor(Math.random() * Data.ALL_SYMBOLS.length);
    const created = createSugarOrPngSymbol(self, value, x, y, 1);
    fillerSymbols.push(created);
  }

  for (let i = 0; i < fillerSymbols.length; i++) {
    const baseObj: any = fillerSymbols[i] as any;
    const overlayObj: any = (baseObj as any)?.__overlayImage;
    const tweenTargets: any = overlayObj ? [baseObj, overlayObj] : baseObj;
    const isTurbo = !!self.scene.gameData?.isTurbo;
    const tweens: any[] = [
      {
        y: `-= ${self.scene.gameData.winUpHeight}`,
        duration: self.scene.gameData.winUpDuration,
        ease: Phaser.Math.Easing.Circular.Out,
      },
      {
        y: `+= ${DROP_DISTANCE}`,
        duration: (self.scene.gameData.dropDuration * 0.9) + extraMs,
        ease: Phaser.Math.Easing.Linear,
      },
    ];

    // In turbo mode, skip the large post-drop bounce on filler symbols
    if (!isTurbo) {
      tweens.push(
        {
          y: `+= ${40}`,
          duration: self.scene.gameData.dropDuration * 0.05,
          ease: Phaser.Math.Easing.Linear,
        },
        {
          y: `-= ${40}`,
          duration: self.scene.gameData.dropDuration * 0.05,
          ease: Phaser.Math.Easing.Linear,
          onComplete: () => {
            self.symbolPool.release(baseObj);
          }
        },
      );
    } else {
      // Still clean up the filler symbol when the main drop completes
      const last = tweens[tweens.length - 1];
      const prevOnComplete = last.onComplete;
      last.onComplete = () => {
        try { if (prevOnComplete) prevOnComplete(); } catch {}
        self.symbolPool.release(baseObj);
      };
    }

    self.scene.tweens.chain({
      targets: tweenTargets,
      tweens,
    })

  }
}

function dropNewSymbols(
  self: Symbols,
  index: number,
  extendDuration: boolean = false,
  turboOverride?: boolean,
  pipelineGeneration?: number,
): Promise<void> {
  return new Promise<void>((resolve) => {
    let resolved = false;
    const resolveOnce = () => {
      if (resolved) return;
      resolved = true;
      resolve();
    };

    const pipelineStale = () =>
      typeof pipelineGeneration === 'number' && self.isDropReelsRowPipelineStale(pipelineGeneration);
    if (
      turboOverride !== true &&
      (pipelineStale() ||
        self.skipReelDropRestartInProgress ||
        self.skipDropModeForCurrentSpin)
    ) {
      resolveOnce();
      return;
    }

    const newCols = self.newSymbols;
    if (
      !Array.isArray(newCols) ||
      newCols.length === 0 ||
      !Array.isArray(newCols[0]) ||
      newCols[0].length === 0
    ) {
      console.warn('[Symbols] dropNewSymbols: newSymbols grid is not ready, resolving immediately');
      resolveOnce();
      return;
    }
    
    const extraMs = extendDuration ? 3000 : 0;

    const totalAnimations = self.newSymbols.reduce((count, col) => {
      return (col && col[index]) ? count + 1 : count;
    }, 0);
    if (totalAnimations === 0) {
      resolveOnce();
      return;
    }
    const STAGGER_MS = Math.max(40, Math.round(100 * NEW_SYMBOL_DROP_DELAY_MULTIPLIER)); // slight delay between symbols within a column
    const symbolHop = self.scene.gameData.winUpHeight * 0.5;
    const isSkipping = self.skipReelDropsActive || self.skipReelDropsPending;
    const durationMultiplier = isSkipping
      ? SKIP_UNIFIED_DROP_DURATION_MULTIPLIER
      : NEW_SYMBOL_DROP_DURATION_MULTIPLIER;

    const dropOneColumn = (col: number): Promise<void> => {
      return new Promise<void>((colResolve) => {
        const symbolRef: any = self.newSymbols?.[col]?.[index];
        let settled = false;
        const settle = () => {
          if (settled) return;
          settled = true;
          try {
            if (symbolRef) {
              if (symbolRef.__skipDropResolve === settle) {
                symbolRef.__skipDropResolve = null;
              }
              // Mark the cell as having reached its final grid position so that
              // killAndCatchUpAllNewSymbolsForRestart can skip it rather than
              // re-tweening an already-settled symbol.
              symbolRef.__hasSettled = true;
            }
          } catch {}
          colResolve();
        };
        self.symbolPool.onRelease(symbolRef, settle);

        try {
          // If the skip-restart re-invokes dropNewSymbols (turboOverride=true) for a cell
          // that already finished its original drop and settled at the final grid position,
          // there is nothing to do — leave the symbol where it is and resolve immediately.
          if (turboOverride === true) {
            const earlyRef: any = self.newSymbols?.[col]?.[index];
            if (earlyRef && (earlyRef as any).__hasSettled === true) {
              settle();
              return;
            }
          }

          // Mid-flight skip: catch-up tween from current Y (no off-screen snap).
          // Fast path uses turboOverride=true and the regular turbo tween below.
          if (turboOverride !== true && (self.skipReelDropsActive || self.skipReelDropsPending)) {
            const symbolRefSkip: any = self.newSymbols?.[col]?.[index];
            if (symbolRefSkip && (symbolRefSkip as any).__hasSettled === true) {
              settle();
              return;
            }
            if (symbolRefSkip) {
              try {
                const overlaySkip: any = symbolRefSkip.__overlayImage;
                if (overlaySkip) self.scene.tweens.killTweensOf(overlaySkip);
                self.scene.tweens.killTweensOf(symbolRefSkip);
              } catch {}
              try { symbolRefSkip.__skipDropResolve = settle; } catch {}
              self.startCatchUpDropForNewSymbolCellPublic(col, index, settle);
            } else {
              settle();
            }
            return;
          }

          const symbol = self.newSymbols[col][index];
          const targetY = getYPos(self, index);
          
          try { playDropAnimationIfAvailable(symbol); } catch {}

          const baseObj: any = symbol as any;
          const overlayObj: any = (baseObj as any)?.__overlayImage;
          const tweenTargets: any = overlayObj ? [baseObj, overlayObj] : baseObj;
          try { (baseObj as any).__skipDropResolve = settle; } catch {}

          const turboNow = typeof turboOverride === 'boolean'
            ? turboOverride
            : shouldUseUnifiedDropMode(self);
          const tweens: any[] = [
            {
              delay: 0,
              y: `-= ${symbolHop}`,
              duration: self.scene.gameData.winUpDuration * durationMultiplier,
              ease: Phaser.Math.Easing.Circular.Out,
            },
            {
              y: targetY,
              duration: ((self.scene.gameData.dropDuration * 0.9) + extraMs) * durationMultiplier,
              ease: turboNow ? Phaser.Math.Easing.Cubic.Out : Phaser.Math.Easing.Linear,
            },
          ];

          if (!turboNow) {
            tweens.push(
              {
                y: `+= ${10}`,
                duration: self.scene.gameData.dropDuration * 0.05 * durationMultiplier,
                ease: Phaser.Math.Easing.Linear,
              },
              {
                y: `-= ${10}`,
                duration: self.scene.gameData.dropDuration * 0.05 * durationMultiplier,
                ease: Phaser.Math.Easing.Linear,
                onComplete: () => {
                  if (!self.scene.gameData.isTurbo && (window as any).audioManager) {
                    (window as any).audioManager.playSoundEffect(SoundEffectType.REEL_DROP);
                    console.log(`[Symbols] Playing reel drop sound effect for reel ${index} after drop completion`);
                  }
                  settle();
                },
              },
            );
          } else {
            const last = tweens[tweens.length - 1];
            const prevOnComplete = last.onComplete;
            last.onComplete = () => {
              try { if (prevOnComplete) prevOnComplete(); } catch {}
              settle();
            };
          }

          self.scene.tweens.chain({
            targets: tweenTargets,
            tweens,
          });
        } catch {
          settle();
        }
      });
    };

    (async () => {
      if (pipelineStale()) {
        resolveOnce();
        return;
      }
      const isSkip = self.skipReelDropsActive || self.skipReelDropsPending;
      const turboNow = typeof turboOverride === 'boolean'
        ? turboOverride
        : (shouldUseUnifiedDropMode(self) || isSkip);
      const promises: Promise<void>[] = [];

      if (turboNow || isSkip) {
        for (let col = 0; col < self.newSymbols.length; col++) {
          promises.push(dropOneColumn(col));
        }
      } else {
        for (let col = 0; col < self.newSymbols.length; col++) {
          if (col > 0) {
            await delayOrSkip(self, Math.max(0, STAGGER_MS));
          }
          // If a mid-flight skip just kicked off the unified restart, do NOT push any
          // more dropOneColumn promises here. The restart owns the new tween schedule
          // for every cell from this point on; pushing more dropOneColumns (which fall
          // into the per-cell skip branch and create fast-drop tweens) would race the
          // restart's turbo tweens for the same cells and produce a visible "second
          // drop" on the late-stagger columns.
          if (self.skipReelDropRestartInProgress) {
            break;
          }
          if (
            self.skipReelDropsActive ||
            self.skipReelDropsPending ||
            !!self.scene.gameData?.isTurbo
          ) {
            for (let c = col; c < self.newSymbols.length; c++) {
              promises.push(dropOneColumn(c));
            }
            break;
          }
          promises.push(dropOneColumn(col));
        }
      }
      await Promise.allSettled(promises);
      resolveOnce();
    })();
  });
}


function disposeSymbols(self: Symbols, symbols: any[][]) {
  console.log('[Symbols] Disposing old symbols...');
  let disposedCount = 0;
  
  for (let col = 0; col < symbols.length; col++) {
    for (let row = 0; row < symbols[col].length; row++) {
      const symbol = symbols[col][row];
      if (symbol && symbol.destroy && !symbol.destroyed) {
        try {
          const symbolType = symbol.animationState ? 'Spine' : 'PNG';
          const symbolKey = symbol.texture?.key || 'unknown';
          self.symbolPool.release(symbol);
          disposedCount++;
        } catch (error) {
          console.error(`[Symbols] Error disposing symbol at (${col}, ${row}):`, error);
        }
      }
    }
  }
  
  console.log(`[Symbols] Disposed ${disposedCount} symbols`);
}


function playDropAnimationIfAvailable(obj: any): void {
  try {
    const val = (obj as any)?.symbolValue;
    const canSpine = !!(obj?.animationState && obj.animationState.setAnimation);
    if (typeof val === 'number' && val >= 0 && val <= 9 && canSpine) {
      const drop = `Symbol${val}_SW_Drop`;
      try {
        const hasDrop = !!(obj as any)?.skeleton?.data?.findAnimation?.(drop);
        if (hasDrop) {
          obj.animationState.setAnimation(0, drop, false);
        }
      } catch {}
    }
  } catch {}
}

const SKIP_DESPAWN_VFX_COUNT = 0;

function pickRandomSymbolsForSkipDespawnVfx(grid: any[][], maxCount: number): any[] {
  const live: any[] = [];
  for (const column of grid) {
    if (!Array.isArray(column)) continue;
    for (const obj of column) {
      const symbolValue = Number((obj as any)?.symbolValue);
      if (
        obj &&
        !(obj as any).destroyed &&
        Number.isFinite(symbolValue) &&
        symbolValue >= 1 &&
        symbolValue <= 9
      ) {
        live.push(obj);
      }
    }
  }

  const cap = Math.max(0, Math.floor(Number(maxCount) || 0));
  if (cap <= 0 || live.length === 0) return [];
  if (live.length <= cap) return live;

  for (let i = live.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = live[i];
    live[i] = live[j];
    live[j] = tmp;
  }
  return live.slice(0, cap);
}

function isSkipDropModeActive(self: Symbols): boolean {
  return !!(self.skipDropModeForCurrentSpin || self.skipReelDropsActive || self.skipReelDropsPending);
}

function shouldUseUnifiedDropMode(self: Symbols): boolean {
  return !!self.scene.gameData?.isTurbo || isSkipDropModeActive(self);
}

function getSpinSkipTurboDurationMultiplier(self: Symbols): number {
  if (self.scene.gameData?.isTurbo) return 1;
  return isSkipDropModeActive(self) ? SKIP_UNIFIED_DROP_DURATION_MULTIPLIER : 1;
}

function getTumbleSkipTurboDurationMultiplier(self: Symbols): number {
  if (self.scene.gameData?.isTurbo) return 1;
  return isSkipDropModeActive(self) ? TurboConfig.TURBO_SPEED_MULTIPLIER : 1;
}

function reevaluateWinsFromGrid(self: Symbols): void {
  try {
    // Build Data with current row-major symbols
    const dt = new Data();
    // Ensure currentSymbolData is populated; if not, derive from self.symbols
    if (!self.currentSymbolData) {
      const numCols = self.symbols?.length || 0;
      const numRows = numCols > 0 ? (self.symbols[0]?.length || 0) : 0;
      const rowMajor: number[][] = [];
      for (let row = 0; row < numRows; row++) {
        rowMajor[row] = [];
        for (let col = 0; col < numCols; col++) {
          // Attempt to read a value property stored during drops; fallback to 0
          try {
            const obj: any = self.symbols[col][row];
            const val = self.currentSymbolData?.[row]?.[col];
            rowMajor[row][col] = typeof val === 'number' ? val : (obj?.symbolValue ?? 0);
          } catch {
            rowMajor[row][col] = 0;
          }
        }
      }
      dt.symbols = rowMajor;
    } else {
      dt.symbols = self.currentSymbolData;
    }

    // Compute wins using SymbolDetector
    const wins = self.symbolDetector.getWins(dt);
    dt.wins = wins;
    const totalWinningCells = Array.from(wins.allMatching.values()).reduce((s, arr) => s + arr.length, 0);
    console.log('[Symbols] Re-evaluated wins after drop:', { patterns: wins.allMatching.size, totalWinningCells });

    // Apply highlighting only if not disabled
    if (!(Symbols as any).WINLINE_CHECKING_DISABLED) {
      replaceWithSpineAnimations(self, dt);
    }
  } catch (e) {
    console.warn('[Symbols] Failed to re-evaluate wins from current grid:', e);
  }
}

function getYPos(self: Symbols, index: number) {
  const symbolTotalHeight = self.displayHeight + self.verticalSpacing;
  const startY = self.slotY - self.totalGridHeight * 0.5;

  return startY + index * symbolTotalHeight + symbolTotalHeight * 0.5;
}


/**
 * Apply a sequence of tumble steps: remove "out" symbols, compress columns down, and drop "in" symbols from top.
 * Expects tumbles to be in the SpinData format: [{ symbols: { in: number[][], out: {symbol:number,count:number,win:number}[] }, win: number }, ...]
 */
/**
 * Max-win tumble/multiplier cap: trigger spin slot.totalWin (buy feature), not freeSpin.totalWin.
 */
function resolveMaxWinCapTotal(self: Symbols, spinData: any): number {
  try {
    const gameAPI = (self.scene as any)?.slotController?.gameAPI;
    if (typeof gameAPI?.getMaxWinCapTotal === 'function') {
      const fromTrigger = gameAPI.getMaxWinCapTotal();
      if (fromTrigger > 0) return fromTrigger;
    }
  } catch {}
  const slotTotal = Number(spinData?.slot?.totalWin ?? 0);
  return Number.isFinite(slotTotal) && slotTotal > 0 ? slotTotal : 0;
}

async function applyTumbles(
  self: Symbols,
  tumbles: any[],
  options?: { isMaxWinItem?: boolean; maxWinCapTotal?: number },
): Promise<void> {
  self.tumbleInProgress = true;
  self.endReelDropSkipWindow();
  self.clearSkipReelDrops();
  self.clearSkipTumbles();
  let cumulativeWin = 0;
  let tumbleIndex = 0;
  const isMaxWinItem = !!options?.isMaxWinItem;
  const maxWinCapTotalRaw = Number(options?.maxWinCapTotal);
  const hasMaxWinCap =
    isMaxWinItem &&
    Number.isFinite(maxWinCapTotalRaw) &&
    maxWinCapTotalRaw >= 0;
  const maxWinCapTotal = hasMaxWinCap ? maxWinCapTotalRaw : 0;
  const CAP_EPSILON = 0.000001;
  // Stop at the SESSION cap so a tumble that crosses slot.totalWin on a later free spin still stops
  // here. BonusHeader only folds a spin's win into its cumulative at TUMBLE_SEQUENCE_DONE/WIN_STOP,
  // so during THIS spin's tumbles its cumulative reflects only PRIOR spins — snapshot that as the
  // baseline and add this spin's running sum on top.
  const bonusHeaderForCap = (self.scene as any)?.bonusHeader;
  const priorSessionWin = hasMaxWinCap
    ? Number(bonusHeaderForCap?.getCumulativeBonusWin?.() ?? 0)
    : 0;
  const sessionTotalSoFar = (): number => priorSessionWin + cumulativeWin;
  try {
    for (const tumble of tumbles) {
      if (self.skipTumblesActive) break;
      if (hasMaxWinCap && sessionTotalSoFar() >= maxWinCapTotal - CAP_EPSILON) {
        break;
      }

      tumbleIndex++;
      let rawTumbleWin = 0;
      try {
        const w = Number((tumble as any)?.win ?? 0);
        if (!isNaN(w) && w > 0) {
          rawTumbleWin = w;
        } else {
          const outsArr = Array.isArray((tumble as any)?.symbols?.out)
            ? (tumble as any).symbols.out as Array<{ win?: number }>
            : [];
          rawTumbleWin = outsArr.reduce((s, o) => s + (Number(o?.win) || 0), 0);
        }
      } catch {}

      const maxAllowedTumbleWin = hasMaxWinCap
        ? Math.max(0, maxWinCapTotal - sessionTotalSoFar())
        : rawTumbleWin;
      const effectiveTumbleWin = hasMaxWinCap
        ? Math.max(0, Math.min(rawTumbleWin, maxAllowedTumbleWin))
        : rawTumbleWin;

      if (hasMaxWinCap && maxAllowedTumbleWin <= 0) {
        break;
      }

      // When this tumble is clamped by the cap, scale every per-symbol win readout (WinTracker rows
      // + floating win text) by the same factor so nothing displays beyond slot.totalWin.
      const maxWinScale =
        hasMaxWinCap && rawTumbleWin > 0 ? Math.min(1, effectiveTumbleWin / rawTumbleWin) : 1;

      const currentTumbleIndex = tumbleIndex;
      await applySingleTumble(self, tumble, currentTumbleIndex, () => {
        try {
          let progressWin = effectiveTumbleWin;
          cumulativeWin += progressWin;
          if (hasMaxWinCap && sessionTotalSoFar() > maxWinCapTotal) {
            cumulativeWin = Math.max(0, maxWinCapTotal - priorSessionWin);
          }
          if (progressWin > 0 || cumulativeWin > 0) {
            gameEventManager.emit(GameEventType.TUMBLE_WIN_PROGRESS, {
              tumbleWin: progressWin,
              cumulativeWin,
            } as any);
          }
        } catch {}
        try {
          const am = (window as any)?.audioManager;
          if (am && typeof am.playSymbolWinByTumble === 'function') {
            console.log(`[Symbols] Calling playSymbolWinByTumble with tumble index: ${currentTumbleIndex}`);
            am.playSymbolWinByTumble(currentTumbleIndex);
          }
        } catch {}
      }, maxWinScale);

      if (self.skipTumblesActive) break;
      if (hasMaxWinCap && sessionTotalSoFar() >= maxWinCapTotal - CAP_EPSILON) {
        try { bonusHeaderForCap?.snapMaxWinCapDisplays?.(self.currentSpinData); } catch {}
        break;
      }
    }
    try {
      gameEventManager.emit(GameEventType.TUMBLE_SEQUENCE_DONE, { totalWin: cumulativeWin } as any);
    } catch {}
  } finally {
    self.tumbleInProgress = false;
    self.clearSkipTumbles();
  }
}

async function applySingleTumble(self: Symbols, tumble: any, tumbleIndex: number, onFirstWinComplete?: (tumbleTotal: number) => void, maxWinScale: number = 1): Promise<void> {
  if (self.skipTumblesActive) return;

  // < 1 when a MaxWin cap clamped this tumble; scale per-symbol win readouts to match the winbar.
  const winScale = Number.isFinite(maxWinScale) && maxWinScale > 0 && maxWinScale < 1 ? maxWinScale : 1;
  const outs = (tumble?.symbols?.out || []) as Array<{ symbol: number; count: number }>;
  const ins = (tumble?.symbols?.in || []) as number[][]; // per real column (x index)

  // If this tumble removes any symbols, it represents a win event during this item
  try {
    const anyRemoval = Array.isArray(outs) && outs.some(o => (Number(o?.count) || 0) > 0);
    if (anyRemoval) { (self as any).hadWinsInCurrentItem = true; }
  } catch {}

  if (!self.symbols || !self.symbols.length || !self.symbols[0] || !self.symbols[0].length) {
    console.warn('[Symbols] applySingleTumble: Symbols grid not initialized');
    return;
  }

  // Grid orientation: self.symbols[col][row]
  const numCols = self.symbols.length;
  const numRows = self.symbols[0].length;

  // Match manual drop timings and staggering for visual consistency
  const MANUAL_STAGGER_MS: number = (self.scene?.gameData?.tumbleStaggerMs ?? 100);

  // Debug: log incoming tumble payload
  try {
    const totalOutRequested = outs.reduce((s, o) => s + (Number(o?.count) || 0), 0);
    const totalInProvided = (Array.isArray(ins) ? ins.flat().length : 0);
    console.log('[Symbols] Tumble payload:', {
      outs,
      insColumns: Array.isArray(ins) ? ins.map((col, idx) => ({ col: idx, count: Array.isArray(col) ? col.length : 0 })) : [],
      totals: { totalOutRequested, totalInProvided }
    });
  } catch {}

  // Build a removal mask per cell
  // removeMask[col][row]
  const removeMask: boolean[][] = Array.from({ length: numCols }, () => Array<boolean>(numRows).fill(false));

  // Identify symbols that meet the high-count threshold (>=8)
  const highCountSymbols = new Set<number>();
  for (const out of outs) {
    const c = Number(out?.count || 0);
    const s = Number(out?.symbol);
    if (!isNaN(c) && !isNaN(s) && c >= 8) {
      highCountSymbols.add(s);
    }
  }

  // Build position indices by symbol (topmost-first per column)
  const positionsBySymbol: { [key: number]: Array<{ col: number; row: number }> } = {};
  let sequenceIndex = 0; // ensures 1-by-1 ordering across columns left-to-right
  for (let col = 0; col < numCols; col++) {
    for (let row = 0; row < numRows; row++) {
      const val = self.currentSymbolData?.[row]?.[col];
      if (typeof val !== 'number') continue;
      if (!positionsBySymbol[val]) positionsBySymbol[val] = [];
      positionsBySymbol[val].push({ col, row });
    }
  }
  // Sort each symbol's positions top-to-bottom (row asc), then left-to-right (col asc)
  Object.keys(positionsBySymbol).forEach(k => {
    positionsBySymbol[Number(k)].sort((a, b) => a.row - b.row || a.col - b.col);
  });

  // Determine per-column incoming counts
  const insCountByCol: number[] = Array.from({ length: numCols }, (_, c) => (Array.isArray(ins?.[c]) ? ins[c].length : 0));
  let targetRemovalsPerCol: number[] = insCountByCol.slice();

  // Helper to pick and mark a position for a symbol in a preferred column
  function pickAndMark(symbol: number, preferredCol: number | null): boolean {
    const list = positionsBySymbol[symbol] || [];
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (removeMask[p.col][p.row]) continue; // already marked
      if (preferredCol !== null && p.col !== preferredCol) continue;
      removeMask[p.col][p.row] = true;
      // Remove from list for efficiency
      list.splice(i, 1);
      return true;
    }
    return false;
  }

  // First pass: satisfy per-column targets using outs composition
  for (const out of outs) {
    let remaining = Number(out?.count || 0);
    const targetSymbol = Number(out?.symbol);
    if (isNaN(remaining) || isNaN(targetSymbol) || remaining <= 0) continue;
    // Try to allocate removals in columns that expect incoming symbols first
    while (remaining > 0) {
      let allocated = false;
      for (let col = 0; col < numCols && remaining > 0; col++) {
        if (targetRemovalsPerCol[col] <= 0) continue;
        if (pickAndMark(targetSymbol, col)) {
          targetRemovalsPerCol[col]--;
          remaining--;
          allocated = true;
        }
      }
      if (!allocated) break; // proceed to second pass
    }
    // Second pass: allocate any remainder anywhere
    while (remaining > 0) {
      if (pickAndMark(targetSymbol, null)) {
        remaining--;
      } else {
        console.warn('[Symbols] Not enough matching symbols in grid to satisfy tumble outs for symbol', targetSymbol);
        break;
      }
    }
  }

  // Debug: per-column removal vs incoming
  try {
    const removedPerCol: number[] = Array.from({ length: numCols }, () => 0);
    for (let col = 0; col < numCols; col++) {
      for (let row = 0; row < numRows; row++) {
        if (removeMask[col][row]) removedPerCol[col]++;
      }
    }
    console.log('[Symbols] Tumble per-column removal vs incoming:', removedPerCol.map((r, c) => ({ col: c, removed: r, incoming: insCountByCol[c] })));
  } catch {}

  // Debug: report which cells are marked for removal per symbol
  try {
    const removedBySymbol: { [key: number]: Array<{ col: number; row: number }> } = {};
    let totalRemoved = 0;
    for (let col = 0; col < numCols; col++) {
      for (let row = 0; row < numRows; row++) {
        if (removeMask[col][row]) {
          const val = self.currentSymbolData?.[row]?.[col];
          const key = typeof val === 'number' ? val : -1;
          if (!removedBySymbol[key]) removedBySymbol[key] = [];
          removedBySymbol[key].push({ col, row });
          totalRemoved++;
        }
      }
    }
    console.log('[Symbols] Tumble removal mask summary:', { totalRemoved, removedBySymbol });
  } catch {}

  // Attach ONE win text per winning symbol value, prioritizing columns 2–5 (1–4 zero-based)
  try {
    // Build removal positions by symbol value
    const positionsForSymbol: { [key: number]: Array<{ col: number; row: number }> } = {};
    for (let col = 0; col < numCols; col++) {
      for (let row = 0; row < numRows; row++) {
        if (!removeMask[col][row]) continue;
        const val = self.currentSymbolData?.[row]?.[col];
        if (typeof val !== 'number') continue;
        if (!positionsForSymbol[val]) positionsForSymbol[val] = [];
        positionsForSymbol[val].push({ col, row });
      }
    }
    // Map of per-symbol win amount from outs (scaled to the MaxWin cap remainder when clamped)
    const winBySymbol: { [key: number]: number } = {};
    for (const out of outs as any[]) {
      const s = Number((out as any)?.symbol);
      const w = Number((out as any)?.win);
      if (!isNaN(s) && !isNaN(w) && w > 0) winBySymbol[s] = w * winScale;
    }
    const tumbleWin = Number((tumble as any)?.win || 0) * winScale;
    // Choose one position per winning symbol and display text
    let winTrackerShown = false;
    for (const keyStr of Object.keys(positionsForSymbol)) {
      const sym = Number(keyStr);
      const list = positionsForSymbol[sym] || [];
      if (!list.length) continue;
      // Prioritize columns 1..4 (2–5 human)
      const priority = list.filter(p => p.col >= 1 && p.col <= 4);
      const pool = priority.length ? priority : list;
      const pick = pool[Math.floor(Math.random() * pool.length)];
      const obj = self.symbols[pick.col][pick.row];
      if (!obj) continue;
      const amount = (winBySymbol[sym] !== undefined) ? winBySymbol[sym] : (tumbleWin > 0 ? tumbleWin : 0);
      if (amount <= 0) continue;
      // Remove any previous win text on this symbol
      try {
        const prev: any = (obj as any).__winText;
        if (prev && prev.destroy && !prev.destroyed) prev.destroy();
      } catch {}
      // Delay win text to appear ~0.8s after the win animation is triggered
      const baseX = obj.x;
      const baseY = obj.y;
      const isCurrentSymbol = self.symbolPool.currentUse(obj);
      self.scene.time.delayedCall(800, () => {
        // If scene or container is gone, skip
        try {
          if (!self || !self.scene || !self.container) return;
        } catch { return; }
        // Show WinTracker once at the same moment win text appears
        try {
          if (!winTrackerShown) {
            winTrackerShown = true;
            const wt = (self.scene as any)?.winTracker;
            if (wt) {
              // Announce win start for coins/listeners — only while this spin is still resolving.
              // Tumble win text is delayed 800ms; WIN_STOP may have already fired by then.
              const spinStillResolving =
                !!gameStateManager.isReelSpinning ||
                !!self.tumbleInProgress ||
                !!(gameStateManager as any).isProcessingSpin;
              if (spinStillResolving) {
                try { gameEventManager.emit(GameEventType.WIN_START); } catch {}
              }
              // Show only the current tumble's wins (scaled to the cap remainder when clamped)
              try {
                const rawOutsArr = Array.isArray((tumble as any)?.symbols?.out) ? (tumble as any).symbols.out : [];
                const outsArr = winScale < 1
                  ? rawOutsArr.map((o: any) => ({ ...o, win: (Number(o?.win) || 0) * winScale }))
                  : rawOutsArr;
                wt.showForTumble(outsArr, self.currentSpinData || null);
              } catch {
                wt.updateFromSpinData(self.currentSpinData || null);
                wt.showLatest();
              }
              // Do not auto-hide WinTracker here; it will persist until a new spin starts,
              // at which point the Game scene explicitly clears it.
            }
          }
        } catch {}
        // Create and place text
        const txt = createWinText(self, amount, baseX, baseY);
        try { txt.setDepth(700); } catch {}
        self.container.add(txt);
        try { if (isCurrentSymbol()) (obj as any).__winText = txt; } catch {}
        // Animate: single pop on appear, then rise and fade
        try {
          const baseSX = (txt as any)?.scaleX ?? 1;
          const baseSY = (txt as any)?.scaleY ?? 1;
          self.scene.tweens.add({
            targets: txt,
            scaleX: baseSX * 1.12,
            scaleY: baseSY * 1.12,
            duration: 160,
            yoyo: true,
            repeat: 0,
            ease: Phaser.Math.Easing.Cubic.Out,
          });
        } catch {}
        try {
          const rise = Math.max(8, Math.round(self.displayHeight * 0.25));
            const holdDuration = Math.max(1000, (self.scene?.gameData?.winUpDuration || 700) + 0);
            const fadeDuration = Math.max(600, (self.scene?.gameData?.winUpDuration || 700) + 0);
          self.scene.tweens.chain({
            targets: txt,
            tweens: [
              {
                y: txt.y - rise,
                duration: holdDuration,
                ease: Phaser.Math.Easing.Cubic.Out,
              },
              {
                alpha: 0,
                duration: fadeDuration,
                ease: Phaser.Math.Easing.Cubic.Out,
                onComplete: () => {
                  try {
                    if (txt && (txt as any).destroy && !(txt as any).destroyed) (txt as any).destroy();
                    if (obj && (obj as any).__winText === txt) (obj as any).__winText = null;
                  } catch {}
                }
              }
            ]
          });
        } catch {}
      });
    }
  } catch {}

  // Animate removal: for high-count sugar symbols (1..9), play SW_Win before destroy; otherwise fade out
  const removalPromises: Promise<void>[] = [];
  const STAGGER_MS = 50; // match drop sequence stagger (shortened)
  // Track first win animation notification (we now trigger on animation start for better SFX sync)
  let firstWinNotified = false;
  function notifyFirstWinIfNeeded() {
    if (!firstWinNotified) {
      firstWinNotified = true;
      console.log(`[Symbols] notifyFirstWinIfNeeded called for tumble index: ${tumbleIndex} (first win animation started)`);
      try {
        // Compute tumble total similarly here for safety
        let tumbleTotal = 0;
        try {
          const tw = Number((tumble as any)?.win ?? 0);
          if (!isNaN(tw) && tw > 0) {
            tumbleTotal = tw;
          } else {
            const outsArr = Array.isArray((tumble as any)?.symbols?.out) ? (tumble as any).symbols.out as Array<{ win?: number }> : [];
            tumbleTotal = outsArr.reduce((s, o) => s + (Number(o?.win) || 0), 0);
          }
        } catch {}
        if (typeof onFirstWinComplete === 'function') {
          onFirstWinComplete(tumbleTotal);
        }
      } catch {}
    } else {
      console.log(`[Symbols] notifyFirstWinIfNeeded called again for tumble index: ${tumbleIndex} (already notified, skipping)`);
    }
  }
  for (let col = 0; col < numCols; col++) {
    for (let row = 0; row < numRows; row++) {
      if (removeMask[col][row]) {
        const obj = self.symbols[col][row];
        if (obj) {
          removalPromises.push(new Promise<void>((resolve) => {
            self.symbolPool.onRelease(obj, resolve);
            try {
              const value = self.currentSymbolData?.[row]?.[col];
              const multiBase = typeof value === 'number' ? getMultiplierAnimationBase(value) : null;
              const canPlaySugarWin = typeof value === 'number' && value >= 1 && value <= 9 && highCountSymbols.has(value) && obj.animationState && obj.animationState.setAnimation;
              // For multipliers, allow win animation only when this item actually had wins
              const canPlayMultiplierWin = !!multiBase && !!(self as any).hadWinsInCurrentItem && obj.animationState && obj.animationState.setAnimation;
              if (canPlaySugarWin || canPlayMultiplierWin) {
                try { if (obj.animationState.clearTracks) obj.animationState.clearTracks(); } catch {}
                const winAnim = canPlaySugarWin ? `Symbol${value}_SW_Win` : `${multiBase}_Win`;
                let completed = false;
                try {
                  if (obj.animationState.addListener) {
                    const listener = {
                      complete: (entry: any) => {
                        try {
                          if (!entry || entry.animation?.name !== winAnim) return;
                        } catch {}
                        if (completed) return; completed = true;
                        try { self.symbolPool.release(obj); } catch {}
                        self.symbols[col][row] = null as any;
                        if (self.currentSymbolData && self.currentSymbolData[row]) {
                          (self.currentSymbolData[row] as any)[col] = null;
                        }
                        resolve();
                      }
                    } as any;
                    obj.animationState.addListener(listener);
                  }
                  obj.animationState.setAnimation(0, winAnim, false);
                  // Log the tumble index when win animation starts
                  console.log(`[Symbols] Playing win animation "${winAnim}" for tumble index: ${tumbleIndex}`);
                  // First win animation just started – notify once so header + SFX sync with visuals
                  notifyFirstWinIfNeeded();
                  // Scale up by 30% after 0.5s
                  scheduleScaleUp(self, obj, 500);
                  // Safety timeout in case complete isn't fired
                  self.symbolPool.delay(obj, self.scene.gameData.winUpDuration + 700, () => {
                    if (completed) return; completed = true;
                    try { self.symbolPool.release(obj); } catch {}
                    self.symbols[col][row] = null as any;
                    if (self.currentSymbolData && self.currentSymbolData[row]) {
                      (self.currentSymbolData[row] as any)[col] = null;
                    }
                    resolve();
                  });
                } catch {
                  // Fallback to fade if animation fails
                  try { self.scene.tweens.killTweensOf(obj); } catch {}
                  const tweenTargets: any = getSymbolTweenTargets(obj);
                  self.scene.tweens.add({
                    targets: tweenTargets,
                    alpha: 0,
                    // No scale change to avoid perceived scale-up/down
                    duration: self.scene.gameData.winUpDuration,
                    ease: Phaser.Math.Easing.Cubic.In,
                    onComplete: () => {
                      try { self.symbolPool.release(obj); } catch {}
                      self.symbols[col][row] = null as any;
                      if (self.currentSymbolData && self.currentSymbolData[row]) {
                        (self.currentSymbolData[row] as any)[col] = null;
                      }
                      resolve();
                    }
                  });
                }
              } else {
                // Non-sugar or low-count: soft fade without scale change
                try { self.scene.tweens.killTweensOf(obj); } catch {}
                const tweenTargets: any = getSymbolTweenTargets(obj);
                self.scene.tweens.add({
                  targets: tweenTargets,
                  alpha: 0,
                  // No scale change
                  duration: self.scene.gameData.winUpDuration,
                  ease: Phaser.Math.Easing.Cubic.In,
                  onComplete: () => {
                    try { self.symbolPool.release(obj); } catch {}
                    // Leave null placeholder for compression step
                    self.symbols[col][row] = null as any;
                    if (self.currentSymbolData && self.currentSymbolData[row]) {
                      (self.currentSymbolData[row] as any)[col] = null;
                    }
                    resolve();
                  }
                });
              }
            } catch {
              try { self.symbolPool.release(obj); } catch {}
              self.symbols[col][row] = null as any;
              if (self.currentSymbolData && self.currentSymbolData[row]) {
                (self.currentSymbolData[row] as any)[col] = null;
              }
              resolve();
            }
          }));
        } else {
          self.symbols[col][row] = null as any;
          if (self.currentSymbolData && self.currentSymbolData[row]) {
            (self.currentSymbolData[row] as any)[col] = null;
          }
        }
      }
    }
  }

  await Promise.all(removalPromises);
  // If we had a tumble win but did not notify (e.g., no win animations played), notify now
  try {
    if (!firstWinNotified) {
      const w = Number((tumble as any)?.win ?? 0);
      const outsArr = Array.isArray((tumble as any)?.symbols?.out) ? (tumble as any).symbols.out as Array<{ win?: number }> : [];
      const sumOuts = outsArr.reduce((s, o) => s + (Number(o?.win) || 0), 0);
      const tumbleTotal = (!isNaN(w) && w > 0) ? w : sumOuts;
      if (tumbleTotal > 0) {
        notifyFirstWinIfNeeded();
      }
    }
  } catch {}

  // Compress each column downwards and compute target indices for remaining symbols
  const symbolTotalHeight = self.displayHeight + self.verticalSpacing;
  const startY = self.slotY - self.totalGridHeight * 0.5;

  // Prepare a new grid to place references post-compression
  const newGrid: any[][] = Array.from({ length: numCols }, () => Array<any>(numRows).fill(null));
  const compressPromises: Promise<void>[] = [];

  for (let col = 0; col < numCols; col++) {
    const kept: Array<{ obj: any, oldRow: number }> = [];
    for (let row = 0; row < numRows; row++) {
      const obj = self.symbols[col][row];
      if (obj) kept.push({ obj, oldRow: row });
    }
    const bottomStart = numRows - kept.length; // first row index for packed symbols at bottom
    kept.forEach((entry, idx) => {
      const obj = entry.obj;
      const oldRow = entry.oldRow;
      const newRow = bottomStart + idx;
      const targetY = startY + newRow * symbolTotalHeight + symbolTotalHeight * 0.5;
      newGrid[col][newRow] = obj;
      // Track updated logical grid coordinates on the symbol
      try { (obj as any).__gridCol = col; (obj as any).__gridRow = newRow; } catch {}
      const needsMove = newRow !== oldRow;
      if (!needsMove) {
        // No movement needed; ensure y is correct and resolve immediately
        try {
          if (typeof obj.setY === 'function') obj.setY(targetY);
          const winTextObj: any = (obj as any)?.__winText;
          if (winTextObj && typeof winTextObj.setY === 'function') winTextObj.setY(targetY);
        } catch {}
        return; // no promise push to avoid waiting on a non-existent tween
      }
      compressPromises.push(new Promise<void>((resolve) => {
        self.symbolPool.onRelease(obj, resolve);
        try {
          const tweenTargetsMove: any = getSymbolTweenTargets(obj);
          const isTurbo = !!self.scene.gameData?.isTurbo;
          const unifiedDropMode = shouldUseUnifiedDropMode(self);
          const baseDuration = self.scene.gameData.dropDuration;
          const tumbleDurationMultiplier = getTumbleSkipTurboDurationMultiplier(self);
          // Use a slightly shorter duration in turbo/skip, but long enough for easing
          // to be visible so the motion doesn't feel rigid.
          const compressionDuration = unifiedDropMode
            ? Math.max(160, baseDuration * 0.6 * tumbleDurationMultiplier)
            : baseDuration;
          const baseDelayMultiplier = (self.scene?.gameData?.compressionDelayMultiplier ?? 1);
          const colDelay = STAGGER_MS * col * baseDelayMultiplier;
          // In manual skip, remove stagger entirely so compressed symbols drop together.
          // Turbo keeps the existing reduced stagger.
          const delay = isSkipDropModeActive(self) ? 0 : (isTurbo ? colDelay * 0.4 : colDelay);
          self.scene.tweens.add({
            targets: tweenTargetsMove,
            y: targetY,
            delay,
            duration: compressionDuration,
            // In turbo mode, keep motion snappy but smoothly decelerating
            ease: unifiedDropMode
              ? Phaser.Math.Easing.Cubic.Out
              : Phaser.Math.Easing.Bounce.Out,
            onComplete: () => resolve(),
          });
        } catch { resolve(); }
      }));
    });
  }

  // Overlap-aware drop scheduling: if enabled, start drops during compression; otherwise, drop after compression completes
  const overlapDrops = !!(self.scene?.gameData?.tumbleOverlapDropsDuringCompression);
  const dropPromises: Promise<void>[] = [];
  const symbolTotalWidth = self.displayWidth + self.horizontalSpacing;
  const startX = self.slotX - self.totalGridWidth * 0.5;
  let totalSpawned = 0;

  if (overlapDrops) {
    // Replace grid immediately so top nulls represent empty slots while compression runs
    self.symbols = newGrid;
    // Update all objects with their current grid coordinates for consistency
    try {
      for (let c = 0; c < numCols; c++) {
        for (let r = 0; r < numRows; r++) {
          const o = self.symbols[c][r];
          if (o) { try { (o as any).__gridCol = c; (o as any).__gridRow = r; } catch {} }
        }
      }
    } catch {}
    // Rebuild currentSymbolData to reflect compressed positions now
    try {
      if (self.currentSymbolData) {
        const rebuilt: (number | null)[][] = Array.from({ length: numRows }, () => Array<number | null>(numCols).fill(null));
        for (let col = 0; col < numCols; col++) {
          const keptValues: number[] = [];
          for (let row = 0; row < numRows; row++) {
            const v = self.currentSymbolData[row]?.[col];
            if (typeof v === 'number') keptValues.push(v);
          }
          const bottomStart = numRows - keptValues.length;
          for (let i = 0; i < keptValues.length; i++) {
            const newRow = bottomStart + i;
            rebuilt[newRow][col] = keptValues[i];
          }
        }
        const finalized: number[][] = rebuilt.map(row => row.map(v => (typeof v === 'number' ? v : 0)));
        self.currentSymbolData = finalized;
      }
    } catch {}

    // Start drops now, while compression tweens are in-flight
    for (let col = 0; col < numCols; col++) {
      const incoming = Array.isArray(ins?.[col]) ? ins[col] : [];
      if (incoming.length === 0) continue;

      let emptyCount = 0;
      for (let row = 0; row < numRows; row++) {
        if (!self.symbols[col][row]) emptyCount++;
        else break;
      }
      const spawnCount = Math.min(emptyCount, incoming.length);
      console.log(`[Symbols] (overlap) Column ${col}: empty=${emptyCount}, incoming=${incoming.length}, spawning=${spawnCount}`);
      for (let j = 0; j < spawnCount; j++) {
        const targetRow = Math.max(0, emptyCount - 1 - j);
        const targetY = startY + targetRow * symbolTotalHeight + symbolTotalHeight * 0.5;
        const xPos = startX + col * symbolTotalWidth + symbolTotalWidth * 0.5;

        const srcIndex = Math.max(0, incoming.length - 1 - j);
        const value = incoming[srcIndex];
        const topOfGridCenterY = startY + symbolTotalHeight * 0.5;
        const startYPos = topOfGridCenterY - self.scene.scale.height + (j * symbolTotalHeight);
        const created: any = createSugarOrPngSymbol(self, value, xPos, startYPos, 1);

        self.symbols[col][targetRow] = created;
        try { (created as any).__gridCol = col; (created as any).__gridRow = targetRow; } catch {}
        if (self.currentSymbolData && self.currentSymbolData[targetRow]) {
          (self.currentSymbolData[targetRow] as any)[col] = value;
        }

        try { playDropAnimationIfAvailable(created); } catch {}

        const DROP_STAGGER_MS = (self.scene?.gameData?.tumbleDropStaggerMs ?? (MANUAL_STAGGER_MS * 0.25));
        const symbolHop = self.scene.gameData.winUpHeight * 0.5;
        const isTurbo = !!self.scene.gameData?.isTurbo;
        const unifiedDropMode = shouldUseUnifiedDropMode(self);
        const tumbleDurationMultiplier = getTumbleSkipTurboDurationMultiplier(self);
        dropPromises.push(new Promise<void>((resolve) => {
          self.symbolPool.onRelease(created, resolve);
          try {
            const computedStartDelay = (self.scene?.gameData?.tumbleDropStartDelayMs ?? 0) + (unifiedDropMode ? 0 : DROP_STAGGER_MS * sequenceIndex);
            const skipPreHop = !!(self.scene?.gameData?.tumbleSkipPreHop);
            const tweensArr: any[] = [];
            if (!skipPreHop) {
              tweensArr.push({
                delay: computedStartDelay,
                y: `-= ${symbolHop}`,
                duration: self.scene.gameData.winUpDuration * tumbleDurationMultiplier,
                ease: Phaser.Math.Easing.Circular.Out,
              });
              tweensArr.push({
                y: targetY,
                duration: (self.scene.gameData.dropDuration * 0.9) * tumbleDurationMultiplier,
                ease: unifiedDropMode ? Phaser.Math.Easing.Cubic.Out : Phaser.Math.Easing.Linear,
              });
            } else {
              tweensArr.push({
                delay: computedStartDelay,
                y: targetY,
                duration: (self.scene.gameData.dropDuration * 0.9) * tumbleDurationMultiplier,
                ease: unifiedDropMode ? Phaser.Math.Easing.Cubic.Out : Phaser.Math.Easing.Linear,
              });
            }
            if (!unifiedDropMode) {
              // Normal mode: include the small post-drop bounce and SFX
              tweensArr.push(
                {
                  y: `+= ${10}`,
                  duration: self.scene.gameData.dropDuration * 0.05,
                  ease: Phaser.Math.Easing.Linear,
                },
                {
                  y: `-= ${10}`,
                  duration: self.scene.gameData.dropDuration * 0.05,
                  ease: Phaser.Math.Easing.Linear,
                  onComplete: () => {
                    try {
                      if (!self.scene.gameData.isTurbo && (window as any).audioManager) {
                        (window as any).audioManager.playSoundEffect(SoundEffectType.REEL_DROP);
                      }
                    } catch {}
                    resolve();
                  }
                }
              );
            } else {
              // Turbo/skip mode: no post-drop bounce; resolve on the main drop completion
              const last = tweensArr[tweensArr.length - 1];
              const prevOnComplete = last.onComplete;
              last.onComplete = () => {
                try { 
                  if (prevOnComplete) prevOnComplete(); 
                  // Play tumble sound for every symbol dropped after compression in turbo mode only.
                  if (isTurbo && (window as any).audioManager) {
                    (window as any).audioManager.playSoundEffect(SoundEffectType.REEL_DROP);
                  }
                } catch (e) {
                  console.warn('[Symbols] Error playing reel drop sound in turbo mode:', e);
                }
                resolve();
              };
            }
            try { self.scene.tweens.chain({ targets: getSymbolTweenTargets(created), tweens: tweensArr }); }
            catch { self.scene.tweens.chain({ targets: created, tweens: tweensArr }); }
          } catch { resolve(); }
        }));
        sequenceIndex++;
        totalSpawned++;
      }
    }

    // Wait for both compression and drop to finish
    await Promise.all([...compressPromises, ...dropPromises]);
  } else {
    // Default behavior: wait compression, then set grid and drop
    await Promise.all(compressPromises);
    self.symbols = newGrid;
    // Update all objects with their current grid coordinates for consistency
    try {
      for (let c = 0; c < numCols; c++) {
        for (let r = 0; r < numRows; r++) {
          const o = self.symbols[c][r];
          if (o) { try { (o as any).__gridCol = c; (o as any).__gridRow = r; } catch {} }
        }
      }
    } catch {}
    try {
      if (self.currentSymbolData) {
        const rebuilt: (number | null)[][] = Array.from({ length: numRows }, () => Array<number | null>(numCols).fill(null));
        for (let col = 0; col < numCols; col++) {
          const keptValues: number[] = [];
          for (let row = 0; row < numRows; row++) {
            const v = self.currentSymbolData[row]?.[col];
            if (typeof v === 'number') keptValues.push(v);
          }
          const bottomStart = numRows - keptValues.length;
          for (let i = 0; i < keptValues.length; i++) {
            const newRow = bottomStart + i;
            rebuilt[newRow][col] = keptValues[i];
          }
        }
        const finalized: number[][] = rebuilt.map(row => row.map(v => (typeof v === 'number' ? v : 0)));
        self.currentSymbolData = finalized;
      }
    } catch {}

    for (let col = 0; col < numCols; col++) {
      const incoming = Array.isArray(ins?.[col]) ? ins[col] : [];
      if (incoming.length === 0) continue;
      let emptyCount = 0;
      for (let row = 0; row < numRows; row++) {
        if (!self.symbols[col][row]) emptyCount++;
        else break;
      }
      const spawnCount = Math.min(emptyCount, incoming.length);
      console.log(`[Symbols] Column ${col}: empty=${emptyCount}, incoming=${incoming.length}, spawning=${spawnCount}`);
      for (let j = 0; j < spawnCount; j++) {
        const targetRow = Math.max(0, emptyCount - 1 - j);
        const targetY = startY + targetRow * symbolTotalHeight + symbolTotalHeight * 0.5;
        const xPos = startX + col * symbolTotalWidth + symbolTotalWidth * 0.5;
        const srcIndex = Math.max(0, incoming.length - 1 - j);
        const value = incoming[srcIndex];
        const topOfGridCenterY = startY + symbolTotalHeight * 0.5;
        const startYPos = topOfGridCenterY - self.scene.scale.height + (j * symbolTotalHeight);
        const created: any = createSugarOrPngSymbol(self, value, xPos, startYPos, 1);
        self.symbols[col][targetRow] = created;
        try { (created as any).__gridCol = col; (created as any).__gridRow = targetRow; } catch {}
        if (self.currentSymbolData && self.currentSymbolData[targetRow]) {
          (self.currentSymbolData[targetRow] as any)[col] = value;
        }
        try { playDropAnimationIfAvailable(created); } catch {}
        const DROP_STAGGER_MS = (self.scene?.gameData?.tumbleDropStaggerMs ?? (MANUAL_STAGGER_MS * 0.25));
        const symbolHop = self.scene.gameData.winUpHeight * 0.5;
        const isTurbo = !!self.scene.gameData?.isTurbo;
        const unifiedDropMode = shouldUseUnifiedDropMode(self);
        const tumbleDurationMultiplier = getTumbleSkipTurboDurationMultiplier(self);
        dropPromises.push(new Promise<void>((resolve) => {
          self.symbolPool.onRelease(created, resolve);
          try {
            const computedStartDelay = (self.scene?.gameData?.tumbleDropStartDelayMs ?? 0) + (unifiedDropMode ? 0 : DROP_STAGGER_MS * sequenceIndex);
            const skipPreHop = !!(self.scene?.gameData?.tumbleSkipPreHop);
            const tweensArr: any[] = [];
            if (!skipPreHop) {
              tweensArr.push({ delay: computedStartDelay, y: `-= ${symbolHop}`, duration: self.scene.gameData.winUpDuration * tumbleDurationMultiplier, ease: Phaser.Math.Easing.Circular.Out });
              tweensArr.push({ y: targetY, duration: (self.scene.gameData.dropDuration * 0.9) * tumbleDurationMultiplier, ease: unifiedDropMode ? Phaser.Math.Easing.Cubic.Out : Phaser.Math.Easing.Linear });
            } else {
              tweensArr.push({ delay: computedStartDelay, y: targetY, duration: (self.scene.gameData.dropDuration * 0.9) * tumbleDurationMultiplier, ease: unifiedDropMode ? Phaser.Math.Easing.Cubic.Out : Phaser.Math.Easing.Linear });
            }
            if (!unifiedDropMode) {
              // Normal mode: include the small post-drop bounce and SFX
              tweensArr.push(
                { y: `+= ${10}`, duration: self.scene.gameData.dropDuration * 0.05, ease: Phaser.Math.Easing.Linear },
                {
                  y: `-= ${10}`,
                  duration: self.scene.gameData.dropDuration * 0.05,
                  ease: Phaser.Math.Easing.Linear,
                  onComplete: () => {
                    try {
                      if (!self.scene.gameData.isTurbo && (window as any).audioManager) {
                        (window as any).audioManager.playSoundEffect(SoundEffectType.REEL_DROP);
                      }
                    } catch {}
                    resolve();
                  }
                }
              );
            } else {
              // Turbo/skip mode: no post-drop bounce; resolve on the main drop completion
              const last = tweensArr[tweensArr.length - 1];
              const prevOnComplete = last.onComplete;
              last.onComplete = () => {
                try { 
                  if (prevOnComplete) prevOnComplete(); 
                  // Play tumble sound for every symbol dropped after compression in turbo mode only.
                  if (isTurbo && (window as any).audioManager) {
                    (window as any).audioManager.playSoundEffect(SoundEffectType.REEL_DROP);
                  }
                } catch (e) {
                  console.warn('[Symbols] Error playing reel drop sound in turbo mode:', e);
                }
                resolve();
              };
            }
            self.scene.tweens.chain({ targets: created, tweens: tweensArr });
          } catch { resolve(); }
        }));
        sequenceIndex++;
        totalSpawned++;
      }
    }
    await Promise.all(dropPromises);
  }

  // Debug: validate totals between outs and ins after spawn
  try {
    const totalOutRequested = outs.reduce((s, o) => s + (Number(o?.count) || 0), 0);
    if (totalOutRequested !== totalSpawned) {
      console.warn('[Symbols] Tumble total mismatch: out.count sum != spawned', {
        totalOutRequested,
        totalSpawned
      });
    } else {
      console.log('[Symbols] Tumble totals OK: removed == spawned', { totalSpawned });
    }
  } catch {}

  // Re-evaluate wins after each tumble drop completes
  try { reevaluateWinsFromGrid(self); } catch {}
  
  // Check for scatter hits from the updated grid after this tumble (both normal and bonus mode)
  try {
    // Scan the live symbols grid to find actual scatter objects and positions
    const grids: Array<{ x: number; y: number }> = [];
    if (self.symbols && self.symbols.length > 0) {
      for (let col = 0; col < self.symbols.length; col++) {
        const column = self.symbols[col];
        if (!Array.isArray(column)) continue;
        for (let row = 0; row < column.length; row++) {
          const obj: any = column[row];
          if (!obj) continue;
          const isScatter = (obj as any)?.symbolValue === 0 || (obj?.texture?.key === 'symbol_0');
          if (isScatter) grids.push({ x: col, y: row });
        }
      }
    }
    const count = grids.length;
    
    if (gameStateManager.isBonus) {
      // Bonus mode: check for retrigger (3+ scatters)
      if (count >= 3) {
        console.log(`[Symbols] Scatter detected during tumble in bonus: ${count} scatter(s)`);
        // Suppress retrigger once the max-win cap is reached so the max-win finalize isn't deferred.
        const capHit = (self.currentSpinData as any)?.slot?.hasMaxWin === true &&
          !!((self.scene as any)?.bonusHeader?.isMaxWinCapReached?.(self.currentSpinData));
        // Defer retrigger to run after all wins/tumbles/multipliers complete (WIN_STOP)
        if (capHit) {
          console.log('[Symbols] Max-win cap reached - suppressing tumble retrigger so max win can finalize');
        } else if (!(self as any).pendingScatterRetrigger) {
          self.setPendingScatterRetrigger(grids);
          console.log('[Symbols] Scheduled retrigger sequence to run after WIN_STOP');
        } else {
          console.log('[Symbols] Retrigger already scheduled; skipping duplicate schedule');
        }
      }
    } else {
      // Normal mode: check for scatter trigger (4+ scatters)
      if (count >= 4 && !gameStateManager.isScatter) {
        console.log(`[Symbols] Scatter detected during tumble in normal mode: ${count} scatter(s)`);
        // Mark scatter as detected - the final scatter check after all tumbles will handle the animation
        gameStateManager.isScatter = true;
        console.log('[Symbols] Scatter marked for processing after all tumbles complete');
      }
    }
  } catch (e) {
    console.warn('[Symbols] Failed to evaluate scatter during tumble:', e);
  }
}


function replaceWithSpineAnimations(self: Symbols, data: Data) {
  const wins = data.wins;

  // Safety check: only proceed if wins exist and have the expected structure
  if (!wins || !wins.allMatching || wins.allMatching.size === 0) {
    console.log('[Symbols] No wins to process, skipping Spine animation replacement');
    return;
  }

  // Safety check: ensure symbols array exists and has the expected dimensions
  if (!self.symbols || !self.symbols.length || !self.symbols[0] || !self.symbols[0].length) {
    console.log('[Symbols] Symbols array not properly initialized, skipping Spine animation replacement');
    return;
  }

  console.log(`[Symbols] Processing ${wins.allMatching.size} winning patterns for Spine animations`);
  console.log(`[Symbols] Current symbols array dimensions: ${self.symbols.length} columns x ${self.symbols[0].length} rows`);
  
  // Determine if any winning symbol is a wildcard and prepare SFX selection
  let hasWildcardInWin = false;
  try {
    const wildcardSet = new Set<number>(MULTIPLIER_SYMBOLS);
    for (const win of wins.allMatching.values()) {
      for (const grid of win) {
        const valueAtGrid = data.symbols?.[grid.y]?.[grid.x];
        if (typeof valueAtGrid === 'number' && wildcardSet.has(valueAtGrid)) {
          hasWildcardInWin = true;
          break;
        }
      }
      if (hasWildcardInWin) break;
    }
  } catch {}
  
  // Ensure we only play the win SFX once per win animation start
  let hasPlayedWinSfx = false;
  
  for (const win of wins.allMatching.values()) {
    for (const grid of win) {
      // Safety check: ensure grid coordinates are within bounds
      if (grid.y < 0 || grid.y >= self.symbols.length || grid.x < 0 || grid.x >= self.symbols[0].length) {
        console.warn(`[Symbols] Grid coordinates (${grid.x}, ${grid.y}) out of bounds for symbols array [${self.symbols.length}][${self.symbols[0].length}], skipping`);
        continue;
      }

      const currentSymbol = self.symbols[grid.y][grid.x];
      
      if (currentSymbol) {
        // Get the symbol value and construct the Spine key
        const symbolValue = data.symbols[grid.y][grid.x];

        // For symbol 0 and symbols 10–21, keep PNGs: do not replace with Spine
        if (typeof symbolValue === 'number' && (symbolValue === 0 || (symbolValue >= 10 && symbolValue <= 21))) {
          continue;
        }

        
        const spineKey = `symbol_${symbolValue}_spine`;
        const spineAtlasKey = spineKey + '-atlas';
        // Removing KA hit animation usage for winning symbols
        
        // Store original position and scale
        const x = currentSymbol.x;
        const y = currentSymbol.y;
        const displayWidth = currentSymbol.displayWidth;
        const displayHeight = currentSymbol.displayHeight;
        
        try {
          console.log(`[Symbols] Replacing sprite with Spine animation: ${spineKey} at (${grid.x}, ${grid.y})`);
          
          // Remove the current sprite
          self.symbolPool.release(currentSymbol);
          
          // Create Spine animation in its place
          const spineSymbol = self.scene.add.spine(x, y, spineKey, spineAtlasKey);
          try { (spineSymbol as any).symbolValue = symbolValue; } catch {}
          spineSymbol.setOrigin(0.5, 0.5);
          
          // Use configured scale for this specific symbol
          const configuredScale = self.getSpineSymbolScale(symbolValue);
          spineSymbol.setScale(configuredScale);
          console.log(`[Symbols] Applied scale ${configuredScale} to symbol ${symbolValue}`);
          
          // No KA hit animation; keep subtle emphasis via scale-up only
          scheduleScaleUp(self, spineSymbol, 500);

          // Play win SFX once when winning symbol animations start
          try {
            if (!hasPlayedWinSfx) {
              const audio = (window as any)?.audioManager;
              if (audio && typeof audio.playSoundEffect === 'function') {
                // During bonus mode, wins that include multiplier symbols (wildcards)
                // should use the dedicated bomb SFX
                if (hasWildcardInWin && gameStateManager.isBonus) {
                  audio.playSoundEffect(SoundEffectType.MULTIPLIER_TRIGGER);
                }
                hasPlayedWinSfx = true;
                // If this spin triggered scatter, chain play scatter_sw after hit/wildmulti
                try {
                  if (gameStateManager.isScatter) {
                    // short chain delay to ensure ordering
                    self.scene.time.delayedCall(100, () => {
                      try { audio.playSoundEffect(SoundEffectType.SCATTER); } catch {}
                    });
                  }
                } catch {}
              }
            }
          } catch {}
          
          // Add to container and update reference
          self.container.add(spineSymbol);
          self.symbols[grid.y][grid.x] = spineSymbol;
          
          console.log(`[Symbols] Successfully replaced sprite with Spine animation at (${grid.x}, ${grid.y})`);
          
        } catch (error) {
          console.warn(`[Symbols] Failed to replace sprite with Spine animation at (${grid.x}, ${grid.y}):`, error);

          // Clear animation fallback: recreate a static symbol without pulsing/tint effects
          try {
            const recreated = createSugarOrPngSymbol(self, symbolValue, x, y, 1);
            self.symbols[grid.y][grid.x] = recreated;
            if (self.container) {
              self.container.add(recreated);
            }
          } catch {}
        }
      }
    }
  }
}


/**
 * Calculate total win amount from paylines array
 */
function calculateTotalWinFromPaylines(paylines: any[]): number {
  if (!paylines || paylines.length === 0) {
    return 0;
  }
  
  const totalWin = paylines.reduce((sum, payline) => {
    const winAmount = payline.win || 0;
    console.log(`[Symbols] Payline ${payline.lineKey}: ${winAmount} (symbol ${payline.symbol}, count ${payline.count})`);
    return sum + winAmount;
  }, 0);
  
  console.log(`[Symbols] Calculated total win: ${totalWin} from ${paylines.length} paylines`);
  return totalWin;
}

async function delay(duration: number) {
  // The duration should already be turbo-adjusted from the backend
  // No need to apply turbo mode again here
  console.log(`[Symbols] Delay: ${duration}ms (should already be turbo-adjusted), turbo state: ${gameStateManager.isTurbo}`);
  
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(true);
    }, duration);
  });
}

async function delayOrSkip(self: Symbols, duration: number) {
  const total = Math.max(0, Number(duration) || 0);
  const isReelDropSkipActive = () =>
    (self.reelDropInProgress || self.preSpinDropInProgress) &&
    (self.skipReelDropsActive ||
      self.skipReelDropsPending ||
      self.skipDropModeForCurrentSpin ||
      self.skipRequestedForCurrentSpin);
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      if (total === 0 || isReelDropSkipActive()) {
        resolve(true);
        return;
      }
      const elapsed = Date.now() - start;
      if (elapsed >= total) {
        resolve(true);
        return;
      }
      self.scene.time.delayedCall(16, tick);
    };
    tick();
  });
}

// Add method to reset symbols visibility
function resetSymbolsVisibility(self: Symbols): void {
  if (self.container) {
    self.container.setAlpha(1);
  }
}

