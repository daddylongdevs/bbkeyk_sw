/** True when a bet/spin failed with no usable HTTP response (offline / fetch failed). */
export function isNetworkOfflineBetError(error: unknown): boolean {
	if (typeof navigator !== 'undefined' && navigator.onLine === false) {
		return true;
	}
	const msg =
		error instanceof Error
			? error.message
			: typeof error === 'string'
				? error
				: typeof (error as { message?: unknown })?.message === 'string'
					? ((error as { message: string }).message)
					: '';
	const m = msg.toLowerCase();
	if (!m) return false;
	return (
		m.includes('failed to fetch') ||
		m.includes('networkerror when attempting to fetch') ||
		m.includes('networkerror') ||
		m.includes('load failed') ||
		m.includes('network request failed')
	);
}
