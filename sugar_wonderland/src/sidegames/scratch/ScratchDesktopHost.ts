import { releasePhaserWebGL } from '../../../../core/utils/releasePhaserWebGL';
import { isPlayInstanceReplaced as hasLostPlayInstance } from '../../backend/PlayInstanceLock';
import Phaser from 'phaser';
import {
	MeshAttachment,
	RegionAttachment,
	SpineGameObject,
	SpinePlugin,
} from '@esotericsoftware/spine-phaser-v3';
import {
	ScratchPanel,
	SCRATCH_PANEL_HEIGHT,
	SCRATCH_PANEL_WIDTH,
	type ScratchPanelOptions,
} from './ScratchPanel';
import {
	SCRATCH_LEGEND_TEXTURE,
	SCRATCH_MULTIPLIER_SPINE_KEY,
	SCRATCH_SYMBOL_TEXTURE,
	SCRATCH_SYMBOL_VALUE,
} from './symbolMap';
import { enableDrawCallDebugger } from '@core/debug';

/**
 * spine-canvas writes straight into the canvas context. Phaser has already copied
 * `camera.matrix` onto that context, and `renderCanvas` also bakes the same camera
 * into the skeleton (GetCalcMatrix). On this host the camera zoom is the HiDPI
 * scale, so the win clip was drawn through that zoom twice — a little to the right
 * and much further down, since the sand cells sit low in the panel.
 * Draw with an identity context; the skeleton transform is already in screen space.
 */
function patchScratchSpineCanvasDraw(): void {
	const proto = SpineGameObject.prototype as any;
	if (proto.__scratchCanvasDrawPatched) return;
	const original = proto.renderCanvas;
	if (typeof original !== 'function') return;
	proto.renderCanvas = function (
		renderer: any,
		src: any,
		camera: any,
		parentMatrix: any,
	) {
		// Slot tumbles share this prototype. Resetting their canvas CTM drops the
		// HiDPI camera transform and draws every symbol in the upper left.
		// Only the scratch side host bakes that zoom into the skeleton twice.
		const game = (this as any)?.scene?.game;
		if (!game?.__scratchSideHost) {
			return original.call(this, renderer, src, camera, parentMatrix);
		}
		const ctx: CanvasRenderingContext2D | undefined = renderer?.currentContext;
		if (!ctx || typeof ctx.setTransform !== 'function') {
			return original.call(this, renderer, src, camera, parentMatrix);
		}
		ctx.save();
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		try {
			return original.call(this, renderer, src, camera, parentMatrix);
		} finally {
			ctx.restore();
		}
	};
	proto.__scratchCanvasDrawPatched = true;
}

/**
 * spine-canvas triangle draw transforms into atlas space and then clips.
 * On a transparent side canvas that expands the clip across empty atlas
 * padding, which is black, so the win clip gets a black rectangle behind it.
 * Clip the screen-space triangle first, then map the atlas into it.
 * Also apply slot blend modes — canvas otherwise draws multiply auras as a solid plate.
 */
const SCRATCH_CANVAS_BLEND = ['source-over', 'lighter', 'multiply', 'screen'] as const;
const SCRATCH_QUAD_TRIANGLES = [0, 1, 2, 2, 3, 0];

