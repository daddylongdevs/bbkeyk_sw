import { isConstrainedPhone } from '../../../core/device/isConstrainedPhone';
import Phaser from 'phaser';
import {
	HI_RES_RENDER_ENABLED,
	HI_RES_RENDER_MAX_CANVAS_PIXELS,
	HI_RES_RENDER_MAX_SCALE,
	HI_RES_RENDER_MIN_SCREEN_MAX_AXIS_PX,
	HI_RES_RENDER_SCALE_STEP,
	HI_RES_RENDER_TEXT_RESOLUTION_ENABLED,
} from '../config/UIPositionConfig';

/**
 * High-resolution rendering for big screens without touching layout code.
 *
 * Phaser 3 keeps two sizes in the ScaleManager:
 *   - `gameSize`  → `scale.width/height`, world/layout units (stays 428–580 × 926)
 *   - `baseSize`  → canvas backing store, renderer viewport, camera viewports
 * Phaser always sets `baseSize = gameSize`; this module sets `baseSize = gameSize × R`
 * every time the ScaleManager refreshes, then zooms each full-frame camera by R with
 * origin (0,0) so world (0,0) → screen (0,0) for both scrollFactor 1 and 0 objects.
 *
 * Consumers that need physical vs logical values:
 *   - `scene.scale.width/height`, `getSafeArea()`     → logical (unchanged)
 *   - `camera.width/height`, `pointer.x/y`            → physical (× R)
 *   - `camera.displayWidth/displayHeight`, `pointer.worldX/worldY` → logical
 */

type HiResState = {
	scale: number;
	baseWidth: number;
	baseHeight: number;
	gameWidth: number;
	gameHeight: number;
	cssScale: number;
	dpr: number;
	reason: string;
};

const MANAGED_FLAG = '__hiResManagedCamera';
const SCENE_HOOK_FLAG = '__hiResSceneHooked';
const TEXT_PATCH_FLAG = '__hiResTextPatched';

let currentState: HiResState | null = null;
let installedGame: Phaser.Game | null = null;

function readQueryParam(name: string): string | null {
	try {
		return new URLSearchParams(window.location.search).get(name);
	} catch {
		return null;
	}
}

function readForcedScale(): number | null {
	const raw = readQueryParam('renderScale') ?? readQueryParam('renderscale');
	if (raw == null) return null;
	const n = Number(raw);
	return Number.isFinite(n) && n > 0 ? n : null;
}

function isForcedOff(): boolean {
	const raw = readQueryParam('hires');
	if (raw == null) return false;
	return raw === '0' || raw.toLowerCase() === 'false' || raw.toLowerCase() === 'off';
}

function quantize(r: number): number {
	const step = Number(HI_RES_RENDER_SCALE_STEP);
	if (!Number.isFinite(step) || step <= 0) return r;
	return Math.round(r / step) * step;
}

/** Compute the render scale for the current ScaleManager state (displaySize must be fresh). */
function computeRenderScale(scale: any): { r: number; cssScale: number; dpr: number; reason: string } {
	const gw = Number(scale?.gameSize?.width) || 0;
	const gh = Number(scale?.gameSize?.height) || 0;
	const dw = Number(scale?.displaySize?.width) || 0;
	const dh = Number(scale?.displaySize?.height) || 0;
	const dpr = Math.max(1, Math.min(4, Number(window.devicePixelRatio) || 1));
	const cssScale = gw > 0 && gh > 0 && dw > 0 && dh > 0 ? Math.max(dw / gw, dh / gh) : 1;

	if (!HI_RES_RENDER_ENABLED) return { r: 1, cssScale, dpr, reason: 'disabled' };
	if (isConstrainedPhone()) return { r: 1, cssScale, dpr, reason: 'phone' };
	if (isForcedOff()) return { r: 1, cssScale, dpr, reason: 'query hires=0' };

	const forced = readForcedScale();
	if (forced != null) {
		return {
			r: Math.max(1, Math.min(Number(HI_RES_RENDER_MAX_SCALE) || 4, forced)),
			cssScale,
			dpr,
			reason: 'query renderScale',
		};
	}

	if (gw <= 0 || gh <= 0 || dw <= 0 || dh <= 0) return { r: 1, cssScale, dpr, reason: 'no display size yet' };

	const screenMax = Math.max(Number(window.innerWidth) || 0, Number(window.innerHeight) || 0);
	const minAxis = Number(HI_RES_RENDER_MIN_SCREEN_MAX_AXIS_PX) || 0;
	if (minAxis > 0 && screenMax < minAxis) {
		return { r: 1, cssScale, dpr, reason: `screen ${screenMax}px < ${minAxis}px gate` };
	}

	let r = cssScale * dpr;
	r = Math.min(r, Math.max(1, Number(HI_RES_RENDER_MAX_SCALE) || 1));

	const budget = Number(HI_RES_RENDER_MAX_CANVAS_PIXELS) || 0;
	if (budget > 0 && gw * gh * r * r > budget) {
		r = Math.sqrt(budget / (gw * gh));
	}

	r = quantize(r);
	if (r <= 1.001) return { r: 1, cssScale, dpr, reason: 'ideal ≈ 1×' };
	return { r, cssScale, dpr, reason: 'auto' };
}

