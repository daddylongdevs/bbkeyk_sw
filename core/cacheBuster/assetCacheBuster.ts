/**
 * Appends the asset version to same-origin static asset requests so a new
 * asset build is not served from a stale cached file.
 * Atlas files are left unchanged: a query string on an .atlas URL breaks
 * Spine page-image resolution.
 */

let cachedAssetVersionBuster: string | undefined;
let cacheBusterHooksInstalled = false;

const STATIC_ASSET_PATH_PATTERN = /\/assets\//i;
const STATIC_ASSET_EXTENSION_PATTERN = /\.(webp|png|jpe?g|gif|svg|ogg|mp3|wav|json|ttf|otf|woff2?)$/i;
const CODE_EXTENSION_PATTERN = /\.(?:js|mjs|cjs|tsx?|jsx?)(?:$|\?|#)/i;

interface PhaserWithLoader {
	Loader?: {
		LoaderPlugin?: {
			prototype: object;
		};
	};
}

interface LoaderFileTarget {
	url?: string;
	src?: string;
}

function readEnvAssetVersion(): string {
	const env = import.meta.env as { VITE_ASSET_VERSION?: string } | undefined;
	const fromEnv = env?.VITE_ASSET_VERSION;
	return typeof fromEnv === 'string' ? fromEnv : '';
}

function getAssetVersionBuster(): string {
	if (cachedAssetVersionBuster === undefined) {
		cachedAssetVersionBuster = (readEnvAssetVersion() || '1').replace(/^v/i, '');
	}
	return cachedAssetVersionBuster;
}

function hasCacheBusterParam(url: string): boolean {
	try {
		const parsed = new URL(url, window.location.href);
		return parsed.searchParams.has('v');
	} catch {
		return /[?&]v=/.test(url);
	}
}

function shouldApplyCacheBuster(url: string): boolean {
	if (!url || /^(?:data:|blob:|javascript:)/i.test(url)) {
		return false;
	}
	if (hasCacheBusterParam(url)) {
		return false;
	}
	if (CODE_EXTENSION_PATTERN.test(url.split('#')[0]) || /app-config\.js/i.test(url) || /\/@/.test(url)) {
		return false;
	}
	if (/\.atlas(?:$|\?|#)/i.test(url)) {
		return false;
	}

	try {
		const parsed = new URL(url, window.location.href);
		if (parsed.origin !== window.location.origin) {
			return false;
		}
		if (/\/api(?:\/|$)/i.test(parsed.pathname)) {
			return false;
		}
		const pathname = parsed.pathname.replace(/\\/g, '/');
		if (/\.atlas$/i.test(pathname)) {
			return false;
		}
		return STATIC_ASSET_PATH_PATTERN.test(pathname)
			|| STATIC_ASSET_EXTENSION_PATTERN.test(pathname)
			|| /^assets\//i.test(url.replace(/^\.\//, ''));
	} catch {
		const normalized = url.replace(/^\.\//, '');
		return STATIC_ASSET_PATH_PATTERN.test(normalized) || /^assets\//i.test(normalized);
	}
}

function applyCacheBuster(url: string): string {
	if (!shouldApplyCacheBuster(url)) {
		return url;
	}
	const version = getAssetVersionBuster();
	if (!version) {
		return url;
	}
	const separator = url.includes('?') ? '&' : '?';
	return `${url}${separator}v=${encodeURIComponent(version)}`;
}

function patchLoaderFileTarget(target: unknown): void {
	if (!target || typeof target !== 'object') {
		return;
	}
	const file = target as LoaderFileTarget;
	if (typeof file.url === 'string') {
		file.url = applyCacheBuster(file.url);
	}
	if (typeof file.src === 'string') {
		file.src = applyCacheBuster(file.src);
	}
}

/**
 * Patches the Phaser loader, XHR, fetch, and Image.src so runtime asset
 * requests share one asset version.
 */
export function installAssetCacheBuster(assetVersion?: string, phaser?: PhaserWithLoader): void {
	if (typeof assetVersion === 'string' && assetVersion.length > 0) {
		cachedAssetVersionBuster = assetVersion.replace(/^v/i, '');
	} else if (cachedAssetVersionBuster === undefined) {
		const fromEnv = readEnvAssetVersion();
		if (fromEnv) {
			cachedAssetVersionBuster = fromEnv.replace(/^v/i, '');
		}
	}
	if (cacheBusterHooksInstalled || typeof window === 'undefined') {
		return;
	}
	cacheBusterHooksInstalled = true;

	try {
		const proto = phaser?.Loader?.LoaderPlugin?.prototype as Record<string, unknown> | undefined;
		const addFile = proto?.addFile;
		if (proto && typeof addFile === 'function' && !proto.__assetCacheBusterPatched) {
			proto.__assetCacheBusterPatched = true;
			const originalAddFile = addFile as (this: unknown, file: unknown) => unknown;
			proto.addFile = function patchedAddFile(this: unknown, file: unknown): unknown {
				if (Array.isArray(file)) {
					file.forEach(patchLoaderFileTarget);
				} else {
					patchLoaderFileTarget(file);
				}
				return originalAddFile.call(this, file);
			};
		}
	} catch (error) {
		console.warn('[AssetLoader] Failed to patch Phaser loader cache buster:', error);
	}

	try {
		const xhrOpen = XMLHttpRequest.prototype.open;
		XMLHttpRequest.prototype.open = function patchedXhrOpen(
			method: string,
			url: string | URL,
			async?: boolean,
			username?: string | null,
			password?: string | null,
		): void {
			const nextUrl = typeof url === 'string' ? applyCacheBuster(url) : url;
			xhrOpen.call(this, method, nextUrl, async ?? true, username, password);
		};
	} catch (error) {
		console.warn('[AssetLoader] Failed to patch XMLHttpRequest cache buster:', error);
	}

	try {
		if (typeof window.fetch === 'function') {
			const nativeFetch = window.fetch.bind(window);
			window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
				if (typeof input === 'string') {
					return nativeFetch(applyCacheBuster(input), init);
				}
				if (typeof URL !== 'undefined' && input instanceof URL) {
					return nativeFetch(applyCacheBuster(input.toString()), init);
				}
				if (typeof Request !== 'undefined' && input instanceof Request) {
					const bustedUrl = applyCacheBuster(input.url);
					if (bustedUrl !== input.url) {
						return nativeFetch(new Request(bustedUrl, input), init);
					}
				}
				return nativeFetch(input as RequestInfo, init);
			};
		}
	} catch (error) {
		console.warn('[AssetLoader] Failed to patch fetch cache buster:', error);
	}

	try {
		const srcDescriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
		const imageProto = HTMLImageElement.prototype as HTMLImageElement & { __assetCacheBusterPatched?: boolean };
		if (srcDescriptor?.set && srcDescriptor.get && !imageProto.__assetCacheBusterPatched) {
			imageProto.__assetCacheBusterPatched = true;
			const setSrc = srcDescriptor.set;
			Object.defineProperty(HTMLImageElement.prototype, 'src', {
				configurable: true,
				enumerable: srcDescriptor.enumerable,
				get: srcDescriptor.get,
				set(this: HTMLImageElement, value: string) {
					setSrc.call(this, applyCacheBuster(value));
				},
			});
		}
	} catch (error) {
		console.warn('[AssetLoader] Failed to patch HTMLImageElement cache buster:', error);
	}
}