function patchScratchSpineTriangleDraw(plugin: any): void {
	const renderer = plugin?.canvasRenderer;
	if (!renderer || renderer.__scratchTrianglePatched) return;
	renderer.triangleRendering = true;

	renderer.drawTriangle = function (
		img: CanvasImageSource & { width: number; height: number },
		x0: number,
		y0: number,
		u0: number,
		v0: number,
		x1: number,
		y1: number,
		u1: number,
		v1: number,
		x2: number,
		y2: number,
		u2: number,
		v2: number,
	) {
		const ctx: CanvasRenderingContext2D | undefined = this.ctx;
		if (!ctx || !img) return;
		const width = Math.max(0, (img.width || 1) - 1);
		const height = Math.max(0, (img.height || 1) - 1);
		u0 *= width;
		v0 *= height;
		u1 *= width;
		v1 *= height;
		u2 *= width;
		v2 *= height;

		const dx1 = x1 - x0;
		const dy1 = y1 - y0;
		const dx2 = x2 - x0;
		const dy2 = y2 - y0;
		const du1 = u1 - u0;
		const dv1 = v1 - v0;
		const du2 = u2 - u0;
		const dv2 = v2 - v0;
		let det = du1 * dv2 - du2 * dv1;
		if (det === 0) return;
		det = 1 / det;
		const a = (dv2 * dx1 - dv1 * dx2) * det;
		const b = (dv2 * dy1 - dv1 * dy2) * det;
		const c = (du1 * dx2 - du2 * dx1) * det;
		const d = (du1 * dy2 - du2 * dy1) * det;
		const e = x0 - a * u0 - c * v0;
		const f = y0 - b * u0 - d * v0;

		ctx.save();
		ctx.beginPath();
		ctx.moveTo(x0, y0);
		ctx.lineTo(x1, y1);
		ctx.lineTo(x2, y2);
		ctx.closePath();
		ctx.clip();
		ctx.transform(a, b, c, d, e, f);
		ctx.drawImage(img, 0, 0);
		ctx.restore();
	};

	renderer.drawTriangles = function (skeleton: any) {
		const ctx: CanvasRenderingContext2D | undefined = this.ctx;
		const drawOrder: any[] | undefined = skeleton?.drawOrder;
		if (!ctx || !drawOrder) return;
		for (let i = 0; i < drawOrder.length; i++) {
			const slot = drawOrder[i];
			const attachment = slot?.getAttachment?.();
			let vertices: ArrayLike<number> | null = null;
			let triangles: ArrayLike<number> | null = null;
			let texture: (CanvasImageSource & { width: number; height: number }) | null = null;
			if (attachment instanceof RegionAttachment) {
				vertices = this.computeRegionVertices(slot, attachment, false);
				triangles = SCRATCH_QUAD_TRIANGLES;
				texture = attachment.region?.texture?.getImage?.() ?? null;
			} else if (attachment instanceof MeshAttachment) {
				vertices = this.computeMeshVertices(slot, attachment, false);
				triangles = attachment.triangles;
				texture = attachment.region?.texture?.getImage?.() ?? null;
			}
			if (!texture || !vertices || !triangles) continue;
			const sk = skeleton.color;
			const sc = slot.color;
			const ac = attachment.color;
			const blend = Number(slot?.data?.blendMode ?? 0);
			ctx.globalCompositeOperation = SCRATCH_CANVAS_BLEND[blend] || 'source-over';
			ctx.globalAlpha = (sk?.a ?? 1) * (sc?.a ?? 1) * (ac?.a ?? 1);
			for (let j = 0; j < triangles.length; j += 3) {
				const t1 = triangles[j] * 8;
				const t2 = triangles[j + 1] * 8;
				const t3 = triangles[j + 2] * 8;
				this.drawTriangle(
					texture,
					vertices[t1],
					vertices[t1 + 1],
					vertices[t1 + 6],
					vertices[t1 + 7],
					vertices[t2],
					vertices[t2 + 1],
					vertices[t2 + 6],
					vertices[t2 + 7],
					vertices[t3],
					vertices[t3 + 1],
					vertices[t3 + 6],
					vertices[t3 + 7],
				);
			}
		}
		ctx.globalAlpha = 1;
		ctx.globalCompositeOperation = 'source-over';
	};

	renderer.__scratchTrianglePatched = true;
}

/** Mad Freaks has no HiResRender module — keep logical == physical unless DPR > 1. */
function getHiResRenderScale(): number {
	try {
		const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
		return Math.max(1, Math.min(2, dpr));
	} catch {
		return 1;
	}
}

export const SCRATCH_DESKTOP_PANEL_WIDTH = SCRATCH_PANEL_WIDTH;
export const SCRATCH_DESKTOP_PANEL_HEIGHT = SCRATCH_PANEL_HEIGHT;
export const SCRATCH_DESKTOP_MIN_VIEWPORT = 900;
const CLIP_ID = 'scratch-side-clip';
const HOST_ID = 'scratch-side-host';
/** Flush against the main canvas left edge. */
const GAP_PX = 0;
const SLIDE_MS = 320;