function approx(a: number, b: number): boolean {
	return Math.abs(a - b) <= 1;
}

/** Apply zoom/viewport to every full-frame camera of a scene (or restore when R = 1). */
function fixSceneCameras(scene: Phaser.Scene, state: HiResState): void {
	const cams: any[] | undefined = (scene as any)?.cameras?.cameras;
	if (!Array.isArray(cams)) return;
	for (const cam of cams) {
		if (!cam) continue;
		const managed = cam[MANAGED_FLAG] === true;
		const atOrigin = Number(cam.x) === 0 && Number(cam.y) === 0;
		const gameSized = approx(cam.width, state.gameWidth) && approx(cam.height, state.gameHeight);
		const baseSized = approx(cam.width, state.baseWidth) && approx(cam.height, state.baseHeight);
		if (!managed && !(atOrigin && (gameSized || baseSized))) continue;

		try {
			if (state.scale > 1) {
				cam[MANAGED_FLAG] = true;
				cam.setSize(state.baseWidth, state.baseHeight);
				cam.setOrigin(0, 0);
				cam.setZoom(state.scale, state.scale);
				cam.setScroll(0, 0);
			} else if (managed) {
				cam[MANAGED_FLAG] = false;
				cam.setSize(state.gameWidth, state.gameHeight);
				cam.setOrigin(0.5, 0.5);
				cam.setZoom(1, 1);
				cam.setScroll(0, 0);
			}
			cam.dirty = true;
		} catch {}
	}
}

function forEachGameObject(root: any, fn: (obj: any) => void): void {
	const list: any[] | undefined = root?.list ?? root?.children?.list;
	if (!Array.isArray(list)) return;
	for (const obj of list) {
		if (!obj) continue;
		fn(obj);
		if (Array.isArray(obj.list)) forEachGameObject(obj, fn);
	}
}

function bumpTextResolution(obj: any, r: number): void {
	if (!obj || typeof obj.setResolution !== 'function' || obj.type !== 'Text') return;
	const current = Number(obj.style?.resolution) || 1;
	if (r > current + 1e-3) {
		try {
			obj.setResolution(r);
		} catch {}
	}
}

function bumpExistingTexts(game: Phaser.Game, r: number): void {
	if (!HI_RES_RENDER_TEXT_RESOLUTION_ENABLED || r <= 1) return;
	for (const scene of game.scene?.scenes ?? []) {
		try {
			forEachGameObject((scene as any).children, (obj) => bumpTextResolution(obj, r));
		} catch {}
	}
}

/** Wrap `scene.add.text` / `scene.make.text` so new Text renders at ≥ R resolution. */
function patchTextFactories(): void {
	if (!HI_RES_RENDER_TEXT_RESOLUTION_ENABLED) return;
	const factoryProto: any = (Phaser.GameObjects as any).GameObjectFactory?.prototype;
	const creatorProto: any = (Phaser.GameObjects as any).GameObjectCreator?.prototype;
	for (const proto of [factoryProto, creatorProto]) {
		if (!proto || typeof proto.text !== 'function' || proto.text[TEXT_PATCH_FLAG]) continue;
		const original = proto.text;
		const wrapped = function (this: any, ...args: any[]) {
			const obj = original.apply(this, args);
			const r = currentState?.scale ?? 1;
			if (r > 1) bumpTextResolution(obj, r);
			return obj;
		};
		(wrapped as any)[TEXT_PATCH_FLAG] = true;
		proto.text = wrapped;
	}
}

function hookScene(scene: Phaser.Scene): void {
	const sys: any = (scene as any)?.sys;
	if (!sys || sys[SCENE_HOOK_FLAG]) return;
	sys[SCENE_HOOK_FLAG] = true;
	try {
		// CameraManager.start (registered earlier) recreates `main` at gameSize on every
		// scene start; our listener runs after it and before the scene's create().
		sys.events.on(Phaser.Scenes.Events.START, () => {
			if (currentState) fixSceneCameras(scene, currentState);
		});
	} catch {}
}

function hookAllScenes(game: Phaser.Game): void {
	for (const scene of game.scene?.scenes ?? []) hookScene(scene);
}

