/**
 * SpinData interface representing the complete spin response from the server
 * This matches the JSON structure returned by the game API
 */

export interface SpinData {
  /** Player ID for the current session */
  playerId: string;
  
  /** Bet amount for this spin */
  bet: string;
  
  /** Slot game data containing the grid and win information */
  slot: SlotData;

  /** Optional unresolved-spin UUID or object provided on scatter-triggering spins */
  unresolvedSpin?: string | { uuid?: string; [key: string]: any };
}

/**
 * Slot data containing the game grid and win information
 */
export interface SlotData {
  /** 3x5 grid of symbols (columns x rows) */
  area: number[][];
  
  /** Array of winning paylines */
  paylines: PaylineData[];

  /** Optional tumble steps for cluster wins (array of steps with in/out and win) */
  tumbles?: any[];
  
  /** Free spin information (lowercase - matches TypeScript interface) */
  freespin: FreespinData;
  
  /** Free spin information (camelCase - matches API response) */
  freeSpin?: FreespinData;

  /** Cumulative bonus total from backend (cap when isMaxWin is active) */
  totalWin?: number;

  /** True when the bonus round hit max win */
  hasMaxWin?: boolean;

  isMaxWin?: boolean;
}

/**
 * Individual payline win data
 */
export interface PaylineData {
  /** Payline identifier (line number) */
  lineKey: number;
  
  /** Symbol that created the win */
  symbol: number;
  
  /** Number of matching symbols in the payline */
  count: number;
  
  /** Win amount for this payline */
  win: number;
  
  /** Multiplier symbols that affect this payline */
  multipliers: MultiplierData[];
}

/**
 * Multiplier symbol data
 */
export interface MultiplierData {
  /** Symbol type that acts as multiplier */
  symbol: number;
  
  /** Number of multiplier symbols */
  count: number;
}

/**
 * Free spin bonus data
 */
export interface FreespinData {
  /** Number of free spins awarded */
  count: number;
  
  /** Total win amount from free spins */
  totalWin: number;
  
  /** Array of individual free spin items */
  items: FreespinItem[];
}

/**
 * Individual free spin item data
 */
export interface FreespinItem {
  /** Number of spins remaining after this spin */
  spinsLeft: number;
  
  /** Backend-reported total win for this specific free spin (may include paylines + tumbles) */
  totalWin?: number;
  
  /** Win amount for this specific free spin */
  subTotalWin: number;
  
  /** 3x5 grid of symbols for this free spin (columns x rows) */
  area: number[][];
  
  /** Array of winning paylines for this free spin */
  payline: PaylineData[];

  /** True when this free spin item reached max win (bonus ends after this spin) */
  isMaxWin?: boolean;
}

/**
 * Utility functions for working with SpinData
 */
export class SpinDataUtils {
  /**
   * Calculate total win amount from all paylines
   */
  static getTotalWin(spinData: SpinData): number {
    const paylines = (spinData && spinData.slot && Array.isArray((spinData.slot as any).paylines))
      ? (spinData.slot as any).paylines as PaylineData[]
      : [];
    return paylines.reduce((total, payline) => total + (payline?.win || 0), 0);
  }

  /** True when this spin has a win — defer balance credit until WIN_STOP (not REELS_STOP). */
  static spinHasWinForBalanceDeferral(spinData: SpinData | null | undefined): boolean {
    if (!spinData?.slot) return false;
    const slotTotal = Number(spinData.slot.totalWin);
    if (Number.isFinite(slotTotal) && slotTotal > 0) return true;
    const paylineWin = this.getTotalWin(spinData);
    if (Number.isFinite(paylineWin) && paylineWin > 0) return true;
    const tumbles = (spinData.slot as any).tumbles;
    if (Array.isArray(tumbles)) {
      for (const tumble of tumbles) {
        const w = Number((tumble as any)?.win ?? 0);
        if (Number.isFinite(w) && w > 0) return true;
        const outs = (tumble as any)?.symbols?.out;
        if (Array.isArray(outs)) {
          for (const out of outs) {
            const ow = Number(out?.win ?? 0);
            if (Number.isFinite(ow) && ow > 0) return true;
          }
        }
      }
    }
    return false;
  }

