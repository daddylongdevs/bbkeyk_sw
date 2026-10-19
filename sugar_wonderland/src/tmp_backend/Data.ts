import { Wins } from "./SymbolDetector";
import { 
  SLOT_COLUMNS, 
  SLOT_ROWS, 
  SCATTER_SYMBOL, 
  NORMAL_SYMBOLS, 
  MULTIPLIER_SYMBOLS, 
  ALL_SYMBOLS, 
  DELAY_BETWEEN_SPINS,
  WINLINES 
} from "../config/GameConfig";

export class Data {
  public static SLOT_COLUMNS: number = SLOT_COLUMNS;
  public static SLOT_ROWS: number = SLOT_ROWS;
  public static SCATTER: number[] = SCATTER_SYMBOL;
  public static NORMAL_SYMBOLS: number[] = NORMAL_SYMBOLS;
  public static WILDCARDS: number[] = MULTIPLIER_SYMBOLS;
  public static ALL_SYMBOLS: number[] = ALL_SYMBOLS;
  public static DELAY_BETWEEN_SPINS: number = DELAY_BETWEEN_SPINS;

  public static WINLINES: number[][][] = WINLINES;
  public symbols: number[][];
  public wins: Wins;

  public balance: number = 200100;
  public totalWins: number = 0;
  public bet: number = 10;

  public scatterIndex: number = 0;

  public freeSpins: number = 0;

  // Balance update tracking for delayed updates
  public pendingBalanceUpdate?: {
    betDeducted: number;
    winnings: number;
    finalBalance: number;
  };


  public init: boolean = true;

  // Note: The following states have been moved to GameStateManager in the frontend:
      // - timeScale, isScatter, isBonus, isReelSpinning, isNormalSpin
  // - isAutoPlaying, isTurbo, isAutoPlaySpinRequested, isShowingWinlines
  
  // Autoplay count management
  public autoplaySpinsRemaining: number = 0;
  public autoplayTotalSpins: number = 0;

  public delayBetweenSpins: number = Data.DELAY_BETWEEN_SPINS;
  public spinTimer: number = 0;
  
  constructor() {
    // rows x columns -> 5 rows, 6 columns
    this.symbols = [
      [1, 5, 1, 4, 1, 2],
      [8, 3, 2, 4, 1, 3],
      [1, 2, 3, 1, 4, 5],
      [5, 4, 2, 3, 2, 1],
      [2, 1, 4, 5, 3, 8],
    ];
  }
}