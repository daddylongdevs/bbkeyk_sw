import { Data } from './Data';
import { SymbolDetector, Wins } from './SymbolDetector';
import { Payout } from './Payout';
import { SymbolGenerator } from './SymbolGenerator';
import { gameEventManager, GameEventType } from '../event/EventManager';
import { gameStateManager } from '../managers/GameStateManager';
import { TurboConfig } from '../config/TurboConfig';
import { GameAPI } from '../backend/GameAPI';
import { SpinData } from '../backend/SpinData';

export class Backend {
  public static data: Data = new Data();
  private static isProcessing = false;
  private static currentOperation: string | null = null;
  private static pendingRequests: Map<string, { type: string; timestamp: number }> = new Map();
  public static isFirstSpin = true; // Track if this is the first spin
  private static gameAPI: GameAPI | null = null;
  
  public static init() {
    // Initialize the EventManager
    gameEventManager.initialize();
    
    // Emit backend ready status
    BackendHelpers.emitBackendStatus('READY', 'Backend initialized and ready');
    
    let data = Backend.data;
    gameEventManager.on(GameEventType.START, () => {
      console.log('[Backend] START event received');
      data.spinTimer = data.delayBetweenSpins;
      data.init = true;
      data.wins = new Wins(new Map());
      
      // Load fixed initial symbols
      loadInitialSymbols(data);
      
      data.totalWins = 0;

      console.log('[Backend] Processing payout and emitting RESPONSE');
      
      // Emit response with initial data for frontend display using existing helper
      const initialResponseData = BackendHelpers.createSpinResponse(
        data.symbols,
        data.wins,
        0, // No payout on game start
        data.balance,
        gameStateManager.isBonus,
        'START'
      );
      
      console.log('[Backend] Complete initial response data (SPIN_RESPONSE removed - using SPIN_DATA_RESPONSE):', initialResponseData);
      
      data.init = false;
      console.log('[Backend] START event processed');
    });

    gameEventManager.on(GameEventType.SPIN, () => {
      // Handle both manual and autoplay spins
      console.log(`[Backend] SPIN event received. Current state: isAutoPlaying=${gameStateManager.isAutoPlaying}, autoplaySpinsRemaining=${data.autoplaySpinsRemaining}, isBonus=${gameStateManager.isBonus}`);
      
      // Check if we're in bonus mode - if so, let the free spin autoplay system handle it
      if (gameStateManager.isBonus) {
        console.log('[Backend] In bonus mode - skipping old spin system, free spin autoplay will handle it');
        return;
      }
      
      if (gameStateManager.isAutoPlaying) {
        // This is an autoplay spin
        console.log('[Backend] Autoplay spin triggered via SPIN event');
        
        // Check if win dialog is showing - pause autoplay if so
        if (gameStateManager.isShowingWinDialog) {
          console.log('[Backend] Win dialog is showing - pausing autoplay spin');
          // Don't process the autoplay spin - it will be retried later
          return;
        }
        
        // Check if we have autoplay spins remaining
        if (data.autoplaySpinsRemaining > 0) {
          console.log(`[Backend] Processing autoplay spin. ${data.autoplaySpinsRemaining} spins remaining.`);
          
          // Apply speed based on turbo state
          const spinDelay = gameStateManager.isTurbo ? Data.DELAY_BETWEEN_SPINS * TurboConfig.TURBO_SPEED_MULTIPLIER : Data.DELAY_BETWEEN_SPINS;
          setSpeed(Backend.data, spinDelay);
          
          // Process the autoplay spin
          spin(Backend.data);
        } else {
          console.log('[Backend] No autoplay spins remaining, stopping autoplay');
          gameStateManager.isAutoPlaying = false;
          data.autoplaySpinsRemaining = 0;
          data.autoplayTotalSpins = 0;
          
          // Emit AUTO_STOP event
          gameEventManager.emit(GameEventType.AUTO_STOP);
        }
      } else {
        // This is a manual spin
        console.log('[Backend] Manual spin triggered via SPIN event');
        
        // Process manual spin immediately
        console.log('[Backend] Processing manual spin immediately');
        
        // Apply speed based on turbo state
        const spinDelay = gameStateManager.isTurbo ? Data.DELAY_BETWEEN_SPINS * TurboConfig.TURBO_SPEED_MULTIPLIER : Data.DELAY_BETWEEN_SPINS;
        setSpeed(Backend.data, spinDelay);
        
        // Process the spin immediately
        spin(Backend.data);
      }
    });

    
    gameEventManager.on(GameEventType.AUTO_START, (eventData) => {
      const spinCount = (eventData as any)?.spinCount || 1;
      console.log(`[Backend] AUTO_START event received with data:`, eventData);
      console.log(`[Backend] Starting autoplay with ${spinCount} spins`);
      
      // Check if we're in bonus mode - if so, let the free spin autoplay system handle it
      if (gameStateManager.isBonus) {
        console.log('[Backend] In bonus mode - skipping old autoplay system, free spin autoplay will handle it');
        return;
      }
      
      // Check if win dialog is showing - don't start autoplay if so
      if (gameStateManager.isShowingWinDialog) {
        console.log('[Backend] Win dialog is showing - delaying autoplay start');
        // Don't start autoplay while win dialog is showing
        // The frontend will retry when the dialog closes
        return;
      }
      
      gameStateManager.isNormalSpin = false;
      gameStateManager.isAutoPlaying = true;
      data.autoplaySpinsRemaining = spinCount;
      data.autoplayTotalSpins = spinCount;
      console.log(`[Backend] Autoplay state set: isAutoPlaying=${gameStateManager.isAutoPlaying}, spinsRemaining=${data.autoplaySpinsRemaining}`);
      
      // Start the first autoplay spin
      console.log('[Backend] Starting first autoplay spin');
      gameEventManager.emit(GameEventType.SPIN);
    });

    // Stop autoplay
    gameEventManager.on(GameEventType.AUTO_STOP, () => {
      console.log('[Backend] Stopping autoplay');
      gameStateManager.isAutoPlaying = false;
      data.autoplaySpinsRemaining = 0;
      data.autoplayTotalSpins = 0;
      // Removed isShowingWinlines and isAutoPlaySpinRequested - no longer needed
      
      console.log('[Backend] Autoplay stopped successfully');
    });

    // Balance update after reels stop spinning
    gameEventManager.on(GameEventType.BALANCE_UPDATE, () => {
      console.log('[Backend] Balance update requested - processing pending balance update');
      
      if (data.pendingBalanceUpdate) {
        // Apply the pending balance update (add winnings to balance)
        data.balance = data.pendingBalanceUpdate.finalBalance;
        console.log(`[Backend] Balance updated: bet deducted (${data.pendingBalanceUpdate.betDeducted}), winnings added (${data.pendingBalanceUpdate.winnings}), final balance: ${data.balance}`);
        
        // Clear the pending update
        data.pendingBalanceUpdate = undefined;
        
      } else {
        console.log('[Backend] No pending balance update found');
      }
    });

    gameEventManager.on(GameEventType.TURBO_ON, () => {
      gameStateManager.isTurbo = true;
      console.log(`[Backend] Turbo state updated to: ${gameStateManager.isTurbo}`);
    });

    gameEventManager.on(GameEventType.TURBO_OFF, () => {
      gameStateManager.isTurbo = false;
      console.log(`[Backend] Turbo state updated to: ${gameStateManager.isTurbo}`);
    });

    // Bet amount update from frontend
    gameEventManager.on(GameEventType.BET_UPDATE, (eventData) => {
      const betAmount = (eventData as any)?.newBet || data.bet;
      console.log(`[Backend] Bet amount updated to: ${betAmount}`);
      data.bet = betAmount;
    });
  }


}