  /** Authoritative session / spin total for Congrats, TotalWin, and MaxWin displays. */
  static getSlotTotalWin(spinData: SpinData | null | undefined): number {
    const slotTotal = Number(spinData?.slot?.totalWin);
    return Number.isFinite(slotTotal) ? slotTotal : 0;
  }

  /** End-of-bonus dialog total from the bet response (session snapshot preferred). */
  static resolveAuthoritativeSlotTotalWinForDisplay(options?: {
    gameAPI?: {
      getBonusSessionTotalWin?: () => number;
      getBonusSessionSpinData?: () => SpinData | null;
      getCurrentSpinData?: () => SpinData | null;
    } | null;
    symbolsSpinData?: SpinData | null;
  }): number {
    try {
      const sessionTotal = Number(options?.gameAPI?.getBonusSessionTotalWin?.());
      if (Number.isFinite(sessionTotal) && sessionTotal > 0) {
        return sessionTotal;
      }
    } catch {}

    const candidates: Array<SpinData | null | undefined> = [];
    try {
      candidates.push(options?.gameAPI?.getBonusSessionSpinData?.() ?? undefined);
    } catch {}
    try {
      candidates.push(options?.gameAPI?.getCurrentSpinData?.() ?? undefined);
    } catch {}
    if (options?.symbolsSpinData) {
      candidates.push(options.symbolsSpinData);
    }

    for (const spin of candidates) {
      const fromSlot = this.getBackendSlotTotalWin(spin);
      if (fromSlot > 0) {
        return fromSlot;
      }
    }

    for (const spin of candidates) {
      const fs = spin?.slot?.freespin ?? spin?.slot?.freeSpin;
      const fsTotal = Number(fs?.totalWin ?? 0);
      if (Number.isFinite(fsTotal) && fsTotal > 0) {
        return fsTotal;
      }
    }

    return 0;
  }

  /** Number of entries in slot.freespin.items / slot.freeSpin.items. */
  static getFreespinItemsCount(spinData: SpinData | null | undefined): number {
    const fs = spinData?.slot?.freespin ?? spinData?.slot?.freeSpin;
    const items = fs?.items;
    return Array.isArray(items) ? items.length : 0;
  }

  /** Alias for items count (API often omits freeSpin.count). */
  static getFreespinCount(spinData: SpinData | null | undefined): number {
    return SpinDataUtils.getFreespinItemsCount(spinData);
  }

  /** Never show more than `slot.totalWin` when the backend provides it. */
  static clampToSlotTotalWin(
    amount: number,
    spinData: SpinData | null | undefined,
  ): number {
    const value = Number(amount);
    if (!Number.isFinite(value)) {
      return 0;
    }
    const slotTotal = this.getBackendSlotTotalWin(spinData);
    if (slotTotal > 0 && value > slotTotal) {
      return slotTotal;
    }
    return value;
  }

  /** Authoritative `slot.totalWin` from the bet response payload. */
  static getBackendSlotTotalWin(spinData: SpinData | null | undefined): number {
    const slotTotal = Number(spinData?.slot?.totalWin);
    return Number.isFinite(slotTotal) && slotTotal >= 0 ? slotTotal : 0;
  }

  /** True when bet response has bonus or freespin item arrays (final = balance + totalWin). */
  static hasBonusOrFreespinItems(spinData: SpinData | null | undefined): boolean {
    const bonus = spinData?.slot?.bonus?.items;
    if (Array.isArray(bonus) && bonus.length > 0) return true;
    const fs = spinData?.slot?.freeSpin?.items ?? spinData?.slot?.freespin?.items;
    return Array.isArray(fs) && fs.length > 0;
  }

