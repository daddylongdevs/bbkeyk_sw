import { Scene } from 'phaser';
import { EventBus } from '../EventBus';
import { NetworkManager } from '../../managers/NetworkManager';
import { ScreenModeManager } from '../../managers/ScreenModeManager';
import { AssetConfig } from '../../config/AssetConfig';
import { AssetLoader } from '../../utils/AssetLoader';
import { GameAPI } from '../../backend/GameAPI';
import { startScratchHubAfterInitialize } from '../../sidegames/scratch/ScratchClient';
import { GameData } from '../components/GameData';
import { FullScreenManager } from '../../managers/FullScreenManager';
import { ensureSpineFactory } from '../../utils/SpineGuard';
import { StudioLoadingScreen } from '../components/StudioLoadingScreen';
import { ClockDisplay } from '../components/ClockDisplay';
import { VersionManager } from '../../managers/VersionManager';
import { CurrencyManager } from '../components/CurrencyManager';
import { unresolvedSpinManager } from '../../managers/UnresolvedSpinManager';
import { localizationManager } from '../../managers/LocalizationManager';
import { CLOCK_DEMO, LOCALIZATION_DEFAULTS, PRELOADER_MAX_WIN } from '../../backend/LocalizationData';
import { MAX_WIN_MULTIPLIER } from '../../config/GameConfig';
import { gameEventManager, GameEventType } from '../../event/EventManager';
import { checkAndHandleModal, clearCurrentModal, showGameLoadingFailedModal } from '../../managers/ModalManager';
import {
	fitLocalizedLogoTexture,
	resolveLocalizedLogoTextureKey,
} from "@core/utils/LocalizedLogo";

export class Preloader extends Scene
{
	private networkManager: NetworkManager;
	private screenModeManager: ScreenModeManager;
	private assetConfig: AssetConfig;
	private assetLoader: AssetLoader;
	private gameAPI: GameAPI;
	private studio?: StudioLoadingScreen;
	private studioFadeComplete = false;
	private clockDisplay?: ClockDisplay;
	private versionDisplay?: VersionManager;
	private preloaderVerticalOffsetModifier: number = 10;
	private bootProgressHandler?: (progress: number) => void;
	private initialBalance: number | null = null;
	/** Starts in {@link preload} so session + balance run in parallel with the asset loader / studio bar. */
	private sessionBootstrapPromise: Promise<void> | undefined;
	/** When true, preloader max-win line stays hidden even if cache has a value. */
	private sessionBootstrapErrored = false;
	private gameLoadingRetryAttempted = false;
	private unsubscribeLocalizationReady?: () => void;
	private replayClockRetryTimer?: Phaser.Time.TimerEvent;

	// Loading bar graphics
	private progressBarBg?: Phaser.GameObjects.Graphics;
	private progressBarFill?: Phaser.GameObjects.Graphics;
	private progressText?: Phaser.GameObjects.Text;
	private progressBarX?: number;
	private progressBarY?: number;
	private progressBarWidth?: number;
	private progressBarHeight?: number;
	private progressBarPadding: number = 3;

	// UI elements we need after load
	private buttonSpin?: Phaser.GameObjects.Image;
	private buttonBg?: Phaser.GameObjects.Image;
	private pressToPlayText?: Phaser.GameObjects.Text;
	private taglineText?: Phaser.GameObjects.Text;
	private websiteText?: Phaser.GameObjects.Text;
	private maxWinText?: Phaser.GameObjects.Text;
	private fullscreenBtn?: Phaser.GameObjects.Image;
	private logo?: Phaser.GameObjects.Image;
	private logoTweenStarted = false;

	constructor ()
	{
		super('Preloader');
	}

