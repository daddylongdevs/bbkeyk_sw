import Phaser from 'phaser';

/** Matches bad_beach idle symbol light-sweep timing and look. */
const ANGLE_DEG = 15;
const WIDTH_FRAC = 0.42;
const DURATION_MS = 820;
const MAX_INTENSITY = 0.8;
const GRADIENT_KEY = '__scratchButtonShineGradient';
const CLIP_KEY = '__scratchButtonShineClip';
const TWEEN_KEY = '__scratchButtonShineTween';
const OVERLAY_KEY = '__scratchButtonShineOverlay';

function worldCenter(target: any): { x: number; y: number } {
	try {
		const matrix = target?.getWorldTransformMatrix?.();
		if (matrix && Number.isFinite(matrix.tx) && Number.isFinite(matrix.ty)) {
			return { x: matrix.tx, y: matrix.ty };
		}
	} catch {
		/* noop */
	}
	let x = Number(target?.x) || 0;
	let y = Number(target?.y) || 0;
	try {
		let parent = target?.parentContainer;
		while (parent) {
			x += Number(parent.x) || 0;
			y += Number(parent.y) || 0;
			parent = parent.parentContainer;
		}
	} catch {
		/* noop */
	}
	return { x, y };
}

function shineDepth(target: any): number {
	let depth = 900;
	let parent = target?.parentContainer;
	while (parent) {
		const d = Number(parent.depth);
		if (Number.isFinite(d) && d > depth) {
			depth = d;
		}
		parent = parent.parentContainer;
	}
	return depth + 15;
}

function buttonAnchor(target: any): { cx: number; cy: number; w: number; h: number } {
	try {
		const bounds = target.getBounds?.();
		const angle = Math.abs(Number(target.angle) || 0);
		if (bounds && bounds.width > 4 && bounds.height > 4 && angle < 1) {
			const cx = Number.isFinite(bounds.centerX) ? bounds.centerX : bounds.x + bounds.width / 2;
			const cy = Number.isFinite(bounds.centerY) ? bounds.centerY : bounds.y + bounds.height / 2;
			return { cx, cy, w: bounds.width, h: bounds.height };
		}
	} catch {
		/* noop */
	}
	const center = worldCenter(target);
	return {
		cx: center.x,
		cy: center.y,
		w: Math.max(8, Number(target?.displayWidth) || 40),
		h: Math.max(8, Number(target?.displayHeight) || 40),
	};
}

function rootScrollFactor(target: any): { x: number; y: number } {
	let x = Number(target?.scrollFactorX);
	let y = Number(target?.scrollFactorY);
	try {
		let parent = target?.parentContainer;
		while (parent) {
			if (Number.isFinite(Number(parent.scrollFactorX))) {
				x = Number(parent.scrollFactorX);
			}
			if (Number.isFinite(Number(parent.scrollFactorY))) {
				y = Number(parent.scrollFactorY);
			}
			parent = parent.parentContainer;
		}
	} catch {
		/* noop */
	}
	return {
		x: Number.isFinite(x) ? x : 1,
		y: Number.isFinite(y) ? y : 1,
	};
}

function ensureGradient(scene: Phaser.Scene): HTMLCanvasElement | HTMLImageElement | null {
	let tex: any = scene.textures.exists(GRADIENT_KEY) ? scene.textures.get(GRADIENT_KEY) : null;
	if (!tex) {
		const w = 256;
		const h = 64;
		tex = scene.textures.createCanvas(GRADIENT_KEY, w, h);
		const ctx = tex?.getContext?.() ?? tex?.context;
		if (!ctx) {
			return null;
		}
		const grad = ctx.createLinearGradient(0, 0, 0, h);
		grad.addColorStop(0, 'rgba(255,255,255,0)');
		grad.addColorStop(0.16, 'rgba(255,255,255,0.22)');
		grad.addColorStop(0.38, 'rgba(255,255,255,0.85)');
		grad.addColorStop(0.5, 'rgba(255,255,255,1)');
		grad.addColorStop(0.62, 'rgba(255,255,255,0.85)');
		grad.addColorStop(0.84, 'rgba(255,255,255,0.22)');
		grad.addColorStop(1, 'rgba(255,255,255,0)');
		ctx.fillStyle = grad;
		ctx.fillRect(0, 0, w, h);
		tex.refresh();
	}
	try {
		return tex.getSourceImage?.() ?? tex.getCanvas?.() ?? null;
	} catch {
		return null;
	}
}