  static extractBetResponseBalance(spinData: any): number | null {
    if (spinData == null) return null;
    const candidates = [
      spinData.balance,
      spinData?.data?.balance,
      spinData.walletBalance,
      spinData?.wallet?.balance,
      spinData?.player?.balance,
    ];
    for (const c of candidates) {
      if (c === undefined || c === null) continue;
      const v = Number(String(c).replace(/,/g, ''));
      if (Number.isFinite(v) && v >= 0) {
        return Math.round(v * 100) / 100;
      }
    }
    return null;
  }

  /** Final balance from bet response: balance + totalWin when bonus/freespin items exist, else balance. */
  static resolveSlotTotalWinForFinalBalance(spinData: SpinData | null | undefined): number {
    let rawTotal = this.getBackendSlotTotalWin(spinData);
    if (rawTotal > 0) {
      return rawTotal;
    }
    const fs = spinData?.slot?.freespin ?? spinData?.slot?.freeSpin;
    const fsTotal = Number(fs?.totalWin ?? 0);
    return Number.isFinite(fsTotal) && fsTotal >= 0 ? fsTotal : 0;
  }

  static resolveFinalBalanceFromBetResponse(spinData: SpinData | null | undefined): number | null {
    const balance = this.extractBetResponseBalance(spinData);
    if (balance === null) return null;
    if (!this.hasBonusOrFreespinItems(spinData)) {
      return balance;
    }
    const tw = this.resolveSlotTotalWinForFinalBalance(spinData);
    return Math.round((balance + tw) * 100) / 100;
  }

  /**
   * When slot.hasMaxWin and raw win exceeds slot.totalWin, show the capped session total everywhere.
   */
  static resolveCappedWinDisplayAmount(
    spinData: SpinData | null | undefined,
    rawAmount: number,
  ): number {
    const raw = Number(rawAmount);
    if (!Number.isFinite(raw) || raw <= 0 || !spinData?.slot) {
      return Number.isFinite(raw) ? raw : 0;
    }
    const slotTotal = Number(spinData.slot.totalWin);
    if (
      spinData.slot.hasMaxWin === true &&
      Number.isFinite(slotTotal) &&
      slotTotal > 0 &&
      raw > slotTotal
    ) {
      return slotTotal;
    }
    return raw;
  }
  
  /**
   * Get all unique symbols that have wins
   */
  static getWinningSymbols(spinData: SpinData): number[] {
    const winningSymbols = new Set<number>();
    const paylines = (spinData && spinData.slot && Array.isArray((spinData.slot as any).paylines))
      ? (spinData.slot as any).paylines as PaylineData[]
      : [];
    paylines.forEach(payline => {
      if (payline && typeof payline.symbol === 'number') winningSymbols.add(payline.symbol);
    });
    return Array.from(winningSymbols);
  }
  
  /**
   * Get all unique multiplier symbols
   */
  static getMultiplierSymbols(spinData: SpinData): number[] {
    const multiplierSymbols = new Set<number>();
    const paylines = (spinData && spinData.slot && Array.isArray((spinData.slot as any).paylines))
      ? (spinData.slot as any).paylines as PaylineData[]
      : [];
    paylines.forEach(payline => {
      const multipliers = (payline && Array.isArray((payline as any).multipliers))
        ? (payline as any).multipliers as MultiplierData[]
        : [];
      multipliers.forEach(multiplier => {
        if (multiplier && typeof multiplier.symbol === 'number') {
          multiplierSymbols.add(multiplier.symbol);
        }
      });
    });
    return Array.from(multiplierSymbols);
  }
  
  /**
   * Check if this spin has any wins
   */
  static hasWins(spinData: SpinData): boolean {
    const paylines = (spinData && spinData.slot && Array.isArray((spinData.slot as any).paylines))
      ? (spinData.slot as any).paylines as PaylineData[]
      : [];
    return paylines.length > 0;
  }
  