	init (data: any)
	{
		// Check if add.spine is available - if not, reload the game
		const hasSpineFactory = ensureSpineFactory(this, '[Preloader] init');
		if (!hasSpineFactory) {
			console.error('[Preloader] add.spine is not recognized. Reloading the game...');
			setTimeout(() => {
				window.location.reload();
			}, 250);
			return;
		}

		// Receive managers from Boot scene
		this.networkManager = data.networkManager;
		this.screenModeManager = data.screenModeManager;
		this.gameLoadingRetryAttempted = data?.gameLoadingRetryAttempted === true;
		this.sessionBootstrapPromise = undefined;
		this.sessionBootstrapErrored = false;
		this.studioFadeComplete = false;
		this.initialBalance = null;
		
		// Initialize asset configuration
		this.assetConfig = new AssetConfig(this.networkManager, this.screenModeManager);
		this.assetLoader = new AssetLoader(this.assetConfig);
		
		// Initialize GameAPI
		const gameData = new GameData();
		this.gameAPI = new GameAPI(gameData);
		
		const screenConfig = this.screenModeManager.getScreenConfig();
		const assetScale = this.networkManager.getAssetScale();
		
		console.log(`[Preloader] Applying asset scale: ${assetScale}x`);
		
		// Background color for studio loading (#10161D to match studio screen)
		this.cameras.main.setBackgroundColor(0x10161D);

		// Always show loading background, scaled to cover the entire screen
		const background = this.add.image(
			this.scale.width * 0.5, 
			this.scale.height * 0.5, 
			"loading_background"
		).setOrigin(0.5, 0.5).setScrollFactor(0);
		
		const scaleX = this.scale.width / background.width;
		const scaleY = this.scale.height / background.height;
		const scale = Math.max(scaleX, scaleY);
		background.setScale(scale);
		
		console.log(`[Preloader] Background original size: ${background.width}x${background.height}`);
		console.log(`[Preloader] Canvas size: ${this.scale.width}x${this.scale.height}`);
		console.log(`[Preloader] Calculated scale: ${scale} (scaleX: ${scaleX}, scaleY: ${scaleY})`);
		console.log(`[Preloader] Background dimensions: ${background.width}x${background.height}, canvas: ${this.scale.width}x${this.scale.height}`);
		console.log(`[Preloader] Background display size: ${this.scale.width}x${this.scale.height}`);
		console.log(`[Preloader] Background position: (${this.scale.width * 0.5}, ${this.scale.height * 0.5})`);

		const localizedDemoLabel = localizationManager.getTextByKey(CLOCK_DEMO) || LOCALIZATION_DEFAULTS[CLOCK_DEMO] || 'DEMO';

		if (this.gameAPI.getReplayState()) {
			this.clockDisplay = new ClockDisplay(this, {
				offsetX: 5,
				offsetY: 5,
				fontSize: 16,
				fontFamily: 'poppins-regular',
				color: '#FFFFFF',
				alpha: 0.5,
				depth: 30000,
				scale: 0.7,
				gameTitle: this.getReplayClockTitle(),
				showClock: false,
				additionalText: 'DiJoker',
				additionalTextOffsetX: 5,
				additionalTextOffsetY: 0,
				additionalTextScale: 0.7,
				additionalTextColor: '#FFFFFF',
				additionalTextFontSize: 16,
				additionalTextFontFamily: 'poppins-regular'
			});
			this.clockDisplay.create();
			this.startReplayClockTitleRetry();
		} else {
			this.clockDisplay = new ClockDisplay(this, {
				offsetX: 5,
				offsetY: 5,
				fontSize: 16,
				fontFamily: 'poppins-regular',
				color: '#FFFFFF',
				alpha: 0.5,
				depth: 30000,
				scale: 0.7,
				suffixText: ` | Sugar Wonderland${this.gameAPI.getDemoState() ? ` | ${localizedDemoLabel}` : ''}`,
				additionalText: 'DiJoker',
				additionalTextOffsetX: 5,
				additionalTextOffsetY: 0,
				additionalTextScale: 0.7,
				additionalTextColor: '#FFFFFF',
				additionalTextFontSize: 16,
				additionalTextFontFamily: 'poppins-regular'
			});
			this.clockDisplay.create();
		}
		this.setupLocalizationReadyListener();

		// Version display in bottom right (same formatting as ClockDisplay)
		this.versionDisplay = new VersionManager(this, {
			fontSize: 16,
			fontFamily: 'poppins-regular',
			color: '#FFFFFF',
			alpha: 0.5,
			depth: 30000,
			scale: 0.7,
		});
		this.versionDisplay.create();

		// Loading frame + tagline + URL and max-win text (aligned to StudioLoadingScreen positions)
		// Use the same offsets as StudioLoadingScreen defaults so both layers line up visually
		const loadingFrameOffsetFromCenter = 345;
		const loadingFrame = this.add.image(
			this.scale.width * 0.5,
			this.scale.height * 0.5 + loadingFrameOffsetFromCenter,
			"loading_frame_2"
		).setOrigin(0.5, 0.5).setScrollFactor(0);

		const frameScale = (Math.max(this.scale.width / loadingFrame.width, this.scale.height / loadingFrame.height)) * 0.04;
		loadingFrame.setScale(frameScale);

		// "PLAY LOUD. WIN WILD. DIJOKER STYLE"
		// Matches StudioLoadingScreen default textOffsetY
		const textOffsetFromCenter = 375;
		this.taglineText = this.add.text(
			this.scale.width * 0.5 - 5,
			this.scale.height * 0.5 + textOffsetFromCenter,
			'PLAY LOUD. WIN WILD. DIJOKER STYLE',
			{
				fontFamily: 'poppins-regular',
				fontSize: '14px',
				color: '#FFFFFF',
				fontStyle: 'normal',
				align: 'center',
			}
		)
		.setOrigin(0.5, 0.5)
		.setScrollFactor(0)
		.setAlpha(1);

		// "www.dijoker.com"
		// Matches StudioLoadingScreen default text2OffsetY
		const websiteOffsetFromCenter = 400;
		this.websiteText = this.add.text(
			this.scale.width * 0.5,
			this.scale.height * 0.5 + websiteOffsetFromCenter,
			'www.dijoker.com',
			{
				fontFamily: 'poppins-regular',
				fontSize: '14px',
				color: '#FFFFFF',
				fontStyle: 'normal',
				align: 'center',
			}
		)
		.setOrigin(0.5, 0.5)
		.setScrollFactor(0)
		.setAlpha(1);

		const winTextY = 145 + this.preloaderVerticalOffsetModifier;
		this.maxWinText = this.add.text(
			this.scale.width * 0.5,
			this.scale.height * 0.5 + winTextY,
			'',
			{
				fontFamily: 'poppins-bold',
				fontSize: '32px',
				color: '#FFFFFF',
				align: 'center',
			}
		)
		.setOrigin(0.5, 0.5)
		.setScrollFactor(0)
		.setAlpha(0)
		.setVisible(true);

		this.tweens.add({
			targets: this.maxWinText,
			scale: { from: 0.90, to: 0.95 },
			duration: 800,
			ease: 'Sine.easeInOut',
			yoyo: true,
			repeat: -1,
			hold: 0,
			delay: 0,
		});

		this.maxWinText
			.setStroke('#379557', 4)
			.setShadow(0, 2, '#000000', 4, true, true);

		if (screenConfig.isPortrait) {
			// Studio loading screen with the same frame/text positioning as Preloader
			this.studio = new StudioLoadingScreen(this, {
				loadingFrameOffsetX: 0,
				loadingFrameOffsetY: 345,
				loadingFrameScaleModifier: 0.04,
				text: 'PLAY LOUD. WIN WILD. DIJOKER STYLE',
				textOffsetX: -5,
				textOffsetY: 375,
				textScale: 1,
				textColor: '#FFFFFF',
				text2: 'www.dijoker.com',
				text2OffsetX: 0,
				text2OffsetY: 400,
				text2Scale: 1,
				text2Color: '#FFFFFF',
			});
			this.studio.show();

			// Hook for any post-fade actions if needed later
			this.events.once('studio-fade-complete', () => {
				this.studioFadeComplete = true;
				if (this.sessionBootstrapErrored) {
					this.showGameLoadingFailedModalNow();
				}
				// no-op for now
			});

			const buttonY = this.scale.height * 0.77;
			
			// Scale buttons based on quality (low quality assets need 2x scaling)
			this.buttonBg = this.add.image(
				this.scale.width * 0.5, 
				buttonY, 
				"button_bg"
			).setOrigin(0.5, 0.5).setScale(assetScale);

			this.buttonSpin = this.add.image(
				this.scale.width * 0.5, 
				buttonY, 
				"button_spin"
			).setOrigin(0.5, 0.5).setScale(assetScale);

			// Grey out and disable the spin button and background until load completes
			this.buttonSpin.setTint(0x777777).setAlpha(0.9);
			this.buttonBg.setTint(0x777777).setAlpha(0.9);
			this.buttonSpin.disableInteractive();

			console.log(`[Preloader] Button scaling: ${assetScale}x`);

			// Game logo (position + breathing animation copied from Hustle Horse)
			this.logo = this.add.image(
				this.scale.width * 0.5, 
				this.scale.height * 0.185, 
				"logo_loading"
			).setOrigin(0.5, 0.5).setScale(0.25);
			
			console.log(`[Preloader] Added logo_loading at scale: ${assetScale}x`);
			this.startLogoTween();

			this.tweens.add({
				targets: this.buttonSpin,
				rotation: Math.PI * 2,
				duration: 5000,
				repeat: -1,
			});

			// // "Press Play To Continue" text (initially hidden), positioned above the spin button
			// const ctaX = this.scale.width * 0.5;
			// const ctaY = buttonY - Math.max(40, 48 * assetScale);
			// this.pressToPlayText = this.add.text(ctaX, ctaY, 'Press Play To Continue', {
			// 	fontFamily: 'poppins-regular',
			// 	fontSize: `${Math.round(22 * assetScale)}px`,
			// 	color: '#FFFFFF',
			// 	align: 'center'
			// })
			// .setOrigin(0.5, 1)
			// .setAlpha(0)
			// .setShadow(0, 3, '#000000', 6, true, true);

		}

		// Notify host page loader (if present) that Phaser boot loader can hide
		try {
			(window as any).hideBootLoader?.();
		} catch {}

		// Set up progress event listener (forward only to external listeners; studio/studio React handle bars)
		this.bootProgressHandler = (progress: number) => {
			EventBus.emit('progress', progress);
			try {
				(window as any).setBootLoaderProgress?.(0.25 + progress * 0.75);
			} catch {}
		};
		this.load.on('progress', this.bootProgressHandler as any);

		this.load.once('complete', () => {
			try {
				(window as any).setBootLoaderProgress?.(1);
			} catch {}
			// Detach this handler so subsequent background loads (audio) don't drive the boot progress UI.
			try {
				if (this.bootProgressHandler) {
					this.load.off('progress', this.bootProgressHandler as any);
					this.bootProgressHandler = undefined;
				}
			} catch {}
		});
		
		EventBus.emit('current-scene-ready', this);	
	}

