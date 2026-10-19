import { Scene } from 'phaser';
import { SpinePlugin } from '@esotericsoftware/spine-phaser-v3';

function hasSpineLoaderApis(scene: Scene): boolean {
	const loadAny = scene.load as any;
	// spine-phaser-v3 may expose either a combined loader (`load.spine`) or separate helpers.
	const hasCombined = typeof loadAny?.spine === 'function';
	const hasSeparate = typeof loadAny?.spineJson === 'function' && typeof loadAny?.spineAtlas === 'function';
	return !!(hasCombined || hasSeparate);
}

function syncSpineSysKeys(scene: Scene): void {
	// spine-phaser-v3 registers `scene.add.spine` via registerGameObject(), and the factory
	// uses `this.scene.sys[pluginKey]` internally, where `pluginKey` is whatever key the FIRST
	// constructed SpinePlugin used.
	//
	// This game uses the key `spine.SpinePlugin` in `src/game/main.ts`, but we also keep
	// `sys.spine` and `scene.spine` aligned to defend against key mismatches across reloads.
	try {
		const sysAny: any = (scene as any).sys;
		if (!sysAny) return;

		const candidate: any =
			sysAny['spine.SpinePlugin'] ||
			sysAny.SpinePlugin ||
			sysAny.spine ||
			(scene as any).spine;

		if (!candidate || typeof candidate.isAtlasPremultiplied !== 'function') return;

		sysAny['spine.SpinePlugin'] = candidate;
		sysAny.SpinePlugin = candidate;
		sysAny.spine = candidate;
		(scene as any).spine = candidate;
	} catch {
		// no-op
	}
}

export function ensureSpineFactory(scene: Scene, context: string): boolean {
	let addAny = scene.add as any;
	syncSpineSysKeys(scene);

	// `add.spine` can exist even when the scene plugin instance is NOT attached to this scene,
	// because spine-phaser-v3 registers the "spine" GameObjectFactory globally the first time
	// any SpinePlugin instance is constructed.
	const getSpineInstance = () => {
		const sysAny = (scene as any).sys;
		return sysAny?.['spine.SpinePlugin'] || sysAny?.SpinePlugin || sysAny?.spine || (scene as any).spine;
	};
	const hasAttachedPluginInstance = () => {
		const inst: any = getSpineInstance();
		return !!inst && typeof inst.isAtlasPremultiplied === 'function';
	};

	let hasFactory = typeof addAny?.spine === 'function' && hasAttachedPluginInstance();
	if (!hasFactory) {
		// Try to install the Spine scene plugin dynamically as a fallback
		try {
			const sysAny = (scene as any).sys;
			const pluginMgr: any = sysAny?.plugins;
			if (pluginMgr?.installScenePlugin) {
				// Important: pass fromLoader=true so Phaser allows attaching an already-registered plugin key
				// to this specific scene (otherwise it warns "Scene Plugin key in use" and returns early).
				pluginMgr.installScenePlugin('spine.SpinePlugin', SpinePlugin as any, 'spine', scene, true);
				syncSpineSysKeys(scene);
				// Re-check after attempting to install
				addAny = scene.add as any;
				hasFactory = typeof addAny?.spine === 'function' && hasAttachedPluginInstance();
				if (hasFactory) {
					console.info(`[SpineGuard] Installed SpinePlugin dynamically for ${context}`);
				}
			}
		} catch (e) {
			console.warn(`[SpineGuard] Failed dynamic SpinePlugin install in ${context}:`, e);
		}

		// If still unavailable, log diagnostics
		if (!hasFactory) {
		const loadAny = scene.load as any;
		const hasLoaderCombined = typeof loadAny?.spine === 'function';
		const hasLoaderJson = typeof loadAny?.spineJson === 'function';
		const hasLoaderAtlas = typeof loadAny?.spineAtlas === 'function';
		try {
			const sysAny = (scene as any).sys;
			const pluginKeys = sysAny?.plugins?.pluginKeys || Object.keys(sysAny?.plugins?.plugins || {});
			const hasSysKey = !!sysAny?.['spine.SpinePlugin'];
			const hasSysSpineKey = !!sysAny?.spine;
			const hasMappingInstance = !!(scene as any).spine;
			const attachedInstanceOk = hasAttachedPluginInstance();
			console.warn(
				`[SpineGuard] Spine factory not ready in ${context}. hasAddSpine=${typeof addAny?.spine === 'function'} attachedInstanceOk=${attachedInstanceOk} hasSysKey=${hasSysKey} hasSysSpineKey=${hasSysSpineKey} hasMappingInstance=${hasMappingInstance} hasLoaderCombined=${hasLoaderCombined} hasLoaderJson=${hasLoaderJson} hasLoaderAtlas=${hasLoaderAtlas} pluginKeys=`,
				pluginKeys
			);
		} catch {
			console.warn(`[SpineGuard] Spine factory not ready in ${context}.`);
		}
		}
	}
	return hasFactory;
}

export function ensureSpineLoader(scene: Scene, context: string): boolean {
	let hasLoader = hasSpineLoaderApis(scene);
	if (!hasLoader) {
		// Attempt to install the scene plugin dynamically to register loader file types,
		// which can fail to register if the game boots in a background tab.
		try {
			const sysAny = (scene as any).sys;
			const pluginMgr: any = sysAny?.plugins;
			if (pluginMgr?.installScenePlugin) {
				// See note above re: fromLoader=true.
				pluginMgr.installScenePlugin('spine.SpinePlugin', SpinePlugin as any, 'spine', scene, true);
				syncSpineSysKeys(scene);
				// Re-evaluate after installation attempt
				hasLoader = hasSpineLoaderApis(scene);
				if (hasLoader) {
					console.info(`[SpineGuard] Installed SpinePlugin to provide loader APIs for ${context}`);
				}
			}
		} catch (e) {
			console.warn(`[SpineGuard] Failed to install SpinePlugin for loader in ${context}:`, e);
		}
	}
	if (!hasLoader) {
		try {
			const sysAny = (scene as any).sys;
			const pluginKeys = sysAny?.plugins?.pluginKeys || Object.keys(sysAny?.plugins?.plugins || {});
			console.warn(`[SpineGuard] Spine loader APIs still missing in ${context}. pluginKeys=`, pluginKeys);
		} catch {
			console.warn(`[SpineGuard] Spine loader APIs still missing in ${context}.`);
		}
	}
	return hasLoader;
}