export function isScratchDesktopViewport(): boolean {
	try {
		if (typeof document !== 'undefined' && document.documentElement.dataset.tbMobileUi === 'true') {
			return false;
		}
		return typeof window !== 'undefined' && window.innerWidth >= SCRATCH_DESKTOP_MIN_VIEWPORT;
	} catch {
		return false;
	}
}

/**
 * Placement used to require a gutter as wide as the full 428 panel (same CSS width as
 * the main canvas), which blocked the side host on common desktop layouts. Keep the
 * logical Phaser size at SCRATCH_PANEL_* for sand parity, but allow opening when the
 * gutter fits the prior ~360 CSS footprint; syncPosition shrinks to fit if needed.
 */
const OUTSIDE_MIN_WIDTH_RATIO = 360 / 428;

/** True when the main canvas has enough left gutter for an outside panel. */
export function canPlaceScratchOutside(mainGame: Phaser.Game): boolean {
	if (!isScratchDesktopViewport()) {
		return false;
	}
	const canvas = mainGame.canvas;
	if (!canvas) {
		return false;
	}
	const rect = canvas.getBoundingClientRect();
	const scale = rect.width / 428;
	const preferredW = Math.min(rect.width, SCRATCH_DESKTOP_PANEL_WIDTH * scale);
	const need = preferredW * OUTSIDE_MIN_WIDTH_RATIO + GAP_PX * scale;
	return rect.left >= need;
}

type ScratchDesktopHostOptions = {
	mainGame: Phaser.Game;
	panelOptions: ScratchPanelOptions;
};

/**
 * Mounts ScratchPanel in a separate Phaser canvas to the LEFT of the main game.
 * A clip wrapper ends at the main canvas’s left edge so the panel slides out from
 * that edge without painting over the game.
 */
export class ScratchDesktopHost {
	private readonly mainGame: Phaser.Game;
	private readonly panelOptions: ScratchPanelOptions;
	private clipEl: HTMLDivElement | null = null;
	private hostEl: HTMLDivElement | null = null;
	private sideGame: Phaser.Game | null = null;
	private panel: ScratchPanel | null = null;
	private visible = false;
	private positionHandler: (() => void) | null = null;
	private slideTimer: number | null = null;
	private bootPromise: Promise<void> | null = null;
	private prewarmStarted = false;
	/** True while show() is in flight — ignore resize auto-close until open finishes. */
	private opening = false;
	/** CSS px slide distance from the game’s left edge. */
	private slideDistancePx = SCRATCH_DESKTOP_PANEL_WIDTH;

	constructor(options: ScratchDesktopHostOptions) {
		this.mainGame = options.mainGame;
		this.panelOptions = options.panelOptions;
	}

	isVisible(): boolean {
		return this.visible;
	}

	/** True while the outside panel is booting/sliding in (resize must not abort it). */
	isOpening(): boolean {
		return this.opening;
	}

	/**
	 * After the slot is on screen: open the hub and boot the hidden side canvas
	 * so the first scratch click does not construct Phaser on the UI thread.
	 */
	prewarm(): void {
		if (this.prewarmStarted) {
			return;
		}
		this.prewarmStarted = true;
		void this.panelOptions.client.ensureJoined().catch((err) => {
			console.warn('[ScratchDesktopHost] hub prewarm failed', err);
		});
		// Phones never show this second canvas. Booting it anyway leaves a WebGL
		// context that a weak iPhone does not free until the next launches crash.
		if (!canPlaceScratchOutside(this.mainGame)) {
			return;
		}
		const bootCanvas = () => {
			void this.ensureSideGame().catch((err) => {
				console.warn('[ScratchDesktopHost] canvas prewarm failed', err);
			});
		};
		const ric = (window as Window & {
			requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
		}).requestIdleCallback;
		if (typeof ric === 'function') {
			ric(bootCanvas, { timeout: 1800 });
		} else {
			window.setTimeout(bootCanvas, 200);
		}
	}

	/** Toggle if outside placement is possible; returns false to fall back to in-game drawer. */
	tryToggle(): boolean {
		if (hasLostPlayInstance()) {
			if (this.visible) {
				this.hide();
			}
			return true;
		}
		if (this.visible) {
			this.hide();
			return true;
		}
		if (!canPlaceScratchOutside(this.mainGame)) {
			return false;
		}
		void this.show();
		return true;
	}

