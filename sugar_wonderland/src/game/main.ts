import { isConstrainedPhone } from '../../../core/device/isConstrainedPhone';
import { releasePhaserWebGL } from '../../../core/utils/releasePhaserWebGL';
import { Boot } from './scenes/Boot';
import { Game as MainGame } from './scenes/Game';
import { AUTO, Game } from 'phaser';
import { Preloader } from './scenes/Preloader';
import { SpinePlugin } from '@esotericsoftware/spine-phaser-v3';
import { installHiResRender } from '../bootstrap/HiResRender';
import { registerMobileViewportGame } from '../bootstrap/MobileViewport';
import { installAssetCacheBuster } from '@core/cacheBuster/assetCacheBuster';
import { ASSET_VERSION } from '../generated/cacheVersions';
import * as MiniumPhaserCacheBuster from 'phaser';

installAssetCacheBuster(ASSET_VERSION, MiniumPhaserCacheBuster);

// Install guards to prevent InvalidStateError when resuming/suspending a closed AudioContext
function installAudioContextGuards(): void {
	try {
		const Ctx: any = (window as any).AudioContext || (window as any).webkitAudioContext;
		if (!Ctx || !Ctx.prototype) return;
		const proto = Ctx.prototype as any;
		if (typeof proto.resume === 'function') {
			const originalResume = proto.resume;
			proto.resume = function (...args: any[]) {
				try {
					if ((this as any)?.state === 'closed') {
						return Promise.resolve();
					}
					const result = originalResume.apply(this, args);
					if (result && typeof result.catch === 'function') {
						return result.catch(() => Promise.resolve());
					}
					return result;
				} catch (_e) {
					return Promise.resolve();
				}
			};
		}
		if (typeof proto.suspend === 'function') {
			const originalSuspend = proto.suspend;
			proto.suspend = function (...args: any[]) {
				try {
					if ((this as any)?.state === 'closed') {
						return Promise.resolve();
					}
					const result = originalSuspend.apply(this, args);
					if (result && typeof result.catch === 'function') {
						return result.catch(() => Promise.resolve());
					}
					return result;
				} catch (_e) {
					return Promise.resolve();
				}
			};
		}
	} catch (_e) {
		// no-op
	}
}

//  Find out more information about the Game Config at:
//  https://docs.phaser.io/api-documentation/typedef/types-core#gameconfig

const config: Phaser.Types.Core.GameConfig = {
	type: AUTO /* WebGL with Canvas fallback (HMR/context limit) */,
	width: 428,
	height: 926,
	parent: 'game-container',
	backgroundColor: 'transparent',
	scale: {
		mode: Phaser.Scale.FIT,
		autoCenter: Phaser.Scale.CENTER_BOTH,
	},
	physics: {
		default: 'arcade',
		arcade: {
			gravity: { x: 0, y: 1000 },
			debug: false,
		},
	},
	scene: [
		Boot,
		Preloader,
		MainGame,
	],
	plugins: {
		scene: [
			{
				key: 'spine.SpinePlugin',
				plugin: SpinePlugin,
				mapping: 'spine',
			},
		],
	},
	render: {
		failIfMajorPerformanceCaveat: false,
		antialias: true,
		clearBeforeRender: false,
	},
};


/** Drop any prior Phaser / scratch canvases so remount/HMR does not hit the browser context limit. */
const disposePriorPhaserWebGL = (parent: string): void => {
	try {
		const scratchHost = (window as any).scratchDesktopHost;
		if (scratchHost && typeof scratchHost.destroy === 'function') {
			try { scratchHost.destroy(); } catch { /* noop */ }
		}
		(window as any).scratchDesktopHost = null;
	} catch { /* noop */ }
	try {
		const prev = (window as any).phaserGame as any;
		if (prev) {
			releasePhaserWebGL(prev);
			(window as any).phaserGame = null;
		}
	} catch { /* noop */ }
	try {
		document
			.querySelectorAll('[data-scratch-side-clip],[data-scratch-side]')
			.forEach((el) => { try { el.remove(); } catch { /* noop */ } });
	} catch { /* noop */ }
	try {
		const rootEl = typeof document !== 'undefined' ? document.getElementById(parent) : null;
		if (!rootEl) return;
		// Remove orphan canvases only — do NOT getContext() (that can create new GL contexts).
		rootEl.querySelectorAll('canvas').forEach((canvas) => {
			try { canvas.remove(); } catch { /* noop */ }
		});
	} catch { /* noop */ }
};