	private getPreloaderMaxWinMultiplierDisplay(): string {
		const mult = this.gameAPI.getMaxWin() ?? MAX_WIN_MULTIPLIER;
		return mult.toLocaleString() + 'x';
	}

	private updatePreloaderMaxWinLine(): void {
		if (!this.maxWinText) {
			return;
		}
		const maxWinLabel =
			localizationManager.getTextByKey(PRELOADER_MAX_WIN) ??
			LOCALIZATION_DEFAULTS[PRELOADER_MAX_WIN] ??
			'Win up to';
		const multiplierStr = this.getPreloaderMaxWinMultiplierDisplay();
		this.maxWinText.setText(`${maxWinLabel} ${multiplierStr}`);
	}

	private revealPreloaderMaxWinText(): void {
		if (this.gameAPI.getReplayState() || this.sessionBootstrapErrored) {
			this.maxWinText?.setVisible(false);
			return;
		}
		this.updatePreloaderMaxWinLine();
		this.maxWinText?.setVisible(true);
		this.maxWinText?.setAlpha(1);
	}

	private setupLocalizationReadyListener(): void {
		this.unsubscribeLocalizationReady = gameEventManager.on(GameEventType.LOCALIZATION_READY, () => {
			this.refreshLocalizedPreloaderText();
		});

		this.events.once('shutdown', () => {
			try {
				this.unsubscribeLocalizationReady?.();
			} catch {}
			this.unsubscribeLocalizationReady = undefined;
			try {
				this.replayClockRetryTimer?.remove();
			} catch {}
			this.replayClockRetryTimer = undefined;
		});
	}