	async show(): Promise<void> {
		if (hasLostPlayInstance() || !canPlaceScratchOutside(this.mainGame)) {
			return;
		}
		this.opening = true;
		this.clearSlideTimer();
		this.ensureHost();
		this.syncPosition();
		const clip = this.clipEl!;
		const host = this.hostEl!;

		host.style.transition = 'none';
		host.style.transform = `translateX(${Math.round(this.slideDistancePx)}px)`;
		host.style.opacity = '0';
		host.style.boxShadow = 'none';
		clip.style.display = 'block';
		clip.style.visibility = 'visible';
		clip.style.pointerEvents = 'none';

		try {
			await this.ensureSideGame();
			try {
				this.sideGame?.scale.refresh();
				const sideScene = this.sideGame?.scene.getScenes(true)?.[0];
				if (sideScene) {
					applyScratchCanvasHiRes(sideScene);
				}
			} catch {
				/* noop */
			}

			if (hasLostPlayInstance()) {
				this.finishHide();
				return;
			}
			this.visible = true;
			// Paint chrome immediately; network join continues while we slide.
			this.panel?.presentChrome();
			await waitForPhaserRender(this.sideGame);

			if (hasLostPlayInstance() || !this.visible) {
				try { this.panel?.hide(); } catch { /* noop */ }
				this.finishHide();
				return;
			}

			host.style.opacity = '1';
			host.style.boxShadow = '0 8px 32px rgba(0,0,0,0.45)';
			clip.style.pointerEvents = 'auto';
			void host.offsetWidth;
			host.style.transition = `transform ${SLIDE_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`;
			host.style.transform = 'translateX(0)';
			this.bindPositionSync();

			void this.panel?.syncSession();
		} catch (err) {
			console.warn('[ScratchDesktopHost] show failed', err);
			this.finishHide();
		} finally {
			this.opening = false;
		}
	}

	hide(): void {
		// Phaser scale.refresh during open fires window.resize; do not abort mid-show.
		if (this.opening) {
			return;
		}
		if (!this.visible) {
			this.finishHide();
			return;
		}
		this.visible = false;
		this.slideHostOut(() => {
			if (this.panel?.isVisible()) {
				this.panel.hide();
				return;
			}
			this.finishHide();
		});
	}

	toggle(): void {
		if (this.visible) {
			this.hide();
		} else {
			void this.show();
		}
	}

	destroy(): void {
		this.visible = false;
		this.clearSlideTimer();
		this.unbindPositionSync();
		try {
			this.panel?.destroy();
		} catch {
			/* noop */
		}
		this.panel = null;
		this.destroySideGameSafely();
		this.sideGame = null;
		this.bootPromise = null;
		this.hostEl = null;
		this.clipEl?.remove();
		this.clipEl = null;
	}

	private finishHide(): void {
		this.visible = false;
		this.clearSlideTimer();
		if (this.hostEl) {
			this.hostEl.style.transition = 'none';
			this.hostEl.style.transform = `translateX(${Math.round(this.slideDistancePx)}px)`;
			this.hostEl.style.opacity = '0';
			this.hostEl.style.boxShadow = 'none';
		}
		if (this.clipEl) {
			this.clipEl.style.display = 'none';
			this.clipEl.style.pointerEvents = 'none';
		}
		this.unbindPositionSync();
	}

	private slideHostOut(done: () => void): void {
		const host = this.hostEl;
		if (!host) {
			done();
			return;
		}
		this.clearSlideTimer();
		host.style.opacity = '1';
		host.style.boxShadow = '0 8px 32px rgba(0,0,0,0.45)';
		host.style.transition = `transform ${SLIDE_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`;
		host.style.transform = `translateX(${Math.round(this.slideDistancePx)}px)`;
		this.slideTimer = window.setTimeout(() => {
			this.slideTimer = null;
			done();
		}, SLIDE_MS);
	}

	private clearSlideTimer(): void {
		if (this.slideTimer !== null) {
			window.clearTimeout(this.slideTimer);
			this.slideTimer = null;
		}
	}

