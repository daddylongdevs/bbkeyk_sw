import { isConstrainedPhone } from '../../../core/device/isConstrainedPhone';
import type { Scene } from 'phaser';
import {
	GAME_VISUAL_MIPMAP_ANISOTROPY,
	GAME_VISUAL_MIPMAP_MIN_FILTER,
	GAME_VISUAL_MIPMAPS_ENABLED,
	GAME_VISUAL_MIPMAPS_MIN_SCREEN_MAX_AXIS_PX,
} from '../config/UIPositionConfig';

/**
 * Runtime mipmaps for Spine atlas pages on WebGL1 (Phaser 3).
 *
 * WebGL1 can only `generateMipmap` on power-of-two textures. Our Spine atlases are
 * NPOT, so each page image is stretched onto a POT canvas (normalized region UVs stay
 * valid), re-uploaded, and then given a mipmapped min filter + optional anisotropy.
 * Filters are applied only after the POT upload succeeds — this avoids the
 * `glGenerateMipmap: non-power-of-two texture` GL error.
 *
 * Asset files are never modified; only the live GL texture changes.
 */

// spine-webgl TextureFilter enum values (== GL constants).
const TextureFilterLinear = 9729; // GL_LINEAR
const TextureFilterMipMapLinearNearest = 9985; // GL_LINEAR_MIPMAP_NEAREST
const TextureFilterMipMapNearestLinear = 9986; // GL_NEAREST_MIPMAP_LINEAR
const TextureFilterMipMapLinearLinear = 9987; // GL_LINEAR_MIPMAP_LINEAR

const paddedImages = new WeakMap<object, HTMLCanvasElement>();
let anisoExtProbe: { gl: WebGLRenderingContext; ext: any | null; max: number } | null = null;

function nextPowerOfTwo(n: number): number {
	const v = Math.max(1, Math.ceil(n));
	return 1 << Math.ceil(Math.log2(v));
}

function isPowerOfTwo(n: number): boolean {
	const v = Math.floor(n);
	return v > 0 && (v & (v - 1)) === 0;
}

/** Resolve the configured min filter to a spine/GL enum value. */
export function getSpineMipMinFilter(): number {
	switch (GAME_VISUAL_MIPMAP_MIN_FILTER) {
		case 'linear':
			return TextureFilterMipMapLinearLinear;
		case 'nearest':
			return TextureFilterMipMapNearestLinear;
		case 'sharp':
		default:
			return TextureFilterMipMapLinearNearest;
	}
}

/** True when the larger CSS screen axis meets the configured threshold (`0` = always). */
export function isBigScreenMipmapsAllowed(): boolean {
	if (!GAME_VISUAL_MIPMAPS_ENABLED) return false;
	if (isConstrainedPhone()) return false;
	const need = Number(GAME_VISUAL_MIPMAPS_MIN_SCREEN_MAX_AXIS_PX);
	if (!Number.isFinite(need) || need <= 0) return true;
	try {
		const w = Number(window?.innerWidth) || 0;
		const h = Number(window?.innerHeight) || 0;
		return Math.max(w, h) >= need;
	} catch {
		return true;
	}
}

function getTextureImage(tex: any): HTMLImageElement | HTMLCanvasElement | ImageBitmap | null {
	const img = tex?._image ?? tex?.image ?? null;
	if (!img) return null;
	if (typeof HTMLImageElement !== 'undefined' && img instanceof HTMLImageElement) return img;
	if (typeof HTMLCanvasElement !== 'undefined' && img instanceof HTMLCanvasElement) return img;
	if (typeof ImageBitmap !== 'undefined' && img instanceof ImageBitmap) return img;
	return img;
}

function readImageSize(image: any, tex: any): { w: number; h: number } {
	const w =
		Number(image?.naturalWidth) ||
		Number(image?.width) ||
		Number(tex?.width) ||
		0;
	const h =
		Number(image?.naturalHeight) ||
		Number(image?.height) ||
		Number(tex?.height) ||
		0;
	return { w, h };
}

