import type { Scene } from "phaser";
import { enableMipmapsOnPhaserTextureKey } from "./PhaserTextureMipmaps";

/**
 * Languages with a dedicated static game-logo asset.
 *
 * Keep these values aligned with the suffix in `logo/logo_{lang}.webp`.
 */
export enum LocalizedLogoLanguage {
	CN = "cn",
}

/**
 * Which on-screen logo is being resolved.
 *
 * `logo_{lang}` is the preloader file. `logo_{lang}_0` is the header file.
 * `logo_{lang}_1` is the bonus-header file. Missing files fall through:
 * preloader uses only `logo_{lang}`; header uses `_0` then `logo_{lang}`;
 * bonus header uses `_1`, then `_0`, then `logo_{lang}`.
 */
export enum LocalizedLogoSurface {
	Preloader = "preloader",
	Header = "header",
	BonusHeader = "bonusHeader",
}

export type LocalizedLogoVariant = "" | "0" | "1";

export type LocalizedLogoFormat = "image" | "spine";

/**
 * Explicitly list localized variants that ship for one game.
 *
 * Browser builds cannot safely probe optional files before queuing Phaser
 * assets. A variant is requested only when it is listed. Spine wins when the
 * same variant is listed in both arrays, and the image is not requested.
 */
export interface LocalizedLogoAssetManifest {
	imageVariants?: readonly LocalizedLogoVariant[];
	spineVariants?: readonly LocalizedLogoVariant[];
}

export interface LocalizedLogoSpineAsset {
	atlas: string;
	json: string;
}

export interface LocalizedLogoAssetGroup {
	images: Record<string, string>;
	spine: Record<string, LocalizedLogoSpineAsset>;
}

export interface ResolvedLocalizedLogoAsset {
	format: LocalizedLogoFormat;
	key: string;
	variant: LocalizedLogoVariant;
}

export interface CreateLocalizedSpineLogoOptions {
	x: number;
	y: number;
	targetWidth: number;
	targetHeight: number;
	animationName: string;
	loop?: boolean;
	originX?: number;
	originY?: number;
	depth?: number;
	scrollFactor?: number;
	parent?: Phaser.GameObjects.Container;
	/** Phaser Spine factory options, used by Phaser 4 spine-webgl paths. */
	factoryOptions?: unknown;
}

const SURFACE_VARIANTS: Record<LocalizedLogoSurface, readonly LocalizedLogoVariant[]> = {
	[LocalizedLogoSurface.Preloader]: [""],
	[LocalizedLogoSurface.Header]: ["0", ""],
	[LocalizedLogoSurface.BonusHeader]: ["1", "0", ""],
};

const LOCALIZED_LOGO_LANGUAGES = new Set<string>(Object.values(LocalizedLogoLanguage));
const LANGUAGE_ALIASES: Readonly<Record<string, LocalizedLogoLanguage>> = {
	zh: LocalizedLogoLanguage.CN,
	"zh-cn": LocalizedLogoLanguage.CN,
	"zh-tw": LocalizedLogoLanguage.CN,
};

/**
 * Resolves the localized-logo language from backend data. Initialization is
 * authoritative; the locale response is used only when initialization does
 * not provide a supported language.
 */
export function resolveLocalizedLogoLanguage(
	initializationLanguage?: string | null,
	localeLanguage?: string | null,
): LocalizedLogoLanguage | undefined {
	for (const language of [initializationLanguage, localeLanguage]) {
		const normalized = language?.trim().toLowerCase();
		const aliasedLanguage = normalized ? LANGUAGE_ALIASES[normalized] : undefined;
		if (aliasedLanguage) {
			return aliasedLanguage;
		}
		if (normalized && LOCALIZED_LOGO_LANGUAGES.has(normalized)) {
			return normalized as LocalizedLogoLanguage;
		}
	}

	return undefined;
}

/**
 * Builds image and Spine asset entries for declared localized-logo files.
 * Undeclared variants are not requested.
 *
 * Image files live at `assets/{orientation}/{quality}/logo/`:
 * `logo_{lang}.webp`, `logo_{lang}_0.webp`, and `logo_{lang}_1.webp`.
 *
 * Spine files live at:
 * `logo/logo_{lang}{suffix}/logo_{lang}{suffix}.{json,atlas}`.
 */
