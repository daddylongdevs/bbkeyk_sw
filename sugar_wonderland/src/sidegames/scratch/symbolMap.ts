/** Scratch symbol names as serialized by galaxite (enum string). */
export type ScratchSymbolName =
	| 'Blank'
	| 'Star'
	| 'Diamond'
	| 'Crown'
	| 'Gem'
	| 'Coin'
	| 'Ms1'
	| 'Ms2'
	| 'Jackpot'
	| string;

/**
 * Map galaxite scratch symbols → sugar_wonderland static texture keys
 * (`symbol0`–`symbol9` from AssetConfig.getSymbolAssets).
 *
 * Prize tier → match symbol (server `ScratchSymbolMapping`):
 *   Small* → Star, Medium* → Diamond, Large* → Crown,
 *   Premium* → Gem, Mega* → Coin, Jackpot → Jackpot
 */
export const SCRATCH_SYMBOL_TEXTURE: Record<string, string | null> = {
	Blank: 'dijoker_face',
	Star: 'symbol2',
	Diamond: 'symbol3',
	Crown: 'symbol4',
	Gem: 'symbol5',
	Coin: 'symbol6',
	/** `Symbol10.png` — bomb art; grid uses SymbolBombs_SW Spine (no number overlay). */
	Ms1: 'Symbol10',
	/** `sugar_symbols/statics/symbol0.webp` — scatter art (static in cell). */
	Ms2: 'symbol0',
	Jackpot: 'symbol7',
};

/** Shared Spine for slot multipliers (Ms1 bombs). */
export const SCRATCH_MULTIPLIER_SPINE_KEY = 'symbol_bombs_sw';

/**
 * Scratch Ms values → bomb anim inside SymbolBombs_SW (no PNG number overlay).
 * Ms1 → Symbols10_SW. Ms2 uses static `symbol0` (not bomb spine).
 */
export const SCRATCH_MULTIPLIER_ANIM_BASE: Record<number, string> = {
	10: 'Symbols10_SW',
	11: 'Symbols12_SW',
};

/** Numeric symbol id used by sugar Spine assets (`symbol_N_sugar_spine`). */
export const SCRATCH_SYMBOL_VALUE: Record<string, number | null> = {
	Blank: null,
	/** Bomb anim `Symbols10_SW` (value 10 in SymbolBombs_SW). */
	Ms1: 10,
	/** Static `symbol0`; value 11 keeps Ms2 paytable / special identity. */
	Ms2: 11,
	Star: 2,
	Diamond: 3,
	Crown: 4,
	Gem: 5,
	Coin: 6,
	Jackpot: 7,
};

/** Animation suffix for this game’s Spine clips (`Symbol2_SW_Win`). */
export const SCRATCH_SPINE_ANIM_SUFFIX = 'SW';

/** Base (non-Ms) legend rows for UI — multipliers × bet. */
export const SCRATCH_BASE_PAY_LEGEND: ReadonlyArray<{
	symbol: ScratchSymbolName;
	label: string;
	multiplier: number;
	jackpotByGrid?: { three: number; four: number; five: number };
}> = [
	{ symbol: 'Star', label: 'Star', multiplier: 1 },
	{ symbol: 'Diamond', label: 'Diamond', multiplier: 2 },
	{ symbol: 'Crown', label: 'Crown', multiplier: 5 },
	{ symbol: 'Gem', label: 'Gem', multiplier: 10 },
	{ symbol: 'Coin', label: 'Coin', multiplier: 25 },
	{
		symbol: 'Jackpot',
		label: 'Jackpot',
		multiplier: 200,
		jackpotByGrid: { three: 100, four: 100, five: 200 },
	},
];

/** Mystery boost factors (server paytable: base×2 / base×3 / base×6). */
export const SCRATCH_MS1_FACTOR = 2;
export const SCRATCH_MS2_FACTOR = 3;

export function isScratchSpecialSymbol(symbol: string | null | undefined): boolean {
	return symbol === 'Ms1' || symbol === 'Ms2';
}

export function isScratchMultiplierValue(value: number | null | undefined): boolean {
	return typeof value === 'number' && value >= 10 && value <= 22;
}

/** Animation base inside `SymbolBombs_SW` for scratch Ms1/Ms2. */
export function scratchMultiplierAnimBase(value: number): string | null {
	return SCRATCH_MULTIPLIER_ANIM_BASE[value] ?? null;
}

export function scratchMultiplierOverlayKey(value: number): string | null {
	if (!isScratchMultiplierValue(value)) return null;
	return `multiplier_overlay_${value}`;
}

export function baseMultiplierForMatchSymbol(
	symbol: string,
	gridDim: number = 5,
): number {
	const row = SCRATCH_BASE_PAY_LEGEND.find((r) => r.symbol === symbol);
	if (!row) return 0;
	if (row.jackpotByGrid) {
		if (gridDim <= 3) return row.jackpotByGrid.three;
		if (gridDim === 4) return row.jackpotByGrid.four;
		return row.jackpotByGrid.five;
	}
	return row.multiplier;
}

/** Static PNGs for the pay legend (Ms1 bomb / Ms2 scatter without overlay). */
export const SCRATCH_LEGEND_TEXTURE: Record<string, string> = {
	Ms1: 'Symbol10',
	Ms2: 'symbol0',
};

export function textureKeyForScratchSymbol(symbol: ScratchSymbolName): string | null {
	if (!symbol) {
		return null;
	}
	if (Object.prototype.hasOwnProperty.call(SCRATCH_SYMBOL_TEXTURE, symbol)) {
		return SCRATCH_SYMBOL_TEXTURE[symbol] ?? null;
	}
	return 'symbol8';
}

export function legendTextureKeyForScratchSymbol(symbol: ScratchSymbolName): string | null {
	if (symbol && Object.prototype.hasOwnProperty.call(SCRATCH_LEGEND_TEXTURE, symbol)) {
		return SCRATCH_LEGEND_TEXTURE[symbol];
	}
	return textureKeyForScratchSymbol(symbol);
}

export function symbolValueForScratchSymbol(symbol: ScratchSymbolName): number | null {
	if (!symbol) {
		return null;
	}
	if (Object.prototype.hasOwnProperty.call(SCRATCH_SYMBOL_VALUE, symbol)) {
		return SCRATCH_SYMBOL_VALUE[symbol] ?? null;
	}
	return 8;
}