function spin(data: Data) {
  console.log('[Backend] spin() function called');
  
  // Emit backend busy status
  BackendHelpers.emitBackendStatus('BUSY', 'Processing spin request', 'SPIN');
  
  gameStateManager.isReelSpinning = true;
  gameStateManager.isAutoPlaySpinRequested = false; // Reset the flag when spin starts
  setNewSymbols(data);
  processWinlines(data);
  
  // Store the bet amount and current balance for later processing
  const betAmount = data.bet;
  const currentBalance = data.balance;
  
  // Deduct bet immediately (this affects the backend state)
  data.balance -= betAmount;
  data.totalWins = 0;
  
  // Decrement autoplay counter if autoplay is active
  if (gameStateManager.isAutoPlaying && data.autoplaySpinsRemaining > 0) {
    data.autoplaySpinsRemaining--;
    console.log(`[Backend] Autoplay spin completed. ${data.autoplaySpinsRemaining} spins remaining.`);
    
    // Check if autoplay should continue
    if (data.autoplaySpinsRemaining > 0) {
      console.log(`[Backend] Autoplay will continue with ${data.autoplaySpinsRemaining} spins remaining`);
    } else {
      console.log(`[Backend] Autoplay completed - no more spins remaining`);
      gameStateManager.isAutoPlaying = false;
    }
  }
  
  // Calculate payout but don't add to balance yet
  const payout = Payout.calc(data);
  data.totalWins = payout;
  
  // Store the pending balance update (bet deducted, winnings not yet added)
  data.pendingBalanceUpdate = {
    betDeducted: betAmount,
    winnings: payout,
    finalBalance: currentBalance - betAmount + payout
  };
  
  // Winline management moved to frontend - backend no longer emits winline events
  
  // Emit response with current state (bet deducted, winnings not yet added)
  console.log('[Backend] Creating spin response with wins:', data.wins);
  console.log('[Backend] Wins allMatching size:', data.wins.allMatching.size);
  
  // Calculate the actual payout for this spin
  const actualPayout = Payout.calc(data);
  console.log(`[Backend] Calculated payout for this spin: $${actualPayout}`);
  
  const responseData = BackendHelpers.createSpinResponse(
    data.symbols,
    data.wins,  // Send the complete wins object instead of just winLines
    actualPayout, // Send the actual payout instead of totalWins
    data.balance,
    gameStateManager.isBonus,
    gameStateManager.isAutoPlaying ? 'AUTO_SPIN' : 'SPIN'
  );
  
  // Add autoplay state information to the response
  responseData.isAutoPlaying = gameStateManager.isAutoPlaying;
  responseData.autoplaySpinsRemaining = data.autoplaySpinsRemaining;
  responseData.autoplayTotalSpins = data.autoplayTotalSpins;
  
  console.log(`[Backend] Spin response includes autoplay state: isAutoPlaying=${responseData.isAutoPlaying}, spinsRemaining=${responseData.autoplaySpinsRemaining}, totalSpins=${responseData.autoplayTotalSpins}`);
  
  // Add the delayBetweenSpins property that the frontend needs
  responseData.delayBetweenSpins = data.delayBetweenSpins;
  
  console.log('[Backend] Complete response data (SPIN_RESPONSE removed - using SPIN_DATA_RESPONSE):', responseData);
  
  // Emit backend ready status after response
  BackendHelpers.emitBackendStatus('READY', 'Spin response completed', 'SPIN', responseData.responseId);
}