function padStretchToPowerOfTwo(
	image: HTMLImageElement | HTMLCanvasElement | ImageBitmap,
): HTMLCanvasElement {
	const cached = paddedImages.get(image as object);
	if (cached) return cached;

	const { w: srcW, h: srcH } = readImageSize(image, null);
	const potW = nextPowerOfTwo(srcW);
	const potH = nextPowerOfTwo(srcH);
	const canvas = document.createElement('canvas');
	canvas.width = potW;
	canvas.height = potH;
	const ctx = canvas.getContext('2d');
	if (ctx && srcW > 0 && srcH > 0) {
		// Uniform stretch keeps Spine atlas UVs (normalized) correct on the POT texture.
		ctx.imageSmoothingEnabled = true;
		(ctx as any).imageSmoothingQuality = 'high';
		ctx.drawImage(image as CanvasImageSource, 0, 0, potW, potH);
	}
	paddedImages.set(image as object, canvas);
	return canvas;
}

function applyAnisotropy(gl: WebGLRenderingContext, tex: any): void {
	const want = Math.floor(Number(GAME_VISUAL_MIPMAP_ANISOTROPY) || 0);
	if (want <= 1) return;
	try {
		if (!anisoExtProbe || anisoExtProbe.gl !== gl) {
			const ext =
				gl.getExtension('EXT_texture_filter_anisotropic') ||
				gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic') ||
				gl.getExtension('MOZ_EXT_texture_filter_anisotropic');
			const max = ext ? Number(gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT)) || 1 : 1;
			anisoExtProbe = { gl, ext, max };
		}
		const { ext, max } = anisoExtProbe;
		if (!ext || max <= 1) return;
		// GLTexture.bind() → activeTexture(0) + bindTexture(TEXTURE_2D, tex).
		if (typeof tex.bind === 'function') tex.bind();
		gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(want, max));
	} catch {}
}

/**
 * Upgrade one spine-webgl GLTexture to POT (if needed) + mipmapped filters.
 * Idempotent: already-upgraded textures return true immediately.
 */
export function upgradeSpineGlTextureMipmaps(tex: any, gl: WebGLRenderingContext): boolean {
	if (!tex || typeof tex.setFilters !== 'function') return false;
	if (tex.__gameVisualMipmapped) return true;

	const image = getTextureImage(tex);
	if (!image) return false;
	const { w: srcW, h: srcH } = readImageSize(image, tex);
	if (srcW <= 0 || srcH <= 0) return false;

	const minFilter = getSpineMipMinFilter();
	try {
		const isWebGL2 =
			(typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext) ||
			typeof (gl as any).texImage3D === 'function';
		const canMipDirect = isWebGL2 || (isPowerOfTwo(srcW) && isPowerOfTwo(srcH));

		if (!canMipDirect) {
			const potW = nextPowerOfTwo(srcW);
			const potH = nextPowerOfTwo(srcH);
			const maxTex = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 0;
			if (maxTex > 0 && (potW > maxTex || potH > maxTex)) return false;
			const pot = padStretchToPowerOfTwo(image);
			tex._image = pot;
			if (typeof tex.update === 'function') {
				// update(true) re-uploads `_image` and generates mipmaps (POT now).
				tex.update(true);
			}
		}

		// Filters only after the texture is POT-capable — prevents NPOT generateMipmap errors.
		tex.setFilters(minFilter, TextureFilterLinear);
		applyAnisotropy(gl, tex);

		tex.__gameVisualMipmapped = true;
		tex.__perspectiveLodMipmapped = true; // legacy flag shared with symbol LOD path
		return true;
	} catch {
		return false;
	}
}

function upgradeAtlasPageMipmaps(atlas: any, gl: WebGLRenderingContext): number {
	if (!atlas || !Array.isArray(atlas.pages)) return 0;
	const minFilter = getSpineMipMinFilter();
	let upgraded = 0;
	for (const page of atlas.pages) {
		const tex = page?.texture;
		if (!tex) continue;
		if (upgradeSpineGlTextureMipmaps(tex, gl)) {
			try {
				page.minFilter = minFilter;
				page.magFilter = TextureFilterLinear;
			} catch {}
			upgraded += 1;
		}
	}
	return upgraded;
}