	private ensureHost(): void {
		const mountParent =
			(document.getElementById('root') as HTMLElement | null) || document.body;
		if (
			this.clipEl &&
			mountParent.contains(this.clipEl) &&
			this.hostEl
		) {
			return;
		}
		let clip = document.getElementById(CLIP_ID) as HTMLDivElement | null;
		if (!clip) {
			clip = document.createElement('div');
			clip.id = CLIP_ID;
			clip.setAttribute('data-scratch-side-clip', 'true');
			clip.style.position = 'fixed';
			clip.style.zIndex = '40';
			clip.style.display = 'none';
			clip.style.overflow = 'hidden';
			clip.style.background = 'transparent';
			clip.style.pointerEvents = 'none';
			mountParent.appendChild(clip);
		} else if (clip.parentElement !== mountParent) {
			// Stay inside #root so native fullscreen (target=#root) still shows scratch.
			mountParent.appendChild(clip);
		}
		let host = document.getElementById(HOST_ID) as HTMLDivElement | null;
		if (!host) {
			host = document.createElement('div');
			host.id = HOST_ID;
			host.setAttribute('data-scratch-side', 'true');
			host.style.position = 'absolute';
			host.style.left = '0';
			host.style.top = '0';
			host.style.overflow = 'hidden';
			host.style.borderRadius = '20px 0 0 20px';
			host.style.background = 'transparent';
			host.style.boxShadow = 'none';
			host.style.pointerEvents = 'auto';
			host.style.opacity = '0';
			clip.appendChild(host);
		} else if (host.parentElement !== clip) {
			clip.appendChild(host);
		}
		this.clipEl = clip;
		this.hostEl = host;
	}

	private syncPosition(): void {
		if (!this.clipEl || !this.hostEl) {
			return;
		}
		const canvas = this.mainGame.canvas;
		if (!canvas) {
			return;
		}
		const rect = canvas.getBoundingClientRect();
		const scale = rect.width / 428;
		const preferredW = Math.min(rect.width, SCRATCH_DESKTOP_PANEL_WIDTH * scale);
		const preferredH = SCRATCH_DESKTOP_PANEL_HEIGHT * scale;
		const gap = GAP_PX * scale;
		// Fit into the left gutter when it is between min-place and full preferred width.
		const available = Math.max(0, rect.left - gap);
		const displayW = Math.max(1, Math.min(preferredW, available));
		const displayH = displayW * (preferredH / Math.max(1, preferredW));
		const clipLeft = rect.left - displayW - gap;
		const clipW = displayW + gap;
		const top = rect.top + (rect.height - displayH) / 2;
		this.slideDistancePx = Math.max(1, displayW + gap);

		this.clipEl.style.left = `${Math.round(clipLeft)}px`;
		this.clipEl.style.top = `${Math.round(top)}px`;
		this.clipEl.style.width = `${Math.round(clipW)}px`;
		this.clipEl.style.height = `${Math.round(displayH)}px`;

		this.hostEl.style.width = `${Math.round(displayW)}px`;
		this.hostEl.style.height = `${Math.round(displayH)}px`;

		const sideScene = this.sideGame?.scene.getScenes(true)?.[0];
		if (sideScene) {
			applyScratchCanvasHiRes(sideScene);
		}
	}

	private bindPositionSync(): void {
		this.unbindPositionSync();
		this.positionHandler = () => {
			if (!this.visible || this.opening) {
				return;
			}
			this.hide();
		};
		window.addEventListener('resize', this.positionHandler);
	}

	private unbindPositionSync(): void {
		if (this.positionHandler) {
			window.removeEventListener('resize', this.positionHandler);
			window.removeEventListener('tb-mobile-fullscreen:change', this.positionHandler);
			this.positionHandler = null;
		}
	}

	/**
	 * Keep the outside panel aligned after resize / fullscreen.
	 * Returns false when the left gutter is gone — caller should hide + fall back
	 * to the in-game drawer (do not hide here, or the migrate path races).
	 */
	handleViewportChange(): boolean {
		if (!this.visible) {
			return false;
		}
		this.ensureHost();
		if (!canPlaceScratchOutside(this.mainGame)) {
			return false;
		}
		this.syncPosition();
		try {
			this.sideGame?.scale.refresh();
		} catch {
			/* noop */
		}
		return true;
	}

