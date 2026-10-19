import { Scene } from 'phaser';
import { EventBus } from '../EventBus';
import { NetworkManager } from '../../managers/NetworkManager';
import { ScreenModeManager } from '../../managers/ScreenModeManager';
import { AssetConfig } from '../../config/AssetConfig';
import { AssetLoader } from '../../utils/AssetLoader';
import { ensureSpineLoader } from '../../utils/SpineGuard';

export class Boot extends Scene
{
	private networkManager: NetworkManager;
	private screenModeManager: ScreenModeManager;
	private assetConfig: AssetConfig;
	private assetLoader: AssetLoader;

	constructor ()
	{
		super('Boot');
		this.networkManager = new NetworkManager();
		this.screenModeManager = new ScreenModeManager();
		this.screenModeManager.forceOrientation('portrait');
		
		// Initialize asset configuration
		this.assetConfig = new AssetConfig(this.networkManager, this.screenModeManager);
		this.assetLoader = new AssetLoader(this.assetConfig);
	}

	init ()
	{
		console.log('Boot scene init');
		EventBus.emit('current-scene-ready', this);
	}

	preload ()
	{
		// Ensure Spine loader/plugin is registered before any asset loading
		try {
			ensureSpineLoader(this, 'Boot.preload');
		} catch (_e) {
			// no-op
		}
		
		// Show debug info
		this.assetConfig.getDebugInfo();
		
		console.log(`[Boot] Asset loading configuration:`);
		console.log(`[Boot] - Asset scale: ${this.networkManager.getAssetScale()}x`);
		console.log(`[Boot] - Asset prefix: ${this.assetConfig['getAssetPrefix']()}`);
		
		// Load loading assets using AssetLoader
		this.assetLoader.loadLoadingAssets(this);
		this.assetLoader.loadLocalizedLogoAssets(this);

		// Preload font assets as early as possible so loading/studio screens can use Poppins
		this.assetLoader.loadFontAssets(this);
		
		console.log(`[Boot] Loading assets (loading + fonts) for Boot scene`);
	}

	create ()
	{
		// Emit the screen mode manager so UI components can access it
		EventBus.emit('screen-mode-manager-ready', this.screenModeManager);

		// Match warfreaks / Phaser defaults: pause Web Audio when the tab is hidden OR the browser
		// window loses OS focus (e.g. alt-tab to another app while the tab stays "visible").
		// AudioContext resume/suspend below still guards against errors when loading in a background tab.
		try {
			if (this.sound) {
				(this.sound as any).pauseOnBlur = true;
				(this.sound as any).pauseOnHide = true;

				// Guard against InvalidStateError by no-op'ing resume/suspend when AudioContext is closed
				const anySound: any = this.sound as any;
				const ctx: any = anySound.context;
				if (ctx && typeof ctx.resume === 'function' && typeof ctx.suspend === 'function') {
					const originalResume = ctx.resume.bind(ctx);
					const originalSuspend = ctx.suspend.bind(ctx);
					ctx.resume = async () => {
						if (ctx.state === 'closed') {
							return Promise.resolve();
						}
						try {
							return await originalResume();
						} catch (_e) {
							return Promise.resolve();
						}
					};
					ctx.suspend = async () => {
						if (ctx.state === 'closed') {
							return Promise.resolve();
						}
						try {
							return await originalSuspend();
						} catch (_e) {
							return Promise.resolve();
						}
					};
				}
			}
		} catch (_e) {
			// no-op
		}
		
		this.scene.start('Preloader', { 
			networkManager: this.networkManager, 
			screenModeManager: this.screenModeManager 
		});
	}
}