function applyState(game: Phaser.Game, state: HiResState, log: boolean): void {
	const prev = currentState;
	currentState = state;
	hookAllScenes(game);
	for (const scene of game.scene?.scenes ?? []) fixSceneCameras(scene, state);
	if (!prev || Math.abs(prev.scale - state.scale) > 1e-3) {
		bumpExistingTexts(game, state.scale);
		if (log) {
			console.log(
				`[HiResRender] scale=${state.scale.toFixed(2)} (${state.reason}) ` +
					`canvas=${state.baseWidth}×${state.baseHeight} game=${state.gameWidth}×${state.gameHeight} ` +
					`css×${state.cssScale.toFixed(2)} dpr=${state.dpr.toFixed(2)}`,
			);
		}
	}
	try {
		(window as any).__hiResRender = { ...state };
	} catch {}
}

/**
 * Install once per Game. Wraps `ScaleManager.refresh` so every size change
 * (boot, window resize, fullscreen, MobileViewport parent-size / FIT↔ENVELOP swaps)
 * re-derives R and re-applies the physical canvas size + camera zoom.
 */
export function installHiResRender(game: Phaser.Game): () => void {
	if (!game || installedGame === game) return () => {};
	installedGame = game;

	const scale: any = game.scale;
	if (!scale || typeof scale.refresh !== 'function') return () => {};

	patchTextFactories();

	// Phaser's refresh() is: updateScale() → updateBounds() → displayScale → emit(RESIZE).
	// We piggyback on its own updateScale() call (displaySize is current right after it)
	// to derive R and resize baseSize/canvas *before* updateBounds + RESIZE fan-out.
	// Perf note: an earlier version called this.updateScale() a second time from the
	// refresh wrapper; updateScale → updateCenter writes canvas margins (style recalc),
	// and refresh runs hundreds of times/s under MobileViewport, so that doubled cost.
	let pendingState: HiResState | null = null;
	const originalUpdateScale = typeof scale.updateScale === 'function' ? scale.updateScale : null;
	const wrappedUpdateScale = function (this: any, ...args: any[]) {
		const result = originalUpdateScale ? originalUpdateScale.apply(this, args) : undefined;
		const { r, cssScale, dpr, reason } = computeRenderScale(this);
		const gw = Number(this.gameSize.width) || 0;
		const gh = Number(this.gameSize.height) || 0;
		const bw = Math.max(1, Math.round(gw * r));
		const bh = Math.max(1, Math.round(gh * r));
		try {
			if (this.baseSize.width !== bw || this.baseSize.height !== bh) {
				this.baseSize.setSize(bw, bh);
			}
			if (this.canvas && (this.canvas.width !== bw || this.canvas.height !== bh)) {
				this.canvas.width = bw;
				this.canvas.height = bh;
			}
		} catch {}
		pendingState = { scale: r, baseWidth: bw, baseHeight: bh, gameWidth: gw, gameHeight: gh, cssScale, dpr, reason };
		return result;
	};
	if (originalUpdateScale) scale.updateScale = wrappedUpdateScale;

	const originalRefresh = scale.refresh;
	const wrappedRefresh = function (this: any, previousWidth?: number, previousHeight?: number) {
		pendingState = null;
		if (!originalUpdateScale) {
			// Defensive fallback for ScaleManager builds without updateScale.
			try {
				wrappedUpdateScale.call(this);
			} catch {}
		}
		// Emits RESIZE → WebGLRenderer.resize(base), CameraManager.onResize, SpinePlugin.onResize.
		const result = originalRefresh.call(this, previousWidth, previousHeight);
		if (pendingState) {
			applyState(game, pendingState, true);
			pendingState = null;
		}
		return result;
	};
	scale.refresh = wrappedRefresh;

	// ScaleManager captured the *original* refresh for its READY listener; run ours after it.
	const onReady = () => {
		try {
			scale.refresh();
		} catch {}
	};
	try {
		game.events.once(Phaser.Core.Events.READY, onReady);
	} catch {}

	// If the game already booted synchronously, apply immediately.
	try {
		if (scale.canvas) scale.refresh();
	} catch {}

	return () => {
		try {
			game.events.off(Phaser.Core.Events.READY, onReady);
		} catch {}
		if (scale.refresh === wrappedRefresh) scale.refresh = originalRefresh;
		if (originalUpdateScale && scale.updateScale === wrappedUpdateScale) scale.updateScale = originalUpdateScale;
		if (installedGame === game) installedGame = null;
		currentState = null;
	};
}

/** Current render scale (1 = native). */
export function getHiResRenderScale(): number {
	return currentState?.scale ?? 1;
}
