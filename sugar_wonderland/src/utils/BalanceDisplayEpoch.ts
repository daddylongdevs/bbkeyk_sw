type BalanceEpochListener = () => void;

let balanceDisplayEpoch = 0;
let armedBalanceEpoch: number | null = null;
/** Generation claimed when the spin request started. Later spin paints reuse it. */
let latchedSpinBalanceEpoch: number | null = null;
const listeners = new Set<BalanceEpochListener>();

/** Start a wallet update. Older in-flight responses must not paint the HUD. */
export function claimBalanceDisplayEpoch(): number {
	balanceDisplayEpoch += 1;
	for (const listener of listeners) {
		try {
			listener();
		} catch {
			/* ignore */
		}
	}
	return balanceDisplayEpoch;
}

export function currentBalanceDisplayEpoch(): number {
	return balanceDisplayEpoch;
}

/** One generation for a spin request, shared by the optimistic deduction and the response. */
export function armBalanceDisplayEpoch(): number {
	armedBalanceEpoch = claimBalanceDisplayEpoch();
	latchedSpinBalanceEpoch = armedBalanceEpoch;
	return armedBalanceEpoch;
}

export function peekArmedBalanceDisplayEpoch(): number | null {
	return armedBalanceEpoch;
}

export function takeArmedBalanceDisplayEpoch(): number | null {
	const epoch = armedBalanceEpoch;
	armedBalanceEpoch = null;
	if (epoch != null) latchedSpinBalanceEpoch = epoch;
	return epoch;
}

/**
 * Use an explicit generation, the in-flight spin generation, or the generation
 * latched when the spin started. Claim a new generation only when this paint
 * is not a delayed spin wallet.
 */
export function resolveSpinBalanceEpoch(explicit?: number | null): number {
	if (explicit != null && Number.isFinite(explicit)) return explicit;
	if (armedBalanceEpoch != null) return armedBalanceEpoch;
	if (latchedSpinBalanceEpoch != null) return latchedSpinBalanceEpoch;
	return claimBalanceDisplayEpoch();
}

export function onBalanceDisplayEpochClaimed(listener: BalanceEpochListener): void {
	listeners.add(listener);
}

let renderedBalanceTimestamp = 0;

/** Numeric DJService actions timestamp. Missing or non-positive values are unordered. */
export function coerceWalletTimestamp(timestamp: unknown): number | undefined {
	if (timestamp == null || timestamp === '') return undefined;
	const value = typeof timestamp === 'number' ? timestamp : Number(timestamp);
	if (!Number.isFinite(value) || value <= 0) return undefined;
	return value;
}

/** Timestamp of the balance currently shown. 0 means no wallet version has been applied yet. */
export function renderedWalletTimestamp(): number {
	return renderedBalanceTimestamp;
}

/** True when this response's timestamp is older than the balance already shown. */
export function isStaleWalletTimestamp(timestamp: unknown): boolean {
	const value = coerceWalletTimestamp(timestamp);
	return value != null && value < renderedBalanceTimestamp;
}

/** Remember the timestamp of the balance that is now the one on screen. */
export function noteRenderedBalanceTimestamp(timestamp: unknown): void {
	const value = coerceWalletTimestamp(timestamp);
	if (value != null && value >= renderedBalanceTimestamp) {
		renderedBalanceTimestamp = value;
	}
}

/**
 * DJService actions timestamp on PlayerDto. The HUD keeps the balance with the
 * highest timestamp. A response that includes a lower timestamp is ignored.
 * A missing timestamp is not ordered against the wallet version.
 */
export function acceptRenderedBalanceTimestamp(timestamp: unknown): boolean {
	if (isStaleWalletTimestamp(timestamp)) return false;
	noteRenderedBalanceTimestamp(timestamp);
	return true;
}

/** Timestamp from a wallet payload, including player.timestamp / player.Timestamp. */
export function readWalletTimestamp(source: unknown): number | undefined {
	if (source == null || typeof source !== 'object') {
		return coerceWalletTimestamp(source);
	}
	const obj = source as {
		timestamp?: unknown;
		Timestamp?: unknown;
		player?: { timestamp?: unknown; Timestamp?: unknown };
		data?: {
			timestamp?: unknown;
			Timestamp?: unknown;
			player?: { timestamp?: unknown; Timestamp?: unknown };
		};
		wallet?: { timestamp?: unknown; Timestamp?: unknown };
	};
	return coerceWalletTimestamp(
		obj.timestamp ??
		obj.Timestamp ??
		obj.player?.timestamp ??
		obj.player?.Timestamp ??
		obj.data?.timestamp ??
		obj.data?.Timestamp ??
		obj.data?.player?.timestamp ??
		obj.data?.player?.Timestamp ??
		obj.wallet?.timestamp ??
		obj.wallet?.Timestamp
	);
}
