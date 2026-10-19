import type { Scene } from 'phaser';
import { isConstrainedPhone } from '../device/isConstrainedPhone';

/**
 * Enable mipmap sampling on Phaser image textures.
 * WebGL1 only mipmaps power-of-two sizes — NPOT sources are padded (no stretch) and
 * the `__BASE` frame stays on the original content rect so display scale is unchanged.
 *
 * Defaults match the games that hardcoded trilinear sampling with no anisotropy:
 * `minFilter: 'linear'`, `anisotropy: 0`, `enabled: true`.
 * Pass {@link PhaserTextureMipmapOptions} to keep a game's config-driven filter or gate.
 */

export type PhaserTextureMipmapMinFilter = 'sharp' | 'linear' | 'nearest';

export interface PhaserTextureMipmapOptions {
	/** When false, enable calls are no-ops. Default true. */
	enabled?: boolean;
	/** Default `'linear'` (`LINEAR_MIPMAP_LINEAR`). */
	minFilter?: PhaserTextureMipmapMinFilter;
	/** 0 or 1 disables anisotropy. Default 0. */
	anisotropy?: number;
}

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

function resolveMipMinFilter(gl: WebGLRenderingContext, minFilter: PhaserTextureMipmapMinFilter): number {
	switch (minFilter) {
		case 'sharp':
			return gl.LINEAR_MIPMAP_NEAREST;
		case 'nearest':
			return gl.NEAREST_MIPMAP_LINEAR;
		case 'linear':
		default:
			return gl.LINEAR_MIPMAP_LINEAR;
	}
}

function applyAnisotropy(gl: WebGLRenderingContext, glTex: any, anisotropy: number): void {
	const want = Math.floor(Number(anisotropy) || 0);
	if (want <= 1) return;
	try {
		const ext =
			gl.getExtension('EXT_texture_filter_anisotropic') ||
			gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic') ||
			gl.getExtension('MOZ_EXT_texture_filter_anisotropic');
		if (!ext) return;
		const max = Number(gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT)) || 1;
		if (max <= 1) return;
		if (typeof glTex.bind === 'function') glTex.bind();
		gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(want, max));
	} catch {}
}

function cropBaseFrame(texture: any, origW: number, origH: number, cutX: number, cutY: number): void {
	try {
		const frame: any =
			texture.frames?.['__BASE'] ??
			(typeof texture.get === 'function' ? texture.get() : null);
		if (!frame) return;
		if (typeof frame.setSize === 'function') {
			frame.setSize(origW, origH, cutX, cutY);
			return;
		}
		frame.cutX = cutX;
		frame.cutY = cutY;
		frame.cutWidth = origW;
		frame.cutHeight = origH;
		frame.width = origW;
		frame.height = origH;
		frame.updateUVs?.();
	} catch {}
}

/**
 * @returns true when the texture is (now) mipmap-enabled.
 */
export function enableMipmapsOnPhaserTextureKey(
	scene: Scene,
	key: string,
	options?: PhaserTextureMipmapOptions,
): boolean {
	if (options?.enabled === false) return false;
	if (isConstrainedPhone()) return false;
	if (!scene?.textures?.exists?.(key)) return false;
	if (key === '__DEFAULT' || key === '__MISSING') return false;

	const texture: any = scene.textures.get(key);
	const src: any = texture?.source?.[0];
	if (!src) return false;
	if (src.__phaserMipmapsEnabled) return true;

	const renderer: any = scene.game?.renderer;
	const gl: WebGLRenderingContext | undefined = renderer?.gl;
	const glTex: any = src.glTexture;
	if (!gl || !glTex || typeof glTex.update !== 'function') return false;

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
		cropBaseFrame(texture, origW, origH, 0, 0);
	}

	const mipMin = resolveMipMinFilter(gl, options?.minFilter ?? 'linear');
	const mag = gl.LINEAR;
	const wrap = gl.CLAMP_TO_EDGE;
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
		applyAnisotropy(gl, glTex, options?.anisotropy ?? 0);
		src.__phaserMipmapsEnabled = true;
		return true;
	} catch {
		return false;
	}
}

export function enableMipmapsOnPhaserTextureKeys(
	scene: Scene,
	keys: Iterable<string>,
	options?: PhaserTextureMipmapOptions,
): number {
	let n = 0;
	for (const key of keys) {
		if (enableMipmapsOnPhaserTextureKey(scene, key, options)) n += 1;
	}
	return n;
}

/** Sweep every loaded Phaser texture in the scene (skips internal placeholders). */
export function enableMipmapsOnAllPhaserTextures(
	scene: Scene,
	options?: PhaserTextureMipmapOptions,
): number {
	if (options?.enabled === false || !scene?.textures) return 0;
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
	return enableMipmapsOnPhaserTextureKeys(scene, keys, options);
}

/**
 * Copy `srcKey` into a new canvas texture `destKey`, centered on a power-of-two canvas.
 * The `__BASE` frame stays on the original content rect. No-op when `destKey` already exists.
 */
export function cloneTexturePadded(scene: Scene, srcKey: string, destKey: string): boolean {
	if (!scene?.textures?.exists?.(srcKey) || scene.textures.exists(destKey)) {
		return scene?.textures?.exists?.(destKey) ?? false;
	}
	const srcTex: any = scene.textures.get(srcKey);
	const src = srcTex?.source?.[0];
	const { w: origW, h: origH, image } = readSourceSize(src);
	if (!image || origW <= 0 || origH <= 0) return false;

	const potW = isPowerOfTwo(origW) ? origW : nextPowerOfTwo(origW);
	const potH = isPowerOfTwo(origH) ? origH : nextPowerOfTwo(origH);
	const canvas = document.createElement('canvas');
	canvas.width = potW;
	canvas.height = potH;
	const ctx = canvas.getContext('2d');
	if (!ctx) return false;
	ctx.clearRect(0, 0, potW, potH);
	ctx.imageSmoothingEnabled = true;
	ctx.imageSmoothingQuality = 'high';
	const padX = Math.floor((potW - origW) / 2);
	const padY = Math.floor((potH - origH) / 2);
	ctx.drawImage(image as CanvasImageSource, padX, padY);

	try {
		scene.textures.addCanvas(destKey, canvas);
		const dest: any = scene.textures.get(destKey);
		cropBaseFrame(dest, origW, origH, padX, padY);
		return true;
	} catch {
		return false;
	}
}