export function createLocalizedLogoAssetGroup(
	assetPrefix: string,
	manifest: LocalizedLogoAssetManifest = {},
): LocalizedLogoAssetGroup {
	const images: Record<string, string> = {};
	const spine: Record<string, LocalizedLogoSpineAsset> = {};
	const imageVariants = new Set(manifest.imageVariants ?? []);
	const spineVariants = new Set(manifest.spineVariants ?? []);

	for (const language of Object.values(LocalizedLogoLanguage)) {
		for (const variant of ["", "0", "1"] as const) {
			const suffix = variant ? `_${variant}` : "";
			const name = `logo_${language}${suffix}`;
			if (spineVariants.has(variant)) {
				spine[getLocalizedLogoSpineKey(language, variant)] = {
					atlas: `${assetPrefix}/logo/${name}/${name}.atlas`,
					json: `${assetPrefix}/logo/${name}/${name}.json`,
				};
			} else if (imageVariants.has(variant)) {
				images[getLocalizedLogoTextureKey(language, variant)] =
					`${assetPrefix}/logo/${name}.webp`;
			}
		}
	}
	return { images, spine };
}

/**
 * Image-only asset builder. Defaults to the preloader file, `logo_{lang}.webp`.
 * Pass `"0"` and `"1"` only when those files ship.
 */
export function createLocalizedLogoAssets(
	assetPrefix: string,
	imageVariants: readonly LocalizedLogoVariant[] = [""],
): Record<string, string> {
	return createLocalizedLogoAssetGroup(assetPrefix, { imageVariants }).images;
}

export function getLocalizedLogoTextureKey(
	language: LocalizedLogoLanguage,
	variant: LocalizedLogoVariant = "",
): string {
	return variant ? `localized-logo-${language}-${variant}` : `localized-logo-${language}`;
}

export function getLocalizedLogoSpineKey(
	language: LocalizedLogoLanguage,
	variant: LocalizedLogoVariant = "",
): string {
	return variant ? `localized-logo-spine-${language}-${variant}` : `localized-logo-spine-${language}`;
}

/**
 * Resolves one localized asset per fallback variant. For every variant, Spine
 * wins over its image; only then does resolution continue to the next variant.
 */
export function resolveLocalizedLogoAsset(
	language: LocalizedLogoLanguage | undefined,
	assetExists: (format: LocalizedLogoFormat, key: string) => boolean,
	surface: LocalizedLogoSurface = LocalizedLogoSurface.Preloader,
): ResolvedLocalizedLogoAsset | undefined {
	if (!language) {
		return undefined;
	}

	for (const variant of SURFACE_VARIANTS[surface]) {
		const spineKey = getLocalizedLogoSpineKey(language, variant);
		if (assetExists("spine", spineKey)) {
			return { format: "spine", key: spineKey, variant };
		}
		const imageKey = getLocalizedLogoTextureKey(language, variant);
		if (assetExists("image", imageKey)) {
			return { format: "image", key: imageKey, variant };
		}
	}

	return undefined;
}

/**
 * Uses the first localized texture in the surface's fallback order that
 * Phaser successfully loaded. Otherwise the default logo is preserved.
 */
export function resolveLocalizedLogoTextureKey(
	defaultTextureKey: string,
	language: LocalizedLogoLanguage | undefined,
	textureExists: (textureKey: string) => boolean,
	surface: LocalizedLogoSurface = LocalizedLogoSurface.Preloader,
): string {
	const asset = resolveLocalizedLogoAsset(
		language,
		(format, key) => format === "image" && textureExists(key),
		surface,
	);
	return asset?.key ?? defaultTextureKey;
}

/**
 * Creates a localized Spine logo and uniformly fits it within a known logo
 * area. The caller supplies the default Spine animation name so translated
 * artwork keeps the same animation contract.
 */
export function createFittedLocalizedSpineLogo(
	scene: Phaser.Scene,
	spineKey: string,
	options: CreateLocalizedSpineLogoOptions,
): any | null {
	const add = scene?.add as any;
	if (typeof add?.spine !== "function") {
		return null;
	}

	let logo: any;
	try {
		logo = add.spine(
			options.x,
			options.y,
			spineKey,
			`${spineKey}-atlas`,
			options.factoryOptions,
		);
	} catch {
		return null;
	}
	if (!logo) {
		return null;
	}

	try {
		logo.setOrigin?.(options.originX ?? 0.5, options.originY ?? 0.5);
		logo.setDepth?.(options.depth ?? 0);
		if (typeof options.scrollFactor === "number") {
			logo.setScrollFactor?.(options.scrollFactor);
		}
		options.parent?.add(logo);

		const data = scene.cache.json.get(spineKey) as {
			skeleton?: { width?: number; height?: number };
		} | undefined;
		const width = Number(data?.skeleton?.width) || Number(logo.width) || 1;
		const height = Number(data?.skeleton?.height) || Number(logo.height) || 1;
		const scale = Math.min(options.targetWidth / width, options.targetHeight / height);
		if (Number.isFinite(scale) && scale > 0) {
			logo.setScale?.(scale);
		}
		logo.animationState?.setAnimation?.(0, options.animationName, options.loop ?? true);
		return logo;
	} catch {
		try {
			logo.destroy?.();
		} catch {}
		return null;
	}
}

