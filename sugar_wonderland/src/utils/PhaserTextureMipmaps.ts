import { isConstrainedPhone } from '../../../core/device/isConstrainedPhone';
import type { Scene } from 'phaser';

/** Scratch / visual PNG mipmaps — local knobs (mad_freaks has no UIPositionConfig). */
export type PhaserMipmapMinFilter = 'sharp' | 'linear' | 'nearest';

const GAME_VISUAL_MIPMAPS_ENABLED = true;
const GAME_VISUAL_MIPMAP_MIN_FILTER: PhaserMipmapMinFilter = 'linear';

/**
 * Enable mipmap sampling on Phaser image textures.
 * WebGL1 only mipmaps power-of-two sizes — NPOT sources are padded (no stretch) and
 * the `__BASE` frame stays on the original content rect so display scale is unchanged.
 */

function nextPowerOfTwo(n: number): number {
	const v = Math.max(1, Math.ceil(n));
	return 1 << Math.ceil(Math.log2(v));
}

function isPowerOfTwo(n: number): boolean {
	const v = Math.floor(n);
	return v > 0 && (v & (v - 1)) === 0;
}

function readSourceSize(src: any): { w: number; h: number; image: any } {
	const image = src?.image ?? src?.source ?? null;
	const w =
		Number(src?.width) ||
		Number(image?.naturalWidth) ||
		Number(image?.width) ||
		0;
	const h =
		Number(src?.height) ||
		Number(image?.naturalHeight) ||
		Number(image?.height) ||
		0;
	return { w, h, image };
}

function resolveMipMinFilter(
	gl: WebGLRenderingContext,
	mode: PhaserMipmapMinFilter = GAME_VISUAL_MIPMAP_MIN_FILTER,
): number {
	switch (mode) {
		case 'linear':
			return gl.LINEAR_MIPMAP_LINEAR;
		case 'nearest':
			return gl.NEAREST_MIPMAP_LINEAR;
		case 'sharp':
		default:
			return gl.LINEAR_MIPMAP_NEAREST;
	}
}

/**
 * @returns true when the texture is (now) mipmap-enabled.
 */
export function enableMipmapsOnPhaserTextureKey(
	scene: Scene,
	key: string,
	minFilter: PhaserMipmapMinFilter = GAME_VISUAL_MIPMAP_MIN_FILTER,
): boolean {
	if (!GAME_VISUAL_MIPMAPS_ENABLED) return false;
	if (isConstrainedPhone()) return false;
	if (!scene?.textures?.exists?.(key)) return false;
	if (key === '__DEFAULT' || key === '__MISSING') return false;

	const texture: any = scene.textures.get(key);
	const src: any = texture?.source?.[0];
	if (!src) return false;

	const renderer: any = scene.game?.renderer;
	const gl: WebGLRenderingContext | undefined = renderer?.gl;
	const glTex: any = src.glTexture;
	if (!gl || !glTex || typeof glTex.update !== 'function') return false;

	const mipMin = resolveMipMinFilter(gl, minFilter);
	const mag = gl.LINEAR;
	const wrap = gl.CLAMP_TO_EDGE;

	if (src.__phaserMipmapsEnabled) {
		try {
			const { w: curW, h: curH, image: curImage } = readSourceSize(src);
			if (curImage && curW > 0 && curH > 0) {
				glTex.update(
					curImage,
					curW,
					curH,
					!!src.flipY,
					wrap,
					wrap,
					mipMin,
					mag,
					glTex.format ?? gl.RGBA,
				);
			}
			src.__phaserMipmapsMinFilter = minFilter;
			return true;
		} catch {
			return true;
		}
	}

	const { w: origW, h: origH, image } = readSourceSize(src);
	if (!image || origW <= 0 || origH <= 0) return false;

	let uploadSource: any = image;
	let uploadW = origW;
	let uploadH = origH;

	if (!isPowerOfTwo(origW) || !isPowerOfTwo(origH)) {
		const potW = nextPowerOfTwo(origW);
		const potH = nextPowerOfTwo(origH);
		const canvas = document.createElement('canvas');
		canvas.width = potW;
		canvas.height = potH;
		const ctx = canvas.getContext('2d');
		if (!ctx) return false;
		ctx.clearRect(0, 0, potW, potH);
		ctx.drawImage(image as CanvasImageSource, 0, 0);

		uploadSource = canvas;
		uploadW = potW;
		uploadH = potH;

		src.image = canvas;
		src.source = canvas;
		src.isCanvas = true;
		src.width = potW;
		src.height = potH;

		try {
			const frame: any =
				texture.frames?.['__BASE'] ??
				(typeof texture.get === 'function' ? texture.get() : null);
			if (frame) {
				if (typeof frame.setSize === 'function') {
					frame.setSize(origW, origH, 0, 0);
				} else {
					frame.cutX = 0;
					frame.cutY = 0;
					frame.cutWidth = origW;
					frame.cutHeight = origH;
					frame.width = origW;
					frame.height = origH;
					frame.updateUVs?.();
				}
			}
		} catch {}
	}

	try {
		glTex.update(
			uploadSource,
			uploadW,
			uploadH,
			!!src.flipY,
			wrap,
			wrap,
			mipMin,
			mag,
			glTex.format ?? gl.RGBA,
		);
		src.__phaserMipmapsEnabled = true;
		src.__phaserMipmapsMinFilter = minFilter;
		return true;
	} catch {
		return false;
	}
}

export function enableMipmapsOnPhaserTextureKeys(
	scene: Scene,
	keys: Iterable<string>,
	minFilter: PhaserMipmapMinFilter = GAME_VISUAL_MIPMAP_MIN_FILTER,
): number {
	let n = 0;
	for (const key of keys) {
		if (enableMipmapsOnPhaserTextureKey(scene, key, minFilter)) n += 1;
	}
	return n;
}

export function enableMipmapsOnAllPhaserTextures(scene: Scene): number {
	if (!GAME_VISUAL_MIPMAPS_ENABLED || !scene?.textures) return 0;
	let keys: string[] = [];
	try {
		if (typeof scene.textures.getTextureKeys === 'function') {
			keys = scene.textures.getTextureKeys();
		} else {
			const list = (scene.textures as any).list;
			if (list && typeof list === 'object') keys = Object.keys(list);
		}
	} catch {
		return 0;
	}
	return enableMipmapsOnPhaserTextureKeys(scene, keys);
}
