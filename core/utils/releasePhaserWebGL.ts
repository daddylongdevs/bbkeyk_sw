/**
 * iOS keeps a WebGL context and its AudioContext until they are explicitly
 * dropped. A weak iPhone dies on the second or third launch once those pile up.
 */
export function releasePhaserWebGL(
	game: any,
	beforeDestroy?: () => void,
): void {
	if (!game || game.__webglReleased) {
		return;
	}
	game.__webglReleased = true;

	const canvas: HTMLCanvasElement | null = game.canvas ?? null;
	const gl: WebGLRenderingContext | undefined = game.renderer?.gl;

	try {
		const sound: any = game.sound;
		const ctx = sound?.context ?? sound?.webaudio?.context;
		if (ctx && typeof ctx.close === 'function') {
			if (ctx.state !== 'closed') {
				const closing = ctx.close();
				if (closing && typeof closing.catch === 'function') {
					closing.catch(() => {});
				}
			}
			// Phaser WebAudioSoundManager.destroy calls this.context.close() with no
			// null-check. Keep the reference, but make a second close a no-op so we
			// neither double-close nor hit "Cannot read properties of null".
			try {
				ctx.close = () => Promise.resolve();
			} catch {
				/* noop */
			}
		}
	} catch {
		/* noop */
	}

	try {
		beforeDestroy?.();
	} catch {
		/* noop */
	}

	try {
		game.destroy?.(true);
	} catch {
		/* noop */
	}

	try {
		gl?.getExtension?.('WEBGL_lose_context')?.loseContext?.();
	} catch {
		/* noop */
	}

	if (canvas) {
		try {
			canvas.width = 1;
			canvas.height = 1;
		} catch {
			/* noop */
		}
		try {
			canvas.remove();
		} catch {
			/* noop */
		}
	}
}
