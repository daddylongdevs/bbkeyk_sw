/**
 * Game Scene - STABLE VERSION v1.0
 * 
 * This version includes:
 * - Complete asset management system with AssetConfig and AssetLoader
 * - NetworkManager and ScreenModeManager integration
 * - Background, Header, Symbols, and SlotController components
 * - BonusBackground and BonusHeader components (commented out)
 * - Proper event handling and backend integration
 * 
 * Base stable version - revert to this if future changes break functionality
 */
import { EventBus } from '../EventBus';
import { Scene } from 'phaser';
import { Background } from '../components/Background';
import { Header } from '../components/Header';
import { SlotController } from '../components/SlotController';
import { NetworkManager } from '../../managers/NetworkManager';
import { ScreenModeManager } from '../../managers/ScreenModeManager';
import { AssetConfig } from '../../config/AssetConfig';
import { PaylineData } from '../../backend/SpinData';
import { AssetLoader } from '../../utils/AssetLoader';
import { Symbols } from '../components/Symbols';
import { GameData } from '../components/GameData';
import { BonusBackground } from '../components/BonusBackground';
import { BonusHeader } from '../components/BonusHeader';
import { Dialogs } from '../components/Dialogs';
import { BetOptions } from '../components/BetOptions';
import { AutoplayOptions } from '../components/AutoplayOptions';
import { gameEventManager, GameEventType } from '../../event/EventManager';
import { gameStateManager } from '../../managers/GameStateManager';
import { SymbolExplosionTransition } from '../components/SymbolExplosionTransition';
import { GameAPI } from '../../backend/GameAPI';
import { SpinData, SpinDataUtils } from '../../backend/SpinData';
import { AudioManager, MusicType, SoundEffectType } from '../../managers/AudioManager';
import { Menu } from '../components/Menu';
import { SpaceHotkeyManager } from '../components/SpaceHotkeyManager';
import { FullScreenManager } from '../../managers/FullScreenManager';
import { ClockDisplay } from '../components/ClockDisplay';
import WinTracker from '../components/WinTracker';
import { FreeRoundManager } from '@core/FreeRoundManager';
import { ensureSpineFactory } from '../../utils/SpineGuard';
import { CurrencyManager } from '../components/CurrencyManager';
import { setDecimalPlaces, formatCurrencyNumber } from '../../utils/NumberPrecisionFormatter';
import { IdleManager } from '../components/IdleManager';
import { MAX_IDLE_TIME_MINUTES, getStartingBet } from '../../config/GameConfig';
import { unresolvedSpinManager } from '../../managers/UnresolvedSpinManager';
import { localizationManager } from '../../managers/LocalizationManager';
import { CLOCK_DEMO, LOCALIZATION_DEFAULTS } from '../../backend/LocalizationData';
import { forceShowReplayPopup, isModalActive, checkAndHandleModal, dismissCurrentModal, showIdleSessionExpiredModal } from '../../managers/ModalManager';
import { ScratchClient, takeWarmedScratchClient, isScratchReplayRequest, isNonScratchReplayRequest, readScratchReplayResults } from '../../sidegames/scratch/ScratchClient';
import {
	ScratchPanel,
	resolveScratchDemoApiKey,
	resolveScratchHubBaseUrl,
} from '../../sidegames/scratch/ScratchPanel';
import { ScratchDesktopHost } from '../../sidegames/scratch/ScratchDesktopHost';
import { onPlayInstanceReplaced } from '../../backend/PlayInstanceLock';
import { enableDrawCallDebugger } from '@core/debug';

export class Game extends Scene
{
	private networkManager: NetworkManager;
	private screenModeManager: ScreenModeManager;
	private gameStateManager: typeof gameStateManager;
	private background: Background;
	private header: Header;
	private slotController: SlotController;
	private assetConfig: AssetConfig;
	private assetLoader: AssetLoader;

	private bonusBackground: BonusBackground;
	private bonusHeader: BonusHeader;
	private dialogs: Dialogs;
	private betOptions: BetOptions;
	private autoplayOptions: AutoplayOptions;
	private candyTransition: SymbolExplosionTransition;
	public gameAPI: GameAPI;
	public audioManager: AudioManager;
	private menu: Menu;
	private clockDisplay: ClockDisplay;
	private winTracker: WinTracker;
	private freeRoundManager: FreeRoundManager | null = null;
	private scratchPanel: ScratchPanel | null = null;
	private scratchDesktopHost: ScratchDesktopHost | null = null;
	private scratchClient: ScratchClient | null = null;
	private scratchWindowResizeHandler: (() => void) | null = null;
	private unsubscribePlayInstanceReplaced: (() => void) | null = null;
	private playInstanceDisconnectNotified = false;
	
	// Note: Payout data now calculated directly from paylines in WIN_STOP handler
	// Track whether this spin has winlines to animate
	private hasWinlinesThisSpin: boolean = false;
	
	// Queue for wins that occur while a dialog is already showing
	private winQueue: Array<{ payout: number; bet: number }> = [];
	private suppressWinDialogsUntilNextSpin: boolean = false;
	private initialBalance: number | null = null;
	private replayPopupShowCount: number = 0;
	private scratchReplayDialogPhase: 'pending' | 'playing' | 'shown' = 'pending';
	private replayClockRetryTimer?: Phaser.Time.TimerEvent;
	/**
	 * The spinData object the MaxWin drawer was already shown for. Keyed to the object (not a sticky
	 * boolean) so it self-resets every new spin/session — buy feature never emits GameEventType.SPIN,
	 * so a boolean reset there would stay stale and suppress the drawer on the next buy. Mirrors beelze_bop.
	 */
	private maxWinDialogShownForSpinData: any = null;
	/** Latched true when the max-win cap is first reached (incl. trigger spin); finalize fires at the next safe WIN_STOP. */
	private maxWinFinalizePending: boolean = false;

	public gameData: GameData;
	private symbols: Symbols;
	public idleManager: IdleManager;

	constructor ()
	{
		super('Game');

		this.gameData = new GameData();
		this.symbols = new Symbols();
		this.menu = new Menu();
	}