  /**
   * Check if this spin triggered free spins
   */
  static hasFreeSpins(spinData: SpinData): boolean {
    return SpinDataUtils.getFreespinItemsCount(spinData) > 0;
  }
  
  /**
   * Get total win amount from all free spins
   */
  static getFreespinTotalWin(spinData: SpinData): number {
    return spinData.slot.freespin?.totalWin || 0;
  }
  
  /**
   * Get all free spin items
   */
  // static getFreespinItems(spinData: SpinData): FreespinItem[] {
  //   return spinData.slot.freespin?.items || [];
  // }
  
  /**
   * Get a specific free spin item by index
   */
  static getFreespinItem(spinData: SpinData, index: number): FreespinItem | null {
    const items = spinData.slot.freespin?.items || [];
    return (index >= 0 && index < items.length) ? items[index] : null;
  }
  
  /**
   * Get the symbol at a specific grid position in a free spin item
   */
  static getFreespinSymbolAt(spinData: SpinData, freespinIndex: number, column: number, row: number): number | null {
    const freespinItem = this.getFreespinItem(spinData, freespinIndex);
    if (!freespinItem) return null;
    
    if (column >= 0 && column < freespinItem.area.length && 
        row >= 0 && row < freespinItem.area[column].length) {
      return freespinItem.area[column][row];
    }
    return null;
  }
  
  /**
   * Get all winning paylines for a specific free spin item
   */
  static getFreespinPaylines(spinData: SpinData, freespinIndex: number): PaylineData[] {
    const freespinItem = this.getFreespinItem(spinData, freespinIndex);
    return freespinItem ? freespinItem.payline : [];
  }
  
  /**
   * Check if a specific free spin item has any wins
   */
  static hasFreespinWins(spinData: SpinData, freespinIndex: number): boolean {
    const paylines = this.getFreespinPaylines(spinData, freespinIndex);
    return paylines.length > 0;
  }
  
  /**
   * Get the symbol at a specific grid position
   */
  static getSymbolAt(spinData: SpinData, column: number, row: number): number | null {
    if (column >= 0 && column < spinData.slot.area.length && 
        row >= 0 && row < spinData.slot.area[column].length) {
      return spinData.slot.area[column][row];
    }
    return null;
  }
  
  /**
   * Get all positions of a specific symbol in the grid
   */
  static getSymbolPositions(spinData: SpinData, symbol: number): Array<{column: number, row: number}> {
    const positions: Array<{column: number, row: number}> = [];
    
    for (let col = 0; col < spinData.slot.area.length; col++) {
      for (let row = 0; row < spinData.slot.area[col].length; row++) {
        if (spinData.slot.area[col][row] === symbol) {
          positions.push({ column: col, row: row });
        }
      }
    }
    
    return positions;
  }
  
  /**
   * Get paylines for a specific symbol
   */
  static getPaylinesForSymbol(spinData: SpinData, symbol: number): PaylineData[] {
    const paylines = (spinData && spinData.slot && Array.isArray((spinData.slot as any).paylines))
      ? (spinData.slot as any).paylines as PaylineData[]
      : [];
    return paylines.filter(payline => payline && payline.symbol === symbol);
  }
  
  /**
   * Calculate win multiplier (total win / bet)
   */
  static getWinMultiplier(spinData: SpinData): number {
    const betAmount = parseFloat(spinData.bet);
    if (betAmount === 0) return 0;
    return this.getTotalWin(spinData) / betAmount;
  }

  static hasMaxWinPayload(spinData: SpinData | null | undefined): boolean {
    return spinData?.slot?.hasMaxWin === true;
  }