if (typeof window !== 'undefined' && !(window as any).__miniumPagehideWebGLRelease) {
	(window as any).__miniumPagehideWebGLRelease = true;
	window.addEventListener('pagehide', (event) => {
		if (event.persisted) {
			return;
		}
		try {
			(window as any).scratchDesktopHost?.destroy?.();
		} catch { /* noop */ }
		(window as any).scratchDesktopHost = null;
		releasePhaserWebGL((window as any).phaserGame);
		(window as any).phaserGame = null;
	});
}

let phoneTextureClampInstalled = false;

/** Some phone GPUs reject atlases above MAX_TEXTURE_SIZE and lose the whole context. */
function installPhoneTextureClamp(): void {
	if (phoneTextureClampInstalled || !isConstrainedPhone()) return;
	phoneTextureClampInstalled = true;

	const isImageSource = (value: unknown): value is CanvasImageSource => {
		if (!value || typeof value !== 'object') return false;
		return (
			(typeof HTMLImageElement !== 'undefined' && value instanceof HTMLImageElement) ||
			(typeof HTMLCanvasElement !== 'undefined' && value instanceof HTMLCanvasElement) ||
			(typeof HTMLVideoElement !== 'undefined' && value instanceof HTMLVideoElement) ||
			(typeof ImageBitmap !== 'undefined' && value instanceof ImageBitmap)
		);
	};

	const patch = (proto: { texImage2D?: (...args: any[]) => void } | undefined): void => {
		if (!proto || typeof proto.texImage2D !== 'function' || (proto.texImage2D as any).__phoneClamp) return;
		const original = proto.texImage2D;
		const wrapped = function (this: WebGLRenderingContext, ...args: any[]) {
			try {
				if (args.length === 6 && isImageSource(args[5])) {
					const source = args[5] as any;
					const w = Number(source.naturalWidth || source.videoWidth || source.width) || 0;
					const h = Number(source.naturalHeight || source.videoHeight || source.height) || 0;
					let max = (this as any).__maxTextureSize as number | undefined;
					if (!max) {
						max = Number(this.getParameter(this.MAX_TEXTURE_SIZE)) || 4096;
						(this as any).__maxTextureSize = max;
					}
					if ((w > max || h > max) && w > 0 && h > 0) {
						const scale = Math.min(max / w, max / h);
						const canvas = document.createElement('canvas');
						canvas.width = Math.max(1, Math.floor(w * scale));
						canvas.height = Math.max(1, Math.floor(h * scale));
						const ctx = canvas.getContext('2d');
						if (ctx) {
							ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
							const next = args.slice();
							next[5] = canvas;
							return original.apply(this, next);
						}
					}
				}
			} catch {
				/* use the original upload */
			}
			return original.apply(this, args);
		};
		(wrapped as any).__phoneClamp = true;
		proto.texImage2D = wrapped;
	};

	patch(typeof WebGLRenderingContext !== 'undefined' ? WebGLRenderingContext.prototype : undefined);
	patch(typeof WebGL2RenderingContext !== 'undefined' ? WebGL2RenderingContext.prototype : undefined);
}

