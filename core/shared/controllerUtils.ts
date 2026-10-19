const DEFAULT_STARTING_BET_INDEX = 4;

/**
 * Resolve the opening bet from a ladder and initialize `defaultBetIndex`.
 * Inject the ladder and raw index — do not read GameAPI from here.
 */
export function getStartingBet(
	betLevels: number[] | undefined | null,
	rawIndex: unknown,
	fallback = 0.2,
	fallbackIndex = DEFAULT_STARTING_BET_INDEX,
): number {
	const indexValue = Number(rawIndex);
	const startingBetIndex =
		Number.isFinite(indexValue) && indexValue >= 0
			? Math.floor(indexValue)
			: fallbackIndex;
	if (!betLevels?.length) {
		return fallback;
	}
	const bet = Number(betLevels[startingBetIndex] ?? betLevels[0] ?? fallback);
	return Number.isFinite(bet) ? bet : fallback;
}
