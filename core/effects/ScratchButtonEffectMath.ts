/** Linear samples over normalized lifetime. A single value is constant; an empty curve is zero. */
export function sampleLifetimeCurve(values: readonly number[], progress: number): number {
	if (values.length === 0) return 0;
	const position = Math.max(0, Math.min(1, progress)) * (values.length - 1);
	const index = Math.floor(position);
	const next = Math.min(index + 1, values.length - 1);
	return values[index] + (values[next] - values[index]) * (position - index);
}