	private getReplayClockTitle(): string {
		const replayData = this.gameAPI.getReplayData?.();
		const roundId = replayData?.round_id;
		const roundIdText =
			roundId === undefined || roundId === null || String(roundId).trim() === ''
				? '...'
				: String(roundId);
		return `Sugar Wonderland | Replay\nID: ${roundIdText}`;
	}

	private startReplayClockTitleRetry(): void {
		if (!this.gameAPI.getReplayState()) {
			return;
		}
		if (this.replayClockRetryTimer) {
			return;
		}
		this.replayClockRetryTimer = this.time.addEvent({
			delay: 100,
			loop: true,
			callback: () => {
				const replayData = this.gameAPI.getReplayData?.();
				const roundId = replayData?.round_id;
				if (roundId === undefined || roundId === null || String(roundId).trim() === '') {
					return;
				}
				this.clockDisplay?.setGameTitle(this.getReplayClockTitle());
				try {
					this.replayClockRetryTimer?.remove();
				} catch {}
				this.replayClockRetryTimer = undefined;
			}
		});
	}

	private refreshLocalizedPreloaderText(): void {
		this.revealPreloaderMaxWinText();
		if (this.gameAPI.getReplayState()) {
			this.clockDisplay?.setGameTitle(this.getReplayClockTitle());
			this.startReplayClockTitleRetry();
			return;
		}

		const demoLabel = localizationManager.getTextByKey(CLOCK_DEMO) || LOCALIZATION_DEFAULTS[CLOCK_DEMO] || 'DEMO';
		const suffixText = ` | Sugar Wonderland${this.gameAPI.getDemoState() ? ` | ${demoLabel}` : ''}`;
		this.clockDisplay?.setSuffixText(suffixText);
	}