	private ensureSideGame(): Promise<void> {
		if (this.sideGame && this.panel) {
			try {
				this.sideGame.scale.refresh();
			} catch {
				/* noop */
			}
			return Promise.resolve();
		}
		if (this.bootPromise) {
			return this.bootPromise;
		}

		this.ensureHost();
		const host = this.hostEl!;
		host.innerHTML = '';

		const mainGame = this.mainGame;
		const panelOptions = this.panelOptions;
		const hostRef = this;

		this.bootPromise = new Promise<void>((resolve, reject) => {
			let settled = false;
			const finish = (err?: unknown) => {
				if (settled) {
					return;
				}
				settled = true;
				if (err) {
					this.bootPromise = null;
					reject(err);
				} else {
					resolve();
				}
			};
			const timeout = window.setTimeout(() => {
				finish(new Error('Scratch side game boot timed out'));
			}, 10000);

			class ScratchSideScene extends Phaser.Scene {
				constructor() {
					super({ key: 'ScratchSide' });
				}

				preload(): void {
					const loadAny = this.load as any;
					const ids = [
						...new Set(
							Object.values(SCRATCH_SYMBOL_VALUE).filter(
								(id): id is number => typeof id === 'number' && id < 10,
							),
						),
					];
					for (const id of ids) {
						// Match slot AssetConfig keys (`symbol_N_sugar_spine`).
						const spineKey = `symbol_${id}_sugar_spine`;
						const base = `assets/symbols/high/sugar_symbols/Symbol${id}`;
						try {
							if (
								typeof loadAny.spineAtlas === 'function' &&
								typeof loadAny.spineJson === 'function'
							) {
								loadAny.spineAtlas(`${spineKey}-atlas`, `${base}.atlas`);
								loadAny.spineJson(spineKey, `${base}.json`);
							} else if (typeof loadAny.spine === 'function') {
								loadAny.spine(spineKey, `${base}.json`, `${base}.atlas`);
							}
						} catch (err) {
							console.warn('[ScratchDesktopHost] Failed to queue spine', spineKey, err);
						}
					}
					// Ms1/Ms2 share SymbolBombs_SW (same key as the main slot).
					try {
						const bombsKey = SCRATCH_MULTIPLIER_SPINE_KEY;
						const bombsBase = 'assets/symbols/high/sugar_symbols/SymbolBombs_SW';
						if (
							typeof loadAny.spineAtlas === 'function' &&
							typeof loadAny.spineJson === 'function'
						) {
							loadAny.spineAtlas(`${bombsKey}-atlas`, `${bombsBase}.atlas`);
							loadAny.spineJson(bombsKey, `${bombsBase}.json`);
						} else if (typeof loadAny.spine === 'function') {
							loadAny.spine(bombsKey, `${bombsBase}.json`, `${bombsBase}.atlas`);
						}
					} catch (err) {
						console.warn('[ScratchDesktopHost] Failed to queue SymbolBombs_SW', err);
					}
					// Don't let a single missing atlas hang the side boot forever.
					this.load.on('loaderror', (file: { key?: string; url?: string }) => {
						console.warn('[ScratchDesktopHost] Side asset load error', file?.key, file?.url);
					});
				}

				create(): void {
					enableDrawCallDebugger(this, { enabled: import.meta.env.DEV, containOverlay: true });
					applyScratchCanvasHiRes(this);
					const plugin: any =
						(this as any).sys?.['spine.SpinePlugin'] ||
						(this as any).sys?.spine ||
						(this as any).spine;
					if (plugin?.canvasRenderer) {
						patchScratchSpineTriangleDraw(plugin);
					}
					// Yield so Phaser.Game construction is not in the same turn as texture clone + panel.
					window.setTimeout(() => {
						try {
							copyScratchTexturesFrom(mainGame, this.game);
							const panel = new ScratchPanel({
								...panelOptions,
								fillScene: true,
								onCloseRequest: () => hostRef.hide(),
								onClose: () => {
									hostRef.finishHide();
									panelOptions.onClose?.();
								},
							});
							panel.create(this);
							hostRef.panel = panel;
							window.clearTimeout(timeout);
							finish();
						} catch (err) {
							window.clearTimeout(timeout);
							finish(err);
						}
					}, 0);
				}
			}

			try {
				patchScratchSpineCanvasDraw();
				this.sideGame = new Phaser.Game({
					// Canvas + Spine (spine-canvas) — not WebGL, so the slot context stays intact.
					type: Phaser.CANVAS,
					audio: { noAudio: true },
					width: SCRATCH_DESKTOP_PANEL_WIDTH,
					height: SCRATCH_DESKTOP_PANEL_HEIGHT,
					parent: host,
					backgroundColor: '#00000000',
					callbacks: {
						preBoot: (game) => {
							(game as Phaser.Game & { __scratchSideHost?: boolean }).__scratchSideHost = true;
						},
					},
					scale: {
						mode: Phaser.Scale.FIT,
						autoCenter: Phaser.Scale.CENTER_BOTH,
					},
					render: {
						antialias: true,
						clearBeforeRender: true,
						transparent: true,
					},
					plugins: {
						scene: [
							{
								key: 'spine.SpinePlugin',
								plugin: SpinePlugin,
								mapping: 'spine',
							},
						],
					},
					scene: [ScratchSideScene],
				});
				const sideCanvas = host.querySelector('canvas');
				if (sideCanvas) {
					(sideCanvas as HTMLElement).style.borderRadius = '20px 0 0 20px';
				}

			} catch (err) {
				window.clearTimeout(timeout);
				finish(err);
			}
		});

		return this.bootPromise;
	}