function getSpinePlugin(scene: Scene): any {
	return (
		(scene as any).spine ??
		(scene as any).sys?.spine ??
		(scene as any).plugins?.get?.('SpinePlugin')
	);
}

function getGl(scene: Scene): WebGLRenderingContext | null {
	return ((scene?.game?.renderer as any)?.gl as WebGLRenderingContext) ?? null;
}

/**
 * Upgrade the atlas pages behind specific Spine keys (both `key` and `key-atlas` are probed).
 * Returns `{ found, upgraded }` — `found` counts keys that resolved to a cached atlas.
 */
export function enableMipmapsOnSpineAtlasKeys(
	scene: Scene,
	keys: Iterable<string>,
): { found: number; upgraded: number } {
	const out = { found: 0, upgraded: 0 };
	if (!isBigScreenMipmapsAllowed() || !scene) return out;
	const plugin = getSpinePlugin(scene);
	if (!plugin || typeof plugin.getAtlas !== 'function') return out;
	const gl = getGl(scene);
	if (!gl) return out;

	const probe = new Set<string>();
	for (const key of keys) {
		if (typeof key !== 'string' || !key) continue;
		probe.add(key);
		if (!key.endsWith('-atlas')) probe.add(`${key}-atlas`);
	}

	for (const key of probe) {
		try {
			if (!plugin.atlasCache?.exists?.(key) && !scene.cache?.text?.exists?.(key)) continue;
			const atlas = plugin.getAtlas(key);
			if (!atlas) continue;
			out.found += 1;
			out.upgraded += upgradeAtlasPageMipmaps(atlas, gl);
		} catch {}
	}
	return out;
}

/** Upgrade every Spine atlas currently in the plugin cache (phase-2 sweep; not wired by default). */
export function enableMipmapsOnAllSpineAtlases(scene: Scene): number {
	if (!isBigScreenMipmapsAllowed() || !scene) return 0;
	const plugin = getSpinePlugin(scene);
	if (!plugin || typeof plugin.getAtlas !== 'function') return 0;

	const atlasKeys = new Set<string>();
	try {
		const entries = plugin.atlasCache?.entries;
		if (entries && typeof entries.keys === 'function') {
			for (const key of entries.keys()) {
				if (typeof key === 'string') atlasKeys.add(key);
			}
		}
	} catch {}
	// Also probe `-atlas` suffixes from json cache keys.
	try {
		const jsonEntries = (scene.cache?.json as any)?.entries;
		if (jsonEntries && typeof jsonEntries.keys === 'function') {
			for (const key of jsonEntries.keys()) {
				if (typeof key === 'string') atlasKeys.add(key);
			}
		}
	} catch {}

	return enableMipmapsOnSpineAtlasKeys(scene, atlasKeys).upgraded;
}

/** Upgrade mipmaps on whatever GL textures a live Spine skeleton is currently sampling. */
export function enableMipmapsOnSpineSkeleton(skeleton: any, scene: Scene): number {
	if (!isBigScreenMipmapsAllowed() || !skeleton || !scene) return 0;
	const gl = getGl(scene);
	if (!gl) return 0;

	const minFilter = getSpineMipMinFilter();
	const pages = new Set<any>();
	let upgraded = 0;
	try {
		const slots = skeleton.slots;
		if (!Array.isArray(slots)) return 0;
		for (const slot of slots) {
			const att = slot?.getAttachment?.() ?? slot?.attachment;
			const region = att?.region ?? att?.regions?.[0];
			const page = region?.page ?? region?.texture;
			const tex = page?.texture ?? (typeof page?.setFilters === 'function' ? page : null);
			if (page?.texture) pages.add(page);
			else if (tex && upgradeSpineGlTextureMipmaps(tex, gl)) upgraded += 1;
		}
		for (const page of pages) {
			const tex = page?.texture;
			if (!tex) continue;
			if (upgradeSpineGlTextureMipmaps(tex, gl)) {
				try {
					page.minFilter = minFilter;
					page.magFilter = TextureFilterLinear;
				} catch {}
				upgraded += 1;
			}
		}
	} catch {}
	return upgraded;
}