	private refreshLocalizedLogo(): void {
		if (!this.logo) {
			return;
		}

		const language = this.gameAPI.getLocalizedLogoLanguage();
		const textureKey = resolveLocalizedLogoTextureKey(
			"logo_loading",
			language,
			(key) => this.textures.exists(key),
		);
		if (textureKey === "logo_loading") {
			return;
		}

		this.stopLogoTween();
		this.tweens.add({
			targets: this.logo,
			alpha: 0,
			duration: 150,
			ease: 'Sine.easeIn',
			onComplete: () => {
				this.applyLocalizedLogo(language);
				this.startLogoTween();
				this.tweens.add({
					targets: this.logo,
					alpha: 1,
					duration: 150,
					ease: 'Sine.easeOut',
				});
			},
		});
	}

	private applyLocalizedLogo(language = this.gameAPI.getLocalizedLogoLanguage()): void {
		if (!this.logo) {
			return;
		}

		fitLocalizedLogoTexture(
			this.logo,
			"logo_loading",
			language,
			(key) => this.textures.exists(key),
		);
	}

	private stopLogoTween(): void {
		if (!this.logo || !this.logoTweenStarted) {
			return;
		}

		this.tweens.killTweensOf(this.logo);
		this.logoTweenStarted = false;
	}

	private startLogoTween(): void {
		if (!this.logo || this.logoTweenStarted) {
			return;
		}

		this.logoTweenStarted = true;
		const scaleX = this.logo.scaleX;
		const scaleY = this.logo.scaleY;
		this.tweens.add({
			targets: this.logo,
			scaleX: { from: scaleX, to: scaleX * (0.26 / 0.25) },
			scaleY: { from: scaleY, to: scaleY * (0.26 / 0.25) },
			duration: 800,
			ease: 'Sine.easeInOut',
			yoyo: true,
			repeat: -1,
		});
	}

