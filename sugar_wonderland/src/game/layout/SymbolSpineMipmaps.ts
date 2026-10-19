import type { Scene } from 'phaser';
import { SYMBOL_SPINE_MIPMAPS_ENABLED } from '../../config/UIPositionConfig';
import {
	enableMipmapsOnSpineAtlasKeys,
	enableMipmapsOnSpineSkeleton as enableMipmapsOnSpineSkeletonShared,
	isBigScreenMipmapsAllowed,
} from '../../utils/SpineAtlasMipmaps';

/** Sugar symbol Spine keys: Symbol0–9 + shared multiplier bombs atlas. */
export const SUGAR_SYMBOL_SPINE_KEYS: readonly string[] = [
	...Array.from({ length: 10 }, (_, i) => `symbol_${i}_sugar_spine`),
	'symbol_bombs_sw',
];

let symbolMipmapsApplied = false;

function symbolMipmapsAllowed(): boolean {
	return !!SYMBOL_SPINE_MIPMAPS_ENABLED && isBigScreenMipmapsAllowed();
}

/**
 * Upgrade mipmaps on whatever GL textures a live Spine symbol skeleton is sampling.
 * Gated by {@link SYMBOL_SPINE_MIPMAPS_ENABLED}.
 */
export function enableMipmapsOnSpineSkeleton(skeleton: any, scene: Scene): void {
	if (!symbolMipmapsAllowed() || !skeleton || !scene) return;
	enableMipmapsOnSpineSkeletonShared(skeleton, scene);
}

/**
 * Upgrade every grid-symbol Spine atlas to POT-padded mipmaps.
 * Idempotent; stops re-probing once every expected atlas was found.
 */
export function enableSymbolSpineAtlasMipmaps(scene: Scene): void {
	if (!symbolMipmapsAllowed() || symbolMipmapsApplied || !scene) return;

	const { found, upgraded } = enableMipmapsOnSpineAtlasKeys(scene, SUGAR_SYMBOL_SPINE_KEYS);
	if (found >= SUGAR_SYMBOL_SPINE_KEYS.length) symbolMipmapsApplied = true;
	if (upgraded > 0) {
		console.log(
			`[PerspectiveLOD] Enabled mipmaps on ${upgraded} symbol Spine atlas page(s) (${found} atlas key(s) found)`,
		);
	}
}