  static resolveMaxWinCapTotal(
    spinData: SpinData | null | undefined,
    gameAPI?: { getMaxWinCapTotal?: () => number; getMaxWin?: () => number | null } | null,
  ): number {
    if (spinData?.slot?.hasMaxWin === true) {
      const cap = Number(spinData.slot.totalWin);
      if (Number.isFinite(cap) && cap > 0) {
        return cap;
      }
    }
    const apiCap = Number(gameAPI?.getMaxWinCapTotal?.());
    if (Number.isFinite(apiCap) && apiCap > 0) {
      return apiCap;
    }
    const bet = parseFloat(String(spinData?.bet ?? '0'));
    const maxMult = gameAPI?.getMaxWin?.() ?? null;
    if (Number.isFinite(bet) && bet > 0 && maxMult != null && Number.isFinite(maxMult) && maxMult > 0) {
      return bet * maxMult;
    }
    return 0;
  }

  static getFreespinItems(spinData: SpinData | null | undefined): FreespinItem[] {
    const fs = spinData?.slot?.freespin ?? spinData?.slot?.freeSpin;
    const items = fs?.items;
    return Array.isArray(items) ? items : [];
  }

  static getFreespinRunningWin(spinData: SpinData | null | undefined, itemIndex: number): number {
    const items = this.getFreespinItems(spinData);
    const item = items[itemIndex];
    const n = Number(item?.subTotalWin ?? item?.totalWin);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }

  static isMaxWinTerminalFreespinItem(
    spinData: SpinData | null | undefined,
    itemIndex?: number,
  ): boolean {
    const items = this.getFreespinItems(spinData);
    if (items.length === 0) {
      return false;
    }
    const idx = itemIndex ?? items.length - 1;
    return items[idx]?.isMaxWin === true;
  }

  static hasRunningWinReachedMaxWinCap(
    spinData: SpinData | null | undefined,
    maxWinCapTotal?: number,
    itemIndex?: number,
  ): boolean {
    if (itemIndex != null && this.isMaxWinTerminalFreespinItem(spinData, itemIndex)) {
      return true;
    }
    if (!this.hasMaxWinPayload(spinData)) {
      return false;
    }
    let cap = Number(maxWinCapTotal);
    if (!Number.isFinite(cap) || cap <= 0) {
      cap = this.resolveMaxWinCapTotal(spinData);
    }
    if (cap <= 0) {
      return false;
    }
    if (itemIndex != null) {
      return this.getFreespinRunningWin(spinData, itemIndex) >= cap;
    }
    for (const item of this.getFreespinItems(spinData)) {
      if (item?.isMaxWin === true) {
        return true;
      }
      const sub = Number(item?.subTotalWin ?? item?.totalWin);
      if (Number.isFinite(sub) && sub >= cap) {
        return true;
      }
    }
    return false;
  }
}

/** Mark remaining freespin steps resolved once max win is hit (`spinsLeft` → 0 from terminal item onward). */
export function resolveMaxWinRemainingFreespinItems(spinData: SpinData | null | undefined): SpinData | null {
  if (!spinData?.slot) {
    return spinData ?? null;
  }
  const fs = spinData.slot.freespin || spinData.slot.freeSpin;
  if (!fs?.items?.length) {
    return spinData;
  }
  const items = fs.items;
  let maxWinIdx = items.findIndex((it) => it?.isMaxWin === true);
  if (maxWinIdx < 0) {
    const cap = SpinDataUtils.resolveMaxWinCapTotal(spinData);
    if (cap > 0) {
      maxWinIdx = items.findIndex((it) => {
        const sub = Number(it?.subTotalWin ?? it?.totalWin);
        return Number.isFinite(sub) && sub >= cap;
      });
    }
  }
  if (maxWinIdx < 0) {
    return spinData;
  }
  items[maxWinIdx].spinsLeft = 0;
  fs.count = 0;
  for (let i = maxWinIdx + 1; i < items.length; i++) {
    items[i].spinsLeft = 0;
  }
  if (spinData.slot.freespin) {
    spinData.slot.freespin = fs;
  }
  if (spinData.slot.freeSpin) {
    spinData.slot.freeSpin = fs;
  }
  return spinData;
}