	preload ()
	{
		this.ensureSessionBootstrapDuringLoad();

		// Prefer more parallel requests on modern networks
		this.load.maxParallelDownloads = Math.max(this.load.maxParallelDownloads, 8);
		// Show debug info
		this.assetConfig.getDebugInfo();

		
		// Load background and header assets (will be used in Game scene)
		this.assetLoader.loadBackgroundAssets(this);
		this.assetLoader.loadHeaderAssets(this);
		this.assetLoader.loadBonusHeaderAssets(this);
		this.assetLoader.loadSymbolAssets(this);
		this.assetLoader.loadButtonAssets(this);
		this.assetLoader.loadFontAssets(this);
		this.assetLoader.loadDialogAssets(this);
		this.assetLoader.loadBonusBackgroundAssets(this);
		this.assetLoader.loadNumberAssets(this);
		this.assetLoader.loadBuyFeatureAssets(this);
		this.assetLoader.loadMenuAssets(this);
		this.assetLoader.loadHelpScreenAssets(this);
		// Preload audio as part of the main Preloader load (blocking).
		// This guarantees audio is ready by the time the player can start the game.
		this.assetLoader.loadAudioAssets(this);
		
		console.log(`[Preloader] Loading assets for Preloader and Game scenes`);
	}

	private ensureSessionBootstrapDuringLoad(): void {
		if (this.sessionBootstrapPromise !== undefined) {
			return;
		}
		this.sessionBootstrapPromise = this.bootstrapSessionAndBalance();
	}

	private async bootstrapSessionAndBalance(): Promise<void> {
		this.sessionBootstrapErrored = false;
		try {
			console.log('[Preloader] Initializing GameAPI (parallel with asset load)...');
			await this.gameAPI.initReplayData();
			const gameToken = await this.gameAPI.initializeGame();
			console.log('[Preloader] Game URL Token:', gameToken);

			console.log('[Preloader] Initializing refresh token...');
			await this.gameAPI.initializeRefreshToken();
			console.log('[Preloader] Refresh token initialized');

			const isDemo = this.gameAPI.getDemoState();
			const isReplay = this.gameAPI.getReplayState();
			if (!isDemo && !isReplay) {
				console.log('[Preloader] Calling backend slot initialization...');
				const slotInitData = await this.gameAPI.initializeSlotSession();
				startScratchHubAfterInitialize(this.gameAPI);
				console.log('[Preloader] Slot initialization data:', slotInitData);
				try {
					if (slotInitData) {
						unresolvedSpinManager.setFromInitializationData(slotInitData);
					}
				} catch {}
				try {
					if (slotInitData) {
						CurrencyManager.initializeFromInitData(slotInitData);
					}
				} catch {}
			} else if (isDemo) {
				console.log('[Preloader] Demo mode active - skipping backend slot initialization');
				startScratchHubAfterInitialize(this.gameAPI);
				try {
					CurrencyManager.initializeFromInitData(this.gameAPI.getInitializationData());
				} catch {}
			} else {
				console.log('[Preloader] Replay mode active - skipping backend slot initialization');
				try {
					CurrencyManager.initializeFromInitData(this.gameAPI.getInitializationData());
				} catch {}
			}

			console.log('[Preloader] Fetching initial balance before enabling play...');
			const initialBalance = Number(await this.gameAPI.initializeBalance());
			if (Number.isFinite(initialBalance) && (initialBalance >= 0 || initialBalance === -1)) {
				this.initialBalance = initialBalance;
				console.log('[Preloader] Initial balance ready:', initialBalance);
			} else {
				console.warn(
					'[Preloader] Initial balance was invalid, Game scene will fall back to its own initialization.',
					{ initialBalance },
				);
			}
		} catch (error) {
			console.error('[Preloader] Failed to initialize GameAPI or slot session:', error);
			this.sessionBootstrapErrored = true;
		}
	}