function ensureClipCanvas(scene: Phaser.Scene, width: number, height: number): any {
	const tw = Math.max(2, Math.ceil(width));
	const th = Math.max(2, Math.ceil(height));
	if (scene.textures.exists(CLIP_KEY)) {
		const existing: any = scene.textures.get(CLIP_KEY);
		if (existing.width !== tw || existing.height !== th) {
			try {
				existing.setSize(tw, th);
			} catch {
				try {
					scene.textures.remove(CLIP_KEY);
				} catch {
					/* noop */
				}
				return scene.textures.createCanvas(CLIP_KEY, tw, th);
			}
		}
		return existing;
	}
	return scene.textures.createCanvas(CLIP_KEY, tw, th);
}

function drawFrame(ctx: CanvasRenderingContext2D, target: any, cw: number, ch: number): boolean {
	const frame = target?.frame;
	const image = frame?.source?.image;
	if (!image || !cw || !ch) {
		return false;
	}
	const sx = Number(frame.cutX ?? frame.x ?? 0);
	const sy = Number(frame.cutY ?? frame.y ?? 0);
	const sw = Number(frame.cutWidth ?? frame.width ?? image.width);
	const sh = Number(frame.cutHeight ?? frame.height ?? image.height);
	if (!(sw > 0) || !(sh > 0)) {
		return false;
	}
	ctx.save();
	ctx.translate(cw / 2, ch / 2);
	ctx.scale(target.flipX ? -1 : 1, target.flipY ? -1 : 1);
	ctx.drawImage(image, sx, sy, sw, sh, -cw / 2, -ch / 2, cw, ch);
	ctx.restore();
	return true;
}

function paintClip(
	scene: Phaser.Scene,
	target: any,
	offsetX: number,
	offsetY: number,
	bandLength: number,
	bandWidth: number,
	alpha: number,
): { w: number; h: number } | null {
	const anchor = buttonAnchor(target);
	const clip = ensureClipCanvas(scene, anchor.w, anchor.h);
	const ctx: CanvasRenderingContext2D | null = clip?.getContext?.() ?? clip?.context ?? null;
	const gradient = ensureGradient(scene);
	if (!ctx || !gradient) {
		return null;
	}
	const cw = clip.width;
	const ch = clip.height;
	ctx.clearRect(0, 0, cw, ch);
	ctx.globalCompositeOperation = 'source-over';
	ctx.globalAlpha = 1;
	if (!drawFrame(ctx, target, cw, ch)) {
		return null;
	}
	ctx.globalCompositeOperation = 'source-in';
	ctx.save();
	ctx.translate(cw / 2 + offsetX, ch / 2 + offsetY);
	ctx.rotate(Phaser.Math.DegToRad(ANGLE_DEG + 90));
	ctx.globalAlpha = alpha;
	ctx.drawImage(gradient, -bandLength / 2, -bandWidth / 2, bandLength, bandWidth);
	ctx.restore();
	ctx.globalCompositeOperation = 'source-over';
	ctx.globalAlpha = 1;
	try {
		clip.refresh();
	} catch {
		/* noop */
	}
	return { w: anchor.w, h: anchor.h };
}

export function stopScratchButtonShine(target: any): void {
	if (!target) {
		return;
	}
	try {
		const tween: any = target[TWEEN_KEY];
		target[TWEEN_KEY] = null;
		if (tween && typeof tween.remove === 'function') tween.remove();
		else tween?.stop?.();
	} catch {
		/* noop */
	}
	try {
		const overlay = target[OVERLAY_KEY];
		target[OVERLAY_KEY] = null;
		overlay?.destroy?.();
	} catch {
		/* noop */
	}
}

