export interface CanvasFrameSource {
	/** Optional caller-owned layer identity, retained for ordered mixed live/cached playback. */
	id?: string;
	x: number;
	y: number;
	width: number;
	height: number;
	blendMode?: GlobalCompositeOperation;
	draw(context: CanvasRenderingContext2D): void;
}

export interface CachedCanvasFrameLayer {
	id?: string;
	canvas: HTMLCanvasElement;
	x: number;
	y: number;
	blendMode: GlobalCompositeOperation;
}

type CachedFrame = { layers: CachedCanvasFrameLayer[]; bytes: number };

/**
 * Lazily rasterize animation frames once, shared by a caller-provided key.
 * Sources use output-pixel coordinates. Separate backdrop-dependent blend layers
 * in draw order instead of flattening them into a normal transparent image.
 * See CanvasAnimationFrameCache.md for the required scratch-symbol audit and
 * draw-cost priorities before choosing which animations to cache.
 */
export class CanvasAnimationFrameCache {
	private frames = new Map<string, CachedFrame>();
	private bytes = 0;

	constructor(private readonly maxBytes = 32 * 1024 * 1024) {}

	getFrame(key: string, createSources: () => CanvasFrameSource[]): CachedCanvasFrameLayer[] | null {
		const existing = this.frames.get(key);
		if (existing) {
			// Refresh insertion order for least-recently-used eviction.
			this.frames.delete(key);
			this.frames.set(key, existing);
			return existing.layers;
		}

		const sources = createSources().filter(source => source.width > 0 && source.height > 0);
		const bounds = sources.map(source => {
			const x = Math.floor(source.x) - 1;
			const y = Math.floor(source.y) - 1;
			return { x, y, width: Math.ceil(source.x + source.width) + 1 - x,
				height: Math.ceil(source.y + source.height) + 1 - y };
		});
		const bytes = bounds.reduce((sum, b) => sum + b.width * b.height * 4, 0);
		// Refuse oversized frames before allocating or rasterizing them.
		if (!Number.isFinite(bytes) || bytes > this.maxBytes || bounds.some(b => b.width > 2048 || b.height > 2048)) {
			return null;
		}
		while (this.frames.size && this.bytes + bytes > this.maxBytes) {
			const oldest = this.frames.keys().next().value!;
			this.release(this.frames.get(oldest)!);
			this.frames.delete(oldest);
		}

		const frame: CachedFrame = { layers: [], bytes: 0 };
		try {
			for (let i = 0; i < sources.length; i++) {
				const source = sources[i];
				const b = bounds[i];
				const canvas = document.createElement('canvas');
				canvas.width = b.width;
				canvas.height = b.height;
				frame.layers.push({ id: source.id, canvas, x: b.x, y: b.y, blendMode: source.blendMode ?? 'source-over' });
				const context = canvas.getContext('2d');
				if (!context) return null;
				context.translate(-b.x, -b.y);
				source.draw(context);
			}
			frame.bytes = bytes;
			this.frames.set(key, frame);
			this.bytes += bytes;
			return frame.layers;
		} finally {
			if (!this.frames.has(key)) {
				for (const layer of frame.layers) layer.canvas.width = layer.canvas.height = 0;
			}
		}
	}

	clear(): void {
		for (const frame of this.frames.values()) this.release(frame);
		this.frames.clear();
	}

	private release(frame: CachedFrame): void {
		for (const layer of frame.layers) layer.canvas.width = layer.canvas.height = 0;
		this.bytes -= frame.bytes;
	}
}