	private startBackgroundAudioLoad(): void {
		try {
			const audioCacheHas = (key: string): boolean => {
				try {
					const c: any = (this.cache.audio as any);
					if (c && typeof c.exists === 'function') return !!c.exists(key);
					if (c && typeof c.has === 'function') return !!c.has(key);
				} catch {}
				return false;
			};

			const isLoaderBusy = (): boolean => {
				try {
					const l: any = this.load as any;
					if (l && typeof l.isLoading === 'function') return !!l.isLoading();
					if (l && typeof l.isLoading === 'boolean') return !!l.isLoading;
					// Best-effort fallback for older Phaser builds
					if (l && typeof l.state === 'number') return l.state !== 0;
				} catch {}
				return false;
			};

			const audioAssets = this.assetConfig.getAudioAssets();
			const audioMap = audioAssets.audio || {};
			const entries = Object.entries(audioMap);
			if (entries.length === 0) return;

			// If the loader is currently busy for any reason, wait and try again.
			if (isLoaderBusy()) {
				this.load.once('complete', () => this.startBackgroundAudioLoad());
				return;
			}

			let queued = 0;
			for (const [key, path] of entries) {
				if (audioCacheHas(key)) continue;
				try {
					this.load.audio(key, path);
					queued++;
				} catch {}
			}

			if (queued <= 0) return;

			console.log(`[Preloader] Background-loading ${queued} audio files (non-blocking for StudioLoading)`);

			this.load.once('complete', () => {
				console.log('[Preloader] Background audio load complete');
			});

			this.load.start();
		} catch (e) {
			console.warn('[Preloader] Failed to start background audio load:', e);
		}
	}

