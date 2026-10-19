import type { Game, Scene } from 'phaser';

export interface DrawCallDebuggerOptions {
	/** Pass import.meta.env.DEV to restrict the debugger to development builds. Default true. */
	enabled?: boolean;
	/** Game canvas corner. Default 'bottom-left'. */
	position?: 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right';
	/** Distance inside both game canvas edges, in CSS pixels. Default 5. */
	margin?: number;
	/** Overlay font size in CSS pixels. Default 14. */
	fontSize?: number;
	/** Attach inside the canvas's positioned parent to follow its clipping and visibility. Default false. */
	containOverlay?: boolean;
}

export interface DrawCallDebuggerHandle {
	/** Number of WebGL draw commands or Canvas 2D paint operations in the last completed frame. */
	getDrawCalls(): number;
	/** Remove the overlay, event listeners, and WebGL hooks. Safe to call more than once. */
	destroy(): void;
}

const activeDebuggers = new WeakMap<Game, DrawCallDebuggerHandle>();

// Describe the optional Phaser 4 hooks without requiring its renderer types.
type DrawCallRenderer = Game['renderer'] & {
	gl?: WebGLRenderingContext | WebGL2RenderingContext;
	gameContext?: CanvasRenderingContext2D;
	drawElements?: (...args: unknown[]) => unknown;
	drawInstancedArrays?: (...args: unknown[]) => unknown;
};

/**
 * Phaser 3 and 4 WebGL or Canvas 2D. Call once in a scene's create(). Counts draw
 * commands across all scenes and cleans up on scene shutdown.
 * The HTML overlay adds no WebGL draw calls and follows the game canvas bounds.
 */
export function enableDrawCallDebugger(
	scene: Scene,
	options: DrawCallDebuggerOptions = {},
): DrawCallDebuggerHandle | undefined {
	if (options.enabled === false) return;

	const game = scene.game;
	const existing = activeDebuggers.get(game);
	if (existing) return existing;

	const renderer = game.renderer as DrawCallRenderer;
	const canvasContext = renderer.gameContext;
	if (!renderer.gl && !canvasContext) {
		console.warn('[DrawCallDebugger] A WebGL or Canvas 2D renderer is required.');
		return;
	}

	const label = canvasContext ? 'Canvas Draws' : 'Draw Calls';
	let currentFrameDraws = 0;
	let lastFrameDraws = 0;
	let destroyed = false;
	const restoreHooks: Array<() => void> = [];

	function hook<T, K extends keyof T>(target: T, key: K): void {
		const original = target[key];
		if (typeof original !== 'function') return;
		const wrapped = function (this: T, ...args: unknown[]) {
			currentFrameDraws++;
			return original.apply(this, args);
		} as T[K];
		target[key] = wrapped;
		restoreHooks.push(() => {
			if (target[key] === wrapped) target[key] = original;
		});
	}

	if (canvasContext) {
		// Count paint operations on this game's output context, including Spine.
		for (const method of [
			'drawImage', 'fill', 'stroke', 'fillRect', 'strokeRect',
			'fillText', 'strokeText', 'putImageData',
		] as const) {
			hook(canvasContext, method);
		}
	} else if (typeof renderer.drawElements === 'function' && typeof renderer.drawInstancedArrays === 'function') {
		// Phaser 4 routes drawing through these renderer methods.
		hook(renderer, 'drawElements');
		hook(renderer, 'drawInstancedArrays');
	} else if (renderer.gl) {
		// Phaser 3 pipelines and Spine draw directly through the WebGL context.
		const gl = renderer.gl;
		hook(gl, 'drawArrays');
		hook(gl, 'drawElements');
		if ('drawArraysInstanced' in gl) {
			hook(gl, 'drawArraysInstanced');
			hook(gl, 'drawElementsInstanced');
		} else {
			const instanced = gl.getExtension('ANGLE_instanced_arrays');
			if (instanced) {
				hook(instanced, 'drawArraysInstancedANGLE');
				hook(instanced, 'drawElementsInstancedANGLE');
			}
		}
	}

	const overlay = document.createElement('div');
	const overlayParent = options.containOverlay ? game.canvas.parentElement : null;
	overlay.textContent = `${label}: 0`;
	const position = options.position ?? 'bottom-left';
	const margin = options.margin ?? 5;
	const bottom = position.startsWith('bottom');
	const left = position.endsWith('left');
	Object.assign(overlay.style, {
		position: overlayParent ? 'absolute' : 'fixed',
		zIndex: '2147483647',
		pointerEvents: 'none',
		userSelect: 'none',
		margin: '0',
		padding: '0',
		font: `bold ${options.fontSize ?? 14}px monospace`,
		lineHeight: '1',
		color: '#fff',
		textShadow: '0 1px 2px #000, 0 0 2px #000',
		whiteSpace: 'nowrap',
		transform: `translate(${left ? '0' : '-100%'}, ${bottom ? '-100%' : '0'})`,
	});
	(overlayParent ?? document.body).appendChild(overlay);

	const layout = () => {
		const canvas = game.canvas;
		const bounds = overlayParent ? {
			left: canvas.offsetLeft,
			right: canvas.offsetLeft + canvas.offsetWidth,
			top: canvas.offsetTop,
			bottom: canvas.offsetTop + canvas.offsetHeight,
		} : canvas.getBoundingClientRect();
		overlay.style.left = `${left ? bounds.left + margin : bounds.right - margin}px`;
		overlay.style.top = `${bottom ? bounds.bottom - margin : bounds.top + margin}px`;
	};
	layout();

	const onPreRender = () => {
		currentFrameDraws = 0;
	};
	const onPostRender = () => {
		// Also follows CSS resizing, canvas centering, and page scrolling.
		layout();
		if (lastFrameDraws !== currentFrameDraws) {
			overlay.textContent = `${label}: ${currentFrameDraws}`;
		}
		lastFrameDraws = currentFrameDraws;
	};

	const handle: DrawCallDebuggerHandle = {
		getDrawCalls: () => lastFrameDraws,
		destroy() {
			if (destroyed) return;
			destroyed = true;
			renderer.off('prerender', onPreRender);
			renderer.off('postrender', onPostRender);
			scene.events.off('shutdown', handle.destroy);
			scene.events.off('destroy', handle.destroy);
			game.events.off('destroy', handle.destroy);
			for (const restore of restoreHooks) restore();
			overlay.remove();
			activeDebuggers.delete(game);
		},
	};

	renderer.on('prerender', onPreRender);
	renderer.on('postrender', onPostRender);
	scene.events.once('shutdown', handle.destroy);
	scene.events.once('destroy', handle.destroy);
	game.events.once('destroy', handle.destroy);
	activeDebuggers.set(game, handle);
	return handle;
}