const StartGame = (parent: string) => {
	installPhoneTextureClamp();
	disposePriorPhaserWebGL(parent);
	installAudioContextGuards();
	const cleanups: Array<() => void> = [];
	const addCleanup = (cleanup: () => void): void => {
		cleanups.push(cleanup);
	};
	const cleanupGameResources = (): void => {
		while (cleanups.length > 0) {
			const cleanup = cleanups.pop();
			try { cleanup?.(); } catch {}
		}
	};
	// Mute Phaser audio when the tab is hidden or the browser window loses focus (warfreaks-style:
	// Phaser Core BLUR + visibility; AudioManager also gates playback when unfocused).
	const installAudioVisibilityPolicy = (game: Phaser.Game) => {
		let windowHasFocus = typeof document.hasFocus === 'function' ? document.hasFocus() : true;

		const applyMuteToAllScenes = (muted: boolean) => {
			try {
				const gameSound = (game as any).sound;
				if (gameSound) {
					gameSound.mute = !!muted;
				}
			} catch {}
			try {
				const scenes = ((game.scene as any).getScenes(false) as Phaser.Scene[]) || [];
				for (const s of scenes) {
					if ((s as any).sound) {
						((s as any).sound as any).mute = !!muted;
					}
				}
			} catch {}
		};

		const shouldUnmute = (): boolean => {
			try {
				const am: any = (window as any).audioManager;
				if (am && typeof am.isAudioMuted === 'function' && am.isAudioMuted()) {
					return false;
				}
			} catch {}
			return true;
		};

		const isPageHidden = (): boolean => {
			try {
				return document.visibilityState === 'hidden' || !!(document as any).hidden;
			} catch {
				return false;
			}
		};

		const applyFocusVisibilityMute = () => {
			if (isPageHidden() || !windowHasFocus) {
				applyMuteToAllScenes(true);
				return;
			}
			if (shouldUnmute()) {
				applyMuteToAllScenes(false);
			}
		};

		const handleWindowBlur = () => {
			windowHasFocus = false;
			applyFocusVisibilityMute();
		};

		const handleWindowFocus = () => {
			windowHasFocus = true;
			applyFocusVisibilityMute();
		};

		document.addEventListener('visibilitychange', applyFocusVisibilityMute);
		window.addEventListener('blur', handleWindowBlur);
		window.addEventListener('focus', handleWindowFocus);
		window.addEventListener('pagehide', () => applyMuteToAllScenes(true));
		window.addEventListener('pageshow', applyFocusVisibilityMute);
		applyFocusVisibilityMute();
	};

	const game = new Game({ ...config, parent });
	(game as any).__cleanupStartGame = cleanupGameResources;
	try { (game.events as any)?.once?.('destroy', cleanupGameResources); } catch {}
	installAudioVisibilityPolicy(game);

	try {
		const hiResCleanup = installHiResRender(game);
		addCleanup(() => { try { hiResCleanup(); } catch {} });
	} catch {}

	let mobileViewportCleanup: (() => void) | null = null;
	try {
		mobileViewportCleanup = registerMobileViewportGame(game, { parent });
		addCleanup(() => {
			try { mobileViewportCleanup?.(); } catch {}
			mobileViewportCleanup = null;
		});
	} catch {}

	(window as any).phaserGame = game;
	/** Dev console: open a dialog. Example: showDialog({ type: 'MaxWin' }) or showDialog({ type: 'BigWin', winAmount: 50000 }) */
	(window as any).showDialog = (params: {
		type: string;
		winAmount?: number;
		maxWinMultiplier?: number;
		freeSpins?: number;
		betAmount?: number;
		isRetrigger?: boolean;
		[key: string]: unknown;
	}) => {
		const g = (window as any).phaserGame;
		if (!g) {
			console.warn('showDialog: phaserGame not found');
			return;
		}
		const scene = g.scene.getScene('Game');
		if (!scene || !(scene as any).dialogs) {
			console.warn('showDialog: Game scene or dialogs not found (ensure game has started)');
			return;
		}
		const dialogs = (scene as any).dialogs;
		const config: Record<string, unknown> = { type: params.type };
		if (params.type === 'MaxWin') {
			const gameApi = (scene as any).gameAPI;
			const spin = gameApi?.getCurrentSpinData?.();
			const slotTotal = Number(spin?.slot?.totalWin);
			if (Number.isFinite(slotTotal)) {
				config.winAmount = slotTotal;
			} else if (params.winAmount != null) {
				config.winAmount = params.winAmount;
			}
			if (params.maxWinMultiplier != null) {
				config.maxWinMultiplier = params.maxWinMultiplier;
			} else {
				const mw = gameApi?.getMaxWin?.();
				if (mw != null && Number.isFinite(Number(mw))) {
					config.maxWinMultiplier = Number(mw);
				}
			}
		} else if (params.winAmount != null) {
			config.winAmount = params.winAmount;
		}
		if (params.freeSpins != null) config.freeSpins = params.freeSpins;
		if (params.betAmount != null) config.betAmount = params.betAmount;
		if (params.isRetrigger != null) config.isRetrigger = params.isRetrigger;
		Object.keys(params).forEach((k) => {
			if (!['type', 'winAmount', 'maxWinMultiplier', 'freeSpins', 'betAmount', 'isRetrigger'].includes(k)) {
				(config as any)[k] = (params as any)[k];
			}
		});
		dialogs.showDialog(scene, config as any);
	};

	return game;
};

export default StartGame;