	/**
	 * SpinePlugin.gameDestroy() is static-unsafe: it removes the global `add.spine`
	 * factory and disposes the main game’s shared WebGL SceneRenderer. Unhook it first.
	 */
	private destroySideGameSafely(): void {
		const game = this.sideGame;
		if (!game) {
			return;
		}
		try {
			const scenes = game.scene.getScenes(false);
			for (const scene of scenes) {
				const plugin =
					(scene as any)?.sys?.['spine.SpinePlugin'] ||
					(scene as any)?.sys?.spine ||
					(scene as any)?.spine;
				if (plugin && typeof plugin.gameDestroy === 'function') {
					game.events.off('destroy', plugin.gameDestroy, plugin);
				}
			}
		} catch {
			/* noop */
		}
		releasePhaserWebGL(game);
	}
}

/**
 * HiResRender intentionally manages only the main WebGL game. The scratch host is
 * a second Canvas game, so give it the same physical backing scale explicitly while
 * keeping scene.scale at the logical 428×860 size (same as in-main drawer).
 */
function applyScratchCanvasHiRes(scene: Phaser.Scene): void {
	const game = scene?.game;
	const canvas = game?.canvas;
	if (!game || !canvas) return;

	const renderScale = Math.max(1, getHiResRenderScale());
	const baseW = Math.max(1, Math.round(SCRATCH_DESKTOP_PANEL_WIDTH * renderScale));
	const baseH = Math.max(1, Math.round(SCRATCH_DESKTOP_PANEL_HEIGHT * renderScale));
	const scale: any = game.scale;
	const renderer: any = game.renderer;

	try {
		if (scale?.baseSize) {
			scale.baseSize.setSize(baseW, baseH);
		}
		if (canvas.width !== baseW || canvas.height !== baseH) {
			canvas.width = baseW;
			canvas.height = baseH;
			renderer?.resize?.(baseW, baseH);
		}

		scale?.updateBounds?.();
		const rect = canvas.getBoundingClientRect();
		if (rect.width > 0 && rect.height > 0 && scale?.displayScale?.set) {
			scale.displayScale.set(baseW / rect.width, baseH / rect.height);
		}

		for (const camera of scene.cameras?.cameras ?? []) {
			camera.setSize(baseW, baseH);
			camera.setOrigin(0, 0);
			camera.setZoom(renderScale, renderScale);
			camera.setScroll(0, 0);
		}
	} catch (err) {
		console.warn('[ScratchDesktopHost] Failed to apply HiDPI Canvas backing store', err);
	}
}

function waitForPhaserRender(game: Phaser.Game | null): Promise<void> {
	return new Promise((resolve) => {
		if (!game) {
			requestAnimationFrame(() => resolve());
			return;
		}
		const scenes = game.scene.getScenes(true);
		const scene = scenes[0] as Phaser.Scene | undefined;
		let done = false;
		const finish = () => {
			if (done) {
				return;
			}
			done = true;
			resolve();
		};
		if (scene?.events) {
			scene.events.once('render', finish);
		} else {
			requestAnimationFrame(finish);
		}
		window.setTimeout(finish, 80);
	});
}