	init (data: any)
	{
		// Receive managers from Preloader scene
		this.networkManager = data.networkManager;
		this.screenModeManager = data.screenModeManager;
		const parsedInitialBalance = Number(data?.initialBalance);
		this.initialBalance = Number.isFinite(parsedInitialBalance) && (parsedInitialBalance >= 0 || parsedInitialBalance === -1)
			? parsedInitialBalance
			: null;
		
		// Initialize game state manager
		this.gameStateManager = gameStateManager;
		console.log(`[Game] Initial isBonus state: ${this.gameStateManager.isBonus}`);
		
		// Initialize asset configuration
		this.assetConfig = new AssetConfig(this.networkManager, this.screenModeManager);
		
		// Initialize GameAPI
		// Prefer the instance passed from Preloader so we can reuse initialization data.
		if (data.gameAPI) {
			console.log('[Game] Using GameAPI instance from Preloader');
			this.gameAPI = data.gameAPI as GameAPI;
		} else {
			console.log('[Game] No GameAPI instance passed from Preloader, creating a new one');
			this.gameAPI = new GameAPI(this.gameData);
		}
		this.unsubscribePlayInstanceReplaced?.();
		this.unsubscribePlayInstanceReplaced = onPlayInstanceReplaced(() => {
			this.disconnectReplacedPlayInstance();
		});
		window.removeEventListener('sugar-play-session-replaced', this.onSugarPlaySessionReplaced);
		window.addEventListener('sugar-play-session-replaced', this.onSugarPlaySessionReplaced);
		this.assetLoader = new AssetLoader(this.assetConfig);
		
		console.log(`[Game] Received managers from Preloader`);
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
		if (!this.gameAPI?.getReplayState?.()) {
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

	private disableAllSlotControllerButtons(reason: string = 'replay mode'): void {
		if (!this.slotController) {
			return;
		}
		this.slotController.disableSpinButton();
		this.slotController.disableAutoplayButton();
		this.slotController.disableTurboButton();
		this.slotController.disableAmplifyButton();
		this.slotController.disableBetBackgroundInteraction(reason);
		this.slotController.disableFeatureButtonVisible();
	}


	/** Bet and total win for the scratch replay summary dialog. */
	private scratchReplaySummaryData(replayData: any): any {
		const results = readScratchReplayResults(replayData);
		const bet = Number(results?.betAmount);
		const win = Number(results?.winAmount ?? results?.scratchCard?.winAmount ?? 0);
		const slot = replayData?.spinData?.slot ?? {};
		return {
			...(replayData?.spinData ?? {}),
			bet: Number.isFinite(bet) ? bet : replayData?.spinData?.bet,
			slot: {
				...slot,
				totalWin: Number.isFinite(win) ? win : 0,
			},
		};
	}

	/** After the scratch card finishes, show the slot win dialog, then the summary dialog. */
	private onScratchReplayPlaybackSettled(): void {
		const results = readScratchReplayResults(this.gameAPI?.getReplayData?.());
		const bet = Number(results?.betAmount);
		const win = Number(results?.winAmount ?? results?.scratchCard?.winAmount ?? 0);
		const revealSummary = () => {
			this.scratchReplayDialogPhase = 'pending';
			this.showReplayPopup();
		};
		if (Number.isFinite(bet) && bet > 0 && Number.isFinite(win) && win > 0) {
			this.checkAndShowWinDialog(win, bet);
			if (this.dialogs?.isDialogShowing?.()) {
				this.events.once('dialogAnimationsComplete', () => revealSummary());
				return;
			}
		}
		revealSummary();
	}

	private showReplayPopup(): void {
		if (!this.gameAPI?.getReplayState?.()) {
			return;
		}
		if (isScratchReplayRequest() && this.scratchReplayDialogPhase !== 'pending') {
			return;
		}
		const replayData = this.gameAPI.getReplayData?.();
		const roundId = replayData?.round_id;
		if (roundId === undefined || roundId === null || String(roundId).trim() === '') {
			return;
		}
		const isSummaryDisplay = this.replayPopupShowCount >= 1;
		if (isScratchReplayRequest()) {
			this.scratchReplayDialogPhase = 'shown';
		}
		forceShowReplayPopup(roundId, {
			displayMode: isSummaryDisplay ? 'summary' : 'initial',
			spinData: isScratchReplayRequest() ? this.scratchReplaySummaryData(replayData) : replayData.spinData,
			currencyCode: (replayData as { currencyCode?: string }).currencyCode ?? replayData.currency,
			createdAt: replayData.created_at.date,
			buttonText: isSummaryDisplay ? 'Watch again' : 'Continue',
			onContinueCallback: () => {
				if (isScratchReplayRequest()) {
					this.scratchReplayDialogPhase = 'playing';
					this.presentScratchReplay();
					return;
				}
				this.slotController.triggerReplaySpin();
			},
			onCompleteCallback: () => {
				this.disableAllSlotControllerButtons('replay popup complete');
			},
		});
		this.replayPopupShowCount++;
	}

	public getCurrentBetAmount(): number {
		if (this.slotController) {
			// Help/menu payout values must be based on the normal bet, not the
			// amplified display bet shown while enhance/amplify is active.
			const baseBet = this.slotController.getBaseBetAmount?.();
			if (typeof baseBet === 'number' && baseBet > 0) {
				return baseBet;
			}

			const betText = this.slotController.getBetAmountText?.();
			const parsedBet = betText ? parseFloat(betText) : Number.NaN;
			if (!Number.isNaN(parsedBet) && parsedBet > 0) {
				return parsedBet;
			}
		}
		return 1;
	}

	preload () 
	{
		// Assets are now loaded in Preloader scene
		console.log(`[Game] Assets already loaded in Preloader scene`);
		console.log(`[Game] Backend service initialized via GameStateManager`);

		// Preload Menu assets specific to the Game scene
		this.menu.preload(this);
	}

	create ()
	{
		enableDrawCallDebugger(this, { enabled: import.meta.env.DEV });
		console.log(`[Game] Creating game scene`);
		// Ensure Spine plugin instance is attached and sys keys are synced for this scene
		// before any components try to call `scene.add.spine(...)`.
		try { ensureSpineFactory(this, '[Game] create'); } catch {}

		// Initialize currency display from initialization data (safe in demo mode).
		try {
			const initData = this.gameAPI?.getInitializationData?.();
			CurrencyManager.initializeFromInitData(initData);
		} catch {}

		// Set bet levels from initialization data so GameData.betLevels is the single source of truth for all bet UIs.
		this.initializeGameDataBetLevels();
		this.initializeNumberPrecisionFromGameData();
		unresolvedSpinManager.setFromInitializationData(this.gameAPI?.getInitializationData?.() ?? null);
		const hasUnresolvedSpinAtInit = unresolvedSpinManager.hasUnresolvedSpin;
		
		// Set physics world bounds (physics is already enabled globally)
		if (this.physics && this.physics.world) {
			this.physics.world.setBounds(0, 0, this.scale.width, this.scale.height - 220);
			console.log('[Game] Physics world bounds set');
		} else {
			console.warn('[Game] Physics system not available');
		}
		
		// Create fade overlay for transition from black
		const fadeOverlay = this.add.rectangle(
			this.scale.width * 0.5,
			this.scale.height * 0.5,
			this.scale.width,
			this.scale.height,
			0x000000
		).setOrigin(0.5, 0.5).setScrollFactor(0).setAlpha(1);
		
		// Backend initialization removed - using SlotController autoplay system
		// Create header using the managers
		// this.header = new Header(this.networkManager, this.screenModeManager);
		// this.header.create(this);
		
		// Create background using the managers
		this.background = new Background(this.networkManager, this.screenModeManager);
		this.background.create(this);
		
		// Create header using the managers
		this.header = new Header(this.networkManager, this.screenModeManager);
		this.header.create(this);

		const localizedDemoLabel = localizationManager.getTextByKey(CLOCK_DEMO) || LOCALIZATION_DEFAULTS[CLOCK_DEMO] || 'DEMO';
		const isReplay = !!this.gameAPI?.getReplayState?.();

		if (isReplay) {
			this.clockDisplay = new ClockDisplay(this, {
				offsetX: 5,
				offsetY: 5,
				fontSize: 16,
				fontFamily: 'poppins-regular',
				color: '#000000',
				alpha: 0.5,
				depth: 30000,
				scale: 0.7,
				gameTitle: this.getReplayClockTitle(),
				showClock: false,
				additionalText: 'DiJoker',
				additionalTextOffsetX: 5,
				additionalTextOffsetY: 0,
				additionalTextScale: 0.7,
				additionalTextColor: '#000000',
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
				color: '#000000',
				alpha: 0.5,
				depth: 30000,
				scale: 0.7,
				suffixText: ` | Sugar Wonderland${this.gameAPI.getDemoState() ? ` | ${localizedDemoLabel}` : ''}`,
				additionalText: 'DiJoker',
				additionalTextOffsetX: 5,
				additionalTextOffsetY: 0,
				additionalTextScale: 0.7,
				additionalTextColor: '#000000',
				additionalTextFontSize: 16,
				additionalTextFontFamily: 'poppins-regular'
			});
			this.clockDisplay.create();
		}

		// Create bonus background using the managers (initially hidden)
		console.log('[Game] Creating bonus background...');
		this.bonusBackground = new BonusBackground(this.networkManager, this.screenModeManager);
		this.bonusBackground.create(this);
		this.bonusBackground.getContainer().setVisible(false);
		console.log('[Game] Bonus background created and hidden');

		// Create bonus header using the managers (initially hidden)
		console.log('[Game] Creating bonus header...');
		this.bonusHeader = new BonusHeader(this.networkManager, this.screenModeManager);
		this.bonusHeader.create(this);
		this.bonusHeader.getContainer().setVisible(false);
		console.log('[Game] Bonus header created and hidden');

		// Create WinTracker (used to display per-symbol wins)
		this.winTracker = new WinTracker();
		this.winTracker.create(this);
		// Reduce symbol icon size in WinTracker
		this.winTracker.setLayout({ iconScale: 0.05 });
		(this as any).winTracker = this.winTracker;

		//Create symbols
		console.log(`[Game] Creating symbols...`);
		this.symbols.create(this);

		// Initialize AudioManager
		this.audioManager = new AudioManager(this);
		console.log('[Game] AudioManager initialized');

		// Defer audio: it may already be downloading (started in Preloader), so initialize when ready.
		this.time.delayedCall(0, () => {
			// Some browsers (especially mobile) keep AudioContext locked/suspended until a user gesture,
			// even if audio files are already downloaded. This can look like "audio loaded but silent".
			const isAudioLockedOrSuspended = (): boolean => {
				try {
					const soundMgr: any = this.sound as any;
					if (!soundMgr) return false;
					if (soundMgr.locked === true) return true;
					const ctx: any = soundMgr.context;
					if (ctx && typeof ctx.state === 'string' && ctx.state === 'suspended') return true;
				} catch {}
				return false;
			};

			const tryUnlockAudio = (): void => {
				try {
					const soundMgr: any = this.sound as any;
					if (!soundMgr) return;
					if (typeof soundMgr.unlock === 'function') {
						try { soundMgr.unlock(); } catch {}
					}
					const ctx: any = soundMgr.context;
					if (ctx && typeof ctx.resume === 'function' && ctx.state === 'suspended') {
						try { ctx.resume(); } catch {}
					}
				} catch {}
			};

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

			const tryInitAudio = (): boolean => {
				// If audio is still locked/suspended, don't spam play calls; try to unlock and retry shortly.
				if (isAudioLockedOrSuspended()) {
					tryUnlockAudio();
					return false;
				}
				try {
					this.audioManager.createMusicInstances();
					this.audioManager.playBackgroundMusic(MusicType.MAIN);
					console.log('[Game] Audio instances created and background music started');
					return true;
				} catch (_e) {
					return false;
				}
			};

			// Keep retrying for a while: on mobile, audio download/decode (or in-flight loads) can lag behind scene start.
			const maxAttempts = 40; // ~10-15s depending on backoff
			const ensureAudioReady = (attempt: number) => {
				if (tryInitAudio()) return;
				if (attempt >= maxAttempts) {
					console.warn('[Game] Audio not ready after retries; leaving muted until next user action');
					return;
				}

				// If this Scene loader is already busy, wait for it to finish then retry.
				if (isLoaderBusy()) {
					this.load.once('complete', () => ensureAudioReady(attempt + 1));
					return;
				}

				// Otherwise, background-load audio on this scene as a fallback (e.g., user clicked early).
				try {
					console.log('[Game] Background-loading audio assets (fallback)...');
					const audioAssets = new AssetConfig(this.networkManager, this.screenModeManager).getAudioAssets();
					const audioMap = audioAssets.audio || {};
					let queued = 0;
					for (const [key, path] of Object.entries(audioMap)) {
						if (audioCacheHas(key)) continue;
						try { this.load.audio(key, path as string); queued++; } catch {}
					}

					if (queued > 0) {
						this.load.once('complete', () => ensureAudioReady(attempt + 1), this);
						this.load.start();
						return;
					}
				} catch (e) {
					console.warn('[Game] Failed to queue background audio load:', e);
				}

				// Nothing queued (or queue failed): retry with backoff to handle decode/in-flight timing.
				const delay = Math.min(1200, 150 + attempt * 75);
				this.time.delayedCall(delay, () => ensureAudioReady(attempt + 1));
			};

			// Last resort: if the game starts before the first user gesture reaches the sound system,
			// unlock on the first pointerdown anywhere in the Game scene, then retry init.
			try {
				this.input.once('pointerdown', () => {
					tryUnlockAudio();
					try { this.time.delayedCall(0, () => ensureAudioReady(0)); } catch {}
				});
			} catch {}

			ensureAudioReady(0);
		});

		// Make AudioManager available globally for other components
		(window as any).audioManager = this.audioManager;
		
		// Create dialogs using the managers
		this.dialogs = new Dialogs(this.networkManager, this.screenModeManager);
		this.dialogs.create(this);
		
		// Initialize scatter animation manager with containers and dialogs component
		const scatterAnimationManager = this.symbols.scatterAnimationManager;
		scatterAnimationManager.initialize(this, this.symbols.container, this.dialogs);
		
		// Create bet options using the managers
		this.betOptions = new BetOptions(this.networkManager, this.screenModeManager);
		this.betOptions.create(this);
		
		// Create autoplay options using the managers
		this.autoplayOptions = new AutoplayOptions(this.networkManager, this.screenModeManager);
		this.autoplayOptions.create(this);
		
		// Create slot controller using the managers
		this.slotController = new SlotController(this.networkManager, this.screenModeManager);
		this.slotController.setSymbols(this.symbols); // Set symbols reference for free spin data access
		this.slotController.setBuyFeatureReference(); // Set BuyFeature reference for bet access
		this.slotController.create(this);
		this.showReplayPopup();

		// Create free round manager AFTER SlotController so it can mirror the spin button.
		// It will read the backend initialization data and decide whether to show itself.
		let appliedInitializationFreeSpinBet = false;
		let appliedUnresolvedSpinBet = false;
		try {
			if (!hasUnresolvedSpinAtInit) {
				const initData = this.gameAPI.getInitializationData();
				const initFsRemaining = this.gameAPI.getRemainingInitFreeSpins();
				const initFsBet = this.gameAPI.getInitFreeSpinBet();

				this.freeRoundManager = new FreeRoundManager();
				this.freeRoundManager.create({
					scene: this,
					gameAPI: this.gameAPI,
					slotController: this.slotController,
					deps: {
						getText: (key) => localizationManager.getTextByKey(key) ?? LOCALIZATION_DEFAULTS[key] ?? key,
						formatCurrencyNumber,
						getCurrencyPrefix: (isDemo) => (isDemo ? '' : CurrencyManager.getCurrencyCode()),
						gameState: {
							get isReelSpinning() { return gameStateManager.isReelSpinning; },
							get isShowingWinDialog() { return gameStateManager.isShowingWinDialog; },
							get isShowingWinlines() { return gameStateManager.isShowingWinlines; },
							get isBonus() { return gameStateManager.isBonus; },
							get isProcessingSpin() { return gameStateManager.isProcessingSpin; },
							setInFreeSpinRound: (active) => {
								gameStateManager.isInFreeSpinRound = active;
							},
							isInFreeSpinRound: () => gameStateManager.isInFreeSpinRound === true,
						},
						events: {
							on: (event, handler) => gameEventManager.on(event as GameEventType, handler),
						},
						rewardPanelDelayMs: 500,
					},
				});

				if (initData && initData.hasFreeSpinRound && initFsRemaining > 0) {
					console.log(
						`[Game] Initialization indicates free spin round available (${initFsRemaining}). FreeRoundManager will enable after delay.`
					);

					// Flag + lock immediately — FreeRoundManager only enables UI after rewardPanelDelayMs,
					// and a 0-balance paid-spin check in that window would show the OOB modal.
					gameStateManager.isInFreeSpinRound = true;
					this.slotController?.setAwaitingFreeRoundStartPrompt(true);
					this.slotController?.disableControlsForFreeRounds();

					if (this.slotController && initFsBet && initFsBet > 0) {
						console.log(
							`[Game] Applying initialization free spin bet to SlotController: ${initFsBet.toFixed(2)}`
						);
						this.slotController.updateBetAmount(initFsBet);
						appliedInitializationFreeSpinBet = true;
					}
				}
			} else {
				console.log('[Game] Initialization contains unresolved spin - skipping FreeRoundManager entry flow');
			}
		} catch (e) {
			console.warn('[Game] Failed to create FreeRoundManager from initialization data:', e);
		}

		if (hasUnresolvedSpinAtInit) {
			appliedUnresolvedSpinBet = this.applyUnresolvedSpinBetAmount();
		}

		// After BetOptions + SlotController are initialized, set the base bet to the first bet level.
		// Respect initialization free-spin bet, unresolved-spin bet, or replay stake if applied above.
		const appliedReplayBet = this.applyReplayBetToSlotController();
		if (!appliedInitializationFreeSpinBet && !appliedUnresolvedSpinBet && !appliedReplayBet) {
			this.initializeBetAmount();
		}
		
		// Create symbol explosion transition component and play at scene start
		this.candyTransition = new SymbolExplosionTransition(this);

		try {
			new SpaceHotkeyManager(
				this,
				this.dialogs,
				this.slotController,
			() =>
				this.betOptions.isVisible() ||
				this.autoplayOptions.isVisible() ||
				this.menu.isMenuVisible() ||
				this.slotController.isBuyFeatureOpen() ||
				isModalActive() ||
				// unresolvedSpinManager.isPopupVisible() ||
				this.slotController.isAwaitingFreeRoundStartPromptActive() ||
				this.freeRoundManager?.isPromptVisible() === true,
				() => this.isSymbolExplosionTransitionActive(),
			).register();
		} catch (e) {
			console.warn('[Game] Failed to register SpaceHotkeyManager:', e);
		}

		// Limit explosion symbols to the ones currently present on the grid (if available)
		let allowedSymbols: number[] | undefined;
		try {
			const grid: any = (this.symbols as any)?.currentSymbolData;
			if (Array.isArray(grid)) {
				const set = new Set<number>();
				for (const col of grid) {
					if (!Array.isArray(col)) continue;
					for (const val of col) {
						const num = Number(val);
						if (!isNaN(num)) {
							set.add(num);
						}
					}
				}
				if (set.size > 0) {
					allowedSymbols = Array.from(set);
				}
			}
		} catch {
			// If anything goes wrong, fall back to using all available symbol spines
		}

		this.candyTransition.play(undefined, { allowedSymbols });

		// Initialize balance on game start
		this.initializeGameBalance(this.initialBalance ?? undefined);
		
		// Emit START event AFTER SlotController is created
		console.log(`[Game] Emitting START event to initialize game...`);
		gameEventManager.emit(GameEventType.START);
		
		// Trigger initial symbol display
		console.log(`[Game] Starting game...`);
		// Game starts automatically when scene is created
		
		// Initialize winnings display
		this.header.initializeWinnings();
		
		// Setup bonus mode event listeners
		this.setupBonusModeEventListeners();
		unresolvedSpinManager.showPopupIfUnresolved(this, () => this.resumeUnresolvedSpinRound());
		unresolvedSpinManager.applyBonusModeVisuals(this);
		if (unresolvedSpinManager.hasUnresolvedSpin && this.slotController) {
			const spinsToShow = this.getRemainingSpinsFromUnresolved(unresolvedSpinManager.unresolvedSpin);
			this.slotController.clearFreeSpinDisplaySuppression();
			this.slotController.showFreeSpinDisplayWithActualValue(spinsToShow || 1);
		}

		this.initializeAndStartIdleManager();
		
		EventBus.emit('current-scene-ready', this);

		// Fade in from black after all components are created
		this.tweens.add({
			targets: fadeOverlay,
			alpha: 0,
			duration: 1000,
			ease: 'Power2',
			onComplete: () => {
				console.log('[Game] Fade in from black complete');
				// Remove the fade overlay to clean up
				fadeOverlay.destroy();
			}
		});

		// Trigger layered effects when game starts
		console.log(`[Game] Triggering layered effects...`);
		

		// Show congratulations dialog (on top)
		//this.dialogs.showPaintEffect(this);
		
		// Show congratulations dialog (on top)
		//this.dialogs.showCongrats(this);

		// Show congratulations dialog (on top)
		//this.dialogs.showFreeSpinDialog(this);

		// Show large win dialog (on top)
		//this.dialogs.showLargeWin(this);

		// Show medium win dialog (on top)
		//this.dialogs.showMediumWin(this);

		// Bet options will be shown when + or - buttons are clicked

		// Show small win dialog (on top)
		//this.dialogs.showSmallWin(this, { winAmount: 123456789.00 });

		// Show medium win dialog (on top)
		//this.dialogs.showMediumWin(this, { winAmount: 2500000.50 });

		// Show large win dialog (on top)
		//this.dialogs.showLargeWin(this, { winAmount: 5000000.75 });

		// Show super win dialog (on top)
		// this.dialogs.showSuperWin(this, { winAmount: 10000000.00 });

		EventBus.on('spin', () => {
			if (this.gameAPI?.hasLostPlayInstance?.()) {
				this.disconnectReplacedPlayInstance();
				return;
			}
			this.spin();
		});

		// Listen for menu button click
		EventBus.on('menu', () => {
			console.log('[Game] Menu button clicked - toggling menu');
			this.menu.toggleMenu(this);
		});

		EventBus.on('scratch-toggle', () => {
			console.log('[Game] Scratch toggle');
			if (isNonScratchReplayRequest()) {
				try { this.scratchDesktopHost?.hide(); } catch { /* noop */ }
				try { this.scratchPanel?.hide(); } catch { /* noop */ }
				return;
			}
			if (this.gameAPI?.hasLostPlayInstance?.() || this.scratchClient?.isSessionReplaced()) {
				this.disconnectReplacedPlayInstance();
				return;
			}
			if (this.scratchPanel?.isVisible() || this.scratchDesktopHost?.isVisible()) {
				this.scratchDesktopHost?.hide();
				this.scratchPanel?.hide();
				return;
			}
			if (!this.isScratchSlotSessionPlayable()) {
				console.warn('[Game] Scratch blocked — slot session is no longer valid');
				try {
					showIdleSessionExpiredModal();
				} catch {
					checkAndHandleModal({
						message: 'Scratch requires a valid slot session.',
					});
				}
				return;
			}
			this.ensureScratchSideGame();
			if (this.scratchDesktopHost?.tryToggle()) {
				return;
			}
			this.scratchPanel?.toggle();
		});

		EventBus.on('show-bet-options', () => {
			console.log('[Game] Showing bet options with fade-in effect');
			
			// Use base bet for internal selection; displayed bet may include +25% when enhanced bet is active
			const currentBetText = this.slotController.getBetAmountText();
			const parsedDisplayBet = currentBetText ? parseFloat(currentBetText) : Number.NaN;
			const fallbackBaseBet = Number.isFinite(parsedDisplayBet) && parsedDisplayBet > 0 ? parsedDisplayBet : 0.20;
			const currentBaseBet = this.slotController.getBaseBetAmount() || fallbackBaseBet;

			const isEnhancedBet = this.gameData?.isEnhancedBet === true;
			const betDisplayMultiplier = isEnhancedBet ? 1.25 : 1;
			const currentBetDisplay = currentBaseBet * betDisplayMultiplier;
			
			this.betOptions.show({
				currentBet: currentBaseBet,
				currentBetDisplay: currentBetDisplay,
				onClose: () => {
					console.log('[Game] Bet options closed');
				},
				onConfirm: (betAmount: number) => {
					console.log(`[Game] Bet confirmed: £${betAmount}`);
					// Update the bet display in the slot controller
					this.slotController.updateBetAmount(betAmount);
					// Update the bet amount in the backend
					gameEventManager.emit(GameEventType.BET_UPDATE, { newBet: betAmount, previousBet: currentBaseBet });
				}
			});
		});

		// Listen for autoplay button click
		EventBus.on('autoplay', () => {
			console.log('[Game] Autoplay button clicked - showing options');
			
			// Use base bet for internal selection; displayed bet may include +25% when enhanced bet is active
			const currentBaseBetText = this.slotController.getBetAmountText();
			const fallbackBet = currentBaseBetText ? parseFloat(currentBaseBetText) : 0.20;
			const currentBaseBet = this.slotController.getBaseBetAmount() || fallbackBet;
			const isEnhancedBet = this.gameData?.isEnhancedBet === true;
			const betDisplayMultiplier = isEnhancedBet ? 1.25 : 1;
			const currentBetDisplay = currentBaseBet * betDisplayMultiplier;
			
			// Get the most current balance as a numeric value from the SlotController
			const currentBalance = this.slotController.getBalanceAmount();
			
			console.log(`[Game] Current balance for autoplay options: $${currentBalance}`);
			
			this.autoplayOptions.show({
				currentAutoplayCount: 10,
				currentBet: currentBaseBet,
				currentBetDisplay: currentBetDisplay,
				betDisplayMultiplier: betDisplayMultiplier,
				isEnhancedBet: isEnhancedBet,
				currentBalance: currentBalance,
				onClose: () => {
					console.log('[Game] Autoplay options closed');
				},
				onConfirm: (autoplayCount: number) => {
					console.log(`[Game] Autoplay confirmed: ${autoplayCount} spins`);
					// Read the bet selected within the autoplay panel
					const selectedBet = this.autoplayOptions.getCurrentBet();
					// If bet changed, update UI and backend
					if (Math.abs(selectedBet - currentBaseBet) > 0.0001) {
						// Use a dedicated API so amplify/enhance bet is preserved when active
						this.slotController.updateBetAmountFromAutoplay(selectedBet);
						gameEventManager.emit(GameEventType.BET_UPDATE, { newBet: selectedBet, previousBet: currentBaseBet });
					}
					console.log(`[Game] Total cost: $${(selectedBet * betDisplayMultiplier * autoplayCount).toFixed(2)}`);
					
					// Start autoplay using the new SlotController method
					this.slotController.startAutoplay(autoplayCount);
				}
			});
		});

		// Note: SPIN_RESPONSE event listeners removed - now using SPIN_DATA_RESPONSE
		gameEventManager.on(GameEventType.SPIN_DATA_RESPONSE, (data: any) => {
			try {
				const spinData = (data as any)?.spinData;
				const rawUnresolved = spinData?.unresolvedSpin;
				let unresolvedUuid: string | null = null;
				if (typeof rawUnresolved === 'string') {
					unresolvedUuid = rawUnresolved;
				} else if (rawUnresolved && typeof rawUnresolved === 'object') {
					const candidate = (rawUnresolved as any).uuid;
					if (typeof candidate === 'string' && candidate.length > 0) {
						unresolvedUuid = candidate;
					}
				}

				if (unresolvedUuid) {
					this.gameAPI.setUnresolvedSpinUuid(unresolvedUuid);
					console.log('[Game] SPIN_DATA_RESPONSE: cached unresolved spin UUID from spin data:', unresolvedUuid);
				}
			} catch (err) {
				console.warn('[Game] SPIN_DATA_RESPONSE: failed to cache unresolved spin UUID', err);
			}
		});

		// Listen for animations completion to show win dialogs (tumble-based)
		gameEventManager.on(GameEventType.WIN_STOP, (data: any) => {
			console.log('[Game] WIN_STOP event received (tumble-based evaluation)');

			const runUnresolvedSpinSideEffects = () => {
				const isDemoUnresolved =
					this.gameAPI.getDemoState() ||
					sessionStorage.getItem('demo') === 'true';
				if (!isDemoUnresolved && gameStateManager.isBonus && this.gameAPI.getUnresolvedSpinUuid()) {
					const unresolvedSpinData =
						this.symbols?.currentSpinData ?? this.gameAPI.getCurrentSpinData();
					const slotAny = unresolvedSpinData?.slot as { freeSpin?: { items?: unknown[] }; freespin?: { items?: unknown[] } };
					const fs = slotAny?.freeSpin ?? slotAny?.freespin;
					const items: unknown[] = Array.isArray(fs?.items) ? fs.items : [];
					const isLastSimulatedFreeSpin =
						items.length > 0 &&
						this.gameAPI.getCurrentFreeSpinIndex() >= items.length;

					const currentWin =
						typeof this.bonusHeader?.getCumulativeBonusWin === 'function'
							? this.bonusHeader.getCumulativeBonusWin()
							: undefined;

					void (async () => {
						let isForceCompleted = false;
						if (isLastSimulatedFreeSpin) {
							const completeEpoch = this.slotController?.claimBalanceDisplayEpoch?.();
							try {
								isForceCompleted = await this.gameAPI.forceCompleteUnresolvedSpin();
								if (isForceCompleted === true || isForceCompleted === 'ok') {
									const completeBalance = this.gameAPI.getLastUnresolvedCompleteBalance?.();
									if (
										completeBalance != null &&
										Number.isFinite(completeBalance) &&
										completeBalance >= 0
									) {
										this.slotController?.applyBalanceFromUnresolvedComplete?.(completeBalance, completeEpoch);
									}
								}
							} catch (err) {
								console.warn('[Game] Unresolved spin force-complete failed, falling back to PATCH', err);
							}
						}
						if (!isForceCompleted) {
							try {
								await this.gameAPI.patchUnresolvedSpin(currentWin);
							} catch (err) {
								console.warn('[Game] Unresolved spin PATCH failed', err);
							}
						}
					})();
				}
			};
			
			// Get the current spin data from the Symbols component
			if (this.symbols && this.symbols.currentSpinData) {
				const spinData = this.symbols.currentSpinData;
				const tumbleResult = this.calculateTotalWinFromTumbles(spinData.slot?.tumbles || []);
				let totalWin = tumbleResult.totalWin;
				const hasCluster = tumbleResult.hasCluster;
				const betAmount = parseFloat(spinData.bet);
				let freeSpinItem: any = null;
				try {
					freeSpinItem = this.resolveFreeSpinItemForWinStop(spinData);
				} catch (e) {
					console.warn('[Game] WIN_STOP: Failed to resolve freespin item', e);
				}

				// During free spins, prefer the totalWin coming from the matching freespin item
				// so win dialogs reflect the backend's per-spin total directly.
				if (gameStateManager.isBonus && freeSpinItem && (freeSpinItem as any).isMaxWin !== true) {
					try {
						const itemTotalWinRaw = (freeSpinItem as any).totalWin ?? (freeSpinItem as any).subTotalWin ?? 0;
						const itemTotalWin = Number(itemTotalWinRaw);
						if (!isNaN(itemTotalWin) && itemTotalWin > 0) {
							console.log(`[Game] WIN_STOP: Overriding tumble totalWin with freespin item totalWin=${itemTotalWin}`);
							totalWin = itemTotalWin;
						}
					} catch (e) {
						console.warn('[Game] WIN_STOP: Failed to derive freespin item totalWin, falling back to tumble totalWin', e);
					}
				}

				// Max win finalizes once the running bonus total reaches the cap (slot.totalWin)
				// after at least one free spin has played (so entry-at-cap still runs one round).
				const slotHasMaxWin = spinData?.slot?.hasMaxWin === true;
				const fsPerformed =
					typeof (this.symbols as any)?.getFreeSpinAutoplayPerformedCount === 'function'
						? (this.symbols as any).getFreeSpinAutoplayPerformedCount()
						: 0;
				const maxWinCapReached =
					slotHasMaxWin &&
					fsPerformed >= 1 &&
					!!(this.bonusHeader as any)?.isMaxWinCapReached?.(spinData);

				// Latch the finalize the first time the cap is reached. It is reached on the
				// bonus-trigger spin (isMaxWinCapReachedForFinalize slotTotal fallback) while later token free
				// spins win 0 — so once latched it stays pending and is NOT re-derived per spin.
				if (maxWinCapReached && this.maxWinDialogShownForSpinData !== spinData) {
					this.maxWinFinalizePending = true;
				}

				if (this.maxWinFinalizePending && this.maxWinDialogShownForSpinData !== spinData) {
					// Play the bonus-entry (scatter/FreeSpin dialog/transition) flow before the MaxWin
					// drawer. Defer without consuming the guard: the next safe WIN_STOP (a played
					// free-spin, after the dialog closes) re-derives cap-reached and finalizes then.
					if (this.shouldDeferMaxWinForBonusEntry(spinData, freeSpinItem)) {
						runUnresolvedSpinSideEffects();
						return;
					}

					const slotTotal = Number((spinData.slot as any)?.totalWin);
					const capFromTrigger =
						typeof this.gameAPI?.getMaxWinCapTotal === 'function'
							? this.gameAPI.getMaxWinCapTotal()
							: 0;
					const winAmount =
						Number.isFinite(slotTotal) && slotTotal > 0
							? slotTotal
							: capFromTrigger;
					// Base-game max win during autoplay: base autoplay is still the LIVE session (it was
					// never paused at a scatter like a bonus). The MaxWin drawer close runs the bonus-exit
					// transition which stops autoplay; cache the remaining base spins now so it resumes via
					// bonusTransitionComplete → resumeAutoplayFromPause, like returning from a bonus.
					if (!gameStateManager.isBonus) {
						try { (this.slotController as any)?.pauseAutoplay?.('baseGameMaxWin'); } catch {}
					}
					try {
						this.gameAPI?.resolveRemainingFreeSpinsOnMaxWin?.();
					} catch {}
					try {
						this.symbols?.stopFreeSpinsAfterMaxWin?.();
					} catch {}
					try {
						const bonusHeader = this.bonusHeader as any;
						if (bonusHeader && typeof bonusHeader.showTotalWinBeforeCongrats === 'function' && winAmount > 0) {
							bonusHeader.showTotalWinBeforeCongrats(winAmount);
						}
					} catch {}
					try {
						if (this.dialogs?.showMaxWin) {
							try {
								const slotController = this.slotController as any;
								if (slotController && winAmount > 0) {
									slotController.capturedBonusTotalWin = winAmount;
								}
							} catch {}
							gameStateManager.isShowingWinDialog = true;
							gameStateManager.suppressTotalWinDialog = true;
							this.maxWinDialogShownForSpinData = spinData;
							this.maxWinFinalizePending = false;
							this.dialogs.showMaxWin(this, { winAmount });
							runUnresolvedSpinSideEffects();
							return;
						}
					} catch (e) {
						console.warn('[Game] WIN_STOP: Failed to show MaxWin drawer', e);
					}
				}

				// Max-win echo: the drawer close re-emits WIN_STOP for the same payload (currentSpinData
				// still carries slot.hasMaxWin). Already finalized — do not fall through to win-dialog tiering.
				if (slotHasMaxWin && this.maxWinDialogShownForSpinData === spinData) {
					runUnresolvedSpinSideEffects();
					return;
				}

				console.log(`[Game] WIN_STOP: totalWin used for win dialog=$${totalWin}, hasCluster>=8=${hasCluster}`);
				if (!gameStateManager.suppressTotalWinDialog && hasCluster && totalWin > 0) {
					this.checkAndShowWinDialog(totalWin, betAmount);
				} else {
					console.log('[Game] WIN_STOP: No qualifying cluster wins (>=8) detected');
				}
			} else {
				console.log('[Game] WIN_STOP: No current spin data available');
			}

			runUnresolvedSpinSideEffects();
			
			// Server balance refresh for normal spins is handled in SlotController on REELS_STOP
			// via updateBalanceFromServer(), with a per-spin guard and debounce to avoid duplicate API calls.
		});

		// Listen for reel completion to handle balance updates only
		gameEventManager.on(GameEventType.REELS_STOP, () => {
			console.log('[Game] REELS_STOP event received');
			
			// Server balance refresh for normal spins is handled in SlotController on REELS_STOP
			// (skip during scatter/bonus; balance will be finalized after bonus ends via setBonusMode)
			
			// Request balance update to finalize the spin (add winnings to balance)
			// This is needed to complete the spin cycle and update the final state
			console.log('[Game] Reels done - requesting balance update to finalize spin');
			gameEventManager.emit(GameEventType.BALANCE_UPDATE);
			
			// Note: Win dialog logic moved to WIN_STOP handler using payline data
			// No fallback logic needed here - WinLineDrawer handles all timing
			console.log('[Game] REELS_STOP: Balance update requested, WIN_STOP handled by winline animations');

			if (this.gameAPI?.getReplayState?.() && !gameStateManager.isScatter && !gameStateManager.isBonus) {
				if (!this.replayPopupReelsStopHandledThisCycle) {
					this.replayPopupReelsStopHandledThisCycle = true;
					this.showReplayPopup();
				}
			}
		});

		// Ensure WinTracker is cleared (with a fade-out) as soon as reels actually start for a new spin
		gameEventManager.on(GameEventType.REELS_START, () => {
			this.replayPopupReelsStopHandledThisCycle = false;
			try {
				if (this.winTracker) {
					this.winTracker.hideWithFade(250);
					console.log('[Game] Fading out WinTracker on REELS_START (new spin started)');
				}
			} catch (e) {
				console.warn('[Game] Failed to clear WinTracker on REELS_START:', e);
			}
		});

		// Listen for dialog animations to complete
		this.events.on('dialogAnimationsComplete', () => {
			console.log('[Game] Dialog animations complete event received');
			// Re-allow win dialogs after transitions complete
			this.suppressWinDialogsUntilNextSpin = false;
			
			// Clear the win dialog state - autoplay can resume
			gameStateManager.isShowingWinDialog = false;
			console.log('[Game] Set isShowingWinDialog to false - autoplay can resume');
			
			// Check if there's a delayed scatter animation waiting to start
			this.checkAndStartDelayedScatterAnimation();
			
			// Note: Autoplay continuation is now handled by SlotController's WIN_DIALOG_CLOSED handler
			// No need to retry spin here as it conflicts with SlotController's autoplay logic
			
			// Process any remaining wins in the queue
			this.processWinQueue();
		});

		// Listen for any spin to start (manual or autoplay)
		gameEventManager.on(GameEventType.SPIN, (eventData: any) => {
			console.log('[Game] SPIN event received - clearing win queue for new spin');
			// Reset winlines tracking for the new spin
			this.hasWinlinesThisSpin = false;
			// Allow win dialogs again on the next spin
			this.suppressWinDialogsUntilNextSpin = false;
			// maxWinDialogShownForSpinData is keyed to the spinData object and self-resets per spin;
			// only the latch needs clearing here.
			this.maxWinFinalizePending = false;
			
			// CRITICAL: Block autoplay spins if win dialog is showing, but allow manual spins
			// This fixes the timing issue where manual spins were blocked
			if (gameStateManager.isShowingWinDialog && this.gameData?.isAutoPlaying) {
				console.log('[Game] Autoplay SPIN event BLOCKED - win dialog is showing');
				console.log('[Game] Manual spins are still allowed to proceed');
				return;
			}

			// Clear any previously displayed WinTracker when a new spin actually starts
			try {
				if (this.winTracker) {
					this.winTracker.hideWithFade(250);
					console.log('[Game] Fading out WinTracker for new spin');
				}
			} catch (e) {
				console.warn('[Game] Failed to clear WinTracker on SPIN:', e);
			}
			
			// Only clear win queue if this is a new spin (not a retry of a paused spin)
			// Check if we're retrying a paused autoplay spin
			const isRetryingPausedSpin = this.gameData?.isAutoPlaying && this.winQueue.length > 0;
			
			if (!isRetryingPausedSpin) {
				this.clearWinQueue();
				console.log('[Game] Cleared win queue for new spin');
				
				// Only clear win dialog state for completely new spins
				gameStateManager.isShowingWinDialog = false;
				console.log('[Game] Cleared isShowingWinDialog state for new spin');
			} else {
				console.log('[Game] Not clearing win queue - retrying paused autoplay spin');
				console.log('[Game] Keeping isShowingWinDialog state for paused spin retry');
			}
		});

		// Listen for autoplay start to prevent it when win dialogs are showing
		gameEventManager.on(GameEventType.AUTO_START, (eventData: any) => {
			// When autoplay resumes, ensure win dialogs are allowed again
			this.suppressWinDialogsUntilNextSpin = false;
			if (gameStateManager.isShowingWinDialog) {
				console.log('[Game] AUTO_START blocked - win dialog is showing');
				// Don't allow autoplay to start while win dialog is showing
				return;
			}
			console.log('[Game] AUTO_START allowed - no win dialog showing');

			// Clear any previously displayed WinTracker when a new autoplay sequence starts
			try {
				if (this.winTracker) {
					this.winTracker.hideWithFade(250);
					console.log('[Game] Fading out WinTracker on AUTO_START');
				}
			} catch (e) {
				console.warn('[Game] Failed to clear WinTracker on AUTO_START:', e);
			}
		});

		this.events.on('bonusTransitionComplete', () => {
			if (!this.gameAPI?.getReplayState?.()) {
				return;
			}
			this.showReplayPopup();
		});
	}

	private initializeGameDataBetLevels() {
		try {
			const initData = this.gameAPI?.getInitializationData?.();
			const levels = (initData as any)?.betLevels;
			if (Array.isArray(levels) && levels.length > 0) {
				const sanitized = levels
					.map((v: any) => Number(v))
					.filter((n: number) => Number.isFinite(n) && n > 0);
				if (sanitized.length > 0) {
					this.gameData.betLevels = sanitized;
				}
			}
		} catch (e) {
			console.warn('[Game] Failed to set gameData.betLevels from initialization data:', e);
		}
	}

	private initializeNumberPrecisionFromGameData() {
		try {
			const initData = this.gameAPI?.getInitializationData?.();
			const currencyDecimalPlaces = (initData as any)?.currencyDecimalPlaces;
			if (currencyDecimalPlaces != null && Number.isFinite(currencyDecimalPlaces)) {
				setDecimalPlaces(currencyDecimalPlaces);
			}
		} catch (e) {
			console.warn('[Game] Failed to set number precision from initialization data:', e);
		}
	}

	private getRemainingSpinsFromUnresolved(unresolved: any): number {
		try {
			const slot = unresolved?.response?.slot ?? {};
			const fs = slot.freespin || slot.freeSpin;
			const items: any[] = Array.isArray(fs?.items) ? fs.items : [];
			const index = typeof unresolved?.index === 'number' && unresolved.index >= 0 ? unresolved.index : 0;
			const itemAtIndex = items[index];
			if (itemAtIndex && typeof itemAtIndex.spinsLeft === 'number') {
				return itemAtIndex.spinsLeft;
			}

			const firstItemSpinsLeft =
				items.length > 0 && typeof items[0]?.spinsLeft === 'number'
					? items[0].spinsLeft
					: 0;
			const count = typeof fs?.count === 'number' ? fs.count : 0;
			return Math.max(count, firstItemSpinsLeft, items.length);
		} catch (e) {
			console.warn('[Game] Failed to derive unresolved remaining spins:', e);
			return 0;
		}
	}

	private resumeUnresolvedSpinRound(): void {
		const unresolved = unresolvedSpinManager.unresolvedSpin;
		if (!unresolved) {
			return;
		}

		try {
			this.gameStateManager.isBonus = true;
			this.gameStateManager.isScatter = false;

			this.gameAPI.setFreeSpinData(unresolved.response);
			this.gameAPI.setCurrentFreeSpinIndex(unresolved.index);
			this.gameAPI.setUnresolvedSpinUuid(unresolved.uuid);
			this.symbols.currentSpinData = unresolved.response;

			this.events.emit('setBonusMode', true);
			this.events.emit('showBonusBackground');
			this.events.emit('showBonusHeader');

			const remainingSpins = this.getRemainingSpinsFromUnresolved(unresolved);
			this.events.emit('scatterBonusActivated', {
				scatterIndex: 0,
				actualFreeSpins: remainingSpins,
				isRetrigger: false,
				fromUnresolvedSpin: true,
			});

			if (this.slotController) {
				this.slotController.clearFreeSpinDisplaySuppression();
				this.slotController.showFreeSpinDisplayWithActualValue(remainingSpins || 1);
				this.slotController.disableBetBackgroundInteraction('unresolved_bonus_mode');
			}

			this.time.delayedCall(500, () => {
				try {
					this.symbols.resetFreeSpinAutoplayState();
				} catch (e) {
					console.warn('[Game] Failed to reset free spin autoplay state for unresolved resume:', e);
				}
				this.events.emit('scatterBonusCompleted');
				// The normal scatter flow reaches autoplay only after dialog animations finish.
				// Unresolved resume skips that dialog, so emit the completion signal ourselves.
				this.events.emit('dialogAnimationsComplete');
			});
		} finally {
			unresolvedSpinManager.clear();
		}
	}

	/** True while a scene-level or dialog-driven symbol explosion transition is playing. */
	private isSymbolExplosionTransitionActive(): boolean {
		return (
			this.candyTransition?.isTransitionPlaying() === true ||
			this.dialogs.isCandyTransitionPlaying()
		);
	}

	private applyReplayBetToSlotController(): boolean {
		if (!this.gameAPI?.getReplayState?.() || !this.slotController) {
			return false;
		}
		const spinData = this.gameAPI.getReplayData?.()?.spinData;
		if (!spinData) {
			return false;
		}
		const raw = (spinData as { bet?: unknown }).bet;
		if (raw === undefined || raw === null) {
			return false;
		}
		const n = typeof raw === 'number' ? raw : Number(raw);
		if (!Number.isFinite(n) || n < 0) {
			return false;
		}
		try {
			const previousBet = this.slotController.getBaseBetAmount?.() ?? 0.2;
			this.slotController.updateBetAmount(n);
			if (this.betOptions) {
				this.betOptions.setCurrentBet(n);
			}
			if (this.autoplayOptions) {
				this.autoplayOptions.setCurrentBet(n);
			}
			if (Math.abs(n - previousBet) > 0.0001) {
				gameEventManager.emit(GameEventType.BET_UPDATE, { newBet: n, previousBet });
			}
			console.log(`[Game] Replay: applied spinData.bet to SlotController: ${n}`);
			return true;
		} catch (e) {
			console.warn('[Game] applyReplayBetToSlotController failed:', e);
			return false;
		}
	}

	private applyUnresolvedSpinBetAmount(): boolean {
		try {
			const unresolved = unresolvedSpinManager.unresolvedSpin;
			const rawBet = unresolved?.betSize ?? unresolved?.response?.bet;
			const unresolvedBet = Number(rawBet);
			if (!Number.isFinite(unresolvedBet) || unresolvedBet <= 0) {
				return false;
			}

			const previousBet = this.slotController?.getBaseBetAmount?.() ?? 0.20;

			if (this.slotController) {
				this.slotController.updateBetAmount(unresolvedBet);
			}
			if (this.betOptions) {
				this.betOptions.setCurrentBet(unresolvedBet);
			}
			if (this.autoplayOptions) {
				this.autoplayOptions.setCurrentBet(unresolvedBet);
			}

			if (Math.abs(unresolvedBet - previousBet) > 0.0001) {
				gameEventManager.emit(GameEventType.BET_UPDATE, { newBet: unresolvedBet, previousBet });
			}

			console.log(`[Game] Applied unresolved spin bet to SlotController: ${unresolvedBet.toFixed(2)}`);
			return true;
		} catch (e) {
			console.warn('[Game] Failed to apply unresolved spin bet amount:', e);
			return false;
		}
	}

	private initializeBetAmount() {
		try {
			const firstBet = getStartingBet(
				this.gameData.betLevels,
				this.gameAPI?.getInitializationData?.()?.defaultBetIndex
			);

			const previousBet = this.slotController?.getBaseBetAmount?.() ?? 0.20;

			if (this.slotController) {
				this.slotController.updateBetAmount(firstBet);
			}
			if (this.betOptions) {
				this.betOptions.setCurrentBet(firstBet);
			}

			// Keep backend (and listeners like Menu) in sync.
			if (Math.abs(firstBet - previousBet) > 0.0001) {
				gameEventManager.emit(GameEventType.BET_UPDATE, { newBet: firstBet, previousBet: previousBet });
			}
		} catch (e) {
			console.warn('[Game] Failed to apply initialization first bet level:', e);
		}
	}

	/**
	 * Initialize the game balance on start
	 */
	private async initializeGameBalance(prefetchedBalance?: number): Promise<void> {
		const __balanceEpoch = this.slotController?.claimBalanceDisplayEpoch?.();

		try {
			console.log('[Game] Initializing game balance...');
			
			// Call the GameAPI to get the current balance
			const rawBalance = Number.isFinite(prefetchedBalance as number)
				? prefetchedBalance
				: await this.gameAPI.initializeBalance();
			const balance = Number(rawBalance);
			if (balance === -1 && this.gameAPI.getReplayState()) {
				if (this.slotController) {
					this.slotController.applyBalanceDisplayResponse(-1, __balanceEpoch);
					console.log('[Game] Replay mode: balance display set to sentinel');
				}
				gameEventManager.emit(GameEventType.BALANCE_INITIALIZED, {
					newBalance: -1,
					previousBalance: 0,
					change: 0,
				balanceEpoch: __balanceEpoch
				} as any);
				return;
			}
			if (!Number.isFinite(balance) || balance < 0) {
				throw new Error(`[Game] Invalid initial balance received: ${rawBalance}`);
			}
			
			// Update the SlotController balance display
			if (this.slotController) {
				this.slotController.applyBalanceDisplayResponse(balance, __balanceEpoch);
				console.log(`[Game] Balance initialized and updated in SlotController: $${balance}`);
			}
			
			// Emit balance initialized event
			gameEventManager.emit(GameEventType.BALANCE_INITIALIZED, {
				newBalance: balance,
				previousBalance: 0,
				change: balance,
				balanceEpoch: __balanceEpoch
			} as any);
			
			console.log('[Game] Balance initialization completed successfully');
			
		} catch (error) {
			console.error('[Game] Error initializing balance:', error);
			// Use default balance if initialization fails
			const defaultBalance = 200000.00;
			if (this.slotController) {
				this.slotController.applyBalanceDisplayResponse(defaultBalance, __balanceEpoch);
				console.log(`[Game] Using default balance: $${defaultBalance}`);
			}
		}
	}

	/**
	 * Update balance from server after WIN_STOP or REELS_STOP
	 */
	private async updateBalanceAfterWinStop(): Promise<void> {
		if (this.gameAPI?.getUnresolvedSpinUuid?.()) {
			const __completeEpoch = this.slotController?.claimBalanceDisplayEpoch?.();
			try {
				const __completeResult = await this.gameAPI.forceCompleteUnresolvedSpin();
				if (__completeResult === true || __completeResult === 'ok') {
					const __completeBalance = this.gameAPI.getLastUnresolvedCompleteBalance?.();
					if (
						__completeBalance != null &&
						Number.isFinite(__completeBalance) &&
						__completeBalance >= 0
					) {
						this.slotController?.applyBalanceFromUnresolvedComplete?.(__completeBalance, __completeEpoch);
						return;
					}
				}
			} catch (err) {
				console.warn('[Game] Unresolved spin force-complete before balance refresh failed', err);
			}
		}
		const __completeDisplay = (this.slotController as any)?.reapplyUnresolvedCompleteBalance?.();
		if (__completeDisplay === 'applied' || __completeDisplay === 'superseded') {
			return;
		}

		const __balanceEpoch = this.slotController?.claimBalanceDisplayEpoch?.();

		if (this.gameAPI?.getReplayState?.()) {
			return;
		}
		try {
			console.log('[Game] Updating balance from server after bonus end / win stop...');
			
			// Always fetch fresh balance (getBalance via initializeBalance); do not use
			// initializeGameBalance's prefetched path — that variable is not in scope here.
			const rawBalance = await this.gameAPI.initializeBalance();
			const balance = Number(rawBalance);
			if (!Number.isFinite(balance)) {
				console.warn('[Game] Balance refresh returned non-finite value:', rawBalance);
				return;
			}
			
			// Update the SlotController balance display
			if (this.slotController) {
				this.slotController.applyBalanceDisplayResponse(balance, __balanceEpoch);
				console.log(`[Game] Balance updated after bonus end: $${balance}`);
			}
			
			// Update autoplay options balance if visible
			this.updateAutoplayOptionsBalance(balance);
			
		} catch (error) {
			console.error('[Game] Error updating balance after WIN_STOP/REELS_STOP:', error);
		}
	}

	/**
	 * Update the AutoplayOptions balance display
	 */
	private updateAutoplayOptionsBalance(balance: number): void {
		if (this.autoplayOptions && this.autoplayOptions.isVisible()) {
			this.autoplayOptions.setCurrentBalance(balance);
		}
	}

	/**
	 * Calculate total win amount from paylines array
	 */
	private resolveFreeSpinItemForWinStop(spinData: any): any | null {
		const slotAny: any = spinData?.slot || {};
		const fs = slotAny.freespin || slotAny.freeSpin;
		const items = Array.isArray(fs?.items) ? fs.items : [];
		if (items.length === 0) return null;

		try {
			const playedIndex =
				typeof this.gameAPI?.getCurrentFreeSpinIndex === 'function'
					? this.gameAPI.getCurrentFreeSpinIndex()
					: 0;
			if (playedIndex > 0) {
				const playedItem = this.gameAPI.getLastPlayedFreeSpinItem?.();
				if (playedItem) return playedItem;
			}
		} catch {}

		const area = slotAny.area;
		if (!Array.isArray(area)) return null;
		const areaJson = JSON.stringify(area);
		return items.find(
			(item: any) => Array.isArray(item?.area) && JSON.stringify(item.area) === areaJson,
		) ?? null;
	}

	/**
	 * True when the MaxWin drawer must wait for the bonus-entry flow (scatter animation, FreeSpin
	 * trigger/retrigger dialog, bonus transition) to finish first. Covers the bonus-trigger spin
	 * (free-spin items present but this spin is not a matched/played free-spin item yet) and the
	 * retrigger flow. Relies on the next bonus free-spin WIN_STOP re-deriving cap-reached.
	 */
	private shouldDeferMaxWinForBonusEntry(spinData: any, freeSpinItem: any): boolean {
		try {
			const slotAny: any = spinData?.slot || {};
			const fs = slotAny.freespin || slotAny.freeSpin;
			const items = Array.isArray(fs?.items) ? fs.items : [];
			// Trigger spin: items exist (bonus starting) but this spin isn't a played free-spin item.
			if (items.length > 0 && !freeSpinItem) {
				return true;
			}
			// A FreeSpin trigger/retrigger dialog is currently on screen.
			if ((this.dialogs as any)?.isFreeSpinDialogShowing?.()) {
				return true;
			}
			// A scatter retrigger is pending or animating.
			const symbols: any = this.symbols;
			if (symbols) {
				if (symbols.hasPendingScatterRetrigger?.() || symbols.isScatterRetriggerAnimationInProgress?.()) {
					return true;
				}
			}
		} catch { /* fail open: show the drawer rather than risk a stall */ }
		return false;
	}

	private calculateTotalWinFromTumbles(tumbles: any[]): { totalWin: number; hasCluster: boolean } {
		if (!Array.isArray(tumbles) || tumbles.length === 0) {
			return { totalWin: 0, hasCluster: false };
		}
		let totalWin = 0;
		let hasCluster = false;
		for (const tumble of tumbles) {
			const w = Number(tumble?.win || 0);
			totalWin += isNaN(w) ? 0 : w;
			const outs = tumble?.symbols?.out || [];
			if (Array.isArray(outs)) {
				for (const out of outs) {
					const c = Number(out?.count || 0);
					if (c >= 8) { hasCluster = true; break; }
				}
			}
		}
		return { totalWin, hasCluster };
	}

	/**
	 * Check if payout reaches win dialog thresholds and show appropriate dialog
	 */
	private checkAndShowWinDialog(payout: number, bet: number): void {
		// Suppress win dialogs if we're transitioning out of bonus back to base
		if (this.suppressWinDialogsUntilNextSpin) {
			console.log('[Game] Suppressing win dialog (transitioning from bonus to base)');
			return;
		}

		const spinData = this.gameAPI?.getCurrentSpinData?.() ?? null;
		payout = SpinDataUtils.resolveCappedWinDisplayAmount(spinData, payout);

		console.log(`[Game] checkAndShowWinDialog called with payout: $${payout}, bet: $${bet}`);
		console.log(`[Game] Current win queue length: ${this.winQueue.length}`);
		console.log(`[Game] Current isShowingWinDialog state: ${gameStateManager.isShowingWinDialog}`);
		console.log(`[Game] Current dialog showing state: ${this.dialogs.isDialogShowing()}`);
		
		// Check if the win line animation was interrupted by a manual spin
		if (this.symbols && this.symbols.winLineDrawer && this.symbols.winLineDrawer.wasInterruptedBySpin()) {
			console.log('[Game] Win line animation was interrupted by manual spin - preventing win dialog from showing');
			return;
		}

		// If multiplier animations are in progress, defer win dialog until animations complete
		try {
			const symbolsAny: any = this.symbols as any;
			const isMultiplierAnimationsInProgress =
				symbolsAny && typeof symbolsAny.isMultiplierAnimationsInProgress === 'function'
					? !!symbolsAny.isMultiplierAnimationsInProgress()
					: false;
			
			if (isMultiplierAnimationsInProgress) {
				console.log('[Game] Multiplier animations in progress - deferring win dialog until MULTIPLIER_ANIMATIONS_COMPLETE');
				this.winQueue.push({ payout, bet });
				console.log(`[Game] Added to win queue due to multiplier animations. Queue length: ${this.winQueue.length}`);
				// Wait for multiplier animations to complete, then process the win queue
				gameEventManager.once(GameEventType.MULTIPLIER_ANIMATIONS_COMPLETE, () => {
					console.log('[Game] MULTIPLIER_ANIMATIONS_COMPLETE received - processing win queue');
					this.processWinQueue();
				});
				return;
			}
		} catch (e) {
			console.warn('[Game] Failed to check multiplier animation status:', e);
		}

		// If scatter retrigger animation is already in progress, defer win dialog until retrigger dialog closes.
		// When only "pending" retrigger (not yet started), we show the win dialog first; Symbols defers its
		// retrigger sequence until after this dialog closes so order is: win dialog (staged) -> retrigger -> retrigger dialog.
		try {
			const symbolsAny: any = this.symbols as any;
			const isRetriggerAnimationInProgress =
				symbolsAny && typeof symbolsAny.isScatterRetriggerAnimationInProgress === 'function'
					? !!symbolsAny.isScatterRetriggerAnimationInProgress()
					: false;
			
			if (isRetriggerAnimationInProgress) {
				console.log('[Game] Scatter retrigger animation already in progress - deferring win dialog until retrigger dialog closes');
				this.winQueue.push({ payout, bet });
				console.log(`[Game] Added to win queue due to retrigger animation. Queue length: ${this.winQueue.length}`);
				return;
			}
		} catch (e) {
			console.warn('[Game] Failed to check retrigger status:', e);
		}
		
		// If scatter is active and we're autoplaying (normal or free spin), defer win dialog
		// until after the free spin dialog finishes (dialogAnimationsComplete).
		// This ensures the sequence: scatter symbol anims -> free spin dialog -> win dialog.
		try {
			// Detect free spin autoplay via Symbols helper if available
			const symbolsAny: any = this.symbols as any;
			const isFreeSpinAutoplayActive =
				symbolsAny && typeof symbolsAny.isFreeSpinAutoplayActive === 'function'
					? !!symbolsAny.isFreeSpinAutoplayActive()
					: false;

			const isNormalAutoplayActive = !!(gameStateManager.isAutoPlaying || this.gameData?.isAutoPlaying);

			if (gameStateManager.isScatter && (isNormalAutoplayActive || isFreeSpinAutoplayActive)) {
				console.log('[Game] Scatter + autoplay detected - deferring win dialog until after free spin dialog closes');
				this.winQueue.push({ payout, bet });
				console.log(`[Game] Added to win queue due to scatter/autoplay. Queue length: ${this.winQueue.length}`);
				// Win is queued, not shown — clear the pre-emptive flag Symbols may have set so
				// scatter animation is not stuck waiting for WIN_DIALOG_CLOSED.
				gameStateManager.isShowingWinDialog = false;
				return;
			}
		} catch (e) {
			console.warn('[Game] Failed to evaluate scatter/autoplay deferral for win dialog:', e);
		}
		
		// Check if a dialog is already showing - prevent multiple dialogs
		if (this.dialogs.isDialogShowing()) {
			console.log('[Game] Dialog already showing, skipping win dialog for this payout');
			// Add to queue if dialog is already showing
			this.winQueue.push({ payout: payout, bet: bet });
			console.log(`[Game] Added to win queue. Queue length: ${this.winQueue.length}`);
			return;
		}
		
		const multiplier = payout / bet;
		console.log(`[Game] Win detected - Payout: $${payout}, Bet: $${bet}, Multiplier: ${multiplier}x`);
		
		// Only show dialogs for wins that are at least 20x the bet size
		if (multiplier < 20) {
			console.log(`[Game] Win below threshold (20x) - No dialog shown for ${multiplier.toFixed(2)}x multiplier`);
			// Clear the win dialog state since no dialog was shown
			gameStateManager.isShowingWinDialog = false;
			return;
		}
		
		// Determine which win dialog to show based on multiplier thresholds
		// Small win: 20x–<30x
		// Medium win: 30x–<45x
		// Large win: 45x–<60x
		// Super win: 60x+
		if (multiplier >= 60) {
			console.log(
				`[Game] Super Win! Showing SuperW_KA dialog for ${multiplier.toFixed(2)}x multiplier (staged inside dialog)`
			);
			this.dialogs.showSuperWin(this, { winAmount: payout, betAmount: bet });
		} else if (multiplier >= 45) {
			console.log(
				`[Game] Large Win! Showing LargeW_KA dialog for ${multiplier.toFixed(2)}x multiplier (staged inside dialog)`
			);
			this.dialogs.showLargeWin(this, { winAmount: payout, betAmount: bet });
		} else if (multiplier >= 30) {
			console.log(
				`[Game] Medium Win! Showing MediumW_KA dialog for ${multiplier.toFixed(2)}x multiplier (staged inside dialog)`
			);
			this.dialogs.showMediumWin(this, { winAmount: payout, betAmount: bet });
		} else if (multiplier >= 20) {
			console.log(
				`[Game] Small Win! Showing SmallW_KA dialog for ${multiplier.toFixed(2)}x multiplier (no staging)`
			);
			this.dialogs.showSmallWin(this, { winAmount: payout, betAmount: bet });
		}
		
		console.log(`[Game] Win dialog should now be visible. isShowingWinDialog: ${gameStateManager.isShowingWinDialog}`);
	}
	/**
	 * Process the win queue to show the next win dialog
	 */
	private processWinQueue(): void {
		if (this.suppressWinDialogsUntilNextSpin) {
			console.log('[Game] Suppressing processing of win queue (transitioning from bonus to base)');
			return;
		}
		console.log(`[Game] processWinQueue called. Queue length: ${this.winQueue.length}`);
		console.log(`[Game] Current isShowingWinDialog state: ${gameStateManager.isShowingWinDialog}`);
		console.log(`[Game] Current dialog showing state: ${this.dialogs.isDialogShowing()}`);
		
		// Check dialog overlay visibility
		const dialogContainer = this.dialogs.getContainer();
		if (dialogContainer) {
			console.log(`[Game] Dialog overlay visible: ${dialogContainer.visible}, alpha: ${dialogContainer.alpha}`);
		}
		
		if (this.winQueue.length === 0) {
			console.log('[Game] Win queue is empty, nothing to process');
			return;
		}
		
		if (this.dialogs.isDialogShowing()) {
			console.log('[Game] Dialog still showing, cannot process win queue yet');
			return;
		}
		
		// Get the next win from the queue
		const nextWin = this.winQueue.shift();
		if (nextWin) {
			console.log(`[Game] Processing next win from queue: $${nextWin.payout} on $${nextWin.bet} bet. Queue remaining: ${this.winQueue.length}`);
			this.checkAndShowWinDialog(nextWin.payout, nextWin.bet);
		}
	}

	/**
	 * Clear the win queue (useful for resetting state)
	 */
	public clearWinQueue(): void {
		const queueLength = this.winQueue.length;
		this.winQueue = [];
		console.log(`[Game] Win queue cleared. Removed ${queueLength} pending wins`);
	}

	/**
	 * Get current win queue status for debugging
	 */
	private getWinQueueStatus(): string {
		return `Win Queue: ${this.winQueue.length} pending wins`;
	}


	/**
	 * Check if there's a delayed scatter animation waiting and start it
	 */
	private checkAndStartDelayedScatterAnimation(): void {
		if (this.symbols && this.symbols.scatterAnimationManager) {
			const scatterManager = this.symbols.scatterAnimationManager;
			
			// Check if there's delayed scatter data waiting
			if (scatterManager.delayedScatterData) {
				console.log('[Game] Found delayed scatter animation data - starting scatter animation after win dialogs');
				
				// Get the delayed data and clear it
				const delayedData = scatterManager.delayedScatterData;
				scatterManager.delayedScatterData = null;
				
				// Start the scatter animation with a small delay to ensure win dialogs are fully closed
				this.time.delayedCall(100, () => {
					console.log('[Game] Starting delayed scatter animation');
					scatterManager.playScatterAnimation(delayedData);
				});
			} else {
				console.log('[Game] No delayed scatter animation data found');
			}
		}
	}

	private initializeAndStartIdleManager(): void {
		const idleTimeoutMs = MAX_IDLE_TIME_MINUTES * 60 * 1000;
		this.idleManager = new IdleManager(this, idleTimeoutMs);

		this.idleManager.events.on(IdleManager.TIMEOUT_EVENT, () => {
			this.invalidateScratchForExpiredSession();
			this.gameAPI.handleIdleSessionExpired();
		});

		this.idleManager.events.on(IdleManager.CHECK_INTERVAL_EVENT, () => {
			if (this.gameStateManager.isBonus ||
				this.gameStateManager.isAutoPlaying ||
				!!this.gameData?.isAutoPlaying ||
				this.gameStateManager.isReelSpinning ||
				this.gameStateManager.isProcessingSpin ||
				this.scratchPanel?.isVisible() ||
				this.scratchDesktopHost?.isVisible()) {
				this.idleManager.reset();
			}
		});

		const onPointerDownResetIdle = () => this.idleManager.reset();
		this.input.on('pointerdown', onPointerDownResetIdle);

		this.events.once('shutdown', () => {
			try { this.input.off('pointerdown', onPointerDownResetIdle); } catch {}
			try { this.idleManager.destroy(); } catch {}
			try {
				this.replayClockRetryTimer?.remove();
			} catch {}
			this.replayClockRetryTimer = undefined;
		});

		this.idleManager.start();
	}

	private setupBonusModeEventListeners(): void {
		// Listen for bonus mode events from dialogs
		this.events.on('setBonusMode', (isBonus: boolean) => {
			console.log(`[Game] Setting bonus mode: ${isBonus}`); 
			console.log(`[Game] Current gameStateManager.isBonus: ${this.gameStateManager.isBonus}`);
			
			// Ensure winnings display stays visible and transfers to bonus header on bonus start
			if (isBonus) {
				this.gameStateManager.isBonusExitTransitionActive = false;
				// Only transfer winnings if we're NOT already in bonus mode (i.e., this is the initial bonus activation)
				// During retriggers, we're already in bonus mode, so we should preserve the accumulated total
				const wasAlreadyInBonus = this.gameStateManager.isBonus;
				
				if (!wasAlreadyInBonus) {
					console.log('[Game] Bonus mode started - transferring winnings display to bonus header');
					try {
						const currentHeaderWin = this.header && typeof this.header.getCurrentWinnings === 'function'
							? Number(this.header.getCurrentWinnings()) || 0
							: 0;
						if (this.bonusHeader) {
							// Seed the bonus header with the current total shown on the main header
							if (typeof (this.bonusHeader as any).seedCumulativeWin === 'function') {
								(this.bonusHeader as any).seedCumulativeWin(currentHeaderWin);
								console.log(`[Game] Seeded BonusHeader with current header winnings: $${currentHeaderWin}`);
								
								// In bonus mode we only show per-tumble "YOU WON" values in the bonus header.
								// The seeded cumulative value is tracked internally; no immediate header UI update here.
							} else if (typeof this.bonusHeader.updateWinningsDisplay === 'function') {
								this.bonusHeader.updateWinningsDisplay(currentHeaderWin);
								console.log(`[Game] Updated BonusHeader winnings to: $${currentHeaderWin}`);
							}
						}
					} catch (e) {
						console.warn('[Game] Failed transferring winnings to BonusHeader on bonus start:', e);
					}
				} else {
					console.log('[Game] Already in bonus mode (retrigger detected) - preserving accumulated winnings total');
				}

				// Music will be switched when showBonusBackground event is emitted
			} else {
				console.log('[Game] Bonus mode ended - enabling winningsDisplay');
				// Ensure bonus-finished flag is cleared and bonus mode is turned off when leaving bonus
				this.gameStateManager.isBonus = false;
				this.gameStateManager.isBonusFinished = false;
				// Keep autoplay flags untouched here because scatter-triggered autoplay may be paused and resumed.
				this.gameStateManager.isShowingWinlines = false;
				this.gameStateManager.isShowingWinDialog = false;
				// Suppress any win dialogs that might be triggered during the transition back to base
				this.suppressWinDialogsUntilNextSpin = true;
				// Prevent re-showing any queued base-game win dialogs after bonus ends
				this.clearWinQueue();
				// Proactively reset visuals and symbols in case the dialog didn't emit them
				this.events.emit('hideBonusBackground');
				this.events.emit('hideBonusHeader');
				this.events.emit('resetSymbolsForBase');
				// Reset free spin-related state across components
				this.events.emit('resetFreeSpinState');
				// Hide winnings displays on both headers (same as on spin start)
				try {
					if (this.header && typeof this.header.hideWinningsDisplay === 'function') {
						this.header.hideWinningsDisplay();
					}
					if (this.bonusHeader && typeof this.bonusHeader.hideWinningsDisplay === 'function') {
						this.bonusHeader.hideWinningsDisplay();
					}
					// Also fade out any lingering WinTracker entries when returning to base game
					if (this.winTracker) {
						this.winTracker.hideWithFade(250);
						console.log('[Game] Fading out WinTracker on bonus mode end (transition to base game)');
					}
				} catch (e) {
					console.warn('[Game] Failed to hide winnings displays on bonus end:', e);
				}
				// Notify other systems autoplay is fully stopped
				gameEventManager.emit(GameEventType.AUTO_STOP);
				// Balance after bonus is applied by SlotController when Congrats_KA / MaxWin closes.
				// Switch back to main background music
				if (this.audioManager) {
					this.audioManager.playBackgroundMusic(MusicType.MAIN);
					console.log('[Game] Switched to main background music');
				}
			}
			
			// TODO: Update backend data isBonus flag if needed
		});

		this.events.on('showBonusBackground', () => {
			console.log('[Game] ===== SHOW BONUS BACKGROUND EVENT RECEIVED =====');
			console.log('[Game] Background exists:', !!this.background);
			console.log('[Game] BonusBackground exists:', !!this.bonusBackground);
			
			// Hide normal background
			if (this.background) {
				this.background.getContainer().setVisible(false);
				console.log('[Game] Normal background hidden');
			}
			
			// Show bonus background
			if (this.bonusBackground) {
				this.bonusBackground.getContainer().setVisible(true);
				console.log('[Game] Bonus background shown');
				console.log('[Game] Bonus background container visible:', this.bonusBackground.getContainer().visible);
			} else {
				console.error('[Game] BonusBackground is null!');
			}
			
			// Switch to bonus background music when background changes to bonus
			if (this.audioManager) {
				this.audioManager.playBackgroundMusic(MusicType.BONUS);
				console.log('[Game] Switched to bonus background music (bonusbg_ka)');
			}
			
			console.log('[Game] ===== BONUS BACKGROUND EVENT HANDLED =====');
		});

		this.events.on('showBonusHeader', () => {
			console.log('[Game] ===== SHOW BONUS HEADER EVENT RECEIVED =====');
			console.log('[Game] Header exists:', !!this.header);
			console.log('[Game] BonusHeader exists:', !!this.bonusHeader);
			
			// Hide normal header
			if (this.header) {
				this.header.getContainer().setVisible(false);
				console.log('[Game] Normal header hidden');
			}
			
			// Show bonus header
			if (this.bonusHeader) {
				this.bonusHeader.getContainer().setVisible(true);
				console.log('[Game] Bonus header shown');
				console.log('[Game] Bonus header container visible:', this.bonusHeader.getContainer().visible);
			} else {
				console.error('[Game] BonusHeader is null!');
			}
			console.log('[Game] ===== BONUS HEADER EVENT HANDLED =====');
		});

		this.events.on('hideBonusBackground', () => {
			console.log('[Game] Hiding bonus background');
			
			// Show normal background
			if (this.background) {
				this.background.getContainer().setVisible(true);
				console.log('[Game] Normal background shown');
			}
			
			// Hide bonus background
			if (this.bonusBackground) {
				this.bonusBackground.getContainer().setVisible(false);
				console.log('[Game] Bonus background hidden');
			}
		});

		this.events.on('hideBonusHeader', () => {
			console.log('[Game] Hiding bonus header');
			
			// Show normal header
			if (this.header) {
				this.header.getContainer().setVisible(true);
				console.log('[Game] Normal header shown');
			}
			
			// Hide bonus header
			if (this.bonusHeader) {
				this.bonusHeader.getContainer().setVisible(false);
				console.log('[Game] Bonus header hidden');
			}
		});

		// Reset symbols and winlines back to base state
		this.events.on('resetSymbolsForBase', () => {
			console.log('[Game] Resetting symbols and winlines to base state');
			try {
				if (this.symbols) {
					// Do not clear Spine tracks here; keep symbols animating by forcing Idle loops
					if ((this.symbols as any).resumeIdleAnimationsForAllSymbols) {
						(this.symbols as any).resumeIdleAnimationsForAllSymbols();
					}
					this.symbols.clearWinLines();
					// Also hide any winning overlays and restore depths/visibility
					if (typeof (this.symbols as any).hideWinningOverlay === 'function') {
						(this.symbols as any).hideWinningOverlay();
					}
					if (typeof (this.symbols as any).resetSymbolDepths === 'function') {
						(this.symbols as any).resetSymbolDepths();
					}
					if (typeof (this.symbols as any).restoreSymbolVisibility === 'function') {
						(this.symbols as any).restoreSymbolVisibility();
					}
				}
				// Reset any internal flags related to win dialogs/winlines
				this.hasWinlinesThisSpin = false;
				gameStateManager.isShowingWinDialog = false;
				console.log('[Game] Symbols and winlines reset complete');
			} catch (e) {
				console.error('[Game] Error resetting symbols for base:', e);
			}
		});

		console.log('[Game] Bonus mode event listeners setup complete');
		
		// Add fullscreen toggle button (top-right) using shared manager
		const assetScale = this.networkManager.getAssetScale();
		FullScreenManager.addToggle(this, {
			margin: 16 * assetScale,
			iconScale: 1.5 * assetScale,
			depth: 1500,
			maximizeKey: 'maximize',
			minimizeKey: 'minimize'
		});

		(window as any).skipSpin = () => {
			try {
				(this as any)?.symbols?.tryRequestSkipReelDrops?.();
			} catch {}
		};

		// Add a test method to manually trigger bonus mode (for debugging)
		(window as any).testBonusMode = () => {
			console.log('[Game] TEST: Manually triggering bonus mode');
			console.log('[Game] TEST: Current isBonus state:', this.gameStateManager.isBonus);
			this.gameStateManager.isBonus = true;
			console.log('[Game] TEST: After setting isBonus to true:', this.gameStateManager.isBonus);
			this.events.emit('showBonusBackground');
			this.events.emit('showBonusHeader');
		};
		
		// Add a test method to simulate free spin dialog close
		(window as any).testFreeSpinDialogClose = () => {
			console.log('[Game] TEST: Simulating free spin dialog close');
			this.events.emit('showBonusBackground');
			this.events.emit('showBonusHeader');
		};
		
		// Add a method to check current state
		(window as any).checkBonusState = () => {
			console.log('[Game] Current game state:');
			console.log('- isBonus:', this.gameStateManager.isBonus);
			console.log('- isScatter:', this.gameStateManager.isScatter);
			console.log('- Background exists:', !!this.background);
			console.log('- BonusBackground exists:', !!this.bonusBackground);
			console.log('- Header exists:', !!this.header);
			console.log('- BonusHeader exists:', !!this.bonusHeader);
			if (this.background) console.log('- Background visible:', this.background.getContainer().visible);
			if (this.bonusBackground) console.log('- BonusBackground visible:', this.bonusBackground.getContainer().visible);
			if (this.header) console.log('- Header visible:', this.header.getContainer().visible);
			if (this.bonusHeader) console.log('- BonusHeader visible:', this.bonusHeader.getContainer().visible);
		};

		// After the first Game frames — do not hitch the preloader Play click on hub / side canvas.
		this.time.delayedCall(600, () => {
			try {
				if (isScratchReplayRequest()) {
					return;
				}
				if (isNonScratchReplayRequest()) {
					return;
				}
				if (!this.isScratchSlotSessionPlayable()) {
					return;
				}
				this.ensureScratchSideGame();
				this.time.delayedCall(200, () => {
					// Outside-desktop layout: open scratch by default beside the main canvas.
					if (this.scratchDesktopHost?.tryToggle()) {
						return;
					}
					this.scratchDesktopHost?.prewarm();
				});
			} catch (err) {
				console.warn('[Game] Scratch side game setup failed', err);
			}
		});
		
	}

	changeScene() {
		// Scene change logic if needed
	}

	spin() {
		console.log('Game Spin');
		
		// Check if we're in bonus mode - if so, let the free spin autoplay system handle it
		if (this.gameStateManager.isBonus) {
			console.log('[Game] In bonus mode - skipping old spin system, free spin autoplay will handle it');
			return;
		}
		
		// Reset the interrupted flag for the new spin
		if (this.symbols && this.symbols.winLineDrawer) {
			this.symbols.winLineDrawer.resetInterruptedFlag();
		}
		
		// Check if win line drawer is still animating and hasn't completed first loop
		if (this.symbols && this.symbols.winLineDrawer) {
			this.symbols.winLineDrawer.forceEmitWinStopIfNeeded();
		}
		
		this.gameStateManager.startSpin();
	}

	/** True when live JWT+sessionId can authorize scratch, or when the slot is in demo. */
	private isScratchSlotSessionPlayable(): boolean {
		if (this.gameAPI?.getDemoState?.()) {
			return true;
		}
		if (this.scratchClient) {
			return this.scratchClient.isSlotSessionPlayable();
		}
		const token = (this.gameAPI?.getAccessToken?.() ?? sessionStorage.getItem('token') ?? '').trim();
		const sessionId = (
			this.gameAPI?.getSessionId?.() ??
			this.gameAPI?.getInitializationData?.()?.sessionId ??
			''
		).trim();
		return !!token && !!sessionId;
	}

	private readonly onSugarPlaySessionReplaced = (): void => {
		this.disconnectReplacedPlayInstance();
	};

	/** Older page stops. Scratch closes even when the superseded flag was set first. */
	private disconnectReplacedPlayInstance(): void {
		const first = !this.playInstanceDisconnectNotified;
		this.playInstanceDisconnectNotified = true;
		this.gameAPI?.markPlaySessionSuperseded?.();
		if (first) {
			console.warn('[Game] Play session replaced by a newer instance');
			try {
				this.slotController?.stopAutoplay?.({ userInitiated: false, reason: 'system:session-replaced' });
			} catch {
				/* noop */
			}
		}
		try {
			this.scratchDesktopHost?.hide();
		} catch {
			/* noop */
		}
		try {
			this.scratchPanel?.hide();
		} catch {
			/* noop */
		}
		if (first) {
			try {
				checkAndHandleModal({
					message: 'This game was opened in another window. This session has been disconnected.',
				});
			} catch {
				/* noop */
			}
		}
	}

	/** Close scratch + drop hub connection when the slot JWT/session is gone. */
	private invalidateScratchForExpiredSession(): void {
		try {
			this.scratchDesktopHost?.hide();
		} catch {
			/* noop */
		}
		try {
			if (this.scratchPanel?.isVisible()) {
				this.scratchPanel.hide();
			}
		} catch {
			/* noop */
		}
		void this.scratchClient?.disconnect();
	}


	/** In-canvas scratch replay. The card cannot be closed. */
	private presentScratchReplay(): void {
		try {
			this.ensureScratchSideGame();
			const results = readScratchReplayResults(this.gameAPI?.getReplayData?.());
			if (!results || !this.scratchPanel) {
				console.warn('[Game] Scratch replay has no results');
				return;
			}
			this.disableAllSlotControllerButtons('scratch replay');
			this.scratchDesktopHost?.hide();
			this.scratchPanel.playReplay(results, () => this.onScratchReplayPlaybackSettled());
		} catch (err) {
			console.warn('[Game] Scratch replay failed', err);
		}
	}

	private ensureScratchSideGame(): void {
		if (this.scratchClient) {
			return;
		}
		const warmedScratchClient = takeWarmedScratchClient();
		this.scratchClient = warmedScratchClient ?? new ScratchClient({
			hubBaseUrl: resolveScratchHubBaseUrl(),
			getAccessToken: () => this.gameAPI?.getAccessToken?.() ?? sessionStorage.getItem('token'),
			getSessionId: () => this.gameAPI?.getSessionId?.() ?? this.gameAPI?.getInitializationData?.()?.sessionId ?? '',
			getPlayerId: () => this.gameAPI?.getPlayerId?.() ?? this.gameAPI?.getInitializationData?.()?.playerId ?? '',
			getOperatorId: () => this.gameAPI?.getOperatorId?.() ?? '',
			getDemoApiKey: () => resolveScratchDemoApiKey(),
			getDomain: () => this.gameAPI?.getJoinDomain?.() ?? this.gameAPI?.getInitializationData?.()?.domain ?? '',
			getIp: () => this.gameAPI?.getJoinIp?.() ?? this.gameAPI?.getInitializationData?.()?.ip ?? '',
			getRtp: () => this.gameAPI?.getRtp?.() ?? '',
			getCurrency: () => {
				const value = this.gameAPI?.getInitializationData?.()?.currency;
				return value == null ? '' : String(value);
			},
			getCurrencySymbol: () => {
				const value = this.gameAPI?.getInitializationData?.()?.currencySymbol;
				return value == null ? '' : String(value);
			},
			isDemo: () => !!this.gameAPI?.getDemoState?.(),
			gameId: this.gameAPI?.getGameId?.() ?? '00010525',
			onSessionReplaced: () => {
				console.warn('[Game] Scratch session replaced');
				this.disconnectReplacedPlayInstance();
			},
		});
		warmedScratchClient?.setOnSessionReplaced(() => {
			this.disconnectReplacedPlayInstance();
		});

		const panelOptions = {
			client: this.scratchClient,
			getBetAmount: () => this.slotController?.getBaseBetAmount?.() ?? 0.2,
			getBetLevels: () => this.slotController?.getBetLevels?.() ?? [],
			onClose: () => {
				console.log('[Game] Scratch panel closed');
			},
			beginBalanceUpdate: () => this.slotController?.claimBalanceDisplayEpoch?.(),
			onBalanceChanged: (balance: number, epoch?: number, timestamp?: number) => {
				const resolved = epoch ?? this.slotController?.claimBalanceDisplayEpoch?.();
				this.slotController?.applyBalanceDisplayResponse?.(balance, resolved, timestamp);
				if (this.gameAPI?.getDemoState?.() && Number.isFinite(balance)) {
					try { this.gameAPI.updateDemoBalance(balance); } catch {}
				}
			},
			onError: (message: string, errorCode?: string | null) => {
				console.error('[Game] Scratch error:', message, errorCode);
				checkAndHandleModal({
					errorCode: errorCode || undefined,
					message,
				}, { recoverSlot: false });
				// A failed scratch bet claims a balance generation and can leave the HUD
				// off the wallet, including the amount after a buy-feature purchase.
				void this.slotController?.refreshBalanceFromServer?.({ forceServer: true });
			},
			onClearError: () => {
				try {
					dismissCurrentModal();
				} catch {
					/* noop */
				}
			},
		};

		this.scratchPanel = new ScratchPanel(panelOptions);
		this.scratchPanel.create(this);

		this.scratchDesktopHost = new ScratchDesktopHost({
			mainGame: this.game,
			panelOptions,
		});
		try {
			(window as any).scratchDesktopHost = this.scratchDesktopHost;
		} catch { /* noop */ }

		this.scratchWindowResizeHandler = () => {
			try {
				// Booting the side canvas fires resize; skip until open completes.
				if (this.scratchDesktopHost?.isOpening()) {
					return;
				}
				if (this.scratchDesktopHost?.isVisible()) {
					this.scratchDesktopHost.hide();
				}
			} catch {
				/* noop */
			}
			try {
				if (this.scratchPanel?.isVisible()) {
					this.scratchPanel.hide();
				}
			} catch {
				/* noop */
			}
		};
		window.addEventListener('resize', this.scratchWindowResizeHandler);
		window.addEventListener('tb-mobile-fullscreen:change', this.scratchWindowResizeHandler);
	}

	turbo() {
		console.log('Game Turbo');
		this.gameStateManager.toggleTurbo();
	}

	autoplay() {
		// Autoplay logic handled by SlotController
	}

	info() {
		console.log('Game Info');
	}

	betAdd() {
		// Bet increase logic
	}

	betMinus() {
		// Bet decrease logic
	}

	toggleSettings() {
		// Settings toggle logic
	}

	setVolume(_level: number) {
		// Volume setting logic
	}

	setSfx(_level: number) {
		// SFX setting logic
	}

	update(time: number, delta: number) {
		// Game state manager handles its own updates through event listeners
	}

	shutdown() {
		try {
			this.unsubscribePlayInstanceReplaced?.();
			this.unsubscribePlayInstanceReplaced = null;
			window.removeEventListener('sugar-play-session-replaced', this.onSugarPlaySessionReplaced);
		} catch {
			/* noop */
		}
		// Called by Phaser when the Scene shuts down.
		// Make sure we don't leave looping BGM running if the game is torn down / replaced.
		try {
			if (this.scratchWindowResizeHandler) {
				window.removeEventListener('resize', this.scratchWindowResizeHandler);
				window.removeEventListener('tb-mobile-fullscreen:change', this.scratchWindowResizeHandler);
				this.scratchWindowResizeHandler = null;
			}
		} catch {}
		try {
			this.scratchDesktopHost?.destroy();
			this.scratchDesktopHost = null;
			try { if ((window as any).scratchDesktopHost) (window as any).scratchDesktopHost = null; } catch { /* noop */ }
		} catch {}
		try {
			this.scratchPanel?.destroy();
			this.scratchPanel = null;
		} catch {}
		try {
			void this.scratchClient?.disconnect();
			this.scratchClient = null;
		} catch {}
		try {
			const anyWindow: any = window as any;
			if (anyWindow.audioManager === this.audioManager) {
				anyWindow.audioManager = undefined;
			}
		} catch {}
		try { this.audioManager?.stopAllMusic?.(); } catch {}
		try { this.audioManager?.destroy?.(); } catch {}
		try { (this.sound as any)?.stopAll?.(); } catch {}
	}
}