/**
 * Diagonal shine clipped to the button texture alpha, then added on top.
 * A rectangle mask includes the image's empty padding, so the sweep was
 * visible outside the artwork.
 */
export function startScratchButtonShine(
	scene: Phaser.Scene,
	target: any,
	onComplete?: () => void,
): void {
	if (!scene || !target || target.destroyed) {
		return;
	}
	if (!target.visible || (typeof target.alpha === 'number' && target.alpha < 0.05)) {
		try {
			onComplete?.();
		} catch {
			/* noop */
		}
		return;
	}
	stopScratchButtonShine(target);

	const anchor = buttonAnchor(target);
	const w = anchor.w;
	const h = anchor.h;
	const widthFrac = Math.max(0.14, WIDTH_FRAC);
	const angleRad = Phaser.Math.DegToRad(ANGLE_DEG);
	const nx = Math.cos(angleRad);
	const ny = Math.sin(angleRad);
	const halfDiagonal = 0.5 * Math.sqrt(w * w + h * h);
	const travel = halfDiagonal * 1.45;
	const bandWidth = Math.max(16, Math.min(w, h) * widthFrac * 1.25);
	const bandLength = Math.max(w, h) * 1.65;
	const peakAlpha = Math.min(0.95, 0.65 + MAX_INTENSITY * 0.28);
	const scroll = rootScrollFactor(target);

	const painted = paintClip(scene, target, -nx * travel, -ny * travel, bandLength, bandWidth, 0);
	if (!painted) {
		try {
			onComplete?.();
		} catch {
			/* noop */
		}
		return;
	}

	const shine = scene.add.image(anchor.cx, anchor.cy, CLIP_KEY);
	shine.setOrigin(0.5, 0.5);
	shine.setDisplaySize(painted.w, painted.h);
	shine.setBlendMode(Phaser.BlendModes.ADD);
	shine.setDepth(shineDepth(target));
	shine.setAlpha(1);
	try {
		shine.setScrollFactor(scroll.x, scroll.y);
	} catch {
		/* noop */
	}
	try {
		target[OVERLAY_KEY] = shine;
	} catch {
		/* noop */
	}

	let finished = false;
	const finish = (callComplete: boolean) => {
		if (finished) {
			return;
		}
		finished = true;
		try {
			target[TWEEN_KEY] = null;
		} catch {
			/* noop */
		}
		try {
			if (target[OVERLAY_KEY] === shine) {
				target[OVERLAY_KEY] = null;
			}
		} catch {
			/* noop */
		}
		try {
			shine.destroy();
		} catch {
			/* noop */
		}
		if (!callComplete) {
			return;
		}
		try {
			onComplete?.();
		} catch {
			/* noop */
		}
	};

	try {
		const state = { t: 0 };
		const tween = scene.tweens.add({
			targets: state,
			t: 1,
			duration: DURATION_MS,
			ease: 'Sine.easeInOut',
			onUpdate: () => {
				if (!target || target.destroyed || !shine.active) {
					return;
				}
				const offset = Phaser.Math.Linear(-travel, travel, state.t);
				const normalized = Phaser.Math.Clamp((offset + travel) / (2 * travel), 0, 1);
				const envelope = Math.sin(normalized * Math.PI);
				const live = buttonAnchor(target);
				const next = paintClip(
					scene,
					target,
					nx * offset,
					ny * offset,
					bandLength,
					bandWidth,
					peakAlpha * envelope,
				);
				if (!next) {
					return;
				}
				shine.setPosition(live.cx, live.cy);
				shine.setDisplaySize(next.w, next.h);
				shine.setVisible(true);
			},
			onComplete: () => finish(true),
		});
		try {
			target[TWEEN_KEY] = tween;
		} catch {
			/* noop */
		}
	} catch (e) {
		console.warn('[ScratchButtonGlow] Failed to start shine:', e);
		finish(true);
	}
}