function setSpeed(data: Data, delay: number) {
  data.delayBetweenSpins = delay;
  data.spinTimer = delay;
}

/**
 * Helper methods for response tracking and backend status management
 */
export namespace BackendHelpers {
  /**
   * Generate a unique response ID
   */
  export function generateResponseId(): string {
    return `resp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Create a complete SpinResponseEventData object
   */
  export function createSpinResponse(
    symbols: any[],
    wins: any,  // Changed from winLines: any[] to wins: any
    payout: number,
    balance: number,
    isBonus: boolean,
    requestType: 'SPIN' | 'AUTO_SPIN' | 'START' = 'SPIN'
  ): any {
    return {
      symbols,
      wins,  // Changed from winLines to wins
      payout,
      balance,
      bet: Backend.data.bet, // Add the bet amount to the response
      isBonus,
      responseId: BackendHelpers.generateResponseId(),
      timestamp: Date.now(),
      requestType,
      status: 'SUCCESS' as const,
      message: 'Spin response completed successfully'
    };
  }

  /**
   * Emit backend status event
   */
  export function emitBackendStatus(
    status: 'READY' | 'BUSY' | 'PROCESSING' | 'ERROR',
    message: string,
    currentOperation?: string,
    responseId?: string
  ): void {
    gameEventManager.emit(GameEventType.BACKEND_READY, {
      status,
      currentOperation,
      timestamp: Date.now(),
      message,
      responseId
    });
  }

  /**
   * Force a scatter pattern for testing purposes
   * This will generate symbols that guarantee a scatter win
   */
  export function forceScatterForTesting(): void {
    console.log('[Backend] Forcing scatter pattern for testing');
    
    // Set symbols that will create a scatter (symbol 0 in rows 0, 2, 4)
    Backend.data.symbols = [
      [0, 1, 0, 1, 0],  // Column 0: scatter in rows 0, 2, 4
      [0, 1, 0, 1, 0],  // Column 1: scatter in rows 0, 2, 4
      [0, 1, 0, 1, 0]   // Column 2: scatter in rows 0, 2, 4
    ];
    
    console.log('[Backend] Forced scatter symbols set (rows 0,2,4):', Backend.data.symbols);
    console.log('[Backend] Next spin will trigger scatter bonus');
  }
}


function setNewSymbols(data: Data) {
  console.log('[Backend] setNewSymbols called');
  console.log('[Backend] Current symbols:', data.symbols);
  
  const symbolGenerator = new SymbolGenerator();
  if (gameStateManager.isBonus && data.freeSpins > 0) {
    //data.symbols = symbolGenerator.generate(Data.SCATTER);

    // data.bonusCount--;
    // if (data.bonusCount === 0) {
    //   data.isBonus = false;
    // }
    // console.log(`Bonus count: ${data.bonusCount} isScatter: ${data.isBonus} isBonus: ${data.isBonus}`);
  } 
  
  if (!gameStateManager.isScatter && !gameStateManager.isBonus) {
    console.log('[Backend] Generating new symbols...');
    
    // FOR TESTING: Force scatter on first actual spin
    if (Backend.isFirstSpin) {
      console.log('[Backend] First spin - forcing scatter for testing');

      // data.symbols = [
      //   [0, 1, 1, 1, 1],  // Column 0: scatter in rows 0, 2, 4
      //   [1, 1, 0, 1, 1],  // Column 1: scatter in rows 0, 2, 4
      //   [1, 1, 1, 1, 0]   // Column 2: scatter in rows 0, 2, 4
      // ];

      data.symbols = symbolGenerator.generate();

      console.log('[Backend] Forced scatter symbols set for first spin (rows 0,2,4):', data.symbols);
      Backend.isFirstSpin = false; // Mark that first spin is done
    } else {
      data.symbols = symbolGenerator.generate();
      console.log('[Backend] New symbols generated:', data.symbols);
    }
    
    //  data.symbols = [
    //    [0, 1, 0, 1, 0],
    //    [5, 5, 5, 5, 2],
    //    [5, 5, 5, 5, 5]
    //  ];


    //  data.symbols = [
    //    [5, 5, 5, 4, 4],
    //    [5, 5, 5, 5, 5],
    //    [5, 5, 5, 4, 4]
    //  ];
  }

  console.log('[Backend] Final symbols after setNewSymbols:', data.symbols);
}

function processWinlines(data: Data) {
  const symbolDetector = new SymbolDetector();
  const wins = symbolDetector.getWins(data);
  data.wins = wins;

  const scatterGrids = symbolDetector.getScatterGrids(data);
  if (scatterGrids.length >= 4) {
    gameStateManager.isScatter = true;
    // Note: We don't set data.freeSpins here because data.scatterIndex is not available yet
    // The frontend will handle setting the free spins value when the scatter bonus is activated
    console.log('[Backend] Scatter detected, but freeSpins will be set by frontend when bonus is activated');
    
    // Stop autoplay when scatter is hit
    // This ensures the player can enjoy the bonus feature without autoplay continuing
    if (gameStateManager.isAutoPlaying) {
      console.log('[Backend] Scatter hit during autoplay - stopping autoplay');
      console.log(`[Backend] Previous autoplay state: ${gameStateManager.isAutoPlaying}, spins remaining: ${data.autoplaySpinsRemaining}`);
      gameStateManager.isAutoPlaying = false;
      data.autoplaySpinsRemaining = 0;
      data.autoplayTotalSpins = 0;
      
      // Emit AUTO_STOP event to notify frontend
      gameEventManager.emit(GameEventType.AUTO_STOP);
      console.log('[Backend] AUTO_STOP event emitted, autoplay stopped due to scatter');
      
      // Note: Autoplay will remain stopped after bonus completes
      // Player must manually restart autoplay if desired
    }
  }
}

function processPayout(data: Data) {
  const payout = Payout.calc(data);
  data.balance += payout;
  data.totalWins += payout;
}

function loadInitialSymbols(data: Data) {
  // Set fixed initial symbols for consistent game start
  data.symbols = [
    [0, 1, 3, 1, 0],  // Column 0: scatter, symbol1, symbol3, symbol1, scatter
    [1, 5, 2, 5, 2],  // Column 1: symbol1, symbol5, symbol2, symbol5, symbol2
    [2, 5, 5, 1, 5]   // Column 2: symbol2, symbol5, symbol5, symbol1, symbol5
  ];
  
  console.log('[Backend] Loaded fixed initial symbols:', data.symbols);
}

