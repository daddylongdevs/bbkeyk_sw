import { Scene } from 'phaser';
import { Data } from '../tmp_backend/Data';
import { SpinData } from '../backend/SpinData';
import { gameEventManager, GameEventType } from '../event/EventManager';
import { gameStateManager } from './GameStateManager';
import { TurboConfig } from '../config/TurboConfig';

export interface ScatterAnimationConfig {
  scatterRevealDelay: number;
  slideInDuration: number;
  spinDelay: number;
  slideDistance: number;
  dialogDelay: number;
}

export class ScatterAnimationManager {
  private static instance: ScatterAnimationManager;
  private scene: Scene | null = null;
  private symbolsContainer: Phaser.GameObjects.Container | null = null;
  private dialogsComponent: any = null; // Reference to the Dialogs component
  private isAnimating: boolean = false;
  public delayedScatterData: any = null;
  private scatterSymbols: any[] = []; // Store references to scatter symbols
  
  // Event listener references for cleanup
  private wheelSpinStartListener: ((data?: any) => void) | null = null; // deprecated
  private wheelSpinDoneListener: ((data?: any) => void) | null = null; // deprecated
  
  private config: ScatterAnimationConfig = {
    scatterRevealDelay: 2500,
    slideInDuration: 3500,
    spinDelay: 500,
    slideDistance: 200,
    dialogDelay: 300
  };

  // Apply turbo mode to delays for consistent timing
  // Note: Scatter animations always use normal speed for better visual experience
  private getTurboAdjustedDelay(baseDelay: number): number {
    // Always use normal speed for scatter animations, regardless of turbo mode
    return baseDelay;
  }

  private constructor() {}

  public static getInstance(): ScatterAnimationManager {
    if (!ScatterAnimationManager.instance) {
      ScatterAnimationManager.instance = new ScatterAnimationManager();
    }
    return ScatterAnimationManager.instance;
  }

  public initialize(scene: Scene, symbolsContainer: Phaser.GameObjects.Container, dialogsComponent?: any): void {
    this.scene = scene;
    this.symbolsContainer = symbolsContainer;
    this.dialogsComponent = dialogsComponent;
    
    console.log('[ScatterAnimationManager] Initialized with containers and dialogs component (spinner removed)');
  }

  public setConfig(config: Partial<ScatterAnimationConfig>): void {
    this.config = { ...this.config, ...config };
  }

  // Wheel event listeners removed (spinner removed)

  public async playScatterAnimation(data: Data): Promise<void> {
    if (this.isAnimating || !this.scene || !this.symbolsContainer) {
      console.warn('[ScatterAnimationManager] Cannot play animation - not ready or already animating');
      return;
    }

    this.isAnimating = true;
    console.log('[ScatterAnimationManager] Starting scatter animation sequence - player will see scatter symbols for 1 second');

    // While the scatter animation / free-spin intro is playing, make sure the
    // SlotController's "spins left" display is completely hidden so it doesn't
    // pop in early underneath the animations or dialogs.
    try {
      const gameSceneAny = this.scene as any;
      const slotController = gameSceneAny?.slotController;
      if (slotController && typeof slotController.suppressFreeSpinDisplay === 'function') {
        slotController.suppressFreeSpinDisplay();
        console.log('[ScatterAnimationManager] Suppressed SlotController free spin display for scatter animation');
      }
    } catch (e) {
      console.warn('[ScatterAnimationManager] Failed to suppress SlotController free spin display at scatter start:', e);
    }

    // Switch BG music to Free Spin track when scatter animation starts
    // Only switch music for initial scatter triggers, not retriggers (when already in bonus mode)
    if (!gameStateManager.isBonus) {
      try {
        const audioMgr = (window as any).audioManager;
        if (audioMgr && typeof audioMgr.switchToFreeSpinMusic === 'function') {
          audioMgr.switchToFreeSpinMusic();
          console.log('[ScatterAnimationManager] Requested switch to free spin background music');
        }
      } catch (e) {
        console.warn('[ScatterAnimationManager] Failed to switch to free spin music', e);
      }
    } else {
      console.log('[ScatterAnimationManager] Skipping free spin music switch - already in bonus mode (retrigger)');
    }

    try {
      // Step 1: Wait for player to see scatter symbols
      console.log('[ScatterAnimationManager] Waiting for player to see scatter symbols...');
      await this.delay(this.getTurboAdjustedDelay(this.config.scatterRevealDelay));
      
      // Step 2: Skip all spinner animations; directly determine free spins and show dialog
      this.determineFreeSpins(data);

      // Directly show free spins dialog without wheel
      this.showFreeSpinsDialog(data);
      
      // Note: Symbol reset will happen after dialog animations complete
      console.log('[ScatterAnimationManager] Scatter bonus sequence completed, waiting for dialog animations to finish');
      
    } catch (error) {
      console.error('[ScatterAnimationManager] Error during scatter animation:', error);
    } finally {
      this.isAnimating = false;
    }
  }