function copyScratchTexturesFrom(from: Phaser.Game, to: Phaser.Game): void {
	const wanted = new Set<string>([
		'buy_feature_bg',
		'long_button',
		'decrease_bet',
		'increase_bet',
		'dijoker_face',
		...Object.values(SCRATCH_SYMBOL_TEXTURE).filter((k): k is string => !!k),
		...Object.values(SCRATCH_LEGEND_TEXTURE),
	]);
	for (let i = 0; i <= 12; i++) {
		wanted.add(`symbol_${i}`);
	}
	for (let i = 0; i <= 12; i++) {
		wanted.add(`symbol${i}`);
	}
	for (const key of wanted) {
		if (!key || to.textures.exists(key)) {
			continue;
		}
		if (!from.textures.exists(key)) {
			continue;
		}
		try {
			const tex = from.textures.get(key);
			const src = tex?.getSourceImage?.() as CanvasImageSource | undefined;
			if (!src) {
				continue;
			}
			const sourceW =
				(src as HTMLImageElement).naturalWidth ||
				(src as HTMLCanvasElement).width ||
				0;
			const sourceH =
				(src as HTMLImageElement).naturalHeight ||
				(src as HTMLCanvasElement).height ||
				0;
			const frame: any = tex?.get?.('__BASE') ?? tex?.get?.();
			const cutX = Number(frame?.cutX) || 0;
			const cutY = Number(frame?.cutY) || 0;
			const w = Number(frame?.cutWidth) || sourceW;
			const h = Number(frame?.cutHeight) || sourceH;
			if (!(w > 0) || !(h > 0)) {
				continue;
			}
			const clone = document.createElement('canvas');
			// Downsample large symbol cards for Canvas; keep UI chrome (panel bg / buttons) full-res
			// so buy_feature_bg matches the slot Buy Feature clarity.
			const isUiChrome =
				key === 'buy_feature_bg' ||
				key === 'long_button' ||
				key === 'decrease_bet' ||
				key === 'increase_bet';
			const maxEdge = isUiChrome ? Math.max(w, h) : 256;
			const scale = Math.min(1, maxEdge / Math.max(w, h));
			const dw = Math.max(1, Math.round(w * scale));
			const dh = Math.max(1, Math.round(h * scale));
			clone.width = dw;
			clone.height = dh;
			const ctx = clone.getContext('2d');
			if (!ctx) {
				continue;
			}
			ctx.imageSmoothingEnabled = true;
			(ctx as any).imageSmoothingQuality = 'high';
			if (!isUiChrome && scale < 1 && Math.max(w, h) > maxEdge * 2) {
				// Two-step pyramid for large sources (closer to mip sampling).
				const mid = document.createElement('canvas');
				const midScale = Math.sqrt(scale);
				mid.width = Math.max(1, Math.round(w * midScale));
				mid.height = Math.max(1, Math.round(h * midScale));
				const midCtx = mid.getContext('2d');
				if (midCtx) {
					midCtx.imageSmoothingEnabled = true;
					(midCtx as any).imageSmoothingQuality = 'high';
					midCtx.drawImage(src, cutX, cutY, w, h, 0, 0, mid.width, mid.height);
					ctx.drawImage(mid, 0, 0, mid.width, mid.height, 0, 0, dw, dh);
				} else {
					ctx.drawImage(src, cutX, cutY, w, h, 0, 0, dw, dh);
				}
			} else {
				ctx.drawImage(src, cutX, cutY, w, h, 0, 0, dw, dh);
			}
			const added = to.textures.addCanvas(key, clone);
			try {
				added?.setFilter?.(Phaser.Textures.FilterMode.LINEAR);
			} catch {
				/* noop */
			}
			try {
				const src0: any = (added as any)?.source?.[0];
				if (src0) {
					src0.scaleMode = Phaser.Textures.FilterMode.LINEAR;
				}
			} catch {
				/* noop */
			}
		} catch {
			/* skip non-image / compressed sources */
		}
	}
}