type TextureSwappableLogo = {
	displayWidth: number;
	displayHeight: number;
	width: number;
	height: number;
	scene?: LogoMipmapScene;
	setTexture(textureKey: string): unknown;
	setDisplaySize(width: number, height: number): unknown;
};

type LogoMipmapScene = {
	textures: {
		exists(textureKey: string): boolean;
		get(textureKey: string): any;
	};
	game?: { renderer?: { gl?: WebGLRenderingContext } };
};

/**
 * WebGL1 can only generate mipmaps for power-of-two textures. Padding and the
 * upload go through Phaser's texture wrapper so the texture-unit cache stays
 * in sync with the bound texture. A raw gl.bindTexture here makes the next
 * batch sample this logo instead of the scene that is already on screen.
 */
function enableLogoTextureMipmaps(scene: LogoMipmapScene | undefined, textureKey: string): void {
	if (!scene?.textures?.exists?.(textureKey)) {
		return;
	}

	const source = scene.textures.get(textureKey)?.source?.[0];
	if (!source || source.__logoMipmapsEnabled || source.__phaserMipmapsEnabled) {
		return;
	}

	if (enableMipmapsOnPhaserTextureKey(scene as Scene, textureKey)) {
		source.__logoMipmapsEnabled = true;
	}
}

export interface LocalizedLogoFitOptions {
	/** Maximum width relative to the default rendered logo. */
	maxWidthRatio?: number;
	/** Maximum height relative to the default rendered logo. */
	maxHeightRatio?: number;
	/** Which logo surface selects the localized file. Defaults to the preloader. */
	surface?: LocalizedLogoSurface;
}

/**
 * Swaps a logo's texture while preserving its current rendered dimensions.
 *
 * Capture the default logo's dimensions before this call; source-image
 * resolution does not affect the localized logo's visible size.
 */
export function setLocalizedLogoTexture(
	logo: TextureSwappableLogo,
	defaultTextureKey: string,
	language: LocalizedLogoLanguage | undefined,
	textureExists: (textureKey: string) => boolean,
	surface: LocalizedLogoSurface = LocalizedLogoSurface.Preloader,
): string {
	const displayWidth = logo.displayWidth;
	const displayHeight = logo.displayHeight;
	const textureKey = resolveLocalizedLogoTextureKey(
		defaultTextureKey,
		language,
		textureExists,
		surface,
	);
	enableLogoTextureMipmaps(logo.scene, defaultTextureKey);
	enableLogoTextureMipmaps(logo.scene, textureKey);

	logo.setTexture(textureKey);
	logo.setDisplaySize(displayWidth, displayHeight);
	return textureKey;
}

/**
 * Swaps a logo's texture while retaining its aspect ratio and targeting the
 * default logo's visual area. The rendered size is capped to avoid excessive
 * overflow when the two assets have substantially different aspect ratios.
 */
export function fitLocalizedLogoTexture(
	logo: TextureSwappableLogo,
	defaultTextureKey: string,
	language: LocalizedLogoLanguage | undefined,
	textureExists: (textureKey: string) => boolean,
	{
		maxWidthRatio = 1.1,
		maxHeightRatio = 1.35,
		surface = LocalizedLogoSurface.Preloader,
	}: LocalizedLogoFitOptions = {},
): string {
	const defaultWidth = logo.displayWidth;
	const defaultHeight = logo.displayHeight;
	const textureKey = resolveLocalizedLogoTextureKey(
		defaultTextureKey,
		language,
		textureExists,
		surface,
	);
	enableLogoTextureMipmaps(logo.scene, defaultTextureKey);
	enableLogoTextureMipmaps(logo.scene, textureKey);

	logo.setTexture(textureKey);
	const areaScale = Math.sqrt(
		(defaultWidth * defaultHeight) / (logo.width * logo.height),
	);
	const maxScale = Math.min(
		(defaultWidth * maxWidthRatio) / logo.width,
		(defaultHeight * maxHeightRatio) / logo.height,
	);
	const scale = Math.min(areaScale, maxScale);
	logo.setDisplaySize(logo.width * scale, logo.height * scale);
	return textureKey;
}