    async create ()
    {
		try {
			const demoState = this.gameAPI.getDemoState();
			console.log('[Preloader] Demo state:', demoState);
		} catch (error) {
			console.error('[Preloader] Failed to get demo state:', error);
		}

		this.ensureSessionBootstrapDuringLoad();
		await this.sessionBootstrapPromise;

		// Fetch locale and set translations (isolated so API failure still allows defaults).
		try {
			console.log('[Preloader] Fetching localization data...');
			await this.gameAPI.fetchLocalizationData();
			console.log('[Preloader] Localization data fetch attempted!');
			const localizationData = this.gameAPI.getLocalizationData();
			const locale: string | null = localizationData?.locale ?? null;
			if (locale && locale.length > 0) {
				localizationManager.setTranslations(locale);
				gameEventManager.emit(GameEventType.LOCALIZATION_READY);
			} else {
				localizationManager.setTranslations(JSON.stringify(LOCALIZATION_DEFAULTS));
			}
		} catch (err) {
			console.warn('[Preloader] Localization fetch failed, using defaults:', err);
			localizationManager.setTranslations(JSON.stringify(LOCALIZATION_DEFAULTS));
		}

		this.refreshLocalizedLogo();
		this.refreshLocalizedPreloaderText();

		if (this.sessionBootstrapErrored) {
			console.warn('[Preloader] Blocking game start because session bootstrap failed');
			if (this.buttonSpin) {
				this.buttonSpin.setTint(0x777777).setAlpha(0.6);
				this.buttonSpin.disableInteractive();
			}
			if (this.buttonBg) {
				this.buttonBg.setTint(0x777777).setAlpha(0.6);
			}
			// Portrait: wait for studio-fade-complete. Landscape / already faded: show now.
			if (!this.studio || this.studioFadeComplete) {
				this.showGameLoadingFailedModalNow();
			}
			return;
		}


        // Create fullscreen toggle now that assets are loaded (using shared manager)
        const assetScale = this.networkManager.getAssetScale();
        this.fullscreenBtn = FullScreenManager.addToggle(this, {
            margin: 16 * assetScale,
            iconScale: 1.5 * assetScale,
            depth: 10000,
            maximizeKey: 'maximize',
            minimizeKey: 'minimize'
        });

        // Enable the spin button for user to continue
        if (this.buttonSpin) {
            this.buttonSpin.clearTint();
            this.buttonSpin.setAlpha(1);
            this.buttonSpin.setInteractive({ useHandCursor: true });
        }
        if (this.buttonBg) {
            this.buttonBg.clearTint();
            this.buttonBg.setAlpha(1);
        }

        // Show call-to-action text
        if (this.pressToPlayText) {
            this.pressToPlayText.setAlpha(1);
            this.tweens.add({
                targets: this.pressToPlayText,
                alpha: 0.3,
                duration: 800,
                yoyo: true,
                repeat: -1
            });
        }

        // Prepare fade overlay
        const fadeOverlay = this.add.rectangle(
            this.scale.width * 0.5,
            this.scale.height * 0.5,
            this.scale.width,
            this.scale.height,
            0x000000
        ).setOrigin(0.5, 0.5).setScrollFactor(0).setAlpha(0);

        // Start game on click
        this.buttonSpin?.once('pointerdown', () => {
            this.tweens.add({
                targets: fadeOverlay,
                alpha: 1,
                duration: 500,
                ease: 'Power2',
                onComplete: () => {
                    console.log('[Preloader] Starting Game scene after click');
                    this.scene.start('Game', { 
                        networkManager: this.networkManager, 
                        screenModeManager: this.screenModeManager,
                        // Pass the same GameAPI instance so initialization data is shared
                        gameAPI: this.gameAPI,
					initialBalance: this.initialBalance
                    });
                }
            });
        });

		// Audio is preloaded in `preload()`, so no background audio load needed here.

		const refreshTextFont = (textObject: Phaser.GameObjects.Text | undefined, fontFamily: string): void => {
			if (!textObject) {
				return;
			}
			textObject.setFontFamily(fontFamily);
			try {
				(textObject as any).updateText?.();
			} catch {}
		};

		const applyLoadingFonts = (): void => {
			refreshTextFont(this.progressText, 'poppins-regular');
			refreshTextFont(this.pressToPlayText, 'poppins-regular');
			refreshTextFont(this.taglineText, 'poppins-regular');
			refreshTextFont(this.websiteText, 'poppins-regular');
			refreshTextFont(this.maxWinText, 'poppins-bold');
			this.versionDisplay?.setFontFamily('poppins-regular');
		};

		const fontsObj: any = (document as any).fonts;
		if (fontsObj && typeof fontsObj.load === 'function') {
			Promise.allSettled([
				fontsObj.load('1em poppins-regular'),
				fontsObj.load('1em poppins-bold')
			]).then(() => {
				applyLoadingFonts();
			}).catch(() => {
				applyLoadingFonts();
			});
		} else if (fontsObj && typeof fontsObj.ready?.then === 'function') {
			fontsObj.ready.then(() => {
				applyLoadingFonts();
			}).catch(() => {
				applyLoadingFonts();
			});
		} else {
			applyLoadingFonts();
		}
    }
	private showGameLoadingFailedModalNow(): void {
		if (this.gameAPI?.isPlaySessionSuperseded?.()) {
			checkAndHandleModal({
				message: 'This game was opened in another window. This session has been disconnected.',
			});
			return;
		}
		if (isPlaySessionSuperseded()) {
			notifyPlayInstanceDisconnected((message) => {
				checkAndHandleModal({ message });
			});
			return;
		}
		showGameLoadingFailedModal({
			scene: this,
			showReloadButton: !this.gameLoadingRetryAttempted,
			onReload: () => {
				try {
					clearCurrentModal();
				} catch {}
				this.scene.restart({
					networkManager: this.networkManager,
					screenModeManager: this.screenModeManager,
					gameLoadingRetryAttempted: true,
				});
			},
		});
	}

}