  private async disableSymbols(): Promise<void> {
    if (!this.symbolsContainer) return;

    console.log('[ScatterAnimationManager] Disabling symbols...');
    
    // Immediately disable symbols by setting alpha to 0
    this.symbolsContainer.setAlpha(0);
    
    // Also hide scatter symbols that are added directly to the scene
    this.hideScatterSymbols();
    
    // Add a small delay to ensure the disable is visible
    await this.delay(50);
    
    console.log('[ScatterAnimationManager] Symbols disabled');
  }

  // Spinner slide-in removed

  // Spinner pulse removed

  private async delay(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      this.scene!.time.delayedCall(ms, () => {
        resolve();
      });
    });
  }

  private determineFreeSpins(data: Data): void {
    // Determine free spins from SpinData using first item's spinsLeft
    const freeSpinsFromSpin = this.getFreeSpinsFromSpinData();
    if (freeSpinsFromSpin > 0) {
      data.freeSpins = freeSpinsFromSpin;
      // Estimate scatter index from current grid (no multiplier table)
      data.scatterIndex = this.estimateScatterIndexFromGrid(data);
      console.log(`[ScatterAnimationManager] Free spins from SpinData: freeSpins=${freeSpinsFromSpin}, estimated scatterIndex=${data.scatterIndex}`);
    } else {
      // Fallback: estimate from grid if SpinData unavailable
      data.scatterIndex = this.estimateScatterIndexFromGrid(data);
      data.freeSpins = 0;
      console.log(`[ScatterAnimationManager] SpinData unavailable, estimated scatterIndex=${data.scatterIndex}, freeSpins=${data.freeSpins}`);
    }
    gameStateManager.isScatter = true;
    gameStateManager.scatterIndex = data.scatterIndex || 0;
  }

  /**
   * Get free spins from SpinData using the first item's spinsLeft
   */
  private getFreeSpinsFromSpinData(): number {
    if (!this.scene) return 0;
    const gameScene = this.scene as any;
    const currentSpinData: SpinData | undefined = gameScene?.symbols?.currentSpinData;
    const fsData = currentSpinData?.slot?.freeSpin || currentSpinData?.slot?.freespin;
    const items = Array.isArray(fsData?.items) ? fsData!.items : [];
    const firstItemSpinsLeft = items.length > 0 && typeof items[0]?.spinsLeft === 'number' ? items[0].spinsLeft : 0;
    if (firstItemSpinsLeft > 0) {
      console.log(`[ScatterAnimationManager] Using first freeSpin item's spinsLeft: ${firstItemSpinsLeft}`);
    } else {
      console.log('[ScatterAnimationManager] first freeSpin item spinsLeft not available; defaulting to 0');
    }
    return firstItemSpinsLeft || 0;
  }

  /**
   * Estimate scatter index from the current grid (scatterCount - 4, clamped to >= 0)
   */
  private estimateScatterIndexFromGrid(data: Data): number {
    const scatterCount = this.getScatterGridsFromData(data).length;
    const index = Math.max(0, scatterCount - 4);
    return index;
  }

  /**
   * Get scatter grids from the data to calculate scatter index
   */
  private getScatterGridsFromData(data: Data): any[] {
    const scatterGrids: any[] = [];
    for (let y = 0; y < data.symbols.length; y++) {
      for (let x = 0; x < data.symbols[y].length; x++) {
        if (data.symbols[y][x] === Data.SCATTER[0]) {
          scatterGrids.push({ x, y, symbol: data.symbols[y][x] });
        }
      }
    }
    return scatterGrids;
  }

  // Spinner wait removed; dialogs shown immediately

  private showFreeSpinsDialog(data: Data): void {
    console.log('[ScatterAnimationManager] ===== SHOW FREE SPINS DIALOG CALLED =====');
    console.log('[ScatterAnimationManager] Dialogs component available:', !!this.dialogsComponent);
    
    if (!this.dialogsComponent) {
      console.warn('[ScatterAnimationManager] Dialogs component not available');
      return;
    }

    // Get free spins count from the current spinData
    let freeSpins = 0; // Default to 0, will be set from spinData
    
    // Get free spins from the current spinData directly from symbols (support new and legacy formats)
    if (this.scene) {
      const gameScene = this.scene as any; // Cast to access symbols property
      if (gameScene.symbols && gameScene.symbols.currentSpinData) {
        const currentSpinData = gameScene.symbols.currentSpinData;
        if (currentSpinData.slot) {
          const fsData = currentSpinData.slot.freeSpin || currentSpinData.slot.freespin;
          if (fsData) {
            // Use strictly the first freeSpin item's spinsLeft
            const items = Array.isArray(fsData.items) ? fsData.items : [];
            const firstItemSpinsLeft = items.length > 0 && typeof items[0]?.spinsLeft === 'number' ? items[0].spinsLeft : 0;
            freeSpins = firstItemSpinsLeft;
            console.log(`[ScatterAnimationManager] Using first freeSpin item's spinsLeft for dialog: ${freeSpins}`);
          } else {
            console.warn(`[ScatterAnimationManager] No freeSpin/freespin data in current spinData`);
          }
        } else {
          console.warn(`[ScatterAnimationManager] No slot data in current spinData`);
        }
      } else {
        console.warn(`[ScatterAnimationManager] Symbols or currentSpinData not available`);
      }
    }
    
    // If we couldn't get freeSpins from spinData, log error and use 0
    if (freeSpins === 0) {
      console.error(`[ScatterAnimationManager] Could not get freeSpins from current spinData - dialog will show 0`);
    }
    
    console.log(`[ScatterAnimationManager] Showing free spins dialog for ${freeSpins} free spins`);
    console.log(`[ScatterAnimationManager] Backend data state: freeSpins=${data.freeSpins}, scatterIndex=${data.scatterIndex}`);

    // Update game state to reflect bonus mode
    console.log('[ScatterAnimationManager] Setting isBonus to true');
    gameStateManager.isBonus = true;
    console.log('[ScatterAnimationManager] isBonus is now:', gameStateManager.isBonus);

    // Show the FreeSpinDialog_KA with all effects - this will trigger bonus mode when clicked
    try {
      console.log('[ScatterAnimationManager] Calling dialogsComponent.showDialog with type: FreeSpinDialog_KA, freeSpins:', freeSpins);
      this.dialogsComponent.showDialog(this.scene, {
        type: 'FreeSpinDialog_KA',
        freeSpins: freeSpins
      });
      
      console.log('[ScatterAnimationManager] Free spins dialog displayed successfully');
      
      // Emit IS_BONUS event through the EventManager
      gameEventManager.emit(GameEventType.IS_BONUS, {
        scatterCount: data.scatterIndex,
        bonusType: 'freeSpins'
      });
      
      // Emit scatter bonus activated event with scatter index and actual free spins for UI updates
      if (this.scene) {
        const eventData = {
          scatterIndex: data.scatterIndex,
          actualFreeSpins: freeSpins
        };
        console.log(`[ScatterAnimationManager] Emitting scatterBonusActivated event with data:`, eventData);
        
        this.scene.events.emit('scatterBonusActivated', eventData);
        console.log(`[ScatterAnimationManager] Emitted scatterBonusActivated event with index ${data.scatterIndex} and ${freeSpins} free spins`);
      }
      
      // Set up listener for when dialog animations complete
      this.setupDialogCompletionListener();
      
    } catch (error) {
      console.error('[ScatterAnimationManager] Error showing dialog effects:', error);
    }
  }

  /**
   * Show a retrigger dialog during an active bonus with an explicit number of new spins.
   * This bypasses SpinData parsing and uses the provided newSpins value.
   */
  public showRetriggerFreeSpinsDialog(newSpins: number): void {
    if (!this.scene) return;
    console.log('[ScatterAnimationManager] ===== SHOW RETRIGGER FREE SPINS DIALOG =====');
    console.log('[ScatterAnimationManager] Dialogs component available:', !!this.dialogsComponent);
    
    if (!this.dialogsComponent) {
      console.warn('[ScatterAnimationManager] Dialogs component not available');
      return;
    }
    
    const spins = Math.max(0, Number(newSpins) || 0);
    console.log(`[ScatterAnimationManager] Showing retrigger dialog for +${spins} free spins`);
    
    // Keep bonus mode active; do not toggle music here
    gameStateManager.isBonus = true;
    // A retrigger explicitly means the bonus is continuing, so make sure any
    // tentative "bonus finished" state set earlier in the spin (e.g. from
    // REELS_STOP heuristics) is cleared before congrats logic can react to it.
    try {
      if (gameStateManager.isBonusFinished) {
        console.log('[ScatterAnimationManager] Retrigger detected - clearing isBonusFinished to prevent premature congrats');
      }
      gameStateManager.isBonusFinished = false;
    } catch {}
    
    try {
      this.dialogsComponent.showDialog(this.scene, {
        type: 'FreeSpinDialog_KA',
        freeSpins: spins,
        isRetrigger: true
      });
      
      // Emit scatter bonus activated event with explicit spin count for UI syncing
      const eventData = {
        scatterIndex: 0, // not used for retrigger visuals
        actualFreeSpins: spins,
        isRetrigger: true
      };
      console.log(`[ScatterAnimationManager] Emitting retrigger scatterBonusActivated with ${spins} spins (isRetrigger=true)`);
      this.scene.events.emit('scatterBonusActivated', eventData);
      
      // Ensure we reset symbols/animations when the dialog finishes
      this.setupDialogCompletionListener();
    } catch (error) {
      console.error('[ScatterAnimationManager] Error showing retrigger dialog:', error);
    }
  }

  public isAnimationInProgress(): boolean {
    return this.isAnimating;
  }

  /**
   * Set delayed scatter animation data (called when win dialogs need to show first)
   */
  public setDelayedScatterAnimation(data: any): void {
    console.log('[ScatterAnimationManager] Setting delayed scatter animation data');
    this.delayedScatterData = data;
  }



  public resetSymbolsVisibility(): void {
    if (this.symbolsContainer) {
      console.log('[ScatterAnimationManager] WARNING: resetSymbolsVisibility called - this should not happen during scatter bonus!');
      console.log('[ScatterAnimationManager] Stack trace:', new Error().stack);
      this.symbolsContainer.setAlpha(1);
    }
  }

  /**
   * Set up listener for when dialog animations complete
   */
  private setupDialogCompletionListener(): void {
    if (!this.scene) return;
    
    console.log('[ScatterAnimationManager] Setting up dialog completion listener...');
    
    // Listen for dialog completion event
    this.scene.events.once('dialogAnimationsComplete', () => {
      console.log('[ScatterAnimationManager] Dialog animations completed, resetting all symbols and animations');
      this.resetAllSymbolsAndAnimations();
    });
    
    // Also set up a fallback timer in case the event doesn't fire
    setTimeout(() => {
      console.log('[ScatterAnimationManager] Fallback timer triggered for symbol reset');
      this.resetAllSymbolsAndAnimations();
    }, 3000); // 3 second fallback
  }

  /**
   * Check if we're currently in an active bonus mode (free spins)
   */
  private isInActiveBonusMode(): boolean {
    // Check if we have free spins remaining or if we're in bonus mode
    // Use SpinData freespin count
    const hasFreeSpins = this.getCurrentFreeSpinsCount() > 0;
    const isBonusMode = gameStateManager.isBonus;
    
    console.log(`[ScatterAnimationManager] Checking bonus mode: hasFreeSpins=${hasFreeSpins}, isBonus=${isBonusMode}`);
    
    return hasFreeSpins || isBonusMode;
  }

  /**
   * Get the current free spins count from SpinData
   */
  private getCurrentFreeSpinsCount(): number {
    // Try to get free spins count from the current spin data
    if (this.scene) {
      const gameScene = this.scene as any; // Cast to access symbols property
      if (gameScene.symbols) {
        const currentSpinData = gameScene.symbols.currentSpinData;
        if (currentSpinData && currentSpinData.slot && currentSpinData.slot.freespin) {
          return currentSpinData.slot.freespin.count || 0;
        }
      }
    }
    
    // No SpinData available - return 0
    return 0;
  }

  /**
   * Consume one free spin (decrement count)
   * Note: freespin.count should remain the original total count from API response
   */
  public consumeFreeSpin(): void {
    const currentCount = this.getCurrentFreeSpinsCount();
    if (currentCount > 0) {
      const newCount = currentCount - 1;
      console.log(`[ScatterAnimationManager] Consuming free spin: ${currentCount} -> ${newCount}`);
      
      // Note: We should NOT modify freespin.count as it represents the original total won
      // The remaining spins should be tracked separately for display purposes
      
      // Free spins count updated in SpinData
      
      // If no more free spins, end bonus mode
      if (newCount === 0) {
        this.endBonusMode();
      }
    }
  }

  /**
   * End bonus mode when free spins are completed
   */
  public endBonusMode(): void {
    console.log('[ScatterAnimationManager] Ending bonus mode');
    gameStateManager.isBonus = false;
    
    // Note: We should NOT modify freespin.count as it represents the original total won
    // Only clear the items array and totalWin for cleanup
    if (this.scene) {
      const gameScene = this.scene as any; // Cast to access symbols property
      if (gameScene.symbols && gameScene.symbols.currentSpinData) {
        if (gameScene.symbols.currentSpinData.slot && gameScene.symbols.currentSpinData.slot.freespin) {
          // Keep original count - don't modify freespin.count
          gameScene.symbols.currentSpinData.slot.freespin.totalWin = 0;
          gameScene.symbols.currentSpinData.slot.freespin.items = [];
        }
      }
    }
    
    // Free spins data cleared from SpinData (except original count)
    
    // Emit events to switch back to normal mode
    if (this.scene) {
      this.scene.events.emit('hideBonusBackground');
      this.scene.events.emit('hideBonusHeader');
    }
  }

  /**
   * Reset all symbols and animations after scatter bonus completes
   */
  private async resetAllSymbolsAndAnimations(): Promise<void> {
    console.log('[ScatterAnimationManager] Resetting all symbols and animations...');
    
    // Free spin music will be stopped when the dialog closes
    // Bonus music will be triggered when showBonusBackground event is emitted

    try {
      // Reset game state - but don't reset isBonus if we're in an active bonus mode
      gameStateManager.isScatter = false;
      
      // Only reset isBonus if we're not in an active bonus mode (free spins)
      // The bonus mode should persist throughout the free spins
      if (!this.isInActiveBonusMode()) {
        console.log('[ScatterAnimationManager] Not in active bonus mode, resetting isBonus to false');
        gameStateManager.isBonus = false;
      } else {
        console.log('[ScatterAnimationManager] In active bonus mode, keeping isBonus as true');
      }
      
      gameStateManager.scatterIndex = 0;
      
      // Reset symbols container visibility
      if (this.symbolsContainer) {
        this.symbolsContainer.setAlpha(1);
        this.symbolsContainer.setVisible(true);
        console.log('[ScatterAnimationManager] Symbols container reset to visible with alpha 1');
      }
      
      // Re-enable scatter symbols
      this.showScatterSymbols();
      
      // Spinner container cleanup removed
      
      // Do not kill symbol container tweens; keep animations running
      
      // Emit event to notify Symbols component to restore symbol visibility
      if (this.scene) {
        this.scene.events.emit('scatterBonusCompleted');
        console.log('[ScatterAnimationManager] Emitted scatterBonusCompleted event');
      }
      
      console.log('[ScatterAnimationManager] All symbols and animations reset successfully');
      
    } catch (error) {
      console.error('[ScatterAnimationManager] Error resetting symbols and animations:', error);
    }
  }

  // hideSpinner removed (spinner removed)

  private hideScatterSymbols(): void {
    if (!this.scene) return;

    console.log('[ScatterAnimationManager] Hiding scatter symbols...');
    
    // Hide all registered scatter symbols
    this.scatterSymbols.forEach(symbol => {
      if (symbol && !symbol.destroyed) {
        symbol.setVisible(false);
        console.log('[ScatterAnimationManager] Hidden scatter symbol');
      }
    });
    
    console.log(`[ScatterAnimationManager] Hidden ${this.scatterSymbols.length} scatter symbols`);
  }

  private showScatterSymbols(): void {
    if (!this.scene) return;

    console.log('[ScatterAnimationManager] Showing scatter symbols...');
    
    // Show all registered scatter symbols
    this.scatterSymbols.forEach(symbol => {
      if (symbol && !symbol.destroyed) {
        symbol.setVisible(true);
        console.log('[ScatterAnimationManager] Shown scatter symbol');
      }
    });
    
    console.log(`[ScatterAnimationManager] Shown ${this.scatterSymbols.length} scatter symbols`);
  }

  /**
   * Register a scatter symbol for management
   */
  public registerScatterSymbol(symbol: any): void {
    if (symbol && !this.scatterSymbols.includes(symbol)) {
      this.scatterSymbols.push(symbol);
      console.log('[ScatterAnimationManager] Registered scatter symbol');
    }
  }

  /**
   * Unregister a scatter symbol from management
   */
  public unregisterScatterSymbol(symbol: any): void {
    const index = this.scatterSymbols.indexOf(symbol);
    if (index !== -1) {
      this.scatterSymbols.splice(index, 1);
      console.log('[ScatterAnimationManager] Unregistered scatter symbol');
    }
  }

  /**
   * Clear all registered scatter symbols
   */
  public clearScatterSymbols(): void {
    this.scatterSymbols = [];
    console.log('[ScatterAnimationManager] Cleared all scatter symbol references');
  }

  public destroy(): void {
    this.scene = null;
    this.symbolsContainer = null;
    this.isAnimating = false;
    this.wheelSpinStartListener = null;
    this.wheelSpinDoneListener = null;
    console.log('[ScatterAnimationManager] Destroyed');
  }
} 