import { addScratchButtonEffect } from '@core/effects/ScratchButtonEffect';
import { SUGAR_WONDERLAND_SCRATCH_BUTTON_EFFECT_CONFIG } from '../../config/ScratchButtonEffectConfig';
import { Scene } from "phaser";
import { Physics } from "@esotericsoftware/spine-core";
import { NetworkManager } from "../../managers/NetworkManager";
import { ScreenModeManager } from "../../managers/ScreenModeManager";
import { EventBus } from "../EventBus";
import { GameData, setSpeed } from "./GameData";
import { gameEventManager, GameEventType, BetFailedErrorEventData } from '../../event/EventManager';
import { gameStateManager } from '../../managers/GameStateManager';
import { TurboConfig } from '../../config/TurboConfig';
import { GameAPI } from '../../backend/GameAPI';
import { isUnplayedFreeRoundStatus, resolveFreeRoundStatus, shouldDeferFreeRoundWalletUntilModal } from '@core/dto';
import { SpinData, SpinDataUtils } from '../../backend/SpinData';
import { BuyFeature } from './BuyFeature';
import { Symbols } from './Symbols';
import { CurrencyManager } from "./CurrencyManager";
import { formatCurrencyNumber } from '../../utils/NumberPrecisionFormatter';
import { SoundEffectType } from '../../managers/AudioManager';
import { LoadingSpinner } from './LoadingSpinner';
import { ensureSpineFactory } from '../../utils/SpineGuard';
import { localizationManager } from '../../managers/LocalizationManager';
import { showModal, ModalType, showBetFailureModalFromError } from '../../managers/ModalManager';
import { getStartingBet, WIN_DIALOG_CONTROLS_REENABLE_DELAY_MS } from '../../config/GameConfig';
import {
	AUTOPLAY_STOP_ICON_OFFSET_X,
	AUTOPLAY_STOP_ICON_OFFSET_Y,
	FREEROUND_SPIN_DISC_OFFSET_X,
	FREEROUND_SPIN_DISC_OFFSET_Y,
	FREEROUND_SPIN_DISC_SCALE_MODIFIER,
	FREEROUND_SPIN_VFX_SCALE_MODIFIER,
	SPIN_BUTTON_HIT_SIZE,
	SPIN_BUTTON_SPINE_OFFSET_X,
	SPIN_BUTTON_SPINE_OFFSET_Y,
	SPIN_BUTTON_SPINE_SCALE_MODIFIER,
	SPIN_ICON_OFFSET_X,
	SPIN_ICON_OFFSET_Y,
} from '../../config/UIPositionConfig';
import {
	COMMON_BALANCE,
	COMMON_BET,
	COMMON_TURBO,
	CONTROLLER_BUY_FEATURE,
	CONTROLLER_SCRATCH,
	CONTROLLER_AMPLIFY_BET,
	CONTROLLER_AUTOPLAY,
	CONTROLLER_MENU,
	CONTROLLER_DOUBLE_CHANCE,
	CONTROLLER_FOR_FEATURE,
	CONTROLLER_REMAINING,
	CONTROLLER_FREE_SPINS,
	LOCALIZATION_DEFAULTS
} from '../../backend/LocalizationData';

import { claimBalanceDisplayEpoch as claimSharedBalanceDisplayEpoch, resolveSpinBalanceEpoch, currentBalanceDisplayEpoch, armBalanceDisplayEpoch, peekArmedBalanceDisplayEpoch, takeArmedBalanceDisplayEpoch, onBalanceDisplayEpochClaimed, coerceWalletTimestamp, isStaleWalletTimestamp, noteRenderedBalanceTimestamp, readWalletTimestamp , renderedWalletTimestamp } from '../../utils/BalanceDisplayEpoch';

export class SlotController {

	private balanceEpochListenerReady = false;

	private ensureBalanceEpochListener(): void {
		if (this.balanceEpochListenerReady) return;
		this.balanceEpochListenerReady = true;
		onBalanceDisplayEpochClaimed(() => {
			if (!this.balanceTween) return;
			if (this.activeBalanceTweenTimestamp != null && !isStaleWalletTimestamp(this.activeBalanceTweenTimestamp)) {
				return;
			}
			try { this.balanceTween.stop(); } catch { /* ignore */ }
			this.balanceTween = null;
			this.balanceAnimationInProgress = false;
			this.activeBalanceTweenTimestamp = undefined;
		});
	}

	public claimBalanceDisplayEpoch(): number {
		this.ensureBalanceEpochListener();
		return claimSharedBalanceDisplayEpoch();
	}

	private armSpinBalanceEpoch(): number {
		this.ensureBalanceEpochListener();
		return armBalanceDisplayEpoch();
	}

	private stampSpinBalanceEpoch(spinData: any): void {
		const epoch = takeArmedBalanceDisplayEpoch();
		if (epoch == null || spinData == null || typeof spinData !== 'object') return;
		try { spinData.__balanceDisplayEpoch = epoch; } catch { /* ignore */ }
	}

	private ensureSpinBalanceEpoch(): number {
		const existing = peekArmedBalanceDisplayEpoch();
		if (existing != null) return existing;
		return this.armSpinBalanceEpoch();
	}

	private balanceEpochFromSpin(spinData: any): number | undefined {
		const tagged = Number(spinData?.__balanceDisplayEpoch);
		return Number.isFinite(tagged) && tagged > 0 ? tagged : undefined;
	}

	private isStaleBalanceEpoch(epoch: number | null | undefined): boolean {
		return epoch != null && epoch !== currentBalanceDisplayEpoch();
	}

	private static readonly BALANCE_PENDING_TEXT = '-';
	private controllerContainer: Phaser.GameObjects.Container;
	private controllerVerticalOffset: number = 0;
	private networkManager: NetworkManager;
	private screenModeManager: ScreenModeManager;
	private scene: Scene | null = null;
	private gameData: GameData | null = null;
	private gameAPI: GameAPI | null = null;

	/** Resolves controller label text via localization. */
	private getControllerText(key: string): string {
		return localizationManager.getTextByKey(key) ?? LOCALIZATION_DEFAULTS[key] ?? key;
	}

	/**
	 * Layout helper for HUD currency + amount pairs (BALANCE/BET/BUY FEATURE).
	 * Centers the combined group and supports non-1-character currency (e.g. "USD").
	 */
	private layoutCurrencyPair(
		centerX: number,
		centerY: number,
		currencyText: Phaser.GameObjects.Text | null | undefined,
		amountText: Phaser.GameObjects.Text | null | undefined,
		isDemo: boolean,
		spacingPx = 6
	): void {
		if (!amountText) return;

		const currencyPrefix = CurrencyManager.getCurrencyGlyph() || CurrencyManager.getCurrencyCode();
		const showCurrency = !isDemo && currencyPrefix.length > 0 && !!currencyText;

		if (!currencyText || !showCurrency) {
			try { currencyText?.setVisible(false); } catch {}
			amountText.setPosition(centerX, centerY);
			return;
		}

		currencyText.setText(currencyPrefix);
		currencyText.setVisible(true);

		// Ensure width is up-to-date after text changes
		const curW = currencyText.width || 0;
		const amtW = amountText.width || 0;
		const groupW = curW + spacingPx + amtW;
		const startX = centerX - groupW * 0.5;

		currencyText.setPosition(startX + curW * 0.5, centerY);
		amountText.setPosition(startX + curW + spacingPx + amtW * 0.5, centerY);
	}

	/**
	 * Re-apply currency code in labels after initialization data is fetched later.
	 */
	public refreshCurrencySymbols(): void {
		const scene = this.scene;
		if (!scene) return;

		const isDemo =
			this.gameAPI?.getDemoState() ||
			sessionStorage.getItem('demo') === 'true';
		const currencyCode = isDemo ? '' : CurrencyManager.getCurrencyCode();
		const balanceX = scene.scale.width * 0.19;
		const balanceY = scene.scale.height * 0.724 - 8;
		const betX = scene.scale.width * 0.81;
		const betY = scene.scale.height * 0.724 - 8;
		const y = scene.scale.height * 0.724 + 8;

		// Rebuild balance label container
		if (this.balanceLabelContainer) {
			this.balanceLabelContainer.removeAll(true);
			
			const balanceText = this.getControllerText(COMMON_BALANCE).toUpperCase();
			let currentX = 0;
			
			// "BALANCE" - green, poppins-bold
			const balanceWordText = scene.add.text(
				currentX, 0, balanceText,
				{
					fontSize: '12px',
					color: '#00ff00', // Green color
					fontFamily: 'poppins-bold'
				}
			).setOrigin(0, 0.5);
			this.balanceLabelContainer.add(balanceWordText);
			currentX += balanceWordText.width;
			
			// Add currency code in parentheses if available
			if (currencyCode) {
				// " (" - green, poppins-regular
				const leftParenText = scene.add.text(
					currentX, 0, ' (',
					{
						fontSize: '12px',
						color: '#00ff00', // Green color
						fontFamily: 'poppins-regular'
					}
				).setOrigin(0, 0.5);
				this.balanceLabelContainer.add(leftParenText);
				currentX += leftParenText.width;
				
				// Currency code - white, poppins-regular
				const currencyText = scene.add.text(
					currentX, 0, currencyCode,
					{
						fontSize: '12px',
						color: '#ffffff', // White color
						fontFamily: 'poppins-regular'
					}
				).setOrigin(0, 0.5);
				this.balanceLabelContainer.add(currencyText);
				currentX += currencyText.width;
				
				// ")" - green, poppins-regular
				const rightParenText = scene.add.text(
					currentX, 0, ')',
					{
						fontSize: '12px',
						color: '#00ff00', // Green color
						fontFamily: 'poppins-regular'
					}
				).setOrigin(0, 0.5);
				this.balanceLabelContainer.add(rightParenText);
			}
			
			// Center the container by adjusting its position
			const totalWidth = currentX;
			this.balanceLabelContainer.setX(balanceX - totalWidth / 2);
			this.balanceLabelContainer.setY(balanceY);
		}
		// Hide balance currency text since it's now in the label
		if (this.balanceDollarText) {
			this.balanceDollarText.setVisible(false);
		}
		// Position balance amount text centered (no currency to layout)
		if (this.balanceAmountText) {
			this.balanceAmountText.setPosition(balanceX, y);
		}

		// Rebuild bet label container
		if (this.betLabelContainer) {
			this.betLabelContainer.removeAll(true);
			
			const betText = this.getControllerText(COMMON_BET).toUpperCase();
			let currentX = 0;
			
			// "BET" - green, poppins-bold
			const betWordText = scene.add.text(
				currentX, 0, betText,
				{
					fontSize: '12px',
					color: '#00ff00', // Green color
					fontFamily: 'poppins-bold'
				}
			).setOrigin(0, 0.5);
			this.betLabelContainer.add(betWordText);
			currentX += betWordText.width;
			
			// Add currency code in parentheses if available
			if (currencyCode) {
				// " (" - green, poppins-regular
				const leftParenText = scene.add.text(
					currentX, 0, ' (',
					{
						fontSize: '12px',
						color: '#00ff00', // Green color
						fontFamily: 'poppins-regular'
					}
				).setOrigin(0, 0.5);
				this.betLabelContainer.add(leftParenText);
				currentX += leftParenText.width;
				
				// Currency code - white, poppins-regular
				const currencyText = scene.add.text(
					currentX, 0, currencyCode,
					{
						fontSize: '12px',
						color: '#ffffff', // White color
						fontFamily: 'poppins-regular'
					}
				).setOrigin(0, 0.5);
				this.betLabelContainer.add(currencyText);
				currentX += currencyText.width;
				
				// ")" - green, poppins-regular
				const rightParenText = scene.add.text(
					currentX, 0, ')',
					{
						fontSize: '12px',
						color: '#00ff00', // Green color
						fontFamily: 'poppins-regular'
					}
				).setOrigin(0, 0.5);
				this.betLabelContainer.add(rightParenText);
			}
			
			// Center the container by adjusting its position
			const totalWidth = currentX;
			this.betLabelContainer.setX(betX - totalWidth / 2);
			this.betLabelContainer.setY(betY);
		}
		// Hide bet currency text since it's now in the label
		if (this.betDollarText) {
			this.betDollarText.setVisible(false);
		}
		// Position bet amount text centered (no currency to layout)
		if (this.betAmountText) {
			this.betAmountText.setPosition(betX, y);
		}

		// Rebuild buy-feature label (BUY + currency) and amount + currency pair
		if (this.featureLabelContainer) {
			this.featureLabelContainer.removeAll(true);
			const featureX = scene.scale.width * 0.5;
			const featureLabelY = scene.scale.height * 0.724 - 8;
			const buyText = this.getControllerText(CONTROLLER_BUY_FEATURE);
			const featureCurrency =
				isDemo ? '' : (CurrencyManager.getCurrencyCode() || CurrencyManager.getCurrencyGlyph());
			let currentXFeature = 0;
			const buyWordText = scene.add
				.text(currentXFeature, 0, buyText, {
					fontSize: '12px',
					color: '#ffffff',
					fontFamily: 'poppins-bold',
				})
				.setOrigin(0, 0.5);
			this.featureLabelContainer.add(buyWordText);
			currentXFeature += buyWordText.width;
			if (featureCurrency) {
				const leftParen = scene.add
					.text(currentXFeature, 0, ' (', {
						fontSize: '12px',
						color: '#ffffff',
						fontFamily: 'poppins-regular',
					})
					.setOrigin(0, 0.5);
				this.featureLabelContainer.add(leftParen);
				currentXFeature += leftParen.width;
				const curText = scene.add
					.text(currentXFeature, 0, featureCurrency, {
						fontSize: '12px',
						color: '#ffffff',
						fontFamily: 'poppins-regular',
					})
					.setOrigin(0, 0.5);
				this.featureLabelContainer.add(curText);
				currentXFeature += curText.width;
				const rightParen = scene.add
					.text(currentXFeature, 0, ')', {
						fontSize: '12px',
						color: '#ffffff',
						fontFamily: 'poppins-regular',
					})
					.setOrigin(0, 0.5);
				this.featureLabelContainer.add(rightParen);
				currentXFeature += rightParen.width;
			}
			this.featureLabelContainer.setVisible(true);
			this.featureLabelContainer.setX(featureX - currentXFeature / 2);
			this.featureLabelContainer.setY(featureLabelY);
		}
		if (this.featureLabelText) {
			this.featureLabelText.setVisible(false);
		}
		this.updateFeatureAmountFromCurrentBet();
	}

	private symbols: Symbols | null = null;
	private buttons: Map<string, Phaser.GameObjects.Image> = new Map();
	private betAmountText: Phaser.GameObjects.Text;
	private betDollarText: Phaser.GameObjects.Text;
	private balanceAmountText: Phaser.GameObjects.Text;
	private balanceDollarText: Phaser.GameObjects.Text;
	private featureAmountText: Phaser.GameObjects.Text;
	private featureDollarText: Phaser.GameObjects.Text;
	private featureLabelText: Phaser.GameObjects.Text | null = null;
	private balanceLabelContainer: Phaser.GameObjects.Container;
	private betLabelContainer: Phaser.GameObjects.Container;
	private featureLabelContainer: Phaser.GameObjects.Container;
	private featureImage: Phaser.GameObjects.Image | null = null;
	private featureButtonHitbox: Phaser.GameObjects.Rectangle | null = null;
	private scratchCardButton: Phaser.GameObjects.GameObject | null = null;
	private scratchCardLabel: Phaser.GameObjects.Text | null = null;
	private scratchCardRoot: Phaser.GameObjects.Container | null = null;
	private primaryControllers: Phaser.GameObjects.Container;
	private controllerTexts: Phaser.GameObjects.Text[] = [];
	private amplifyDescriptionContainer: Phaser.GameObjects.Container;
	private freeSpinLabel: Phaser.GameObjects.Text;
	private freeSpinNumber: Phaser.GameObjects.Text;
	private freeSpinSubLabel: Phaser.GameObjects.Text;
	private autoplaySpinsRemainingText: Phaser.GameObjects.Text;
	// UI override for free spin remaining display; used to add +5 on retrigger and prevent server display from overwriting
	private freeSpinDisplayOverride: number | null = null;
	private pendingFreeSpinsData: { scatterIndex: number; actualFreeSpins: number } | null = null;
	
	// Store pending balance updates until reels stop spinning
	private pendingBalanceUpdate: { balance: number; bet: number; winnings?: number } | null = null;
	/** During freespin, hold HUD balance until bonus summary dialog closes. */
	private freezeBalanceUi: boolean = false;
	private bonusStartBalanceSnapshot: number | null = null;
	private deferredBalanceAfterBonus: number | null = null;
	/** Captured from bonus summary before teardown. Used in applyBonusExitBalance. */
	public capturedBonusTotalWin: number = 0;
	/** Wallet balance from the trigger bet response (response.balance). */
	private bonusTriggerWalletBalance: number | null = null;
	/** Prevents demo WIN_STOP / server reconcile from overwriting post-bonus balance until next spin. */
	public bonusExitBalanceApplied: boolean = false;
	
	// Spine animation for spin button (start_btn_spine disc + press FX)
	private spinButtonAnimation: any = null;
	// Spine animation for spin button during initialization free-round spins
	private freeRoundSpinButtonAnimation: any = null;
	/** Orange `freeround_bg` disc — visible only during free-round spins. */
	private freeRoundSpinDisc: Phaser.GameObjects.Image | null = null;
	/** True while FR disc + Button_Bonus VFX are the active spin visuals. */
	private freeRoundSpinVisualsActive: boolean = false;
	/**
	 * True from press-FX start until it finishes. Spam clicks must not restart/cut
	 * `start_btn_spine` / Button_Bonus while this is set.
	 */
	private spinButtonPressPlaying: boolean = false;
	private spinButtonPressToken: number = 0;
	private spinButtonPressListener: any = null;
	/** Non-rendering click zone for the spin button (Phaser ignores alpha=0 Images for input). */
	private spinHitZone: Phaser.GameObjects.Zone | null = null;
	/** assetScale used when the spin button stack was last built (for layout). */
	private spinButtonAssetScale: number = 1;
	
	// Spine animation for autoplay button (looping when active)
	private autoplayButtonAnimation: any = null;
	
	// Spine animation for turbo button (looping when active)
	private turboButtonAnimation: any = null;
	
	// Spin icon overlay and its tween
	private spinIcon: Phaser.GameObjects.Image | null = null;
	private spinIconTween: Phaser.Tweens.Tween | null = null;
	private spinIconSkipFadeTween: Phaser.Tweens.Tween | null = null;
	private autoplayStopIconTween: Phaser.Tweens.Tween | null = null;
	
	// Autoplay stop icon overlay (also reused as manual-spin skip affordance)
	private autoplayStopIcon: Phaser.GameObjects.Image | null = null;
	private spinSkipVisualActive: boolean = false;
	/** Prevents double spin clicks before the spin pipeline locks the button. */
	private manualSpinClickInFlight: boolean = false;
	/** True only for the current manual base-game spin; autoplay spins never use button skip. */
	private currentSpinAllowsManualButtonSkip: boolean = false;
	/** Skip already used this manual spin; keeps active HUD and blocks re-grey. */
	private manualSpinSkipConsumedForCurrentSpin: boolean = false;
	private static readonly SPIN_SKIP_VISUAL_MS = 80;

	// Guard to ensure we decrement autoplay counter once per spin at REELS_START
	private hasDecrementedAutoplayForCurrentSpin: boolean = false;
	// Guard to ensure balance reconcile runs only once per spin (REELS_STOP can fire twice: from Symbols + WinLineDrawer)
	private balanceApiCalledThisSpin: boolean = false;
	private isBalanceInitialized: boolean = false;
	private pendingSpinUntilBalanceReady: boolean = false;
	private balanceTween: Phaser.Tweens.Tween | null = null;
	private balanceAnimationInProgress: boolean = false;
	private activeBalanceTweenTarget: number | null = null;
	private pendingServerBalanceForReconcile: number | null = null;
	private pendingServerBalanceTimestamp: number | undefined;
	/** Per-spin wallet cycle — pairs deferred response.balance with WIN_START / REELS_STOP. */
	private balanceAnimSpinToken: number = 0;
	/** Coalesce duplicate failed-spin recovery. */
	private failedSpinRecoveryInFlight: boolean = false;
	/** Dedupe concurrent getBalance calls during failed-spin recovery. */
	private balanceRefreshInFlight: Promise<void> | null = null;
	private pendingWalletBalanceFromSpin: number | null = null;
	private pendingWalletBalanceSpinToken: number = -1;
	/** Generation captured when the spin request started. Later scratch/spin responses outrank it. */
	private pendingWalletBalanceEpoch: number | null = null;
	private pendingWalletBalanceTimestamp: number | undefined;
	private pendingServerBalanceEpoch: number | null = null;
	private activeBalanceTweenEpoch: number | null = null;
  private activeBalanceTweenTimestamp: number | undefined;
	
	// Loading spinner for when API requests take > 2 seconds (after symbols clear)
	private loadingSpinner: LoadingSpinner | null = null;
	
	// When true, prevent the free spin display from being shown (e.g., after congrats)
	private freeSpinDisplaySuppressed: boolean = false;
	
	// For free spin autoplay UI sync: subtract 1 from server value for current spin
	private shouldSubtractOneFromServerFsDisplay: boolean = false;
	// Tracks whether we already applied the UI -1 optimistically for the current spin
	private uiFsDecrementApplied: boolean = false;
	
	// Buy feature drawer component
	private buyFeature: BuyFeature | null = null;
	
	// Amplify bet pulsing system
	private amplifyBetBounceTimer: Phaser.Time.TimerEvent | null = null;
	
	// Amplify bet spine animation
	private amplifyBetAnimation: any = null;

	// Enhance Bet idle loop spine animation (shown when enhanced bet is ON)
	private enhanceBetIdleAnimation: any = null;
	
	// Flag to prevent amplify bet reset during internal bet changes
	private isInternalBetChange: boolean = false;

	// Feature button enable guard: only allow enabling after explicit setBonusMode(false)
	private canEnableFeatureButton: boolean = true;
	
	// Store the base bet amount (without amplify bet increase) for API calls
	private baseBetAmount: number = 0;
	
	// Simple autoplay system
	private autoplaySpinsRemaining: number = 0;
	private pausedAutoplaySpinsRemaining: number = 0;
	private autoplayTimer: Phaser.Time.TimerEvent | null = null;
	private pausedAutoplayResumeTimer: Phaser.Time.TimerEvent | null = null;
	/** Autoplay waits for bet-failed popup close before scheduling the next spin. */
	private autoplayPausedForBetFailedPopup: boolean = false;

	// Locks controls during the post-TotalWin (Congrats_KA) cool-down window only — not SuperW_KA.
	// Set on WIN_DIALOG_CLOSING (synchronous click, before isShowingWinDialog is cleared),
	// cleared after WIN_DIALOG_CONTROLS_REENABLE_DELAY_MS
	// later by winDialogCooldownTimer. Acts as a blocker so background restore paths also wait.
	private winDialogControlsLocked: boolean = false;
	private winDialogCooldownTimer: Phaser.Time.TimerEvent | null = null;
	private postSpinControlsRefreshPollScheduled: boolean = false;
	// When true, current autoplay session is a dedicated "freeround autoplay"
	private isFreeRoundAutoplay: boolean = false;
	// True while the initialization free-round starting prompt is open (or pending show).
	// Keeps the spin button disabled until the player dismisses it with SPIN NOW.
	private isAwaitingFreeRoundStartPrompt: boolean = false;
	// Flag to track if we need to re-enable spin button after first autoplay spin in normal mode
	private shouldReenableSpinButtonAfterFirstAutoplay: boolean = false;

	constructor(networkManager: NetworkManager, screenModeManager: ScreenModeManager) {
		this.networkManager = networkManager;
		this.screenModeManager = screenModeManager;
		
		// Initialize buy feature component
		this.buyFeature = new BuyFeature();
		
		// Listen for autoplay state changes
		this.setupAutoplayEventListeners();
	}

	/**
	 * Initialize the loading spinner
	 * Should be called after the scene and symbols are set up
	 */
	private initializeLoadingSpinner(): void {
		if (!this.scene) {
			console.warn('[SlotController] Cannot initialize spinner - scene not set');
			return;
		}

		// Get the center position of the symbols grid
		const centerX = this.scene.scale.width * 0.5 - 5;
		const centerY = this.scene.scale.height * 0.445;

		this.loadingSpinner = new LoadingSpinner(this.scene, centerX, centerY);
		console.log('[SlotController] Loading spinner initialized');
	}

	/**
	 * Start the spinner timer (shows spinner after 2 seconds if still loading)
	 * Delayed to allow previous symbols to clear before showing
	 */
	private startSpinnerTimer(): void {
		if (!this.loadingSpinner) {
			return;
		}
		this.loadingSpinner.startDelayedShow();
	}

	/**
	 * Hide the spinner (call when data is received, before symbols drop)
	 */
	public hideLoadingSpinner(): void {
		this.hideSpinner();
	}

	/**
	 * Hide the spinner (call when data is received)
	 */
	private hideSpinner(): void {
		if (!this.loadingSpinner) {
			return;
		}
		this.loadingSpinner.hide();
	}

	private showOutOfBalancePopup(_message?: string): void {
		const scene = this.scene as Scene | null;
		if (!scene) return;
		showModal(ModalType.OUT_OF_BALANCE, {
			scene,
			onHide: () => this.refreshControlsAfterOutOfBalancePopupClose(),
		});
	}

	private refreshControlsAfterOutOfBalancePopupClose(): void {
		const gsmAny: any = gameStateManager as any;
		const isInFreeSpinRound = gsmAny.isInFreeSpinRound === true;
		const isAutoplayActive =
			this.autoplaySpinsRemaining > 0 ||
			gameStateManager.isAutoPlaying ||
			(this.gameData?.isAutoPlaying ?? false);

		this.updateSpinButtonState();

		if (
			gameStateManager.isScatter ||
			gameStateManager.isBonus ||
			this.isBonusExitTransitionActive() ||
			isInFreeSpinRound ||
			gameStateManager.isReelSpinning ||
			gameStateManager.isProcessingSpin ||
			gameStateManager.isShowingWinlines ||
			gameStateManager.isShowingWinDialog
		) {
			console.log('[SlotController] Skipping out-of-balance control refresh (blocked game state still active)');
			return;
		}

		this.updateAutoplayButtonState();
		this.updateTurboButtonState();
		this.enableBetButtons();
		this.enableBetBackgroundInteraction('after out-of-balance popup close');
		if (!this.shouldKeepBaseControlsLocked() && this.canEnableFeatureButton) {
			this.enableFeatureButton();
		}
		if (isAutoplayActive) {
			this.disableAmplifyButton();
		} else {
			this.enableAmplifyButton();
		}
	}

	/**
	 * Expose the primary controllers container so external UI (e.g., FreeRoundManager)
	 * can align itself within the same coordinate space as the spin button.
	 */
	public getPrimaryControllersContainer(): Phaser.GameObjects.Container | null {
		return this.primaryControllers || null;
	}

	/**
	 * Expose the main spin button image for other UI components (e.g., FreeRoundManager).
	 * With start_btn_spine this is the `spin_icon` overlay (not a disc Image). Callers must
	 * not setTexture disc keys (`spin` / `freeround_bg`) on it — Phaser silently uses __MISSING.
	 */
	public getSpinButton(): Phaser.GameObjects.Image | null {
		return this.spinIcon || this.buttons.get('spin') || null;
	}

	/**
	 * Expose the spin icon overlay image (if created).
	 */
	public getSpinIcon(): Phaser.GameObjects.Image | null {
		return this.spinIcon;
	}

	/**
	 * Expose the autoplay stop icon overlay image (if created).
	 */
	public getAutoplayStopIcon(): Phaser.GameObjects.Image | null {
		return this.autoplayStopIcon;
	}

	/**
	 * Remaining-spins HUD sits in the buy-feature slot, same band as BALANCE / BET.
	 */
	public getFreeRoundInfoPanelPosition(): { x: number; y: number } | null {
		const feature = this.buttons.get('feature');
		if (feature) {
			return { x: feature.x, y: feature.y };
		}
		if (!this.scene) {
			return null;
		}
		return {
			x: this.scene.scale.width * 0.5,
			y: this.scene.scale.height * 0.724,
		};
	}
	
	 /* Free-round spin visuals: `freeround_bg` disc + `Button_Bonus_Buttom` VFX.
	 * Normal visuals: `start_btn_spine` + rotating `spin_icon`. Hit Zone stays either way.
	 */
	public setFreeRoundSpinButtonVisuals(active: boolean): void {
		this.freeRoundSpinVisualsActive = active;
		const assetScale = this.spinButtonAssetScale || 1;

		if (active) {
			this.ensureFreeRoundSpinDisc(this.scene, assetScale);
			if (this.spinButtonAnimation) {
				this.spinButtonAnimation.setVisible(false);
			}
			if (this.freeRoundSpinDisc) {
				this.freeRoundSpinDisc.setVisible(true);
			}
			// VFX spine stays hidden until a press; disc is the idle look.
			if (this.freeRoundSpinButtonAnimation) {
				this.freeRoundSpinButtonAnimation.setVisible(false);
			}
			if (this.spinIcon) {
				this.spinIcon.setVisible(true);
			}
			console.log('[SlotController] Free-round spin visuals ON (freeround_bg + Button_Bonus)');
		} else {
			if (this.freeRoundSpinDisc) {
				this.freeRoundSpinDisc.setVisible(false);
			}
			if (this.freeRoundSpinButtonAnimation) {
				this.freeRoundSpinButtonAnimation.setVisible(false);
			}
			if (this.spinButtonAnimation) {
				this.setStartBtnSpineIdle(this.spinButtonAnimation);
				this.spinButtonAnimation.setVisible(true);
			}
			if (this.spinIcon) {
				this.spinIcon.setVisible(true);
			}
			console.log('[SlotController] Free-round spin visuals OFF (start_btn_spine)');
		}

		this.layoutSpinButtonStack(assetScale);
		this.bringSpinButtonStackToFront();
	}

	/** Create `freeround_bg` disc once (hidden until FR mode). */
	private ensureFreeRoundSpinDisc(scene: Scene | null, assetScale: number): void {
		if (!scene || this.freeRoundSpinDisc) return;
		if (!scene.textures.exists('freeround_bg')) {
			console.warn(
				'[SlotController] freeround_bg not loaded — free-round disc unavailable ' +
					'(Phaser would silently use __MISSING)'
			);
			return;
		}
		const anchor = this.getSpinButtonAnchor();
		if (!anchor) return;

		this.freeRoundSpinDisc = scene.add
			.image(anchor.x, anchor.y, 'freeround_bg')
			.setOrigin(0.5, 0.5)
			.setScale(assetScale * FREEROUND_SPIN_DISC_SCALE_MODIFIER)
			.setDepth(9)
			.setVisible(false);
		if (this.primaryControllers) {
			this.primaryControllers.addAt(this.freeRoundSpinDisc, 0);
		} else {
			this.controllerContainer.add(this.freeRoundSpinDisc);
		}
	}

	/**
	 * Disable UI controls that should not be usable during free rounds.
	 * - Buy Feature button
	 * - Autoplay button
	 * - Amplify bet button
	 * - Bet +/- buttons
	 * - Bet background (that opens bet options)
	 */
	public disableControlsForFreeRounds(): void {
		console.log('[SlotController] Disabling controls for free rounds');

		// Reuse existing helpers where possible
		this.disableBetButtons();
		this.disableFeatureButton();

		// Completely hide the Buy Feature visuals while free rounds are active so the
		// center row can be used by the FreeRoundManager info panel instead.
		//
		// NOTE: Unlike some other games (e.g. warfreaks), sugar_wonderland does NOT store the
		// feature button in `this.buttons` (it uses `featureImage` + `featureButtonHitbox`),
		// so we must hide those objects explicitly.
		try {
			this.featureImage?.setVisible(false);
			this.featureButtonHitbox?.setVisible(false);
			if (this.featureLabelContainer) {
				this.featureLabelContainer.setVisible(false);
			}
			this.featureLabelText?.setVisible(false);
			this.featureAmountText?.setVisible(false);
			this.featureDollarText?.setVisible(false);

			// Fallback: if any implementation stored a feature button in the map, hide it too.
			const featureButton = this.buttons.get('feature');
			featureButton?.setVisible(false);
		} catch (e) {
			console.warn('[SlotController] Failed to hide Buy Feature UI for free rounds:', e);
		}

		// Autoplay button
		const autoplayButton = this.buttons.get('autoplay');
		if (autoplayButton) {
			autoplayButton.setAlpha(0.5);
			autoplayButton.disableInteractive();
			console.log('[SlotController] Autoplay button disabled for free rounds');
		}

		// Amplify bet button
		const amplifyButton = this.buttons.get('amplify');
		if (amplifyButton) {
			amplifyButton.setAlpha(0.5);
			amplifyButton.disableInteractive();
			console.log('[SlotController] Amplify bet button disabled for free rounds');
		}

		// Bet background (that opens bet options)
		this.disableBetBackgroundInteraction('free rounds');
	}

	/**
	 * Restore the restricted idle chrome after an initialization free-round settles.
	 * Spin, turbo, and menu retain their usual idle/modal state.
	 */
	public applyFreeRoundIdleControlState(): void {
		if (!this.isInitializationFreeRoundActive()) {
			return;
		}
		this.disableControlsForFreeRounds();
		this.buttons.get('decrease_bet')?.disableInteractive();
		this.buttons.get('increase_bet')?.disableInteractive();
		this.featureImage?.setVisible(false);
		this.featureButtonHitbox?.setVisible(false)?.disableInteractive?.();
		this.featureLabelContainer?.setVisible(false);
		this.featureLabelText?.setVisible(false);
		this.featureAmountText?.setVisible(false);
		this.featureDollarText?.setVisible(false);
		(this.buttons.get('feature') as any)?.setVisible(false)?.disableInteractive?.();
		this.updateSpinButtonState();
		try { this.updateTurboButtonState(); } catch {}
	}

	/**
	 * Lock/unlock the spin button around the free-round starting prompt.
	 * While awaiting, spin stays disabled; clearing the flag restores normal spin state.
	 */
	public setAwaitingFreeRoundStartPrompt(awaiting: boolean): void {
		this.isAwaitingFreeRoundStartPrompt = !!awaiting;
		if (this.isAwaitingFreeRoundStartPrompt) {
			this.disableSpinButton();
		} else {
			this.updateSpinButtonState();
			this.applyFreeRoundIdleControlState();
		}
	}

	/** True while the free-round start prompt is open or pending show (SPACE must not spin). */
	public isAwaitingFreeRoundStartPromptActive(): boolean {
		return this.isAwaitingFreeRoundStartPrompt;
	}

	/**
	 * Re-enable UI controls after free rounds end.
	 */
	public enableControlsAfterFreeRounds(): void {
		this.isAwaitingFreeRoundStartPrompt = false;

		// Always clear stale autoplay flags first (gameData.isAutoPlaying survives AUTO_STOP).
		this.finalizeAutoplaySessionEnd();
		this.resetManualSpinSkipButtonState();
		this.releaseManualSpinClickLock();

		if (this.shouldKeepBaseControlsLocked()) {
			return;
		}
		console.log('[SlotController] Enabling controls after free rounds');

		this.restoreBaseControls();

		// Restore Buy Feature visuals after free rounds end.
		// (Visibility restore is independent from interactivity restore, which is handled by enableFeatureButton())
		try {
			this.featureImage?.setVisible(true);
			this.featureButtonHitbox?.setVisible(true);
			this.featureLabelContainer?.setVisible(true);
			this.featureLabelText?.setVisible(false);
			this.featureAmountText?.setVisible(true);
			try { this.updateFeatureAmountFromCurrentBet(); } catch {}

			// Fallback (if present in map)
			const featureButton = this.buttons.get('feature');
			featureButton?.setVisible(true);
		} catch (e) {
			console.warn('[SlotController] Failed to restore Buy Feature UI after free rounds:', e);
		}

		const autoplayButton = this.buttons.get('autoplay');
		if (autoplayButton) {
			autoplayButton.setAlpha(1.0);
			autoplayButton.setInteractive();
			console.log('[SlotController] Autoplay button re-enabled after free rounds');
		}

		const amplifyButton = this.buttons.get('amplify');
		if (amplifyButton) {
			amplifyButton.setAlpha(1.0);
			amplifyButton.setInteractive();
			console.log('[SlotController] Amplify bet button re-enabled after free rounds');
		}

		// Bet background (that opens bet options)
		this.enableBetBackgroundInteraction('after free rounds');
	}

	/**
	 * Apply the last free-round envelope balance after the end modal is dismissed.
	 */
	public applyFreeRoundEndBalance(balance: number): void {
		if (!Number.isFinite(balance) || balance < 0) {
			return;
		}
		const prevFreeze = this.freezeBalanceUi;
		this.freezeBalanceUi = false;
		try {
			const wb = this.roundCurrency(balance);
			this.startBalanceTween(wb, 200);
			if (this.gameAPI?.getDemoState?.()) {
				try { this.gameAPI.updateDemoBalance(wb); } catch {}
			}
			console.log('[SlotController] Applied free-round end balance:', wb);
		} finally {
			this.freezeBalanceUi = prevFreeze;
		}
	}

	private isInitializationFreeRoundActive(): boolean {
		return gameStateManager.isInFreeSpinRound === true && !gameStateManager.isBonus;
	}

	/** Defer HUD wallet until the FR status modal closes (complete / partial / cancelled / failed). */
	private shouldDeferFreeRoundWalletUntilModal(): boolean {
		if (!this.isInitializationFreeRoundActive()) {
			return false;
		}
		return shouldDeferFreeRoundWalletUntilModal(this.gameAPI?.getLastFreeRoundBetUpdate?.() ?? null);
	}

	private abortUnplayedFreeRoundSpin(): void {
		console.log('[SlotController] Aborting unplayed free-round spin (failed/cancelled)');
		try {
			(this.scene as any)?.symbols?.cancelClientSpinPresentation?.({ restoreSymbols: true, clearPreparedSymbols: true });
		} catch {}
		try { this.hideSpinner(); } catch {}
		try { gameStateManager.isReelSpinning = false; } catch {}
		try { (gameStateManager as any).isProcessingSpin = false; } catch {}
		this.releaseManualSpinClickLock();
		this.resetManualSpinSkipButtonState();
		this.updateSpinButtonState();
		gameEventManager.emit(GameEventType.FREEROUND_SPIN_ABORTED);
	}

	/**
	 * Disable interaction on the bet background that opens the bet options panel.
	 * This is used in multiple states (free rounds, buy feature, etc.).
	 */
	public disableBetBackgroundInteraction(reason: string = ''): void {
		if (!this.controllerContainer) {
			return;
		}

		this.controllerContainer.iterate((child: any) => {
			if (child && child.getData && child.getData('isBetBackground')) {
				// Do NOT grey it out; just disable interaction so bet options cannot be opened.
				child.disableInteractive();
				const suffix = reason ? ` (${reason})` : '';
				console.log(`[SlotController] Bet background interaction disabled${suffix}`);
			}
		});
	}

	/**
	 * Re-enable interaction on the bet background that opens the bet options panel.
	 */
	private enableBetBackgroundInteraction(reason: string = ''): void {
		if (!this.controllerContainer) {
			return;
		}

		this.controllerContainer.iterate((child: any) => {
			if (child && child.getData && child.getData('isBetBackground')) {
				// Restore interaction only (keep original alpha as designed)
				child.setInteractive();
				const suffix = reason ? ` (${reason})` : '';
				console.log(`[SlotController] Bet background interaction re-enabled${suffix}`);
			}
		});
	}

	/**
	 * Prevent the free spin display from appearing until cleared.
	 * Also immediately hides the display if it is currently visible.
	 */
	public suppressFreeSpinDisplay(): void {
		this.freeSpinDisplaySuppressed = true;
		this.hideFreeSpinDisplay();
		console.log('[SlotController] Free spin display suppression enabled');
	}

	/**
	 * Allow the free spin display to appear again.
	 */
	public clearFreeSpinDisplaySuppression(): void {
		this.freeSpinDisplaySuppressed = false;
		console.log('[SlotController] Free spin display suppression cleared');
	}

	/**
	 * Set the symbols component reference
	 * This allows the SlotController to access free spin data from the Symbols component
	 */
	public setSymbols(symbols: Symbols): void {
		this.symbols = symbols;
		console.log('[SlotController] Symbols component reference set');
		
		// Update loading spinner position at center of symbols grid
		if (this.loadingSpinner && this.scene) {
			const centerX = this.scene.scale.width * 0.5 - 5;
			const centerY = this.scene.scale.height * 0.445; // Same as symbols center
			this.loadingSpinner.updatePosition(centerX, centerY);
			console.log('[SlotController] Loading spinner position updated to symbols center');
		}
	}

	/**
	 * Set the BuyFeature reference in the BuyFeature component
	 * This allows the BuyFeature to access current bet information
	 */
	public setBuyFeatureReference(): void {
		if (this.buyFeature) {
			this.buyFeature.setSlotController(this);
			console.log('[SlotController] BuyFeature reference set');
		}
	}

	preload(scene: Scene): void {
		// Assets are now loaded centrally through AssetConfig in Preloader
		console.log(`[SlotController] Assets loaded centrally through AssetConfig`);
	}

	create(scene: Scene): void {
		console.log("[SlotController] Creating controller elements");
		
		// Store scene reference for event listening
		this.scene = scene;
		
		// Initialize loading spinner at center of symbols grid
		const centerX = scene.scale.width * 0.5 - 5;
		const centerY = scene.scale.height * 0.445;
		this.loadingSpinner = new LoadingSpinner(scene, centerX, centerY);
		
		// Get GameData from the scene
		if (scene.scene.key === 'Game') {
			this.gameData = (scene as any).gameData;
			this.gameAPI = (scene as any).gameAPI;
		}
		
		// Create main container for all controller elements
		this.controllerContainer = scene.add.container(0, 0);
		// Apply a small downward offset to move the whole controller slightly down
		this.controllerVerticalOffset = scene.scale.height * 0.02;
		this.controllerContainer.setY(this.controllerVerticalOffset + 80);
		// Ensure controller UI renders above coin animations (800) but below dialogs (1000)
		this.controllerContainer.setDepth(900);
		
		const screenConfig = this.screenModeManager.getScreenConfig();
		const assetScale = this.networkManager.getAssetScale();
		
		console.log(`[SlotController] Creating controller with scale: ${assetScale}x`);

		// Add controller elements
		this.createControllerElements(scene, assetScale);
		
		// Create buy feature component
		if (this.buyFeature) {
			this.buyFeature.create(scene);
		}
		
		// Setup bonus mode event listener
		this.setupBonusModeEventListener();
		
		// Setup spin state change listener
		this.setupSpinStateListener();
		
		// No need to set initial spin button state here - will be handled when reels finish
	}

	private getTextStyle(): Phaser.Types.GameObjects.Text.TextStyle {
		return {
			fontSize: '10px',
			color: '#ffffff',
			fontFamily: 'poppins-regular'
		};
	}

	private createControllerElements(scene: Scene, assetScale: number): void {
		const screenConfig = this.screenModeManager.getScreenConfig();
		
		if (screenConfig.isPortrait) {
			this.createPortraitController(scene, assetScale);
		} else {
			this.createLandscapeController(scene, assetScale);
		}
	}

	/**
	 * Align a Spine object's visual bounds center to an anchor point.
	 */
	private alignSpineVisualCenter(spineObj: any, anchorX: number, anchorY: number): void {
		if (!spineObj) return;
		try {
			if (typeof spineObj.getBounds !== 'function') {
				spineObj.setPosition(anchorX, anchorY);
				return;
			}
			const bounds = spineObj.getBounds();
			if (!bounds?.offset || !bounds?.size) {
				spineObj.setPosition(anchorX, anchorY);
				return;
			}
			const centerX = bounds.offset.x + bounds.size.x * 0.5;
			const centerY = bounds.offset.y + bounds.size.y * 0.5;
			const scaleX = spineObj.scaleX ?? spineObj.scale ?? 1;
			const scaleY = spineObj.scaleY ?? spineObj.scale ?? 1;
			spineObj.x = anchorX - centerX * scaleX;
			spineObj.y = anchorY - centerY * scaleY;
		} catch (e) {
			console.warn('[SlotController] Failed to align spine visual center:', e);
			spineObj.setPosition(anchorX, anchorY);
		}
	}

	/** Shared spin-button anchor (hit zone / icon center). */
	private getSpinButtonAnchor(): { x: number; y: number } | null {
		if (this.spinHitZone) {
			return { x: this.spinHitZone.x, y: this.spinHitZone.y };
		}
		const spin = this.buttons.get('spin');
		if (!spin) return null;
		return { x: spin.x, y: spin.y };
	}

	/**
	 * Layout start_btn_spine + overlays on the shared anchor.
	 * Icons use origin 0.5 so they sit on the button center (+ UIPositionConfig offsets).
	 */
	private layoutSpinButtonStack(assetScale: number = this.spinButtonAssetScale): void {
		const anchor = this.getSpinButtonAnchor();
		if (!anchor) return;

		const spineX = anchor.x + SPIN_BUTTON_SPINE_OFFSET_X * assetScale;
		const spineY = anchor.y + SPIN_BUTTON_SPINE_OFFSET_Y * assetScale;
		if (this.spinButtonAnimation) {
			this.alignSpineVisualCenter(this.spinButtonAnimation, spineX, spineY);
		}
		if (this.freeRoundSpinButtonAnimation) {
			this.alignSpineVisualCenter(this.freeRoundSpinButtonAnimation, spineX, spineY);
			this.freeRoundSpinButtonAnimation.setScale(assetScale * FREEROUND_SPIN_VFX_SCALE_MODIFIER);
		}
		if (this.freeRoundSpinDisc) {
			this.freeRoundSpinDisc.setPosition(
				anchor.x + FREEROUND_SPIN_DISC_OFFSET_X * assetScale,
				anchor.y + FREEROUND_SPIN_DISC_OFFSET_Y * assetScale
			);
			this.freeRoundSpinDisc.setScale(assetScale * FREEROUND_SPIN_DISC_SCALE_MODIFIER);
		}
		if (this.spinIcon) {
			this.spinIcon.setPosition(
				anchor.x + SPIN_ICON_OFFSET_X * assetScale,
				anchor.y + SPIN_ICON_OFFSET_Y * assetScale
			);
		}
		if (this.autoplayStopIcon) {
			this.autoplayStopIcon.setPosition(
				anchor.x + AUTOPLAY_STOP_ICON_OFFSET_X * assetScale,
				anchor.y + AUTOPLAY_STOP_ICON_OFFSET_Y * assetScale
			);
		}
	}

	/** Bring overlays above the spine, then the hit zone on top for reliable clicks. */
	private bringSpinButtonStackToFront(): void {
		if (!this.primaryControllers) return;
		if (this.spinButtonAnimation) {
			this.primaryControllers.sendToBack(this.spinButtonAnimation);
		}
		if (this.freeRoundSpinDisc) {
			this.primaryControllers.sendToBack(this.freeRoundSpinDisc);
			if (this.spinButtonAnimation) {
				this.primaryControllers.sendToBack(this.spinButtonAnimation);
			}
		}
		if (this.freeRoundSpinButtonAnimation) {
			this.primaryControllers.bringToTop(this.freeRoundSpinButtonAnimation);
		}
		if (this.spinIcon) {
			this.primaryControllers.bringToTop(this.spinIcon);
		}
		if (this.autoplayStopIcon) {
			this.primaryControllers.bringToTop(this.autoplayStopIcon);
		}
		if (this.spinHitZone) {
			this.primaryControllers.bringToTop(this.spinHitZone);
		}
	}

	/** Idle pose for start_btn_spine: freeze `"animation"` at keyframe 0 (disc only). */
	private setStartBtnSpineIdle(spine: any = this.spinButtonAnimation): void {
		if (!spine?.animationState || !spine?.skeleton) return;
		try {
			const entry = spine.animationState.setAnimation(0, 'animation', false);
			spine.animationState.timeScale = 0;
			if (entry) {
				entry.trackTime = 0;
				entry.timeScale = 0;
			}
			spine.animationState.apply(spine.skeleton);
			spine.skeleton.updateWorldTransform(Physics.none);
		} catch (error) {
			console.warn('[SlotController] Failed to idle start_btn_spine:', error);
		}
	}

	/** Tint disc/spine parts only — never dim `spin_icon` (guide §6.9: input-only when disabled). */
	private applySpinButtonVisualTint(tint: number | null): void {
		const apply = (obj: any) => {
			if (!obj) return;
			try {
				if (tint == null) obj.clearTint?.();
				else obj.setTint?.(tint);
			} catch {}
		};
		apply(this.spinButtonAnimation);
		apply(this.freeRoundSpinDisc);
		apply(this.freeRoundSpinButtonAnimation);
		apply(this.autoplayStopIcon);
		// spin_icon intentionally excluded — stay full-bright and spinning while input is gated.
	}

	/**
	 * Continuous idle rotation for `spin_icon`.
	 * Must use relative `angle: '+=360'` — absolute `360` completes once and freezes (guide §6.7).
	 * Never call `tweens.killTweensOf(spinIcon)` from skip/reset paths; use this helper to re-arm.
	 */
	private ensureSpinIconIdleTween(scene: Scene | null = this.scene): void {
		if (!scene || !this.spinIcon || this.spinIcon.texture?.key !== 'spin_icon') return;
		if (!this.spinIcon.visible) return;
		try {
			if (this.spinIconTween?.isPlaying?.()) return;
			if (this.spinIconTween && !this.spinIconTween.isPlaying?.()) {
				try { this.spinIconTween.resume(); } catch {}
				if (this.spinIconTween?.isPlaying?.()) return;
			}
		} catch {}
		try { this.spinIconTween?.stop(); } catch {}
		this.spinIconTween = scene.tweens.add({
			targets: this.spinIcon,
			angle: '+=360',
			duration: 4000,
			repeat: -1,
			ease: 'Linear',
		});
	}

	/** Instant spin_icon ↔ autoplay_stop_icon swap (no alpha fade — guide §6.8). */
	private setSpinOverlayIconsImmediate(showStop: boolean): void {
		this.stopSpinIconSkipFadeTween();
		try { this.scene?.tweens.killTweensOf(this.autoplayStopIcon); } catch {}
		this.autoplayStopIconTween = null;

		if (showStop) {
			if (this.spinIcon) {
				this.spinIcon.setVisible(false);
				this.spinIcon.setAlpha(1);
			}
			try { this.spinIconTween?.pause(); } catch {}
			if (this.autoplayStopIcon) {
				this.autoplayStopIcon.setVisible(true);
				this.autoplayStopIcon.setAlpha(1);
				if (this.primaryControllers) {
					this.primaryControllers.bringToTop(this.autoplayStopIcon);
				}
			}
		} else {
			if (this.autoplayStopIcon) {
				this.autoplayStopIcon.setVisible(false);
				this.autoplayStopIcon.setAlpha(1);
			}
			if (this.spinIcon) {
				this.spinIcon.setVisible(true);
				this.spinIcon.setAlpha(1);
			}
			this.ensureSpinIconIdleTween();
		}
		this.bringSpinButtonStackToFront();
	}

	/**
	 * Non-rendering click zone. Never use an Image hit proxy — alpha 0 is ignored by
	 * Phaser input, and a failed/empty generated texture shows as __MISSING (green box).
	 */
	private createSpinHitZone(
		scene: Scene,
		x: number,
		y: number,
		assetScale: number
	): Phaser.GameObjects.Zone {
		// Destroy any leftover Image hit proxy from older builds / HMR.
		try {
			const prior = this.buttons.get('spin');
			if (prior && prior !== this.spinIcon && (prior as any).type === 'Image') {
				try { scene.tweens.killTweensOf(prior); } catch {}
				try { prior.destroy(); } catch {}
				this.buttons.delete('spin');
			}
		} catch {}

		// Sweep container for any visible __MISSING Image (old hit-proxy leftovers).
		try {
			const list = this.primaryControllers?.list ?? [];
			for (const child of [...list]) {
				const img = child as Phaser.GameObjects.Image;
				if (
					img &&
					(img as any).type === 'Image' &&
					img !== this.spinIcon &&
					img !== this.autoplayStopIcon &&
					img.texture?.key === '__MISSING'
				) {
					try { scene.tweens.killTweensOf(img); } catch {}
					try { img.destroy(); } catch {}
				}
			}
		} catch {}

		if (this.spinHitZone) {
			try { this.spinHitZone.destroy(); } catch {}
			this.spinHitZone = null;
		}

		const hitSize = SPIN_BUTTON_HIT_SIZE * assetScale;
		const zone = scene.add.zone(x, y, hitSize, hitSize).setOrigin(0.5, 0.5).setDepth(14);
		zone.on('pointerdown', async () => {
			console.log('[SlotController] Spin button clicked');
			await this.onSpinButtonActivated('pointer');
		});
		this.spinHitZone = zone;
		this.applySpinHitZoneInteractive(true);
		return zone;
	}


	/**
	 * Circular tap area matching the green spin disc.
	 * Hit-area space is the Zone's top-left box, so the circle is centered at (r, r).
	 */
	private applySpinHitZoneInteractive(enabled: boolean): void {
		const zone = this.spinHitZone;
		if (!zone) return;
		try {
			if (!enabled) {
				zone.disableInteractive();
				return;
			}
			const diameter = Math.max(1, zone.width || SPIN_BUTTON_HIT_SIZE * (this.spinButtonAssetScale || 1));
			const radius = diameter * 0.5;
			zone.disableInteractive();
			zone.setInteractive({
				hitArea: new Phaser.Geom.Circle(radius, radius, radius),
				hitAreaCallback: Phaser.Geom.Circle.Contains,
				useHandCursor: true,
			});
		} catch {
			/* noop */
		}
	}

	/** True when a texture key is loaded and is not Phaser's placeholder. */
	private isUsableTexture(scene: Scene, key: string): boolean {
		if (!key || key === '__MISSING') return false;
		if (!scene.textures.exists(key)) return false;
		try {
			const tex = scene.textures.get(key);
			if (!tex || tex.key === '__MISSING') return false;
			const src = tex.getSourceImage?.() as { width?: number; height?: number } | undefined;
			const w = src?.width ?? tex.source?.[0]?.width ?? 0;
			const h = src?.height ?? tex.source?.[0]?.height ?? 0;
			return w > 1 && h > 1;
		} catch {
			return false;
		}
	}

	private bindSpinOverlayPointer(target: Phaser.GameObjects.Image): void {
		target.setInteractive({ useHandCursor: true });
		target.on('pointerdown', async () => {
			console.log('[SlotController] Spin overlay clicked');
			await this.onSpinButtonActivated('pointer');
		});
	}

	/** Enable/disable spin hit zone + overlay click targets together. */
	private setSpinButtonInputEnabled(enabled: boolean): void {
		this.applySpinHitZoneInteractive(enabled);
		const targets: Array<{ setInteractive: Function; disableInteractive: Function } | null | undefined> = [
			this.spinIcon,
			this.autoplayStopIcon,
		];
		for (const target of targets) {
			if (!target) continue;
			try {
				if (enabled) target.setInteractive({ useHandCursor: true });
				else target.disableInteractive();
			} catch {}
		}
	}

	/**
	 * Centered rotating spin arrows. Only create once `spin_icon` is a real texture —
	 * creating early binds Phaser's green `__MISSING` placeholder permanently.
	 */
	private createSpinIconOverlay(
		scene: Scene,
		x: number,
		y: number,
		assetScale: number,
		scaleMult: number,
		retryAttempt: number = 0
	): void {
		if (this.spinIcon) {
			// Repair a stale __MISSING binding (HMR / race).
			if (this.spinIcon.texture?.key !== 'spin_icon' && this.isUsableTexture(scene, 'spin_icon')) {
				try { this.spinIcon.setTexture('spin_icon'); } catch {}
			}
			return;
		}

		if (!this.isUsableTexture(scene, 'spin_icon')) {
			if (retryAttempt === 0) {
				console.warn('[SlotController] spin_icon not ready — will retry overlay create');
			}
			if (retryAttempt < 40) {
				scene.time.delayedCall(100, () => {
					this.createSpinIconOverlay(scene, x, y, assetScale, scaleMult, retryAttempt + 1);
				});
			} else {
				console.error('[SlotController] spin_icon texture never became usable');
			}
			return;
		}

		const icon = scene.add
			.image(x, y, 'spin_icon')
			.setOrigin(0.5, 0.5)
			.setScale(assetScale * scaleMult)
			.setDepth(12)
			.setVisible(true)
			.setAlpha(1);

		if (icon.texture?.key !== 'spin_icon') {
			console.warn('[SlotController] spin_icon Image bound to', icon.texture?.key, '— destroying and retrying');
			try { icon.destroy(); } catch {}
			if (retryAttempt < 40) {
				scene.time.delayedCall(100, () => {
					this.createSpinIconOverlay(scene, x, y, assetScale, scaleMult, retryAttempt + 1);
				});
			}
			return;
		}

		this.spinIcon = icon;
		this.bindSpinOverlayPointer(this.spinIcon);
		this.primaryControllers?.add(this.spinIcon);
		this.buttons.set('spin', this.spinIcon);
		this.layoutSpinButtonStack(assetScale);
		this.bringSpinButtonStackToFront();
		this.ensureSpinIconIdleTween(scene);
		console.log('[SlotController] spin_icon overlay ready');
	}

	private createAutoplayStopIconOverlay(
		scene: Scene,
		x: number,
		y: number,
		assetScale: number,
		scaleMult: number,
		retryAttempt: number = 0
	): void {
		if (this.autoplayStopIcon) {
			if (
				this.autoplayStopIcon.texture?.key !== 'autoplay_stop_icon' &&
				this.isUsableTexture(scene, 'autoplay_stop_icon')
			) {
				try { this.autoplayStopIcon.setTexture('autoplay_stop_icon'); } catch {}
			}
			return;
		}

		if (!this.isUsableTexture(scene, 'autoplay_stop_icon')) {
			if (retryAttempt === 0) {
				console.warn('[SlotController] autoplay_stop_icon not ready — will retry');
			}
			if (retryAttempt < 40) {
				scene.time.delayedCall(100, () => {
					this.createAutoplayStopIconOverlay(scene, x, y, assetScale, scaleMult, retryAttempt + 1);
				});
			}
			return;
		}

		this.autoplayStopIcon = scene.add
			.image(x, y, 'autoplay_stop_icon')
			.setOrigin(0.5, 0.5)
			.setScale(assetScale * scaleMult)
			.setDepth(13)
			.setVisible(false)
			.setAlpha(1);
		this.bindSpinOverlayPointer(this.autoplayStopIcon);
		this.primaryControllers?.add(this.autoplayStopIcon);
		this.layoutSpinButtonStack(assetScale);
		this.bringSpinButtonStackToFront();
	}

	/**
	 * Create start_btn_spine as the spin-button disc (+ click FX).
	 * Idle = keyframe 0; press plays full `"animation"`, then returns to idle.
	 */
	private createSpinButtonAnimation(scene: Scene, assetScale: number): void {
		try {
			if (!ensureSpineFactory(scene, '[SlotController] createSpinButtonAnimation')) {
				console.warn('[SlotController] Spine factory not available yet; will retry spin button spine shortly');
				scene.time.delayedCall(250, () => this.createSpinButtonAnimation(scene, assetScale));
				return;
			}

			if (!scene.cache.json.has('spin_button_animation')) {
				console.warn('[SlotController] spin_button_animation spine assets not loaded yet, will retry later');
				scene.time.delayedCall(1000, () => this.createSpinButtonAnimation(scene, assetScale));
				return;
			}

			const anchor = this.getSpinButtonAnchor();
			if (!anchor) {
				console.warn('[SlotController] Spin button anchor not found, cannot position animation');
				return;
			}

			this.spinButtonAssetScale = assetScale;

			if (this.spinButtonAnimation) {
				try { this.spinButtonAnimation.destroy(); } catch {}
				this.spinButtonAnimation = null;
			}
			this.spinButtonPressPlaying = false;
			this.spinButtonPressListener = null;

			this.spinButtonAnimation = scene.add.spine(
				anchor.x,
				anchor.y,
				'spin_button_animation',
				'spin_button_animation-atlas'
			);
			this.spinButtonAnimation.setOrigin(0.5, 0.5);
			this.spinButtonAnimation.setScale(assetScale * SPIN_BUTTON_SPINE_SCALE_MODIFIER);
			this.spinButtonAnimation.setDepth(9);
			this.setStartBtnSpineIdle(this.spinButtonAnimation);
			this.spinButtonAnimation.setVisible(true);

			if (this.primaryControllers) {
				// Insert spine behind overlays / hit zone
				this.primaryControllers.addAt(this.spinButtonAnimation, 0);
			} else {
				this.controllerContainer.add(this.spinButtonAnimation);
			}

			// Free-round stack: freeround_bg disc (idle) + Button_Bonus_Buttom VFX (on press).
			this.ensureFreeRoundSpinDisc(scene, assetScale);
			if (scene.cache.json.has('fr_spin_button_animation')) {
				try {
					if (this.freeRoundSpinButtonAnimation) {
						try { this.freeRoundSpinButtonAnimation.destroy(); } catch {}
						this.freeRoundSpinButtonAnimation = null;
					}
					this.freeRoundSpinButtonAnimation = scene.add.spine(
						anchor.x,
						anchor.y,
						'fr_spin_button_animation',
						'fr_spin_button_animation-atlas'
					);
					this.freeRoundSpinButtonAnimation.setOrigin(0.5, 0.5);
					this.freeRoundSpinButtonAnimation.setScale(assetScale * FREEROUND_SPIN_VFX_SCALE_MODIFIER);
					this.freeRoundSpinButtonAnimation.setDepth(11);
					this.freeRoundSpinButtonAnimation.setVisible(false);

					if (this.primaryControllers) {
						this.primaryControllers.addAt(this.freeRoundSpinButtonAnimation, 1);
					} else {
						this.controllerContainer.add(this.freeRoundSpinButtonAnimation);
					}
				} catch (e) {
					console.warn('[SlotController] Failed to create free-round spin button animation:', e);
					this.freeRoundSpinButtonAnimation = null;
				}
			}

			this.layoutSpinButtonStack(assetScale);
			this.bringSpinButtonStackToFront();
			if (this.freeRoundSpinVisualsActive) {
				this.setFreeRoundSpinButtonVisuals(true);
			}
			console.log('[SlotController] start_btn_spine ready');
		} catch (error) {
			console.error('[SlotController] Error creating Spine button animation:', error);
		}
	}

	/**
	 * Create the autoplay button spine animation
	 */
	private createAutoplayButtonAnimation(scene: Scene, assetScale: number): void {
		try {
			if (!ensureSpineFactory(scene, '[SlotController] createAutoplayButtonAnimation')) {
				console.warn('[SlotController] Spine factory not available yet; will retry autoplay spine shortly');
				scene.time.delayedCall(250, () => this.createAutoplayButtonAnimation(scene, assetScale));
				return;
			}

			// Check if the spine assets are loaded
			if (!scene.cache.json.has('button_animation_idle')) {
				console.warn('[SlotController] button_animation_idle spine assets not loaded yet, will retry later');
				// Set up a retry mechanism
				scene.time.delayedCall(1000, () => {
					this.createAutoplayButtonAnimation(scene, assetScale);
				});
				return;
			}

			// Get the autoplay button position to place the animation at the same location
			const autoplayButton = this.buttons.get('autoplay');
			if (!autoplayButton) {
				console.warn('[SlotController] Autoplay button not found, cannot position animation');
				return;
			}

			// Create spine animation at the same position as the autoplay button
			// Following the exact same pattern as kobi-ass animation in Header.ts
			this.autoplayButtonAnimation = scene.add.spine(
				autoplayButton.x - 4, 
				autoplayButton.y - 26, 
				"button_animation_idle", 
				"button_animation_idle-atlas"
			);
			
			// Set properties following the same pattern as kobi-ass
			this.autoplayButtonAnimation.setOrigin(0.5, 0.5);
			this.autoplayButtonAnimation.setScale(assetScale * 0.16); // Same scale as autoplay button
			this.autoplayButtonAnimation.setDepth(11); // Above the autoplay button
			
			// Set animation speed to 1.3x (same as spin button)
			this.autoplayButtonAnimation.animationState.timeScale = 1;
			
			// Initially hide the animation
			this.autoplayButtonAnimation.setVisible(false);
			
			// Add to the primary controllers container so it gets disabled/enabled with other controls
			this.primaryControllers.add(this.autoplayButtonAnimation);
			
			console.log('[SlotController] Autoplay button spine animation created successfully with 1.3x speed');
		} catch (error) {
			console.error('[SlotController] Error creating Spine autoplay button animation:', error);
		}
	}

	/**
	 * Create the turbo button spine animation
	 */
	private createTurboButtonAnimation(scene: Scene, assetScale: number): void {
		try {
			if (!ensureSpineFactory(scene, '[SlotController] createTurboButtonAnimation')) {
				console.warn('[SlotController] Spine factory not available yet; will retry turbo spine shortly');
				scene.time.delayedCall(250, () => this.createTurboButtonAnimation(scene, assetScale));
				return;
			}

			// Check if the spine assets are loaded
			if (!scene.cache.json.has('turbo_animation')) {
				console.warn('[SlotController] turbo_animation spine assets not loaded yet, will retry later');
				// Set up a retry mechanism
				scene.time.delayedCall(1000, () => {
					this.createTurboButtonAnimation(scene, assetScale);
				});
				return;
			}

			// Get the turbo button position to place the animation at the same location
			const turboButton = this.buttons.get('turbo');
			if (!turboButton) {
				console.warn('[SlotController] Turbo button not found, cannot position animation');
				return;
			}

			// Create spine animation at the same position as the turbo button
			// Following the exact same pattern as kobi-ass animation in Header.ts
			this.turboButtonAnimation = scene.add.spine(
				turboButton.x, 
				turboButton.y + 7, 
				"turbo_animation", 
				"turbo_animation-atlas"
			);
			
			// Set properties following the same pattern as kobi-ass
			this.turboButtonAnimation.setOrigin(0.5, 0.5);
			this.turboButtonAnimation.setScale(assetScale * 1); // Same scale as turbo button
			this.turboButtonAnimation.setDepth(11); // Above the turbo button
			
			// Set animation speed to 1.3x (same as spin button)
			this.turboButtonAnimation.animationState.timeScale = 1;
			
			// Initially hide the animation
			this.turboButtonAnimation.setVisible(false);
			
			// Add to the primary controllers container so it gets disabled/enabled with other controls
			this.primaryControllers.add(this.turboButtonAnimation);
			
			console.log('[SlotController] Turbo button spine animation created successfully with 1.3x speed');
		} catch (error) {
			console.error('[SlotController] Error creating Spine turbo button animation:', error);
		}
	}

	/**
	 * Create the autoplay spins remaining text
	 */
	private createAutoplaySpinsRemainingText(scene: Scene, assetScale: number): void {
		// Get the spin button position to place the text at the same location
		const spinButton = this.buttons.get('spin');
		if (!spinButton) {
			console.warn('[SlotController] Spin button not found, cannot position autoplay spins text');
			return;
		}

		// Create text element positioned at the same location as the spin button
		this.autoplaySpinsRemainingText = scene.add.text(
			spinButton.x,
			spinButton.y,
			'0',
			{
				fontSize: '24px',
				color: '#ffffff',
				fontFamily: 'poppins-regular',
				stroke: '#379557',
				strokeThickness: 4
			}
		);
		
		// Set properties
		this.autoplaySpinsRemainingText.setOrigin(0.5, 0.5);
		this.autoplaySpinsRemainingText.setDepth(20); // Ensure above spin button, spin icon, and stop icon
		
		// Initially hide the text (only show when autoplay is active)
		this.autoplaySpinsRemainingText.setVisible(false);
		
		// Add to the primary controllers container so it gets disabled/enabled with other controls
		this.primaryControllers.add(this.autoplaySpinsRemainingText);
		// Ensure it's on top within the container ordering
		this.primaryControllers.bringToTop(this.autoplaySpinsRemainingText);
		
		console.log('[SlotController] Autoplay spins remaining text created successfully');
	}

	/**
	 * Show the autoplay spins remaining text
	 */
	private showAutoplaySpinsRemainingText(): void {
		if (this.autoplaySpinsRemainingText) {
			this.autoplaySpinsRemainingText.setVisible(true);
			if (this.primaryControllers) {
				this.primaryControllers.bringToTop(this.autoplaySpinsRemainingText);
			}
			console.log('[SlotController] Autoplay spins remaining text shown');
		}
	}

	/**
	 * Hide the autoplay spins remaining text
	 */
	private hideAutoplaySpinsRemainingText(): void {
		if (this.autoplaySpinsRemainingText) {
			this.autoplaySpinsRemainingText.setVisible(false);
			console.log('[SlotController] Autoplay spins remaining text hidden');
		}
	}

	/**
	 * Disable bet buttons (grey out and disable interaction)
	 */
	private disableBetButtons(): void {
		const decreaseBetButton = this.buttons.get('decrease_bet');
		const increaseBetButton = this.buttons.get('increase_bet');

		// IMPORTANT: keep the buttons interactive even when "disabled" so they still
		// block pointer events from falling through to the bet background (which opens
		// the bet options panel). The pointer handlers will no-op while disabled.
		this.setBetButtonEnabled(decreaseBetButton, false);
		this.setBetButtonEnabled(increaseBetButton, false);
		console.log('[SlotController] Bet +/- buttons disabled (interactive, but no-op)');
	}

	/**
	 * Enable bet buttons (restore opacity and enable interaction)
	 */
	private enableBetButtons(): void {
		if (this.isInitializationFreeRoundActive()) {
			this.applyFreeRoundIdleControlState();
			return;
		}
		if (this.shouldKeepBaseControlsLocked()) {
			this.disableBetButtons();
			return;
		}

		const decreaseBetButton = this.buttons.get('decrease_bet');
		const increaseBetButton = this.buttons.get('increase_bet');

		this.setBetButtonEnabled(decreaseBetButton, true);
		this.setBetButtonEnabled(increaseBetButton, true);
		console.log('[SlotController] Bet +/- buttons enabled');

		// After generic enable, apply min/max limit greying based on current bet
		const currentBaseBet = this.getBaseBetAmount() || 0.2;
		this.updateBetLimitButtons(currentBaseBet);
	}

	/**
	 * Set bet button enabled/disabled state while keeping it interactive to block clicks.
	 * This prevents clicks from falling through to the bet background (which opens bet options).
	 */
	private setBetButtonEnabled(button: Phaser.GameObjects.Image | undefined, enabled: boolean): void {
		if (!button) return;

		button.setAlpha(enabled ? 1.0 : 0.3);
		// Keep interactive for hit-testing so disabled +/- buttons still block pointer
		// events from falling through to the bet background (which opens bet options).
		if (!button.input) {
			button.setInteractive();
		}
		button.setData('disabled', !enabled);
	}

	/**
	 * Get the bet ladder levels used for +/- bet adjustments.
	 * Keep this in sync with BetOptions.ts.
	 */
	public getBetLevels(): number[] {
		return this.gameData?.betLevels?.length ? this.gameData.betLevels : [
			0.2, 0.4, 0.6, 0.8, 1,
			1.2, 1.6, 2, 2.4, 2.8,
			3.2, 3.6, 4, 5, 6,
			8, 10, 14, 18, 24,
			32, 40, 60, 80, 100,
			110, 120, 130, 140, 150
		];
	}

	/**
	 * Grey out and disable the bet +/- buttons when the current bet
	 * is at the minimum or maximum level in the bet ladder.
	 */
	private updateBetLimitButtons(currentBet: number): void {
		const decreaseBetButton = this.buttons.get('decrease_bet');
		const increaseBetButton = this.buttons.get('increase_bet');

		// If buttons are not created yet, nothing to update
		if (!decreaseBetButton && !increaseBetButton) {
			return;
		}

		const betLevels = this.getBetLevels();

		// Find the closest bet level index to the current bet
		let idx = 0;
		let bestDiff = Number.POSITIVE_INFINITY;
		for (let i = 0; i < betLevels.length; i++) {
			const diff = Math.abs(betLevels[i] - currentBet);
			if (diff < bestDiff) {
				bestDiff = diff;
				idx = i;
			}
		}

		const isAtMin = idx === 0;
		const isAtMax = idx === betLevels.length - 1;

		// Update decrease bet button state
		if (isAtMin) {
			this.setBetButtonEnabled(decreaseBetButton, false);
			console.log('[SlotController] Decrease bet button greyed out at minimum bet');
		} else {
			this.setBetButtonEnabled(decreaseBetButton, true);
			console.log('[SlotController] Decrease bet button enabled (above minimum bet)');
		}

		// Update increase bet button state
		if (isAtMax) {
			this.setBetButtonEnabled(increaseBetButton, false);
			console.log('[SlotController] Increase bet button greyed out at maximum bet');
		} else {
			this.setBetButtonEnabled(increaseBetButton, true);
			console.log('[SlotController] Increase bet button enabled (below maximum bet)');
		}
	}

	/** Whether buy feature must stay non-interactive (spin/tumble, bonus, autoplay, amplify, etc.). */
	private isBuyFeatureInteractionBlocked(): boolean {
		if (!this.canEnableFeatureButton) {
			return true;
		}
		if (this.shouldLockAuxiliaryControls()) {
			return true;
		}
		if (this.manualSpinClickInFlight) {
			return true;
		}
		if (this.isAutoplaySpinControlActive()) {
			return true;
		}
		if (this.pausedAutoplaySpinsRemaining > 0) {
			return true;
		}
		const gameData = this.getGameData();
		if (gameData?.isEnhancedBet) {
			return true;
		}
		return false;
	}

	/**
	 * Disable feature button (grey out and disable interaction)
	 */
	private disableFeatureButton(): void {
		const desiredAlpha = 0.3;

		if (this.featureButtonHitbox) {
			this.featureButtonHitbox.disableInteractive(); // Disable clicking
			console.log('[SlotController] Feature button disabled');
		}

		if (this.featureImage) {
			this.featureImage.setAlpha(desiredAlpha);
		}

		if (this.featureLabelContainer) {
			this.featureLabelContainer.setAlpha(desiredAlpha);
		}
		this.featureLabelText?.setAlpha(desiredAlpha);
		this.featureAmountText?.setAlpha(desiredAlpha);
		this.featureDollarText?.setAlpha(desiredAlpha);
	}

	/**
	 * Enable feature button (restore opacity and enable interaction)
	 */
	private enableFeatureButton(): void {
		const desiredAlpha = 1.0;

		if (this.featureButtonHitbox) {
			if (this.isBuyFeatureInteractionBlocked()) {
				console.log('[SlotController] Skipping feature enable (spin/tumble/autoplay/bonus lock active)');
				return;
			}
			this.featureButtonHitbox.setInteractive(); // Re-enable clicking
			console.log('[SlotController] Feature button enabled');
		}

		if (this.featureImage) {
			this.featureImage.setAlpha(desiredAlpha);
		}

		if (this.featureLabelContainer) {
			this.featureLabelContainer.setAlpha(desiredAlpha);
		}
		this.featureLabelText?.setAlpha(desiredAlpha);
		this.featureAmountText?.setAlpha(desiredAlpha);
		this.featureDollarText?.setAlpha(desiredAlpha);
	}

	/**
	 * Update the autoplay spins remaining text
	 */
	private updateAutoplaySpinsRemainingText(spinsRemaining: number): void {
		if (this.autoplaySpinsRemainingText) {
			this.autoplaySpinsRemainingText.setText(spinsRemaining.toString());
			if (this.primaryControllers) {
				this.primaryControllers.bringToTop(this.autoplaySpinsRemainingText);
			}
			console.log(`[SlotController] Autoplay spins remaining text updated to: ${spinsRemaining}`);
		}
	}

	/**
	 * Bounce the autoplay spins remaining text
	 */
	private bounceAutoplaySpinsRemainingText(): void {
		if (!this.autoplaySpinsRemainingText || !this.scene) {
			return;
		}

		try {
			// Create a bounce animation sequence
			this.scene.tweens.add({
				targets: this.autoplaySpinsRemainingText,
				scaleX: 1.45,
				scaleY: 1.45,
				duration: 100,
				ease: 'Power2',
				yoyo: true,
				onComplete: () => {
					// Reset to original scale
					this.autoplaySpinsRemainingText.setScale(1, 1);
					console.log('[SlotController] Autoplay spins remaining text bounce completed');
				}
			});
			
			console.log('[SlotController] Autoplay spins remaining text bounce started');
		} catch (error) {
			console.error('[SlotController] Error bouncing autoplay spins remaining text:', error);
		}
	}

	/**
	 * Play the autoplay button animation once per spin
	 */
	private playAutoplayAnimation(): void {
		// Ensure the animation exists
		this.ensureAutoplayAnimationExists();
		
		if (!this.autoplayButtonAnimation) {
			console.warn('[SlotController] Autoplay button animation not available');
			return;
		}

		try {
			// Show the animation
			this.autoplayButtonAnimation.setVisible(true);
			
			// Play animation once following the same pattern as spin button
			this.autoplayButtonAnimation.animationState.setAnimation(0, "animation", false);
			
			// Listen for animation completion to hide it
			this.autoplayButtonAnimation.animationState.addListener({
				complete: (entry: any) => {
					if (entry.animation.name === "animation") {
						this.autoplayButtonAnimation.setVisible(false);
					}
				}
			});
			
			console.log('[SlotController] Autoplay button spine animation played once');
		} catch (error) {
			console.error('[SlotController] Error playing autoplay button animation:', error);
			// Hide the animation if there's an error
			if (this.autoplayButtonAnimation) {
				this.autoplayButtonAnimation.setVisible(false);
			}
		}
	}

	/**
	 * Start the autoplay button animation (looping)
	 */
	private startAutoplayAnimation(): void {
		// Ensure the animation exists
		this.ensureAutoplayAnimationExists();
		
		if (!this.autoplayButtonAnimation) {
			console.warn('[SlotController] Autoplay button animation not available');
			return;
		}

		try {
			// Show the animation
			this.autoplayButtonAnimation.setVisible(true);
			
			// Start looping animation following the same pattern as kobi-ass
			// Use animationState.setAnimation with loop = true for continuous looping
			this.autoplayButtonAnimation.animationState.setAnimation(0, "animation", true);
			
			console.log('[SlotController] Autoplay button spine animation started (looping)');
		} catch (error) {
			console.error('[SlotController] Error starting autoplay button animation:', error);
		}
	}

	/**
	 * Stop the autoplay button animation
	 */
	private stopAutoplayAnimation(): void {
		if (!this.autoplayButtonAnimation) {
			console.warn('[SlotController] Autoplay button animation not available');
			return;
		}

		try {
			// Hide the animation
			this.autoplayButtonAnimation.setVisible(false);
			
			// Stop the animation
			this.autoplayButtonAnimation.animationState.clearTracks();
			
			console.log('[SlotController] Autoplay button spine animation stopped');
		} catch (error) {
			console.error('[SlotController] Error stopping autoplay button animation:', error);
		}
	}

	/**
	 * Ensure the autoplay animation exists and recreate if needed
	 */
	private ensureAutoplayAnimationExists(): void {
		if (!this.autoplayButtonAnimation && this.scene) {
			console.log('[SlotController] Autoplay animation not found, recreating...');
			const screenConfig = this.screenModeManager.getScreenConfig();
			const assetScale = this.networkManager.getAssetScale();
			this.createAutoplayButtonAnimation(this.scene, assetScale);
		}
	}

	/**
	 * Play the spin button spine press FX once through to the end.
	 * Spam clicks are ignored while a press is already playing (no reset/cut).
	 */
	private playSpinButtonAnimation(): void {
		const isInFreeRoundSpins =
			this.freeRoundSpinVisualsActive ||
			(gameStateManager as any)?.isInFreeSpinRound === true;

		const targetAnimation = isInFreeRoundSpins && this.freeRoundSpinButtonAnimation
			? this.freeRoundSpinButtonAnimation
			: this.spinButtonAnimation;

		if (!targetAnimation?.animationState) {
			console.warn('[SlotController] Spin button animation not available (no default or free-round animation)');
			return;
		}

		// Hard lock: once started, play until complete — spam must not call setAnimation again.
		if (this.spinButtonPressPlaying) {
			return;
		}

		const isStartBtn = targetAnimation === this.spinButtonAnimation;
		const animationName = isStartBtn ? 'animation' : 'Button_Bonus_Bottom';

		try {
			if (isStartBtn) {
				if (this.freeRoundSpinButtonAnimation) {
					this.freeRoundSpinButtonAnimation.setVisible(false);
				}
				if (this.freeRoundSpinDisc) {
					this.freeRoundSpinDisc.setVisible(false);
				}
			} else {
				if (this.spinButtonAnimation) {
					this.spinButtonAnimation.setVisible(false);
				}
				if (this.freeRoundSpinDisc) {
					this.freeRoundSpinDisc.setVisible(true);
				}
			}

			targetAnimation.setVisible(true);

			if (this.spinButtonPressListener) {
				try { this.spinButtonAnimation?.animationState?.removeListener?.(this.spinButtonPressListener); } catch {}
				try { this.freeRoundSpinButtonAnimation?.animationState?.removeListener?.(this.spinButtonPressListener); } catch {}
				this.spinButtonPressListener = null;
			}

			this.spinButtonPressPlaying = true;
			const token = ++this.spinButtonPressToken;

			targetAnimation.animationState.timeScale = 1;
			const trackEntry: any = targetAnimation.animationState.setAnimation(0, animationName, false);
			if (trackEntry) {
				trackEntry.timeScale = 1;
				try {
					const animData = (targetAnimation as any)?.skeleton?.data?.findAnimation?.(animationName);
					const duration: number | undefined = animData?.duration;
					if (typeof duration === 'number' && duration > 0.01) {
						trackEntry.animationEnd = Math.max(0, duration - 0.01);
					}
				} catch (e) {
					console.warn('[SlotController] Failed to clamp spin button animationEnd:', e);
				}
			}

			const finishPress = () => {
				if (token !== this.spinButtonPressToken) return;
				this.spinButtonPressPlaying = false;
				if (this.spinButtonPressListener) {
					try { targetAnimation.animationState.removeListener(this.spinButtonPressListener); } catch {}
					this.spinButtonPressListener = null;
				}
				if (isStartBtn) {
					this.setStartBtnSpineIdle(targetAnimation);
				} else {
					targetAnimation.setVisible(false);
					if (this.freeRoundSpinDisc && this.freeRoundSpinVisualsActive) {
						this.freeRoundSpinDisc.setVisible(true);
					}
				}
			};

			const listener = {
				complete: (entry: any) => {
					if (token !== this.spinButtonPressToken) return;
					if (!entry || entry.animation?.name !== animationName) return;
					finishPress();
				},
			} as any;
			this.spinButtonPressListener = listener;
			targetAnimation.animationState.addListener(listener);

			// Safety: if complete never fires, unlock after duration so the button isn't stuck.
			try {
				const animData = (targetAnimation as any)?.skeleton?.data?.findAnimation?.(animationName);
				const duration = typeof animData?.duration === 'number' ? animData.duration : 0.8;
				this.scene?.time.delayedCall(Math.ceil((duration + 0.15) * 1000), () => {
					if (token === this.spinButtonPressToken && this.spinButtonPressPlaying) {
						finishPress();
					}
				});
			} catch {}

			console.log('[SlotController] Spin button spine animation played');
		} catch (error) {
			this.spinButtonPressPlaying = false;
			console.error('[SlotController] Error playing Spine button animation:', error);
			if (this.freeRoundSpinVisualsActive) {
				if (this.spinButtonAnimation) this.spinButtonAnimation.setVisible(false);
				if (this.freeRoundSpinDisc) this.freeRoundSpinDisc.setVisible(true);
				if (this.freeRoundSpinButtonAnimation) this.freeRoundSpinButtonAnimation.setVisible(false);
			} else {
				if (this.spinButtonAnimation) {
					this.setStartBtnSpineIdle(this.spinButtonAnimation);
					this.spinButtonAnimation.setVisible(true);
				}
				if (this.freeRoundSpinButtonAnimation) {
					this.freeRoundSpinButtonAnimation.setVisible(false);
				}
				if (this.freeRoundSpinDisc) {
					this.freeRoundSpinDisc.setVisible(false);
				}
			}
		}
	}

	/**
	 * Rotate the spin button clockwise
	 */
	/** Visual/audio feedback for any spin button tap (including no-op taps during an active spin). */
	private playSpinButtonClickFeedback(): void {
		this.playSpinButtonAnimation();
		this.rotateSpinButton();
		try {
			if ((window as any).audioManager) {
				(window as any).audioManager.playSoundEffect(SoundEffectType.MENU_CLICK);
			}
		} catch {}
	}

	private rotateSpinButton(): void {
		// Disc is Spine; only rotate the spin_icon overlay (never the hit Zone / leftover Images).
		const target = this.spinIcon;
		if (!target || target.texture?.key !== 'spin_icon') {
			console.warn('[SlotController] spin_icon not ready for rotation');
			return;
		}

		try {
			if (this.spinIconTween) {
				try { this.spinIconTween.pause(); } catch {}
			}
			this.scene?.tweens.add({
				targets: target,
				angle: '+=360',
				duration: 500,
				ease: 'Power2',
				onComplete: () => {
					this.ensureSpinIconIdleTween();
					console.log('[SlotController] Spin button rotation completed');
				}
			});
			console.log('[SlotController] Spin button rotation started');
		} catch (error) {
			console.error('[SlotController] Error rotating spin button:', error);
		}
	}

	private createPortraitController(scene: Scene, assetScale: number): void {
		console.log("[SlotController] Creating portrait controller layout");
		
		// Create primary controllers container
		this.primaryControllers = scene.add.container(0, 0);
		this.controllerContainer.add(this.primaryControllers);
		
		// Create vertical buttons on the right side
		const middleRef = scene.scale.height * 0.82;
		const buttonSpacing = 80;
		
		// Spin button: Zone hit + spin_icon / autoplay_stop overlays.
		// Visual disc is start_btn_spine (created later in createSpinButtonAnimation).
		this.spinButtonAssetScale = assetScale;
		const spinX = scene.scale.width * 0.5;
		const spinY = middleRef;
		this.createSpinHitZone(scene, spinX, spinY, assetScale);
		this.createSpinIconOverlay(scene, spinX, spinY, assetScale, 1.2);
		this.createAutoplayStopIconOverlay(scene, spinX, spinY, assetScale, 0.45);

		// Keep an Image in the buttons map for legacy callers (position / has checks).
		if (this.spinIcon) {
			this.buttons.set('spin', this.spinIcon);
		}
		if (this.spinHitZone) {
			this.primaryControllers.add(this.spinHitZone);
		}
		this.layoutSpinButtonStack(assetScale);
		this.bringSpinButtonStackToFront();

		// Turbo button
		const turboButton = scene.add.image(
			scene.scale.width * 0.9,
			middleRef + 5,
			'turbo_off'
		).setOrigin(0.5, 0.5).setScale(assetScale).setDepth(10);
		turboButton.setInteractive();
		turboButton.on('pointerdown', () => {
			console.log('[SlotController] Turbo button clicked');
			this.handleTurboButtonClick();
		});
		this.buttons.set('turbo', turboButton);
		this.primaryControllers.add(turboButton);

		// Turbo text label
		const turboText = scene.add.text(
			scene.scale.width * 0.9,
			middleRef + 5 + (turboButton.displayHeight * 0.5) + 15,
			this.getControllerText(COMMON_TURBO),
			this.getTextStyle()
		).setOrigin(0.5, 0.5).setDepth(10);
		this.controllerContainer.add(turboText);
		this.controllerTexts.push(turboText);

		// Amplify button
		const amplifyButton = scene.add.image(
			scene.scale.width * 0.73,
			middleRef,
			'amplify'
		).setOrigin(0.5, 0.5).setScale(assetScale).setDepth(10);
		amplifyButton.setInteractive();
		amplifyButton.on('pointerdown', () => {
			console.log('[SlotController] Amplify button clicked');
			this.handleAmplifyButtonClick();
		});
		this.buttons.set('amplify', amplifyButton);
		this.primaryControllers.add(amplifyButton);

		// Amplify text label
		const amplifyText = scene.add.text(
			scene.scale.width * 0.73,
			middleRef + (amplifyButton.displayHeight * 0.5) + 15,
			this.getControllerText(CONTROLLER_AMPLIFY_BET),
			this.getTextStyle()
		).setOrigin(0.5, 0.5).setDepth(10);
		this.controllerContainer.add(amplifyText);
		this.controllerTexts.push(amplifyText);

		// Amplify description container
		this.createAmplifyDescription(scene, assetScale);

		// Autoplay button
		const autoplayButton = scene.add.image(
			scene.scale.width * 0.27,
			middleRef,
			'autoplay_off'
		).setOrigin(0.5, 0.5).setScale(assetScale).setDepth(10);
		autoplayButton.setInteractive();
		autoplayButton.on('pointerdown', () => {
			console.log('[SlotController] Autoplay button clicked');
			this.handleAutoplayButtonClick();
		});
		this.buttons.set('autoplay', autoplayButton);
		this.primaryControllers.add(autoplayButton);

		// Autoplay text label
		const autoplayText = scene.add.text(
			scene.scale.width * 0.27,
			middleRef + (autoplayButton.displayHeight * 0.5) + 15,
			this.getControllerText(CONTROLLER_AUTOPLAY),
			this.getTextStyle()
		).setOrigin(0.5, 0.5).setDepth(10);
		this.controllerContainer.add(autoplayText);
		this.controllerTexts.push(autoplayText);

		// Menu button
		const menuButton = scene.add.image(
			scene.scale.width * 0.1,
			middleRef + 5,
			'menu'
		).setOrigin(0.5, 0.5).setScale(assetScale).setDepth(10);
		menuButton.setInteractive();
		menuButton.on('pointerdown', () => {
			console.log('[SlotController] Menu button clicked');
			EventBus.emit('menu');
		});
		this.buttons.set('menu', menuButton);
		this.primaryControllers.add(menuButton);

		// Menu text label
		const menuText = scene.add.text(
			scene.scale.width * 0.1,
			middleRef + 5 + (menuButton.displayHeight * 0.5) + 15,
			this.getControllerText(CONTROLLER_MENU),
			this.getTextStyle()
		).setOrigin(0.5, 0.5).setDepth(10);
		this.controllerContainer.add(menuText);
		this.controllerTexts.push(menuText);

		// Balance display container
		this.createBalanceDisplay(scene, assetScale);

		// Scratch card toggle (above balance)
		this.createScratchCardButton(scene, assetScale);

		// Bet display container
		this.createBetDisplay(scene, assetScale);
		
		// Feature button container
		this.createFeatureButton(scene, assetScale);
		
		// Free spin display container
		this.createFreeSpinDisplay(scene, assetScale);
		
		// Create the spin button animation
		this.createSpinButtonAnimation(scene, assetScale);
		
		// Create the autoplay button animation
		this.createAutoplayButtonAnimation(scene, assetScale);
		
		// Create the turbo button animation
		this.createTurboButtonAnimation(scene, assetScale);
		
		// Create the autoplay spins remaining text
		this.createAutoplaySpinsRemainingText(scene, assetScale);
		
		// Initialize amplify button state
		this.initializeAmplifyButtonState();
	}

	private createAmplifyDescription(scene: Scene, assetScale: number): void {
		// Position for amplify description (above amplify button)
		const amplifyX = scene.scale.width * 0.73;
		const amplifyY = scene.scale.height * 0.833;
		const descriptionX = amplifyX;
		const descriptionY = amplifyY - 50; // Higher than amplify button
		const containerWidth = 90;
		const containerHeight = 30;
		const cornerRadius = 8;

		// Create container for amplify description elements
		this.amplifyDescriptionContainer = scene.add.container(0, 0);

		// Create rounded rectangle background with green outline
		const descriptionBg = scene.add.graphics();
		descriptionBg.fillStyle(0x000000, 0.65); // Dark background
		descriptionBg.fillRoundedRect(
			descriptionX - containerWidth / 2,
			descriptionY - containerHeight / 2,
			containerWidth,
			containerHeight,
			cornerRadius
		);
		descriptionBg.lineStyle(1, 0x00ff00, 1); // Green outline
		descriptionBg.strokeRoundedRect(
			descriptionX - containerWidth / 2,
			descriptionY - containerHeight / 2,
			containerWidth,
			containerHeight,
			cornerRadius
		);
		descriptionBg.setDepth(8);
		this.amplifyDescriptionContainer.add(descriptionBg);

		// "Double Chance" label (1st line)
		const descriptionLabel1 = scene.add.text(
			descriptionX,
			descriptionY - 5,
			this.getControllerText(CONTROLLER_DOUBLE_CHANCE),
			{
				fontSize: '9px',
				color: '#ffffff', // Green color
				fontFamily: 'poppins-regular'
			}
		).setOrigin(0.5, 0.5).setDepth(9);
		this.amplifyDescriptionContainer.add(descriptionLabel1);

		// "For Feature" label (2nd line)
		const descriptionLabel2 = scene.add.text(
			descriptionX,
			descriptionY + 6,
			this.getControllerText(CONTROLLER_FOR_FEATURE),
			{
				fontSize: '9px',
				color: '#ffffff', // White color
				fontFamily: 'poppins-regular'
			}
		).setOrigin(0.5, 0.5).setDepth(9);
		this.amplifyDescriptionContainer.add(descriptionLabel2);

		// Add the container to the main controller container
		this.controllerContainer.add(this.amplifyDescriptionContainer);
	}

	private createBalanceDisplay(scene: Scene, assetScale: number): void {
		// Position for balance display (top center)
		const balanceX = scene.scale.width * 0.19;
		const balanceY = scene.scale.height * 0.724;
		const containerWidth = 125;
		const containerHeight = 55;
		const cornerRadius = 10;
		// Demo mode: hide currency symbol and keep the value centered
		const isDemoBalance =
			this.gameAPI?.getDemoState() ||
			sessionStorage.getItem('demo') === 'true';

		// Create rounded rectangle background
		const balanceBg = scene.add.graphics();
		balanceBg.fillStyle(0x000000, 0.65); // Dark gray with 80% alpha
		balanceBg.fillRoundedRect(
			balanceX - containerWidth / 2,
			balanceY - containerHeight / 2,
			containerWidth,
			containerHeight,
			cornerRadius
		);
		balanceBg.setDepth(8);
		this.controllerContainer.add(balanceBg);

		// Create container for balance label parts
		this.balanceLabelContainer = scene.add.container(balanceX, balanceY - 8);
		this.balanceLabelContainer.setDepth(9);
		
		const balanceText = this.getControllerText(COMMON_BALANCE).toUpperCase();
		const currencyCode = isDemoBalance ? '' : CurrencyManager.getCurrencyCode();
		
		let currentX = 0;
		
		// "BALANCE" - green, poppins-bold
		const balanceWordText = scene.add.text(
			currentX, 0, balanceText,
			{
				fontSize: '12px',
				color: '#00ff00', // Green color
				fontFamily: 'poppins-bold'
			}
		).setOrigin(0, 0.5);
		this.balanceLabelContainer.add(balanceWordText);
		currentX += balanceWordText.width;
		
		// Add currency code in parentheses if available
		if (currencyCode) {
			// " (" - green, poppins-regular
			const leftParenText = scene.add.text(
				currentX, 0, ' (',
				{
					fontSize: '12px',
					color: '#00ff00', // Green color
					fontFamily: 'poppins-regular'
				}
			).setOrigin(0, 0.5);
			this.balanceLabelContainer.add(leftParenText);
			currentX += leftParenText.width;
			
			// Currency code - white, poppins-regular
			const currencyText = scene.add.text(
				currentX, 0, currencyCode,
				{
					fontSize: '12px',
					color: '#ffffff', // White color
					fontFamily: 'poppins-regular'
				}
			).setOrigin(0, 0.5);
			this.balanceLabelContainer.add(currencyText);
			currentX += currencyText.width;
			
			// ")" - green, poppins-regular
			const rightParenText = scene.add.text(
				currentX, 0, ')',
				{
					fontSize: '12px',
					color: '#00ff00', // Green color
					fontFamily: 'poppins-regular'
				}
			).setOrigin(0, 0.5);
			this.balanceLabelContainer.add(rightParenText);
		}
		
		// Center the container by adjusting its position
		const totalWidth = currentX;
		this.balanceLabelContainer.setX(balanceX - totalWidth / 2);
		this.controllerContainer.add(this.balanceLabelContainer);

		// "200,000.00" amount (2nd line) - centered (no currency to layout)
		this.balanceAmountText = scene.add.text(
			balanceX,
			balanceY + 8,
			SlotController.BALANCE_PENDING_TEXT,
			{
				fontSize: '14px',
				color: '#ffffff', // White color
				fontFamily: 'poppins-bold'
			}
		).setOrigin(0.5, 0.5).setDepth(9);
		this.controllerContainer.add(this.balanceAmountText);

		// Currency code text (hidden, kept for compatibility)
		this.balanceDollarText = scene.add.text(
			balanceX,
			balanceY + 8,
			'',
			{
				fontSize: '14px',
				color: '#ffffff', // White color
				fontFamily: 'poppins-regular'
			}
		).setOrigin(0.5, 0.5).setDepth(9);
		this.controllerContainer.add(this.balanceDollarText);
		// Hide currency text since it's now in the label
		this.balanceDollarText.setVisible(false);
	}

	private createBetDisplay(scene: Scene, assetScale: number): void {
		// Position for bet display (proportionate opposite side of balance display)
		const betX = scene.scale.width * 0.81;
		const betY = scene.scale.height * 0.724;
		const containerWidth = 125;
		const containerHeight = 55;
		const cornerRadius = 10;
		// Demo mode: hide currency symbol and keep the value centered
		const isDemoBet =
			this.gameAPI?.getDemoState() ||
			sessionStorage.getItem('demo') === 'true';
		const  betValueOffset = 0;


		// Create amplify bet spine animation (behind bet background)
		this.createAmplifyBetAnimation(scene, betX, betY, containerWidth, containerHeight);
		// Create enhance-bet idle spine animation (behind bet background)
		this.createEnhanceBetIdleAnimation(scene, betX, betY, containerWidth, containerHeight);
		
		// Create rounded rectangle background
		const betBg = scene.add.graphics();
		betBg.fillStyle(0x000000, 0.65); // Dark gray with 65% alpha
		betBg.fillRoundedRect(
			betX - containerWidth / 2,
			betY - containerHeight / 2,
			containerWidth,
			containerHeight,
			cornerRadius
		);
		betBg.setDepth(8);
		// Tag this graphics as the bet background so it can be disabled/enabled for free rounds
		(betBg as any).setData && betBg.setData('isBetBackground', true);
		this.controllerContainer.add(betBg);

		// Open Bet Options when the bet background is clicked
		betBg.setInteractive(
			new Phaser.Geom.Rectangle(
				betX - containerWidth / 2,
				betY - containerHeight / 2,
				containerWidth,
				containerHeight
			),
			Phaser.Geom.Rectangle.Contains
		);
		betBg.on('pointerdown', () => {
			console.log('[SlotController] Bet background clicked');

			// Honor the post-TotalWin (Congrats_KA) cool-down — bet options stay closed during the window
			if (this.winDialogControlsLocked) {
				return;
			}

			// Prevent opening bet options as soon as a spin is requested, even
			// before the reels fully enter their spinning state.
			if (
				(gameStateManager as any).isProcessingSpin ||
				gameStateManager.isReelSpinning ||
				gameStateManager.isAutoPlaying ||
				gameStateManager.isAutoPlaySpinRequested
			) {
				console.log(
					'[SlotController] Bet options panel disabled while spin processing, spinning, or autoplaying'
				);
				return;
			}

			// Also prevent opening bet options while scatter animation is in progress
			// (so the player cannot raise the bet once a scatter has triggered)
			let isScatterAnimating = false;
			try {
				if (this.scene) {
					const gameScene: any = this.scene as any;
					const symbolsComponent = gameScene.symbols;
					const scatterManager = symbolsComponent && symbolsComponent.scatterAnimationManager;
					if (scatterManager && typeof scatterManager.isAnimationInProgress === 'function') {
						isScatterAnimating = !!scatterManager.isAnimationInProgress();
					}
				}
			} catch (e) {
				console.warn('[SlotController] Unable to determine scatter animation state:', e);
			}

			if (gameStateManager.isScatter || isScatterAnimating) {
				console.log(
					'[SlotController] Bet options panel disabled while scatter animation is playing'
				);
				return;
			}

			EventBus.emit('show-bet-options');
		});
		

		// Create container for bet label parts
		this.betLabelContainer = scene.add.container(betX, betY - 8);
		this.betLabelContainer.setDepth(9);
		
		const betText = this.getControllerText(COMMON_BET).toUpperCase();
		const currencyCode = isDemoBet ? '' : CurrencyManager.getCurrencyCode();
		
		let currentX = 0;
		
		// "BET" - green, poppins-bold
		const betWordText = scene.add.text(
			currentX, 0, betText,
			{
				fontSize: '12px',
				color: '#00ff00', // Green color
				fontFamily: 'poppins-bold'
			}
		).setOrigin(0, 0.5);
		this.betLabelContainer.add(betWordText);
		currentX += betWordText.width;
		
		// Add currency code in parentheses if available
		if (currencyCode) {
			// " (" - green, poppins-regular
			const leftParenText = scene.add.text(
				currentX, 0, ' (',
				{
					fontSize: '12px',
					color: '#00ff00', // Green color
					fontFamily: 'poppins-regular'
				}
			).setOrigin(0, 0.5);
			this.betLabelContainer.add(leftParenText);
			currentX += leftParenText.width;
			
			// Currency code - white, poppins-regular
			const currencyText = scene.add.text(
				currentX, 0, currencyCode,
				{
					fontSize: '12px',
					color: '#ffffff', // White color
					fontFamily: 'poppins-regular'
				}
			).setOrigin(0, 0.5);
			this.betLabelContainer.add(currencyText);
			currentX += currencyText.width;
			
			// ")" - green, poppins-regular
			const rightParenText = scene.add.text(
				currentX, 0, ')',
				{
					fontSize: '12px',
					color: '#00ff00', // Green color
					fontFamily: 'poppins-regular'
				}
			).setOrigin(0, 0.5);
			this.betLabelContainer.add(rightParenText);
		}
		
		// Center the container by adjusting its position
		const totalWidth = currentX;
		this.betLabelContainer.setX(betX - totalWidth / 2);
		this.controllerContainer.add(this.betLabelContainer);

		// "0.60" amount (2nd line) - centered (no currency to layout)
		const startingBetLevel = getStartingBet(
			this.getBetLevels(),
			this.gameAPI?.getInitializationData?.()?.defaultBetIndex
		);
		this.betAmountText = scene.add.text(
			betX,
			betY + 8,
			formatCurrencyNumber(startingBetLevel),
			{
				fontSize: '14px',
				color: '#ffffff', // White color
				fontFamily: 'poppins-bold'
			}
		).setOrigin(0.5, 0.5).setDepth(9);
		this.controllerContainer.add(this.betAmountText);

		// Initialize base bet amount
		this.baseBetAmount = startingBetLevel;

		// Currency code text (hidden, kept for compatibility)
		this.betDollarText = scene.add.text(
			betX,
			betY + 8,
			'',
			{
				fontSize: '14px',
				color: '#ffffff', // White color
				fontFamily: 'poppins-regular'
			}
		).setOrigin(0.5, 0.5).setDepth(9);
		this.controllerContainer.add(this.betDollarText);
		// Hide currency text since it's now in the label
		this.betDollarText.setVisible(false);

		// Decrease bet button (left side within container)
		const decreaseBetButton = scene.add.image(
			betX - 42, // Left side within container
			betY + 8,
			'decrease_bet'
		).setOrigin(0.5, 0.5).setScale(assetScale * 0.55).setDepth(10);
		decreaseBetButton.setInteractive();
		decreaseBetButton.on('pointerdown', () => {
			// Keep the button interactive even when disabled so it blocks clicks from
			// falling through to the bet background. No-op when disabled.
			if (decreaseBetButton.getData('disabled')) {
				return;
			}
			console.log('[SlotController] Decrease bet button clicked');
			this.adjustBetByStep(-1);
		});
		this.buttons.set('decrease_bet', decreaseBetButton);
		this.controllerContainer.add(decreaseBetButton);

		// Increase bet button (right side within container)
		const increaseBetButton = scene.add.image(
			betX + 42, // Right side within container
			betY + 8,
			'increase_bet'
		).setOrigin(0.5, 0.5).setScale(assetScale * 0.55).setDepth(10);
		increaseBetButton.setInteractive();
		increaseBetButton.on('pointerdown', () => {
			// Keep the button interactive even when disabled so it blocks clicks from
			// falling through to the bet background. No-op when disabled.
			if (increaseBetButton.getData('disabled')) {
				return;
			}
			console.log('[SlotController] Increase bet button clicked');
			this.adjustBetByStep(1);
		});
		this.buttons.set('increase_bet', increaseBetButton);
		this.controllerContainer.add(increaseBetButton);

		// Initialize bet button states based on the starting bet (min bet greys out the decrement button)
		this.updateBetLimitButtons(this.baseBetAmount);
	}

	/** Move the bet to the next/previous level based on the BetOptions ladder */
	public adjustBetByStep(direction: 1 | -1): void {
		try {
			// Keep the ladder in sync with BetOptions.ts
			const betLevels: number[] = this.getBetLevels();

			// Use base bet (without amplify) to find current index
			const currentBaseBet = this.getBaseBetAmount() || 0.2;
			let idx = 0;
			let bestDiff = Number.POSITIVE_INFINITY;
			for (let i = 0; i < betLevels.length; i++) {
				const diff = Math.abs(betLevels[i] - currentBaseBet);
				if (diff < bestDiff) { bestDiff = diff; idx = i; }
			}

			const newIdx = Math.max(0, Math.min(betLevels.length - 1, idx + direction));
			const previousBet = currentBaseBet;
			const newBet = betLevels[newIdx];

			// Update UI and internal base bet via existing API (resets amplify if active)
			this.updateBetAmount(newBet);

			// Notify rest of the system
			gameEventManager.emit(GameEventType.BET_UPDATE, { newBet: newBet, previousBet: previousBet });
		} catch (e) {
			console.warn('[SlotController] adjustBetByStep failed:', e);
		}
	}

	/**
	 * Create amplify bet spine animation behind the bet background
	 */
	private createAmplifyBetAnimation(scene: Scene, betX: number, betY: number, containerWidth: number, containerHeight: number): void {
		try {
			if (!ensureSpineFactory(scene, '[SlotController] createAmplifyBetAnimation')) {
				console.warn('[SlotController] Spine factory not available yet; skipping amplify spine for now');
				return;
			}

			// Check if the spine assets are loaded
			if (!scene.cache.json.has('amplify_bet')) {
				console.warn('[SlotController] Amplify bet spine assets not loaded, skipping animation creation');
				return;
			}

			// Create the spine animation
			const amplifyOffsetX = -4; // slight left
			const amplifyOffsetY =  0; // slight up
			this.amplifyBetAnimation = scene.add.spine(
				betX + amplifyOffsetX, 
				betY + amplifyOffsetY, 
				'amplify_bet', 
				'amplify_bet-atlas'
			);
			
			// Scale the animation to fit within the bet background area
			const scale = Math.min(containerWidth / 200, containerHeight / 100); // Adjust scale based on container size
			this.amplifyBetAnimation.setScale(1);
			
			// Position it behind the bet background
			this.amplifyBetAnimation.setDepth(7); // Lower depth than bet background (8)
			
			// Initially hidden - will be shown when amplify bet is active and spin is triggered
			this.amplifyBetAnimation.setVisible(false);
			
			// Add to controller container
			this.controllerContainer.add(this.amplifyBetAnimation);
			
			console.log('[SlotController] Amplify bet spine animation created and positioned behind bet background');
			
		} catch (error) {
			console.error('[SlotController] Failed to create amplify bet spine animation:', error);
		}
	}

	/**
	 * Create the Enhance Bet idle loop spine animation near the Amplify button
	 */
	private createEnhanceBetIdleAnimation(scene: Scene, betX: number, betY: number, containerWidth: number, containerHeight: number): void {
		try {
			if (!ensureSpineFactory(scene, '[SlotController] createEnhanceBetIdleAnimation')) {
				console.warn('[SlotController] Spine factory not available yet; skipping enhance-bet idle spine for now');
				return;
			}

			if (!scene.cache.json.has('enhance_bet_idle_on')) {
				console.warn('[SlotController] enhance_bet_idle_on spine assets not loaded, skipping idle animation creation');
				return;
			}

			// Position to exactly match amplify bet animation if available, including offsets
			const targetX = this.amplifyBetAnimation ? this.amplifyBetAnimation.x : (betX - 4);
			const targetY = this.amplifyBetAnimation ? this.amplifyBetAnimation.y : (betY);
			this.enhanceBetIdleAnimation = scene.add.spine(targetX, targetY, 'enhance_bet_idle_on', 'enhance_bet_idle_on-atlas');
			this.enhanceBetIdleAnimation.setOrigin(0.5, 0.5);
			// Match scale and depth to amplify bet animation if present
			if (this.amplifyBetAnimation) {
				this.enhanceBetIdleAnimation.setScale(this.amplifyBetAnimation.scaleX, this.amplifyBetAnimation.scaleY);
				this.enhanceBetIdleAnimation.setDepth(this.amplifyBetAnimation.depth);
			} else {
				this.enhanceBetIdleAnimation.setScale(1);
				this.enhanceBetIdleAnimation.setDepth(7);
			}
			this.enhanceBetIdleAnimation.setVisible(false);

			// Add to controller container so it renders with HUD
			this.controllerContainer.add(this.enhanceBetIdleAnimation);

			console.log('[SlotController] Enhance Bet idle spine created');
		} catch (error) {
			console.error('[SlotController] Failed to create enhance bet idle animation:', error);
		}
	}

	/** Start the enhance bet idle loop (loop=true) */
	private showEnhanceBetIdleLoop(): void {
		if (!this.enhanceBetIdleAnimation) {
			return;
		}
		this.enhanceBetIdleAnimation.setVisible(true);
		const idleName = 'animation'; // single animation in JSON is named 'animation'
		if (this.enhanceBetIdleAnimation.skeleton?.data.findAnimation(idleName)) {
			this.enhanceBetIdleAnimation.animationState.setAnimation(0, idleName, true);
		} else {
			const animations = this.enhanceBetIdleAnimation.skeleton?.data.animations || [];
			if (animations.length > 0) {
				this.enhanceBetIdleAnimation.animationState.setAnimation(0, animations[0].name, true);
			}
		}
	}

	/** Stop and hide the enhance bet idle loop */
	private hideEnhanceBetIdleLoop(): void {
		if (!this.enhanceBetIdleAnimation) {
			return;
		}
		this.enhanceBetIdleAnimation.animationState.clearTracks();
		this.enhanceBetIdleAnimation.setVisible(false);
	}

	/**
	 * Buy Feature button — amount + currency beside the price, BUY label with currency.
	 */
	private createFeatureButton(scene: Scene, assetScale: number): void {
		const featureX = scene.scale.width * 0.5;
		const featureY = scene.scale.height * 0.724;

		this.featureImage = scene.add
			.image(featureX, featureY, 'feature')
			.setOrigin(0.5, 0.5)
			.setScale(assetScale)
			.setDepth(10);
		this.controllerContainer.add(this.featureImage);

		const baseWidth = this.featureImage.displayWidth || 200;
		const baseHeight = this.featureImage.displayHeight || 80;
		const featureButton = scene.add
			.rectangle(featureX, featureY, baseWidth * 0.65, baseHeight * 0.45, 0xffffff, 0)
			.setOrigin(0.5, 0.5)
			.setDepth(11);
		featureButton.setInteractive({ useHandCursor: true });
		featureButton.on('pointerdown', () => {
			console.log('[SlotController] Feature button clicked');
			if ((window as any).audioManager) {
				(window as any).audioManager.playSoundEffect(SoundEffectType.MENU_CLICK);
			}
			this.showBuyFeatureDrawer();
		});
		this.featureButtonHitbox = featureButton;
		this.controllerContainer.add(featureButton);

		const isDemoFeature =
			this.gameAPI?.getDemoState() || sessionStorage.getItem('demo') === 'true';

		this.featureLabelContainer = scene.add.container(featureX, featureY - 8);
		this.featureLabelContainer.setDepth(9);

		const buyText = this.getControllerText(CONTROLLER_BUY_FEATURE);
		const currencyCode = isDemoFeature
			? ''
			: CurrencyManager.getCurrencyCode() || CurrencyManager.getCurrencyGlyph();

		let currentX = 0;
		const buyWordText = scene.add
			.text(currentX, 0, buyText, {
				fontSize: '12px',
				color: '#ffffff',
				fontFamily: 'poppins-bold',
			})
			.setOrigin(0, 0.5);
		this.featureLabelContainer.add(buyWordText);
		currentX += buyWordText.width;

		if (currencyCode) {
			const leftParenText = scene.add
				.text(currentX, 0, ' (', {
					fontSize: '12px',
					color: '#ffffff',
					fontFamily: 'poppins-regular',
				})
				.setOrigin(0, 0.5);
			this.featureLabelContainer.add(leftParenText);
			currentX += leftParenText.width;

			const currencyText = scene.add
				.text(currentX, 0, currencyCode, {
					fontSize: '12px',
					color: '#ffffff',
					fontFamily: 'poppins-regular',
				})
				.setOrigin(0, 0.5);
			this.featureLabelContainer.add(currencyText);
			currentX += currencyText.width;

			const rightParenText = scene.add
				.text(currentX, 0, ')', {
					fontSize: '12px',
					color: '#ffffff',
					fontFamily: 'poppins-regular',
				})
				.setOrigin(0, 0.5);
			this.featureLabelContainer.add(rightParenText);
			currentX += rightParenText.width;
		}

		this.featureLabelContainer.setX(featureX - currentX / 2);
		this.controllerContainer.add(this.featureLabelContainer);
		this.featureLabelText = null;

		this.featureAmountText = scene.add
			.text(featureX, featureY + 8, '0', {
				fontSize: '14px',
				color: '#ffffff',
				fontFamily: 'poppins-bold',
			})
			.setOrigin(0.5, 0.5)
			.setDepth(9);
		this.controllerContainer.add(this.featureAmountText);

		this.featureDollarText = scene.add
			.text(featureX, featureY + 8, '', {
				fontSize: '14px',
				color: '#ffffff',
				fontFamily: 'poppins-regular',
			})
			.setOrigin(0.5, 0.5)
			.setDepth(9)
			.setVisible(false);
		this.controllerContainer.add(this.featureDollarText);

		this.updateFeatureAmountFromCurrentBet();
	}

	private scratchButtonPosition(scene: Scene): { x: number; y: number } {
		const balanceX = Math.round(scene.scale.width * 0.19);
		const balanceY = scene.scale.height * 0.724;
		// Sit just above the balance pill (same final offset as genghisbao).
		return { x: balanceX, y: Math.round(balanceY - 61) };
	}

	private makeScratchButtonRoot(scene: Scene): Phaser.GameObjects.Container {
		const pos = this.scratchButtonPosition(scene);
		const root = scene.add.container(pos.x, pos.y).setDepth(10);
		try {
			root.setName('hud_scratch_card_root');
		} catch {
			/* noop */
		}
		return root;
	}

	private bindScratchToggle(target: Phaser.GameObjects.GameObject): void {
		if (isNonScratchReplayRequest()) {
			lockScratchControlForSlotReplay(this.scratchCardRoot);
			const scene = (target as any)?.scene;
			try { scene?.time?.delayedCall?.(0, () => lockScratchControlForSlotReplay(this.scratchCardRoot)); } catch { /* noop */ }
			return;
		}
		const interactive = target as any;
		try {
			interactive.setInteractive({ useHandCursor: true });
		} catch {
			interactive.setInteractive();
		}
		interactive.on('pointerdown', () => {
			if ((window as any).audioManager) {
				(window as any).audioManager.playSoundEffect(SoundEffectType.MENU_CLICK);
			}
			if (isNonScratchReplayRequest()) {
				return;
			}
			console.log('[SlotController] Scratch toggle clicked');
			EventBus.emit('scratch-toggle');
		});
	}

	private addScratchCardLabel(scene: Scene, root: Phaser.GameObjects.Container): void {
		const textResolution = Math.min(
			3,
			Math.max(2, Math.round((typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1)),
		);
		// Label centered on the green banner in the art.
		this.scratchCardLabel = scene.add
			.text(0, 4, this.getControllerText(CONTROLLER_SCRATCH, true), {
				fontSize: '11px',
				color: '#ffffff',
				fontFamily: 'poppins-bold',
				align: 'center',
				resolution: textResolution,
			})
			.setOrigin(0.5, 0.5);
		try {
			this.scratchCardLabel.setResolution(textResolution);
		} catch {
			/* noop */
		}
		root.add(this.scratchCardLabel);
	}

	/** Static scratch card image with the shared trail and glitter effect. */
	private createScratchCardButton(scene: Scene, assetScale: number): void {
		if (this.scratchCardButton || this.scratchCardRoot) {
			return;
		}
		const key = 'scratch_card';
		const root = this.makeScratchButtonRoot(scene);

		try {
			scene.textures.get(key)?.setFilter(Phaser.Textures.FilterMode.LINEAR);
		} catch {
			/* noop */
		}

		const scratchButton = scene.add
			.image(0, 0, key)
			.setOrigin(0.5, 0.5)
			.setScale(assetScale);
		try {
			(scratchButton as any).setRoundPixels?.(true);
		} catch {
			/* noop */
		}
		try {
			scratchButton.setName('hud_scratch_card_button');
		} catch {
			/* noop */
		}
		this.bindScratchToggle(scratchButton);
		root.add(scratchButton);
		addScratchButtonEffect(scene, root, scratchButton, SUGAR_WONDERLAND_SCRATCH_BUTTON_EFFECT_CONFIG);
		this.scratchCardButton = scratchButton;
		if (isNonScratchReplayRequest()) {
			lockScratchControlForSlotReplay(root);
		}
		this.addScratchCardLabel(scene, root);
		this.controllerContainer.add(root);
		this.scratchCardRoot = root;
	}


	private createLandscapeController(scene: Scene, assetScale: number): void {
		console.log("[SlotController] Creating landscape controller layout");
		
		// Create primary controllers container
		this.primaryControllers = scene.add.container(0, 0);
		this.controllerContainer.add(this.primaryControllers);
		
		// Create buttons for landscape layout
		const middleRef = scene.scale.height * 0.9;
		const buttonSpacing = 100;
		
		// Spin button: Zone hit + spin_icon / autoplay_stop overlays.
		// Visual disc is start_btn_spine (created later in createSpinButtonAnimation).
		this.spinButtonAssetScale = assetScale;
		const spinX = scene.scale.width * 0.5;
		const spinY = middleRef;
		this.createSpinHitZone(scene, spinX, spinY, assetScale);
		if (!this.spinIcon) {
			this.createSpinIconOverlay(scene, spinX, spinY, assetScale, 1);
		}
		if (!this.autoplayStopIcon) {
			this.createAutoplayStopIconOverlay(scene, spinX, spinY, assetScale, 1);
		}

		if (this.spinIcon) {
			this.buttons.set('spin', this.spinIcon);
		}
		if (this.spinHitZone && this.primaryControllers.getIndex(this.spinHitZone) === -1) {
			this.primaryControllers.add(this.spinHitZone);
		}
		this.layoutSpinButtonStack(assetScale);
		this.bringSpinButtonStackToFront();

		// Turbo button
		const turboButton = scene.add.image(
			scene.scale.width * 0.5 - buttonSpacing,
			middleRef,
			'turbo_off'
		).setOrigin(0.5, 0.5).setScale(assetScale).setDepth(10);
		turboButton.setInteractive();
		turboButton.on('pointerdown', () => {
			console.log('[SlotController] Turbo button clicked');
			this.handleTurboButtonClick();
		});
		this.buttons.set('turbo', turboButton);
		this.primaryControllers.add(turboButton);

		// Turbo text label
		const turboText = scene.add.text(
			scene.scale.width * 0.5 - buttonSpacing,
			middleRef + (turboButton.displayHeight * 0.5) + 15,
			this.getControllerText(COMMON_TURBO),
			this.getTextStyle()
		).setOrigin(0.5, 0.5).setDepth(10);
		this.controllerContainer.add(turboText);
		this.controllerTexts.push(turboText);

		// Autoplay button
		const autoplayButton = scene.add.image(
			scene.scale.width * 0.5 + buttonSpacing,
			middleRef,
			'autoplay_off'
		).setOrigin(0.5, 0.5).setScale(assetScale).setDepth(10);
		autoplayButton.setInteractive();
		autoplayButton.on('pointerdown', () => {
			console.log('[SlotController] Autoplay button clicked');
			this.handleAutoplayButtonClick();
		});
		this.buttons.set('autoplay', autoplayButton);
		this.primaryControllers.add(autoplayButton);

		// Autoplay text label
		const autoplayText = scene.add.text(
			scene.scale.width * 0.5 + buttonSpacing,
			middleRef + (autoplayButton.displayHeight * 0.5) + 15,
			this.getControllerText(CONTROLLER_AUTOPLAY),
			this.getTextStyle(),
		).setOrigin(0.5, 0.5).setDepth(10);
		this.controllerContainer.add(autoplayText);
		this.controllerTexts.push(autoplayText);

		// Menu button
		const menuButton = scene.add.image(
			scene.scale.width * 0.5 + buttonSpacing * 2,
			middleRef,
			'menu'
		).setOrigin(0.5, 0.5).setScale(assetScale).setDepth(10);
		menuButton.setInteractive();
		menuButton.on('pointerdown', () => {
			console.log('[SlotController] Menu button clicked');
			EventBus.emit('menu');
		});
		this.buttons.set('menu', menuButton);
		this.primaryControllers.add(menuButton);

		// Menu text label
		const menuText = scene.add.text(
			scene.scale.width * 0.5 + buttonSpacing * 2,
			middleRef + (menuButton.displayHeight * 0.5) + 15,
			this.getControllerText(CONTROLLER_MENU),
			this.getTextStyle()
		).setOrigin(0.5, 0.5).setDepth(10);
		this.controllerContainer.add(menuText);
		this.controllerTexts.push(menuText);

		// Amplify description container
		this.createAmplifyDescription(scene, assetScale);

		// Balance display container
		this.createBalanceDisplay(scene, assetScale);

		// Scratch card toggle (above balance)
		this.createScratchCardButton(scene, assetScale);

		// Bet display container
		this.createBetDisplay(scene, assetScale);
		
		// Feature button container
		this.createFeatureButton(scene, assetScale);
		
		// Free spin display container
		this.createFreeSpinDisplay(scene, assetScale);
		
		// Create the spin button animation
		this.createSpinButtonAnimation(scene, assetScale);
		
		// Create the autoplay button animation
		this.createAutoplayButtonAnimation(scene, assetScale);
		
		// Create the turbo button animation
		this.createTurboButtonAnimation(scene, assetScale);
		
		// Create the autoplay spins remaining text
		this.createAutoplaySpinsRemainingText(scene, assetScale);
	}

	updateButtonState(buttonName: string, isActive: boolean): void {
		const button = this.buttons.get(buttonName);
		if (button) {
			const newTexture = isActive ? `${buttonName}_on` : `${buttonName}_off`;
			button.setTexture(newTexture);
		}
	}

	resize(scene: Scene): void {
		if (this.controllerContainer) {
			this.controllerContainer.setSize(scene.scale.width, scene.scale.height);
			// Reapply vertical offset on resize to maintain spacing
			if (this.controllerVerticalOffset === 0) {
				this.controllerVerticalOffset = scene.scale.height * 0.02;
			}
			this.controllerContainer.setY(this.controllerVerticalOffset + 80);
		}
	}

	getContainer(): Phaser.GameObjects.Container {
		return this.controllerContainer;
	}

	getButton(buttonName: string): Phaser.GameObjects.Image | undefined {
		return this.buttons.get(buttonName);
	}

	/**
	 * Update bet amount from autoplay panel without resetting amplify/enhanced bet state.
	 * This preserves existing enhance bet if it was enabled before autoplay starts.
	 */
	public updateBetAmountFromAutoplay(betAmount: number): void {
		// Treat this as an internal bet change so resetAmplifyBetOnBetChange is not triggered
		this.isInternalBetChange = true;
		try {
			this.updateBetAmount(betAmount);

			// Manually update baseBetAmount since updateBetAmount skips it when isInternalBetChange is true
			// This is critical for autoplay to use the correct bet amount
			this.baseBetAmount = betAmount;
			
			// Update Buy Feature amount to sync with the new base bet
			this.updateFeatureAmountFromCurrentBet();

			// If enhance/amplify bet is currently ON, keep the displayed bet at +25%
			// while the underlying base bet (used for API and Buy Feature price) is betAmount.
			const gameData = this.getGameData();
			if (gameData && gameData.isEnhancedBet && this.betAmountText) {
				const increasedBet = betAmount * 1.25;
				this.betAmountText.setText(formatCurrencyNumber(increasedBet));
				// Center the amount text (no currency layout needed)
				const betX = this.scene ? this.scene.scale.width * 0.81 : this.betAmountText.x;
				this.betAmountText.setPosition(betX, this.betAmountText.y);
			}
		} finally {
			this.isInternalBetChange = false;
		}
	}

	updateBetAmount(betAmount: number): void {
		// Preserve enhanced bet state and display the correct value
		const gameData = this.getGameData();
		const isEnhanced = !!gameData?.isEnhancedBet;
		const displayBet = isEnhanced ? betAmount * 1.25 : betAmount;

		if (this.betAmountText) {
			this.betAmountText.setText(formatCurrencyNumber(displayBet));

			const betY = this.betAmountText.y;
			const betX = this.scene ? this.scene.scale.width * 0.81 : this.betAmountText.x;
			if (this.betDollarText) this.betDollarText.setVisible(false);
			this.betAmountText.setPosition(betX, betY);
		}

		// Update base bet amount when changed externally (not by amplify bet)
		if (!this.isInternalBetChange) {
			this.baseBetAmount = betAmount;
			// Do NOT reset enhanced bet or re-enable feature; retain current state
		}

		// Keep the Buy Feature amount synced with current base bet (using the updated baseBetAmount)
		this.updateFeatureAmountFromCurrentBet();

		// Update bet +/- button states based on the new bet (for min/max greying)
		this.updateBetLimitButtons(betAmount);

		// Refresh affordability whenever bet changes
		this.updateSpinButtonState();
	}

	/**
	 * Update the Buy Feature button amount to current base bet x100
	 */
	private updateFeatureAmountFromCurrentBet(): void {
		if (!this.featureAmountText) {
			return;
		}
		const displayedBet = this.getBaseBetAmount() || 0;
		const price = displayedBet * 100;
		this.featureAmountText.setText(formatCurrencyNumber(price));
		this.featureAmountText.setVisible(true);
		this.featureDollarText?.setVisible(false);
		// Amount text is already centered - no layout needed
	}

	getBetAmountText(): string | null {
		return this.betAmountText ? this.betAmountText.text : null;
	}

	/**
	 * Get the base bet amount for API calls (without amplify bet increase)
	 */
	getBaseBetAmount(): number {
		return this.baseBetAmount;
	}


	/**
	 * Apply wallet from unresolved-spin /complete (rainbow_fist).
	 * Applies immediately — balance is not frozen during freespin/feature.
	 */
		private unresolvedCompleteBalanceEpoch: number | null = null;
		private unresolvedCompleteTimestamp: number | undefined;
	private unresolvedCompleteBalance: number | null = null;

	
	/** Re-paint the /complete wallet while that request is still the latest HUD generation. */
	public reapplyUnresolvedCompleteBalance(): 'applied' | 'superseded' | 'none' {
		const balance = this.unresolvedCompleteBalance;
		const epoch = this.unresolvedCompleteBalanceEpoch;
		const timestamp = this.unresolvedCompleteTimestamp;
		if (balance == null || !Number.isFinite(Number(balance))) {
			return 'none';
		}
		if (isStaleWalletTimestamp(timestamp)) {
			return 'superseded';
		}
		if (timestamp == null && (epoch == null || epoch !== currentBalanceDisplayEpoch())) {
			return 'superseded';
		}
		this.applyBalanceFromUnresolvedComplete(Number(balance), epoch ?? undefined, timestamp);
		return 'applied';
	}

	public applyBalanceFromUnresolvedComplete(balance: number, epoch?: number, timestamp?: number | string | null): void {
		const raw = Number(balance);
		if (!Number.isFinite(raw) || raw < 0) {
			return;
		}
		const walletTimestamp = coerceWalletTimestamp(
			timestamp !== undefined ? timestamp : this.gameAPI?.getLastUnresolvedCompleteTimestamp?.()
		);
		if (isStaleWalletTimestamp(walletTimestamp) || (walletTimestamp == null && renderedWalletTimestamp() > 0)) {
			try { this.gameAPI?.consumeLastUnresolvedCompleteBalance?.(); } catch {}
			return;
		}
		if (walletTimestamp == null && (epoch == null || epoch !== currentBalanceDisplayEpoch())) {
			return;
		}
		const wb = typeof (this as any).roundCurrency === 'function'
			? (this as any).roundCurrency(Math.max(0, raw))
			: Math.round(Math.max(0, raw) * 100) / 100;
		this.unresolvedCompleteBalance = wb;
		this.unresolvedCompleteBalanceEpoch = epoch ?? null;
		this.unresolvedCompleteTimestamp = walletTimestamp;
		try { (this as any).freezeBalanceUi = false; } catch {}
		try { if ('deferredBalanceAfterBonus' in this) (this as any).deferredBalanceAfterBonus = null; } catch {}
		try { if ('pendingUnresolvedCompleteBalance' in this) (this as any).pendingUnresolvedCompleteBalance = null; } catch {}
		try { if ('bonusExitBalanceApplied' in this) (this as any).bonusExitBalanceApplied = true; } catch {}
		try { this.gameAPI?.consumeLastUnresolvedCompleteBalance?.(); } catch {}
		const current = Number(this.getBalanceAmount?.() ?? NaN);
		if (Number.isFinite(current) && wb > current && typeof (this as any).startBalanceTween === 'function') {
			(this as any).startBalanceTween(wb, 220, epoch, walletTimestamp);
		} else if (typeof this.updateBalanceAmount === 'function') {
			this.updateBalanceAmount(wb, epoch, walletTimestamp);
		}
		try {
			if (this.gameAPI?.getDemoState?.()) {
				this.gameAPI.updateDemoBalance?.(wb);
			}
		} catch {}
		console.log('[SlotController] Applied unresolved-spin /complete balance:', wb);
	}

	
	public applyBalanceDisplayResponse(balance: number, epoch?: number, timestamp?: number | string | null): void {
		this.updateBalanceAmount(balance, epoch, timestamp);
	}

updateBalanceAmount(balanceAmount: number, epoch?: number, timestamp?: number | string | null): void {
		if (isStaleWalletTimestamp(timestamp)) return;
		const walletTimestamp = coerceWalletTimestamp(timestamp);
		// A balance with no timestamp must not cover one that already has a wallet version.
		if (walletTimestamp == null && renderedWalletTimestamp() > 0) return;
		const __resolvedBalanceEpoch = resolveSpinBalanceEpoch(epoch);
		// A wallet timestamp newer than the one on screen wins over the local spin generation.
		if (walletTimestamp == null && __resolvedBalanceEpoch !== currentBalanceDisplayEpoch()) return;
		noteRenderedBalanceTimestamp(walletTimestamp);

		try {
			if (this.freezeBalanceUi) {
				const v = Number(balanceAmount);
				if (Number.isFinite(v) && v >= 0) {
					this.deferredBalanceAfterBonus = this.roundCurrency(v);
				}
				return;
			}
		} catch {}
		if (this.balanceAmountText) {
			if (!Number.isFinite(balanceAmount)) {
				this.balanceAmountText.setText(SlotController.BALANCE_PENDING_TEXT);
				this.updateSpinButtonState();
				return;
			}
			if (balanceAmount < 0) {
				this.balanceAmountText.setText('-');
			} else {
				this.balanceAmountText.setText(formatCurrencyNumber(balanceAmount));
			}
			const balanceX = this.scene ? this.scene.scale.width * 0.19 : this.balanceAmountText.x;
			this.balanceAmountText.setPosition(balanceX, this.balanceAmountText.y);
			this.isBalanceInitialized = true;
		}

		this.updateSpinButtonState();
	}

	private startBalanceTween(targetBalance: number, durationMs: number = 220, epoch?: number, timestamp?: number | string | null): void {
		this.ensureBalanceEpochListener();
		if (isStaleWalletTimestamp(timestamp)) return;
		const walletTimestamp = coerceWalletTimestamp(timestamp);
		// A balance with no timestamp must not cover one that already has a wallet version.
		if (walletTimestamp == null && renderedWalletTimestamp() > 0) return;
		const __balanceEpoch = resolveSpinBalanceEpoch(epoch);
		if (walletTimestamp == null && __balanceEpoch !== currentBalanceDisplayEpoch()) return;
		const walletStillCurrent = (): boolean =>
			!isStaleWalletTimestamp(walletTimestamp) &&
			(walletTimestamp != null || __balanceEpoch === currentBalanceDisplayEpoch());

		if (!Number.isFinite(targetBalance)) {
			return;
		}
		noteRenderedBalanceTimestamp(walletTimestamp);
		this.activeBalanceTweenEpoch = __balanceEpoch;
		const safeTarget = this.roundCurrency(Math.max(0, Number(targetBalance) || 0));
		if (this.freezeBalanceUi) {
			this.deferredBalanceAfterBonus = safeTarget;
			return;
		}
		if (!this.scene || !this.balanceAmountText) {
			this.updateBalanceAmount(safeTarget, __balanceEpoch, walletTimestamp);
			return;
		}

		const currentBalance = this.getBalanceAmount();
		const fromBalance = Number.isFinite(currentBalance) ? currentBalance : safeTarget;
		if (Math.abs(safeTarget - fromBalance) < 0.0001) {
			this.updateBalanceAmount(safeTarget, __balanceEpoch, walletTimestamp);
			return;
		}

		try {
			this.balanceTween?.stop();
		} catch {}

		const valueProxy = { value: fromBalance };
		this.balanceAnimationInProgress = true;
		this.activeBalanceTweenTarget = safeTarget;
		this.balanceTween = this.scene.tweens.add({
			targets: valueProxy,
			value: safeTarget,
			duration: durationMs,
			ease: 'Cubic.Out',
			onUpdate: () => { if (!walletStillCurrent()) { try { this.balanceTween?.stop(); } catch { /* ignore */ } return; }
				this.updateBalanceAmount(valueProxy.value, __balanceEpoch, walletTimestamp);
			},
			onComplete: () => {
				const deferred = this.pendingServerBalanceForReconcile;
				const deferredEpoch = this.pendingServerBalanceEpoch;
				if (!walletStillCurrent()) {
					if (deferredEpoch === __balanceEpoch) {
						this.pendingServerBalanceForReconcile = null;
						this.pendingServerBalanceEpoch = null;
					}
					return;
				}
				this.balanceAnimationInProgress = false;
				this.balanceTween = null;
				this.activeBalanceTweenTarget = null;
				this.updateBalanceAmount(safeTarget, __balanceEpoch, walletTimestamp);
				this.pendingServerBalanceForReconcile = null;
				this.pendingServerBalanceEpoch = null;
				if (Number.isFinite(deferred) && (deferredEpoch == null || deferredEpoch === __balanceEpoch)) {
					this.startBalanceTween(Number(deferred), 200, __balanceEpoch, this.pendingServerBalanceTimestamp);
				} else {
					this.updateSpinButtonState();
					this.restoreBaseGameControlsAfterIdleSpin();
					this.schedulePostSpinControlsRefresh();
				}
			},
			onStop: () => { if (!walletStillCurrent()) { this.balanceAnimationInProgress = false; this.balanceTween = null; return; }
				this.balanceAnimationInProgress = false;
				this.balanceTween = null;
				this.activeBalanceTweenTarget = null;
				this.updateSpinButtonState();
				this.restoreBaseGameControlsAfterIdleSpin();
				this.schedulePostSpinControlsRefresh();
			}
		});
	}

	private roundCurrency(value: number): number {
		return Math.round(value * 100) / 100;
	}

	private beginWalletCycleForSpinLikeAction(): void {
		this.finalizeBalanceTweenBeforeSpin();
		this.balanceAnimSpinToken++;
		this.pendingWalletBalanceFromSpin = null;
		this.pendingWalletBalanceSpinToken = -1;
		this.pendingWalletBalanceEpoch = null;
		this.pendingWalletBalanceTimestamp = undefined;
		try {
			this.balanceTween?.stop();
		} catch {}
		this.balanceTween = null;
		this.balanceAnimationInProgress = false;
	}

	private isAwaitingAuthoritativeSpinBalance(): boolean {
		return this.pendingWalletBalanceFromSpin !== null || this.balanceAnimationInProgress;
	}

	/**
	 * Stage response balance from the bet payload until reel/win animations complete.
	 */
	private applyWalletBalanceFromSpinResponse(spinData: SpinData | null | undefined): void {
		if (!spinData) {
			return;
		}
		try {
			if (this.gameAPI?.getReplayState?.()) {
				return;
			}
			if (this.shouldDeferFreeRoundWalletUntilModal()) {
				return;
			}
			const walletTimestamp = readWalletTimestamp(spinData);
			if (isStaleWalletTimestamp(walletTimestamp)) {
				return;
			}
			const epoch = this.balanceEpochFromSpin(spinData);
			if (walletTimestamp == null && this.isStaleBalanceEpoch(epoch)) {
				return;
			}
			const balance = SpinDataUtils.extractBetResponseBalance(spinData);
			if (balance === null) {
				return;
			}
			if (SpinDataUtils.hasBonusOrFreespinItems(spinData)) {
				// rainbow_fist: do not freeze balance during freespin/feature
				this.freezeBalanceUi = false;
				this.bonusTriggerWalletBalance = balance;
				this.capturedBonusTotalWin = 0;
				if (epoch != null || walletTimestamp != null) {
					this.updateBalanceAmount(balance, epoch, walletTimestamp);
				}
				console.log(
					`[SlotController] Bonus/freespin items — froze balance at post-bet wallet: $${balance}`
				);
				return;
			}
			const finalBalance = this.isInitializationFreeRoundActive()
				? balance
				: SpinDataUtils.resolveFinalBalanceFromBetResponse(spinData);
			if (finalBalance === null) {
				return;
			}
			console.log(
				`[SlotController] Deferred final balance from bet response until animation completes: $${finalBalance}`
			);
			this.pendingWalletBalanceFromSpin = finalBalance;
			this.pendingWalletBalanceSpinToken = this.balanceAnimSpinToken;
			this.pendingWalletBalanceEpoch = epoch ?? null;
			this.pendingWalletBalanceTimestamp = walletTimestamp;
		} catch {}
	}

	private applyAuthoritativeSpinBalance(balance: number, durationMs: number = 200, epoch?: number, timestamp?: number): void {
		const wb = this.roundCurrency(Math.max(0, balance));
		this.pendingWalletBalanceFromSpin = null;
		this.pendingWalletBalanceSpinToken = -1;
		this.pendingWalletBalanceEpoch = null;
		this.pendingWalletBalanceTimestamp = undefined;
		if (isStaleWalletTimestamp(timestamp)) {
			return;
		}
		if (timestamp == null && (epoch == null || this.isStaleBalanceEpoch(epoch))) {
			return;
		}
		this.startBalanceTween(wb, durationMs, epoch, timestamp);
		try {
			if (this.gameAPI?.getDemoState()) {
				this.gameAPI.updateDemoBalance(wb);
			}
		} catch {}
	}

	private flushPendingWalletBalanceFromSpin(expectedToken: number): boolean {
		if (this.pendingWalletBalanceFromSpin == null) {
			return false;
		}
		if (this.pendingWalletBalanceSpinToken !== expectedToken) {
			return false;
		}
		const wb = this.pendingWalletBalanceFromSpin;
		const epoch = this.pendingWalletBalanceEpoch ?? undefined;
		const timestamp = this.pendingWalletBalanceTimestamp;
		if (isStaleWalletTimestamp(timestamp) || (timestamp == null && (epoch == null || this.isStaleBalanceEpoch(epoch)))) {
			this.pendingWalletBalanceFromSpin = null;
			this.pendingWalletBalanceSpinToken = -1;
			this.pendingWalletBalanceEpoch = null;
			this.pendingWalletBalanceTimestamp = undefined;
			return false;
		}
		this.applyAuthoritativeSpinBalance(wb, 320, epoch, timestamp);
		console.log('[SlotController] Applied deferred wallet balance (tween):', wb);
		return true;
	}

	private onWinStartBalancePresentation(): void {
		// Normal bets: balance is applied on REELS_STOP (no win) or WIN_STOP (win), not WIN_START.
	}

	private applyDeferredWalletBalanceAfterAnimation(phase: 'reels-stop' | 'win-stop'): void {
		if (
			gameStateManager.isScatter ||
			gameStateManager.isBonus ||
			this.freezeBalanceUi ||
			this.shouldDeferFreeRoundWalletUntilModal() ||
			this.gameAPI?.getReplayState?.()
		) {
			return;
		}
		try {
			const spinData = (this.symbols as any)?.currentSpinData ?? this.gameAPI?.getCurrentSpinData?.();
			const epoch = this.balanceEpochFromSpin(spinData) ?? this.pendingWalletBalanceEpoch ?? undefined;
			const walletTimestamp = readWalletTimestamp(spinData) ?? this.pendingWalletBalanceTimestamp;
			if (isStaleWalletTimestamp(walletTimestamp) || (walletTimestamp == null && this.isStaleBalanceEpoch(epoch))) {
				this.pendingWalletBalanceFromSpin = null;
				this.pendingWalletBalanceSpinToken = -1;
				this.pendingWalletBalanceEpoch = null;
				this.pendingWalletBalanceTimestamp = undefined;
				return;
			}
			const hasWin = SpinDataUtils.spinHasWinForBalanceDeferral(spinData);
			if (phase === 'reels-stop' && hasWin) {
				return;
			}

			const current = this.getBalanceAmount();
			const pending = this.pendingWalletBalanceFromSpin;
			const pendingMatchesToken =
				pending != null && this.pendingWalletBalanceSpinToken === this.balanceAnimSpinToken;

			if (
				walletTimestamp == null &&
				phase === 'reels-stop' &&
				!hasWin &&
				pendingMatchesToken &&
				Number.isFinite(current) &&
				pending > current + 0.01
			) {
				console.warn(
					'[SlotController] Skipping deferred balance flush — server wallet exceeds post-bet HUD'
				);
				this.pendingWalletBalanceFromSpin = null;
				this.pendingWalletBalanceSpinToken = -1;
				this.pendingWalletBalanceEpoch = null;
				this.pendingWalletBalanceTimestamp = undefined;
			} else if (this.flushPendingWalletBalanceFromSpin(this.balanceAnimSpinToken)) {
				this.balanceApiCalledThisSpin = true;
			} else if (!this.balanceApiCalledThisSpin) {
				const reconciled = SpinDataUtils.resolveFinalBalanceFromBetResponse(spinData);
				const allowReconcile =
					reconciled !== null &&
					(walletTimestamp != null || phase === 'win-stop' || !Number.isFinite(current) || reconciled <= current + 0.01);
				if (allowReconcile) {
					this.applyReconciledBalance(reconciled!, current, epoch, walletTimestamp);
					this.balanceApiCalledThisSpin = true;
				}
			}
		} catch {}
	}

	private extractBalanceFromSpinPayload(spinData: any): number | null {
		if (spinData == null) {
			return null;
		}
		try {
			const candidates = [
				spinData.balance,
				spinData?.data?.balance,
				spinData.walletBalance,
				(spinData as any)?.wallet?.balance,
				(spinData as any)?.player?.balance,
			];
			for (const c of candidates) {
				if (c === undefined || c === null) {
					continue;
				}
				const v = Number(String(c).replace(/,/g, ''));
				if (Number.isFinite(v) && v >= 0) {
					return this.roundCurrency(v);
				}
			}
		} catch {}
		return null;
	}

	private resolveBonusTotalWinFromScene(): number {
		try {
			const sceneAny: any = this.scene as any;
			const symbols: any = sceneAny?.symbols;
			const sd: any = symbols?.currentSpinData;
			const apiSd: any = sceneAny?.gameAPI?.currentSpinData;

			for (const spinData of [sd, apiSd]) {
				if (!spinData?.slot) continue;
				if (spinData.slot.hasMaxWin === true) {
					const capped = SpinDataUtils.getSlotTotalWin(spinData);
					if (capped > 0) {
						return capped;
					}
				}
			}

			let best = 0;
			const consider = (value: any) => {
				const numeric = Number(value);
				if (isFinite(numeric) && numeric >= 0) {
					best = Math.max(best, numeric);
				}
			};

			consider(SpinDataUtils.getSlotTotalWin(sd));
			consider(SpinDataUtils.getSlotTotalWin(apiSd));
			consider(SpinDataUtils.getFreespinTotalWin(sd));
			consider(SpinDataUtils.getFreespinTotalWin(apiSd));
			consider((symbols as any)?.lastBonusTotalWin);

			const bonusHeader: any = sceneAny?.bonusHeader;
			consider(bonusHeader?.getResolvedBonusTotalWin?.());
			consider(bonusHeader?.getCurrentWinnings?.());

			if (best > 0) {
				return best;
			}
		} catch {}
		return 0;
	}

	/**
	 * Unfreeze the balance HUD after bonus and tween to the final balance.
	 * Non-demo + freeSpin.items: post-bet wallet + slot.totalWin.
	 * Demo: spinData.balance only (analytics already returns post-feature wallet).
	 */
	private applyBonusExitBalance(tweenDurationMs: number = 220): void {
		if (!this.freezeBalanceUi) return;
		const bonusEndPending =
			!gameStateManager.isBonus ||
			gameStateManager.isBonusFinished ||
			gameStateManager.pendingEndOfBonusSummary;
		if (!bonusEndPending) {
			return;
		}
		const current = Number(this.getBalanceAmount());
		const isDemo = !!this.gameAPI?.getDemoState?.();
		let spinData: SpinData | null = null;
		try {
			if (isDemo) {
				// Prefer trigger/session snapshot — simulateFreeSpin rebuilds currentSpinData without balance.
				spinData =
					this.gameAPI?.getBonusSessionSpinData?.() ??
					this.gameAPI?.getCurrentSpinData?.() ??
					(this.symbols as any)?.currentSpinData ??
					null;
			} else {
				spinData =
					(this.symbols as any)?.currentSpinData ??
					this.gameAPI?.getCurrentSpinData?.() ??
					null;
			}
		} catch {}

		let target: number | null = null;
		const hasFreeSpinItems = SpinDataUtils.getFreespinItemsCount(spinData) > 0;

		if (isDemo) {
			// Demo bonus: trust analytics wallet — do not add totalWin again.
			target = SpinDataUtils.extractBetResponseBalance(spinData)
				?? (this.bonusTriggerWalletBalance !== null ? Number(this.bonusTriggerWalletBalance) : null)
				?? this.extractBalanceFromSpinPayload(spinData);
		} else {
			target = SpinDataUtils.resolveFinalBalanceFromBetResponse(spinData);
			if (hasFreeSpinItems) {
				const base = (this.bonusTriggerWalletBalance !== null)
					? Number(this.bonusTriggerWalletBalance)
					: (this.bonusStartBalanceSnapshot != null ? Number(this.bonusStartBalanceSnapshot) : current);
				const slotTotal = SpinDataUtils.resolveSlotTotalWinForFinalBalance(spinData);
				if (slotTotal > 0) {
					target = Math.round((Math.max(0, base) + slotTotal) * 100) / 100;
				} else if (target === null) {
					let win = Number(this.capturedBonusTotalWin);
					if (!(win > 0)) {
						win = this.resolveBonusTotalWinFromScene();
					}
					target = (isFinite(base) && base >= 0 ? base : 0) + (isFinite(win) && win > 0 ? win : 0);
				}
			} else if (target === null) {
				const balance = this.extractBalanceFromSpinPayload(spinData);
				if (balance === null) {
					return;
				}
				target = balance;
			}
		}

		if (target === null || !Number.isFinite(target)) {
			return;
		}

		this.freezeBalanceUi = false;
		this.bonusExitBalanceApplied = true;
		this.bonusTriggerWalletBalance = null;
		this.bonusStartBalanceSnapshot = null;
		this.deferredBalanceAfterBonus = null;
		if (isFinite(current) && target > current) {
			this.startBalanceTween(target, tweenDurationMs);
		} else {
			this.updateBalanceAmount(target);
		}
		try {
			if (this.gameAPI?.getDemoState()) {
				this.gameAPI.updateDemoBalance(target);
			}
		} catch {}
		console.log(
			'[SlotController] applyBonusExitBalance:',
			'hasItems=', hasFreeSpinItems,
			'target=', target,
			'isDemo=', isDemo,
		);
	}

	/**
	 * Fetch authoritative balance from server after a failed bet.
	 */
	public async refreshBalanceFromServer(options?: { forceServer?: boolean }): Promise<void> {
		if (!options?.forceServer) {
		const __completeDisplay = this.reapplyUnresolvedCompleteBalance();
		if (__completeDisplay === 'applied' || __completeDisplay === 'superseded') {
			return;
		}
		}

		if (this.balanceRefreshInFlight) {
			return this.balanceRefreshInFlight;
		}
		this.balanceRefreshInFlight = this.fetchBalanceFromServerAfterFailedBet(!!options?.forceServer);
		try {
			await this.balanceRefreshInFlight;
		} finally {
			this.balanceRefreshInFlight = null;
		}
	}

	private async fetchBalanceFromServerAfterFailedBet(forceServer = false): Promise<void> {
		if (this.gameAPI?.getReplayState?.()) {
			return;
		}
		let epoch = this.claimBalanceDisplayEpoch();
		if (forceServer) {
			await Promise.resolve();
		}
		try {
			if (!this.gameAPI) {
				return;
			}
			if (this.gameAPI.getDemoState?.()) {
				const balance = this.gameAPI.getDemoBalance();
				if (forceServer) {
					epoch = this.claimBalanceDisplayEpoch();
					const __keptFreeze = (this as any).freezeBalanceUi;
					(this as any).freezeBalanceUi = false;
					try { (this as any).balanceTween?.stop(); } catch {}
					this.updateBalanceAmount(balance, epoch);
					if (__keptFreeze) { (this as any).deferredBalanceAfterBonus = balance; }
					(this as any).freezeBalanceUi = __keptFreeze;
				} else {
					this.updateBalanceAmount(balance, epoch);
				}
				return;
			}
			const response = await this.gameAPI.getBalance();
			const balance = this.parseBalanceFromApiResponse(response);
			const walletTimestamp = readWalletTimestamp(response);
			if (balance === null) {
				console.warn('[SlotController] Balance API response missing numeric balance — reverting optimistic deduction');
				return;
			}
			console.log(`[SlotController] Balance refreshed from server after bet failure: $${balance}`);
			(() => {
				const __keptFreeze = this.freezeBalanceUi;
				this.freezeBalanceUi = false;
				if (forceServer) { epoch = this.claimBalanceDisplayEpoch(); }
				this.updateBalanceAmount(balance, epoch, walletTimestamp);
				this.freezeBalanceUi = __keptFreeze;
			})();
		} catch (error) {
			console.warn('[SlotController] Failed to refresh balance from server — reverting optimistic deduction:', error);
		}
	}

	private parseBalanceFromApiResponse(response: any): number | null {
		const candidates = [response?.data?.balance, response?.balance];
		for (const c of candidates) {
			if (c === undefined || c === null) {
				continue;
			}
			const v = Number(c);
			if (Number.isFinite(v) && v >= 0) {
				return Math.round(Math.max(0, v) * 100) / 100;
			}
		}
		return null;
	}

	private revertOptimisticSpinBetDeduction(epoch?: number): void {
		try {
			const gsmAny: any = gameStateManager as any;
			if (gsmAny.isInFreeSpinRound === true) {
				return;
			}
			if (gameStateManager.isBonus) {
				return;
			}
			const cost = this.getSpinBetCost();
			if (!Number.isFinite(cost) || cost <= 0) {
				return;
			}
			const cur = this.getBalanceAmount();
			if (!Number.isFinite(cur)) {
				return;
			}
			const restored = Math.max(0, Math.round((cur + cost) * 100) / 100);
			this.startBalanceTween(restored, 200, epoch);
			if (this.gameAPI?.getDemoState?.()) {
				this.gameAPI.updateDemoBalance(restored);
			}
		} catch {}
	}

	/** Single recovery path for failed spins so balance refresh runs once per failure. */
	private reconcileFailedSpin(): void {
		if (this.failedSpinRecoveryInFlight) {
			return;
		}
		this.failedSpinRecoveryInFlight = true;
		const runRecovery = () => {
			void (async () => {
				try {
					await this.refreshBalanceFromServer({ forceServer: true });
					this.restoreControlsAfterFailedSpin();
				} catch {
					this.restoreControlsAfterFailedSpin();
				} finally {
					this.failedSpinRecoveryInFlight = false;
				}
			})();
		};
		try {
			this.scene?.time?.delayedCall?.(0, runRecovery);
		} catch {
			runRecovery();
		}
	}

	private restoreControlsAfterFailedSpin(): void {
		const restore = () => {
			try { (this.scene as any)?.symbols?.cancelClientSpinPresentation?.({ restoreSymbols: true, clearPreparedSymbols: true }); } catch {}
			try { gameStateManager.isReelSpinning = false; } catch {}
			try { (gameStateManager as any).isProcessingSpin = false; } catch {}
			this.releaseManualSpinClickLock();
			this.resetManualSpinSkipButtonState();
			try { this.hideSpinner(); } catch {}
			this.updateSpinButtonState();
			this.enableAutoplayButton();
			this.enableBetButtons();
			this.enableFeatureButton();
			this.enableAmplifyButton();
			if (this.autoplaySpinsRemaining > 0 && gameStateManager.isAutoPlaying) {
				console.log('[SlotController] Bet/spin failed during autoplay - scheduling next spin');
				try { this.scheduleNextAutoplaySpin(500); } catch {}
			}
		};
		try {
			if (this.scene?.time?.delayedCall) {
				this.scene.time.delayedCall(0, restore);
				return;
			}
		} catch {}
		setTimeout(restore, 0);
	}

	private finalizeBalanceTweenBeforeSpin(): void {
		if (!this.balanceAnimationInProgress) {
			return;
		}
		const target = this.activeBalanceTweenTarget;
		const epoch = this.activeBalanceTweenEpoch;
		const timestamp = this.activeBalanceTweenTimestamp;
		try { this.balanceTween?.stop(); } catch {}
		this.balanceTween = null;
		this.balanceAnimationInProgress = false;
		this.activeBalanceTweenTarget = null;
		this.activeBalanceTweenEpoch = null;
		this.activeBalanceTweenTimestamp = undefined;
		if (Number.isFinite(target) && (timestamp != null || (epoch != null && epoch === currentBalanceDisplayEpoch()))) {
			this.updateBalanceAmount(Number(target), epoch ?? undefined, timestamp);
		}
	}

	private applyReconciledBalance(newBalance: number, oldBalance: number, epoch?: number, timestamp?: number): void {
		if (isStaleWalletTimestamp(timestamp)) {
			return;
		}
		if (timestamp == null && (epoch == null || this.isStaleBalanceEpoch(epoch))) {
			return;
		}
		if (this.freezeBalanceUi || gameStateManager.isBonus || this.shouldDeferFreeRoundWalletUntilModal()) {
			return;
		}
		if (this.balanceAnimationInProgress) {
			this.pendingServerBalanceForReconcile = newBalance;
			this.pendingServerBalanceEpoch = epoch ?? this.activeBalanceTweenEpoch;
		} else {
			this.startBalanceTween(
				newBalance,
				Math.abs(newBalance - oldBalance) < 0.02 ? 100 : 200,
				epoch,
				timestamp
			);
		}
		if (this.gameAPI?.getDemoState?.()) {
			try { this.gameAPI.updateDemoBalance(newBalance); } catch {}
		}
		try {
			gameEventManager.emit(GameEventType.BALANCE_UPDATE, {
				newBalance,
				previousBalance: oldBalance,
				change: newBalance - oldBalance,
			});
		} catch {}
	}

	/** Charge the bet immediately on spin start (trippy_cat / blockchain_blitz pattern). */
	private applyOptimisticBetDeduction(): void {
		if ((gameStateManager as any)?.isInFreeSpinRound === true || gameStateManager.isBonus) {
			return;
		}
		try {
			this.decrementBalanceByBet();
		} catch {}
	}

	/**
	 * Decrement balance by the current bet amount (frontend only)
	 */
	private decrementBalanceByBet(): void {
		if (this.gameAPI?.getReplayState?.()) {
			return;
		}
		try {
			this.finalizeBalanceTweenBeforeSpin();
			// Get current balance and bet amount
			const currentBalance = this.getBalanceAmount();
			if (!Number.isFinite(currentBalance)) {
				console.warn('[SlotController] Balance not initialized yet; skip optimistic decrement.');
				return;
			}
			const currentBet = this.getBaseBetAmount();
			const gameData = this.getGameData();

			// If Enhanced Bet is active, include the additional 25% in the deducted amount (frontend only)
			const totalBetToCharge = (gameData && gameData.isEnhancedBet)
				? currentBet * 1.25
				: currentBet;
			
			console.log(`[SlotController] Decrementing balance: $${currentBalance} - $${totalBetToCharge} ${gameData && gameData.isEnhancedBet ? '(enhanced bet +25%)' : ''}`);
			
			// Calculate new balance
			const newBalance = Math.max(0, currentBalance - totalBetToCharge); // Ensure balance doesn't go below 0
			
			// Update balance display immediately
			const keptTimestamp = renderedWalletTimestamp();
			this.startBalanceTween(newBalance, 200, undefined, keptTimestamp > 0 ? keptTimestamp : undefined);

			// Sync demo balance if demo mode is active
			if (this.gameAPI?.getDemoState()) {
				this.gameAPI.updateDemoBalance(newBalance);
			}
			
			console.log(`[SlotController] Balance decremented: $${currentBalance} -> $${newBalance} (bet charged: $${totalBetToCharge})`);
			
		} catch (error) {
			console.error('[SlotController] Error decrementing balance:', error);
		}
	}

	getBalanceAmountText(): string | null {
		return this.balanceAmountText ? this.balanceAmountText.text : null;
	}

	getBalanceAmount(): number {
		if (this.balanceAmountText) {
			const rawText = (this.balanceAmountText.text || '').trim();
			if (!rawText || rawText === '-' || rawText === SlotController.BALANCE_PENDING_TEXT || rawText === '\u2014') {
				return Number.NaN;
			}
			const balanceText = CurrencyManager.stripCurrencyPrefix(this.balanceAmountText.text).replace(/,/g, '');
			const parsed = parseFloat(balanceText);
			return Number.isFinite(parsed) ? parsed : Number.NaN;
		}
		return Number.NaN;
	}

	enablePrimaryControllers(): void {
		if (this.primaryControllers) {
			this.primaryControllers.setVisible(true);
			this.primaryControllers.setInteractive(true);
		}
	}

	disablePrimaryControllers(): void {
		if (this.primaryControllers) {
			this.primaryControllers.setVisible(false);
			this.primaryControllers.setInteractive(false);
		}
	}

	/**
	 * Setup event listeners for autoplay state changes
	 */
	private setupAutoplayEventListeners(): void {
		// Listen for balance initialization
		gameEventManager.on(GameEventType.BALANCE_INITIALIZED, (data: any) => {
			console.log('[SlotController] Balance initialized event received:', data);

			const rawBalance = data?.newBalance ?? data?.balance ?? data?.currentBalance;
			const resolvedBalance = Number(rawBalance);
			if (!Number.isFinite(resolvedBalance)) {
				console.warn('[SlotController] BALANCE_INITIALIZED missing numeric balance payload:', data);
				return;
			}
			console.log(`[SlotController] Updating balance display to: $${resolvedBalance}`);
			this.isBalanceInitialized = true;
			const __initEpoch = Number(data?.balanceEpoch);
			this.applyBalanceDisplayResponse(
				resolvedBalance,
				Number.isFinite(__initEpoch) && __initEpoch > 0 ? __initEpoch : undefined,
				readWalletTimestamp(data),
			);
			if (this.pendingSpinUntilBalanceReady && !gameStateManager.isReelSpinning) {
				this.pendingSpinUntilBalanceReady = false;
				try {
					this.scene?.time?.delayedCall?.(0, () => {
						void this.handleSpin();
					});
				} catch {
					void this.handleSpin();
				}
			}
		});

		// Listen for any spin to start (manual or autoplay)
		gameEventManager.on(GameEventType.SPIN, () => {
			console.log('[SlotController] Spin event received');
			this.beginWalletCycleForSpinLikeAction();
			this.bonusExitBalanceApplied = false;
			this.disableFeatureButton();

			// CRITICAL: Block autoplay spins if win dialog is showing, but allow manual spins
			// This fixes the timing issue where manual spin button animation was blocked
			if (gameStateManager.isShowingWinDialog && this.gameData?.isAutoPlaying) {
				console.log('[SlotController] Autoplay SPIN event BLOCKED - win dialog is showing');
				console.log('[SlotController] Manual spins are still allowed to proceed');
				return;
			}
			
			// Check if free spin autoplay is active - if so, don't play spin button animation
			const symbolsComponent = (this.scene as any).symbols;
			if (symbolsComponent && typeof symbolsComponent.isFreeSpinAutoplayActive === 'function' && symbolsComponent.isFreeSpinAutoplayActive()) {
				console.log('[SlotController] Free spin autoplay is active - skipping spin button animation');
				return;
			}
			
			if (!this.isAutoplaySpinControlActive() && this.currentSpinAllowsManualButtonSkip) {
				try {
					this.scene?.time.delayedCall(0, () => this.refreshManualSpinSkipButtonVisual());
				} catch {}
			} else if (this.isAutoplaySpinControlActive()) {
				this.currentSpinAllowsManualButtonSkip = false;
				this.manualSpinSkipConsumedForCurrentSpin = false;
				this.syncAutoplaySpinButtonVisual();
			} else if (!gameStateManager.isAutoPlaying) {
				this.disableSpinButton();
			}
			
			// Play the spin button spine animation for all spins (manual and autoplay)
			this.playSpinButtonAnimation();
			
			// Rotate the spin button for all spins (manual and autoplay)
			this.rotateSpinButton();
			
			
			// Removed pulsing of autoplay spins remaining text during spin
			
			// Log current GameData animation values to debug turbo mode
			console.log('[SlotController] Spin started - GameData animation values:', this.getGameDataAnimationInfo());
			
			// Ensure turbo speed is applied to scene GameData before winline animations start
			this.forceApplyTurboToSceneGameData();
			
			// Ensure turbo speed is applied to winline animations via Symbols component
			this.applyTurboToWinlineAnimations();
		});

		// Listen for reels start to disable amplify button
		gameEventManager.on(GameEventType.REELS_START, () => {
			console.log('[SlotController] Reels started - disabling amplify button');
			if (this.isAutoplaySpinControlActive()) {
				this.syncAutoplaySpinButtonVisual();
			} else if (this.currentSpinAllowsManualButtonSkip) {
				this.refreshManualSpinSkipButtonVisual();
			}
			this.balanceApiCalledThisSpin = false; // Reset guard for new spin
			this.disableFeatureButton();
			this.disableAmplifyButton();
			// Decrement normal autoplay spins at start of reels
			if (this.autoplaySpinsRemaining > 0 && gameStateManager.isAutoPlaying && !gameStateManager.isBonus) {
				if (!this.hasDecrementedAutoplayForCurrentSpin) {
					this.autoplaySpinsRemaining = Math.max(0, this.autoplaySpinsRemaining - 1);
					this.updateAutoplaySpinsRemainingText(this.autoplaySpinsRemaining);
					this.hasDecrementedAutoplayForCurrentSpin = true;
					console.log(`[SlotController] Autoplay decremented on REELS_START. Remaining: ${this.autoplaySpinsRemaining}`);

					// If this autoplay session is a freeround autoplay, broadcast remaining spins
					// so FreeRoundManager can update its text display.
					if (this.isFreeRoundAutoplay && this.scene) {
						this.scene.events.emit('freeround-autoplay-remaining', this.autoplaySpinsRemaining);
					}
					
					// Re-enable spin button interaction after first autoplay spin is triggered in normal mode
					if (this.shouldReenableSpinButtonAfterFirstAutoplay) {
						const spinButton = this.buttons.get('spin');
						if (spinButton) {
							this.setSpinButtonInputEnabled(true);
							this.shouldReenableSpinButtonAfterFirstAutoplay = false;
							console.log('[SlotController] Re-enabled spin button interaction after first autoplay spin');
						}
					}
				}
			}
			// During bonus mode, sync the free spin display exactly when reels start
			if (gameStateManager.isBonus) {
				try {
					const symbolsComponent = (this.scene as any)?.symbols;
					if (symbolsComponent && this.freeSpinNumber) {
						const rem = symbolsComponent.freeSpinAutoplaySpinsRemaining;
						if (typeof rem === 'number') {
							this.updateFreeSpinNumber(rem);
							console.log(`[SlotController] REELS_START: synced free spin display to ${rem}`);
						}
					}
				} catch (e) {
					console.warn('[SlotController] Failed to sync free spin display on REELS_START:', e);
				}
			}
		});

		gameEventManager.on(GameEventType.REELS_STOP, () => {
			console.log('[SlotController] Reels stopped event received - updating spin button state');
			// Reset decrement guard for next spin
			this.hasDecrementedAutoplayForCurrentSpin = false;
			
			// Apply deferred wallet after reel animation (no-win spins only).
			this.applyDeferredWalletBalanceAfterAnimation('reels-stop');
			
			// Apply pending balance update now that reels have stopped spinning (skipped in replay)
			if (this.pendingBalanceUpdate && !this.freezeBalanceUi && !this.shouldDeferFreeRoundWalletUntilModal()) {
				if (this.gameAPI?.getReplayState?.()) {
					this.pendingBalanceUpdate = null;
					console.log('[SlotController] Cleared pending balance update without applying (replay mode)');
				} else {
					console.log('[SlotController] Applying pending balance update after reels stopped:', this.pendingBalanceUpdate);
					if (this.pendingBalanceUpdate.balance !== undefined) {
						const oldBalance = this.getBalanceAmountText();
						this.startBalanceTween(this.pendingBalanceUpdate.balance, 320);
						if (this.pendingBalanceUpdate.winnings && this.pendingBalanceUpdate.winnings > 0) {
							console.log(`[SlotController] Balance updated after reels stopped: ${oldBalance} -> ${this.pendingBalanceUpdate.balance} (added winnings: ${this.pendingBalanceUpdate.winnings})`);
						} else {
							console.log(`[SlotController] Balance updated after reels stopped: ${oldBalance} -> ${this.pendingBalanceUpdate.balance}`);
						}
					}
					this.pendingBalanceUpdate = null;
					console.log('[SlotController] Pending balance update cleared');
				}
			} else {
				console.log('[SlotController] No pending balance update to apply');
			}
			
			// If we're in bonus mode, check if free spins are finishing now
			if (gameStateManager.isBonus) {
				try {
					const gameScene: any = this.scene as any;
					const symbolsComponent = gameScene?.symbols;
					
					// Check if there's a pending scatter retrigger that will add more free spins
					// If so, don't set isBonusFinished because the bonus will continue
					const hasPendingRetrigger = symbolsComponent && typeof symbolsComponent.hasPendingScatterRetrigger === 'function' 
						? symbolsComponent.hasPendingScatterRetrigger() 
						: false;
					
					if (hasPendingRetrigger) {
						console.log('[SlotController] REELS_STOP: Pending scatter retrigger detected - NOT setting isBonusFinished (bonus will continue)');
					} else {
						// Prefer Symbols' remaining counter if available
						if (symbolsComponent && typeof symbolsComponent.freeSpinAutoplaySpinsRemaining === 'number') {
							const remaining: number = symbolsComponent.freeSpinAutoplaySpinsRemaining;
							// If after this spin there are no spins remaining, flag bonus finished
							if (remaining <= 0) {
								console.log('[SlotController] REELS_STOP: remaining free spins <= 0 – setting isBonusFinished=true');
								gameStateManager.isBonusFinished = true;
							}
						} else if (this.gameAPI && typeof this.gameAPI.getCurrentSpinData === 'function') {
							// Fallback: inspect GameAPI spin data for remaining spins
							const apiSpinData: any = this.gameAPI.getCurrentSpinData();
							const fs = apiSpinData?.slot?.freespin || apiSpinData?.slot?.freeSpin;
							if (fs?.items && Array.isArray(fs.items)) {
								const totalRemaining = fs.items.reduce((sum: number, it: any) => sum + (it?.spinsLeft || 0), 0);
								if (totalRemaining <= 1) {
									console.log('[SlotController] REELS_STOP: totalRemaining free spins <= 1 – setting isBonusFinished=true');
									gameStateManager.isBonusFinished = true;
								}
							}
						}
					}
				} catch (e) {
					console.warn('[SlotController] REELS_STOP: Unable to evaluate bonus finish state:', e);
				}
			}
			
			// If scatter bonus just triggered or bonus mode is active, keep buttons disabled
			if (gameStateManager.isScatter || gameStateManager.isBonus) {
				console.log('[SlotController] Scatter/Bonus active - keeping buttons disabled on REELS_STOP');
				return;
			}

			// Win dialog visible or post-TotalWin cool-down — do not re-enable yet.
			if (gameStateManager.isShowingWinDialog || this.winDialogControlsLocked) {
				console.log('[SlotController] Win dialog / cool-down active - keeping buttons disabled on REELS_STOP');
				this.lockBaseControls();
				return;
			}

			if (this.isAwaitingAuthoritativeSpinBalance()) {
				console.log('[SlotController] Awaiting response balance - deferring REELS_STOP restore until balance settles');
				this.schedulePostSpinControlsRefresh();
				return;
			}

			// If we are in initialization free-round mode, keep autoplay/bet controls
			// disabled/greyed-out for the duration of the free rounds. Only the spin
			// button is re-enabled between spins (turbo stays toggle-able and is never disabled).
			const gsmAny: any = gameStateManager as any;
			if (gsmAny.isInFreeSpinRound === true) {
				this.updateSpinButtonState();
				console.log('[SlotController] Initialization free-round mode active - re-enabled spin on REELS_STOP');
				return;
			}
			
			// Check if free spin autoplay is active - if so, don't re-enable buttons
			const symbolsComponent = (this.scene as any).symbols;
			if (symbolsComponent && typeof symbolsComponent.isFreeSpinAutoplayActive === 'function' && symbolsComponent.isFreeSpinAutoplayActive()) {
				console.log('[SlotController] Free spin autoplay is active - keeping buttons disabled');
				return;
			}
			
			// Note: autoplaySpinsRemaining is decremented in WIN_STOP handler after win processing
			
			// Note: AUTO_STOP is now emitted in WIN_STOP handler after stopAutoplay() is called
			
			// For manual spins, re-enable spin button and hide autoplay counter immediately after REELS_STOP
			// Check autoplay counter instead of state manager to avoid timing issues
			if (this.autoplaySpinsRemaining === 0) {
				this.releaseManualSpinClickLock();
				if (!this.isManualSpinPresentationActive()) {
					this.resetManualSpinSkipButtonState();
				}
				this.updateSpinButtonState();
				this.enableAutoplayButton();
				this.enableTurboButton();
				this.enableBetButtons();
				// Keep feature disabled during bonus or until explicitly allowed
				if (!this.shouldKeepBaseControlsLocked() && this.canEnableFeatureButton) {
					this.enableFeatureButton();
				}
				this.enableAmplifyButton();
				this.enableBetBackgroundInteraction('after manual spin REELS_STOP');
				this.hideAutoplaySpinsRemainingText();
				this.updateAutoplayButtonState();
				this.updateTurboButtonState();
				console.log('[SlotController] Manual spin - all buttons re-enabled after REELS_STOP');
				return;
			}
			
			// Update spin button state when spin completes
			// Only enable spin button if not autoplaying AND reels are not spinning
			if(!this.gameData?.isAutoPlaying && !gameStateManager.isReelSpinning) {
				this.releaseManualSpinClickLock();
				this.resetManualSpinSkipButtonState();
				this.updateSpinButtonState();
				this.enableAutoplayButton();
				this.enableTurboButton();
				this.enableBetButtons();
				// Keep feature disabled during bonus or until explicitly allowed
				if (!this.shouldKeepBaseControlsLocked() && this.canEnableFeatureButton) {
					this.enableFeatureButton();
				}
				this.enableAmplifyButton();
				this.enableBetBackgroundInteraction('after manual spin complete');
				this.updateTurboButtonState();
				console.log('[SlotController] All buttons enabled - manual spin completed and reels stopped');
				return;
			}
			
			if (this.gameData?.isAutoPlaying) {
				console.log('[SlotController] Spin button remains disabled - autoplay active');
			} else if (gameStateManager.isReelSpinning && this.currentSpinAllowsManualButtonSkip) {
				this.refreshManualSpinSkipButtonVisual();
			} else if (this.isAutoplaySpinControlActive()) {
				this.syncAutoplaySpinButtonVisual();
			} else if (gameStateManager.isReelSpinning) {
				console.log('[SlotController] Spin button remains disabled - reels still spinning');
			}
		});

		// Listen for autoplay start
		gameEventManager.on(GameEventType.AUTO_START, () => {
			console.log('[SlotController] Autoplay started - changing button to ON state');
			
			// Update GameData autoplay state
			if (this.gameData) {
				this.gameData.isAutoPlaying = true;
				console.log('[SlotController] Updated GameData.isAutoPlaying to true');
			}
			
			this.setAutoplayButtonState(true);
			this.currentSpinAllowsManualButtonSkip = false;
			this.manualSpinSkipConsumedForCurrentSpin = false;
			this.disableAmplifyButton();
			this.enableAutoplaySessionHudControls();
			this.syncAutoplaySpinButtonVisual();
			try {
				const spinButton = this.buttons.get('spin');
				if (spinButton) {
					this.applySpinButtonVisualTint(null);
					this.setSpinButtonInputEnabled(true);
				}
			} catch {}
		});

		// Listen for autoplay stop
		gameEventManager.on(GameEventType.AUTO_STOP, () => {
			console.log('[SlotController] AUTO_STOP event received');
			console.log('[SlotController] Current state - isAutoPlaying:', gameStateManager.isAutoPlaying, 'isReelSpinning:', gameStateManager.isReelSpinning);
			console.log('[SlotController] Autoplay counter:', this.autoplaySpinsRemaining);
			
			// Always reset autoplay UI when AUTO_STOP is received
			// (AUTO_STOP should only be emitted when autoplay is finished)
			console.log('[SlotController] Resetting autoplay UI on AUTO_STOP');
			
			// Reset autoplay button to off
			this.setAutoplayButtonState(false);
			console.log('[SlotController] Autoplay button set to OFF');
			
			// Hide autoplay spin count display
			this.hideAutoplaySpinsRemainingText();
			console.log('[SlotController] Autoplay spin count hidden');

			// GameStateManager clears isAutoPlaying on AUTO_STOP, but gameData.isAutoPlaying
			// can remain true and block restore via isBuyFeatureInteractionBlocked / updateSpinButtonState.
			this.finalizeAutoplaySessionEnd();

			// If the current spin/tumble is still resolving, DO NOT re-enable controls yet.
			// Stopping autoplay should not allow starting a new spin while reels are still spinning / processing.
			const isSpinStillActive =
				gameStateManager.isReelSpinning ||
				gameStateManager.isProcessingSpin ||
				gameStateManager.isShowingWinlines ||
				gameStateManager.isShowingWinDialog ||
				gameStateManager.isBonusExitTransitionActive ||
				this.winDialogControlsLocked;

			// If we are in initialization free-round mode, do not re-enable autoplay
			// or bet controls here; they stay disabled/greyed-out until free rounds
			// are fully completed.
			const gsmAny: any = gameStateManager as any;
			if (gsmAny.isInFreeSpinRound === true && !gameStateManager.isBonus) {
				// Session finished but free-round UI stays until completion panel closes.
				this.updateSpinButtonState();
				console.log('[SlotController] AUTO_STOP during initialization free-round mode - kept autoplay/bet controls disabled');
				return;
			}

			if (isSpinStillActive) {
				// Keep everything locked until REELS_STOP/WIN_STOP fully complete.
				this.lockBaseControls();
				this.scheduleRestoreControlsPoll();
				console.log('[SlotController] AUTO_STOP while spin still active - kept controls disabled');
				return;
			}

			// Spin pipeline idle — clear stale winline latch before restoring.
			try { gameStateManager.isShowingWinlines = false; } catch {}
			
			this.restoreBaseControls();
			if (!this.isManualSpinPresentationActive()) {
				this.resetManualSpinSkipButtonState();
			} else if (this.currentSpinAllowsManualButtonSkip) {
				this.refreshManualSpinSkipButtonVisual();
			} else {
				this.hideSpinSkipButtonMode(false);
			}
			this.restoreBaseGameControlsAfterIdleSpin();
			console.log('[SlotController] Spin, autoplay, bet, feature, and amplify buttons enabled');
			
			console.log('[SlotController] Autoplay UI reset completed');
		});

		// Spin HTTP/network failure — reconcile balance + restore HUD.
		// BET_FAILED pauses autoplay (auto-close + resume); NETWORK_OFFLINE stops autoplay.
		gameEventManager.on(GameEventType.BET_FAILED_ERROR, (data) => {
			console.log('[SlotController] BET_FAILED_ERROR received - restoring reels and controls');
			const popupType = (data as BetFailedErrorEventData | undefined)?.popupType;
			if (this.isAutoplayUiActive()) {
				if (popupType === ModalType.BET_FAILED) {
					this.pauseAutoplayForBetFailedPopup();
				} else {
					try {
						this.stopAutoplay({ userInitiated: false, reason: 'system:spin-api-error' });
					} catch {}
				}
			}
			this.restoreControlsAfterFailedSpin();
		});

		gameEventManager.on(GameEventType.BET_FAILED_POPUP_CLOSED, () => {
			if (!this.autoplayPausedForBetFailedPopup) {
				return;
			}
			this.autoplayPausedForBetFailedPopup = false;
			if (!this.isAutoplayUiActive()) {
				return;
			}

			console.log('[SlotController] Bet failed popup closed - scheduling next autoplay spin');
			const baseDelay = 250;
			const gameData = this.getGameData();
			const isTurbo = gameData?.isTurbo || false;
			const totalDelay = isTurbo ? baseDelay * TurboConfig.TURBO_DELAY_MULTIPLIER : baseDelay;
			this.scheduleNextAutoplaySpin(totalDelay);
		});

		gameEventManager.on(GameEventType.SPIN_RESPONSE_FAILED, () => {
			console.log('[SlotController] SPIN_RESPONSE_FAILED received - reconciling failed spin');
			this.reconcileFailedSpin();
		});


		// Listen for when reels stop spinning to enable spin button for manual spins
		gameEventManager.on(GameEventType.WIN_START, () => {
			try {
				this.onWinStartBalancePresentation();
			} catch {}
		});

		gameEventManager.on(GameEventType.WIN_STOP, () => {
			console.log('[SlotController] WIN_STOP received - checking if spin button should be enabled');
			try {
				if (!gameStateManager.isBonus && !this.freezeBalanceUi && !this.shouldDeferFreeRoundWalletUntilModal()) {
					this.flushPendingWalletBalanceFromSpin(this.balanceAnimSpinToken);
				}
				this.applyDeferredWalletBalanceAfterAnimation('win-stop');
			} catch {}
			this.schedulePostSpinControlsRefresh();

			// Safety: late tumble WIN_START or balance tween can race past the first restore pass.
			try {
				this.scene?.time?.delayedCall?.(1200, () => {
					try { this.restoreBaseGameControlsAfterIdleSpin(); } catch {}
				});
			} catch {}

			// If scatter bonus is in progress or bonus mode is active, keep buttons disabled
			if (gameStateManager.isScatter || gameStateManager.isBonus) {
				console.log('[SlotController] Scatter/Bonus in progress - skipping UI re-enable in WIN_STOP');
				return;
			}
			
			// Check if free spin autoplay is active - if so, don't re-enable buttons
			const symbolsComponent = (this.scene as any).symbols;
			if (symbolsComponent && typeof symbolsComponent.isFreeSpinAutoplayActive === 'function' && symbolsComponent.isFreeSpinAutoplayActive()) {
				console.log('[SlotController] Free spin autoplay is active - skipping button re-enable in WIN_STOP');
				return;
			}
			
			// Handle autoplay spin completion
			// Check if autoplay is active by checking both the counter and the game state
			const isAutoplayActive = this.autoplaySpinsRemaining > 0 || gameStateManager.isAutoPlaying;
			
			if (isAutoplayActive) {
				console.log('[SlotController] Autoplay spin completed, checking for next spin');
				console.log(`[SlotController] Autoplay state: spinsRemaining=${this.autoplaySpinsRemaining}, isAutoPlaying=${gameStateManager.isAutoPlaying}`);
				
				// Decrement now handled at REELS_START for normal autoplay
				
				// Check if a win dialog is showing - pause autoplay if so
				if (gameStateManager.isShowingWinDialog) {
					console.log('[SlotController] Win dialog is showing - pausing autoplay until dialog closes');
					return;
				}

				if (this.autoplayPausedForBetFailedPopup) {
					console.log('[SlotController] Bet failed popup is showing - pausing autoplay until popup closes');
					return;
				}
				
				// Only schedule next spin if we have spins remaining
				if (this.autoplaySpinsRemaining > 0 && !gameStateManager.isShowingWinDialog) {
					console.log(`[SlotController] Scheduling next autoplay spin. ${this.autoplaySpinsRemaining} spins remaining`);
					// WIN_STOP is emitted both for no wins (immediately) and after first win loop
					// Apply turbo to the delay
					const baseDelay = 500;
					// FIXED: Use GameData.isTurbo instead of gameStateManager.isTurbo for consistency
					const gameData = this.getGameData();
					const isTurbo = gameData?.isTurbo || false;
					const turboDelay = isTurbo ? 
						baseDelay * TurboConfig.TURBO_DELAY_MULTIPLIER : baseDelay;
					console.log(`[SlotController] Autoplay delay: ${baseDelay}ms -> ${turboDelay}ms (turbo: ${isTurbo})`);
					this.scheduleNextAutoplaySpin(turboDelay);
				} else {
					console.log('[SlotController] No autoplay spins remaining - autoplay finished');
					// Emit AUTO_STOP when autoplay is truly finished
					gameEventManager.emit(GameEventType.AUTO_STOP);
				}
			} else {
				console.log('[SlotController] Manual spin completed - restoring controls');
				try {
					if (this.gameData && !this.isAutoplaySpinControlActive()) {
						this.gameData.isAutoPlaying = false;
					}
				} catch {}
				try { this.restoreBaseGameControlsAfterIdleSpin(); } catch {}
				this.schedulePostSpinControlsRefresh();
			}
		});

		gameEventManager.on(GameEventType.TUMBLE_SEQUENCE_DONE, () => {
			if (gameStateManager.isScatter || gameStateManager.isBonus) {
				return;
			}
			if (this.isAutoplaySpinControlActive()) {
				return;
			}
			this.schedulePostSpinControlsRefresh();
		});

		// Listen for win dialog *closing* (the synchronous click signal) to engage the cool-down.
		// Per WIN_DIALOG_COOLDOWN_PORTING_GUIDE: TotalWin / MaxWin only — Congrats_KA and MaxWin.
		gameEventManager.on(GameEventType.WIN_DIALOG_CLOSING, (data?: any) => {
			const dialogType = (data as any)?.dialogType;
			if (dialogType !== 'Congrats_KA' && dialogType !== 'MaxWin') return;

			// Engage the cool-down BEFORE Dialogs.ts clears gameStateManager.isShowingWinDialog
			// (via resetGameStateForNewSpin, which runs on the same tick right after this emit).
			// Schedule the timer here — not from WIN_DIALOG_CLOSED — so the delay starts at click
			// time and isn't dependent on the WIN_DIALOG_CLOSED payload arriving with the right
			// dialogType.
			//
			// The cool-down applies to every close (manual AND autoplay continuation / paused-
			// resume) — the timer's callback below routes back to autoplay if there are still
			// spins to run.
			//
			// If a previous cool-down timer is still pending, cancel it and start fresh so the lock
			// is held for the full window after the *latest* Congrats close.
			this.winDialogCooldownTimer?.remove(false);
			this.winDialogCooldownTimer = null;

			this.winDialogControlsLocked = true;
			try { this.disableSpinButton(); } catch { }
			try { this.disableAutoplayButton(); } catch { }
			try { this.disableBetButtons(); } catch { }
			try { this.disableAmplifyButton(); } catch { }
			try { this.disableTurboButton(); } catch { }
			try { this.disableFeatureButton(); } catch { }
			try { this.disableBetBackgroundInteraction('winDialogCooldown'); } catch { }

			if (!this.scene?.time?.delayedCall) {
				console.warn('[SlotController] Cannot schedule win-dialog cool-down — scene timer missing');
				this.winDialogControlsLocked = false;
				return;
			}

			console.log(
				`[SlotController] Win-dialog cool-down started (${WIN_DIALOG_CONTROLS_REENABLE_DELAY_MS}ms, dialog=${dialogType})`,
			);

			this.winDialogCooldownTimer = this.scene.time.delayedCall(WIN_DIALOG_CONTROLS_REENABLE_DELAY_MS, () => {
				this.winDialogCooldownTimer = null;
				this.winDialogControlsLocked = false;
				console.log('[SlotController] Win-dialog cool-down expired — restoring controls');

				// Route the post-cool-down restore based on autoplay state:
				//   1) Paused-with-cached-spins → resumeAutoplayFromPause() (the retry-safe path).
				//   2) Active autoplay with spins remaining → scheduleNextAutoplaySpin(0).
				//   3) Otherwise → manual restore via the individual enable* methods (sugar_wonderland
				//      has no tryRestoreControlsAfterSpin / updateAllAuxiliaryButtonStates helper).
				try {
					this.canEnableFeatureButton = true;
					if (this.pausedAutoplaySpinsRemaining > 0) {
						this.resumeAutoplayFromPause();
						return; // startAutoplay → enableAutoplaySessionHudControls
					}
					if (this.autoplaySpinsRemaining > 0 && gameStateManager.isAutoPlaying) {
						this.enableAutoplaySessionHudControls();
						this.scheduleNextAutoplaySpin(0);
						return;
					}

					// Manual restore. Each enable* method has its own state checks; with the
					// cool-down lock cleared above, shouldKeepBaseControlsLocked() reflects only
					// scatter/bonus/exit-transition again.
					if (gameStateManager.isScatter || gameStateManager.isBonus) return;
					if (gameStateManager.isReelSpinning || gameStateManager.isProcessingSpin) return;
					if (gameStateManager.isShowingWinDialog) return;
					if (this.isAwaitingAuthoritativeSpinBalance()) {
						this.schedulePostSpinControlsRefresh();
						return;
					}

					this.restoreBaseGameControlsAfterIdleSpin();
				} catch { }
			}) ?? null;
		});

		// Listen for win dialog close (for high winnings case)
		gameEventManager.on(GameEventType.WIN_DIALOG_CLOSED, () => {
			console.log('[SlotController] WIN_DIALOG_CLOSED received');
			console.log('[SlotController] Current autoplay state:', {
				autoplaySpinsRemaining: this.autoplaySpinsRemaining,
				isAutoPlaying: gameStateManager.isAutoPlaying,
				isShowingWinDialog: gameStateManager.isShowingWinDialog
			});
			try {
				if (!this.freezeBalanceUi && !gameStateManager.isBonus && !gameStateManager.isScatter && !this.shouldDeferFreeRoundWalletUntilModal()) {
					this.flushPendingWalletBalanceFromSpin(this.balanceAnimSpinToken);
				}
			} catch {}
			try {
				this.applyBonusExitBalance(320);
			} catch {}

			if (gameStateManager.isScatter || gameStateManager.isBonus) {
				console.log('[SlotController] WIN_DIALOG_CLOSED in bonus/scatter - Symbols handles continuation');
				return;
			}

			// If autoplay is active and win dialog was closed, schedule the next spin.
			// Note: autoplaySpinsRemaining was already decremented in WIN_STOP handler.
			if (this.autoplaySpinsRemaining > 0) {
				console.log('[SlotController] Scheduling next autoplay spin after closing Win Dialog');
				const baseDelay = 0;
				const gameData = this.getGameData();
				const isTurbo = gameData?.isTurbo || false;
				const turboDelay = isTurbo ?
					baseDelay * TurboConfig.TURBO_DELAY_MULTIPLIER : baseDelay;
				console.log(`[SlotController] Autoplay delay: ${baseDelay}ms -> ${turboDelay}ms (turbo: ${isTurbo})`);
				this.scheduleNextAutoplaySpin(turboDelay);
				return;
			}

			if (gameStateManager.isAutoPlaying || this.gameData?.isAutoPlaying) {
				console.log('[SlotController] Finalizing autoplay after dialog close - stopping and emitting AUTO_STOP');
				this.stopAutoplay();
				gameEventManager.emit(GameEventType.AUTO_STOP);
				return;
			}

			// Manual base-game win dialog: AUTO_STOP locked controls while the dialog was visible.
			// Congrats/MaxWin use winDialogControlsLocked + cool-down timer instead.
			if (this.winDialogControlsLocked) {
				console.log('[SlotController] WIN_DIALOG_CLOSED - deferring restore to win-dialog cool-down');
				return;
			}
			if (gameStateManager.isReelSpinning || gameStateManager.isProcessingSpin) {
				console.log('[SlotController] WIN_DIALOG_CLOSED - spin still active, deferring restore to REELS_STOP');
				return;
			}

			console.log('[SlotController] WIN_DIALOG_CLOSED - restoring controls after manual win dialog');
			this.restoreBaseGameControlsAfterIdleSpin();
			this.schedulePostSpinControlsRefresh();
		});

		// Note: SPIN_RESPONSE event listeners removed - now using SPIN_DATA_RESPONSE
	}

	/**
	 * Handle turbo button click - toggle between on and off states
	 */
	private handleTurboButtonClick(): void {
		// Check GameData state to determine current turbo status
		const gameData = this.getGameData();
		if (!gameData) {
			console.error('[SlotController] GameData not available for turbo button click');
			return;
		}
		
		if (gameData.isTurbo) {
			// Turbo is active, turn it off
			console.log('[SlotController] Turning turbo OFF via button click');
			gameData.isTurbo = false;
			this.setTurboButtonState(false);
		} else {
			// Turbo is not active, turn it on
			console.log('[SlotController] Turning turbo ON via button click');
			gameData.isTurbo = true;
			this.setTurboButtonState(true);
		}
		
		// Apply turbo speed modifications
		this.applyTurboSpeedModifications();
		
		// Force apply turbo to scene GameData (used by Symbols component)
		this.forceApplyTurboToSceneGameData();
		
		// Apply turbo to winline animations via Symbols component
		this.applyTurboToWinlineAnimations();
		
		// Emit turbo event for other components to handle
		EventBus.emit('turbo', gameData.isTurbo);
		
		// Send turbo state to backend for speed modifications
		if (gameData.isTurbo) {
			gameEventManager.emit(GameEventType.TURBO_ON);
		} else {
			gameEventManager.emit(GameEventType.TURBO_OFF);
		}
		
		console.log(`[SlotController] Turbo state changed to: ${gameData.isTurbo} and sent to backend`);
	}

	/**
	 * Handle amplify button click - toggle between on and off states
	 */
	private handleAmplifyButtonClick(): void {
		if (this.isInitializationFreeRoundActive()) {
			return;
		}
		// Ignore clicks during autoplay - button should be disabled, this is a safety guard
		if (gameStateManager.isAutoPlaying) {
			return;
		}
		// Check GameData state to determine current amplify bet status
		const gameData = this.getGameData();
		if (!gameData) {
			console.error('[SlotController] GameData not available for amplify button click');
			return;
		}
		
		if (gameData.isEnhancedBet) {
			// Amplify bet is active, turn it off
			console.log('[SlotController] Turning amplify bet OFF via button click');
			gameData.isEnhancedBet = false;
			this.setAmplifyButtonState(false);
			// Hide the animation when turning off
			this.hideAmplifyBetAnimation();
			this.hideEnhanceBetIdleLoop();
			// Restore original bet amount (remove 25% increase)
			this.restoreOriginalBetAmount();

			// Re-enable Buy Feature button now that enhance/amplify bet is OFF
			if (!gameStateManager.isBonus) {
				this.enableFeatureButton();
			}
		} else {
			// Amplify bet is not active, turn it on
			console.log('[SlotController] Turning amplify bet ON via button click');
			gameData.isEnhancedBet = true;
			this.setAmplifyButtonState(true);
			// Trigger animation when turning ON
			this.triggerAmplifyBetAnimation();
			// Apply 25% bet increase
			this.applyAmplifyBetIncrease();

			// Disable Buy Feature button while enhance/amplify bet is ON
			this.disableFeatureButton();
		}
		
		// Control the amplify bet button pulsing based on state
		this.controlAmplifyBetAnimation();
		
		// Emit amplify event for other components to handle
		EventBus.emit('amplify', gameData.isEnhancedBet);
		
		console.log(`[SlotController] Amplify bet state changed to: ${gameData.isEnhancedBet}`);

		// Refresh affordability when amplify toggles
		this.updateSpinButtonState();
	}

	/**
	 * Handle autoplay button click - either start autoplay or stop if already running
	 */
	private handleAutoplayButtonClick(): void {
		// Check if autoplay is currently active
		if (this.autoplaySpinsRemaining > 0) {
			// Autoplay is active, stop it
			console.log('[SlotController] Stopping autoplay via button click');
			this.stopAutoplay();
		} else {
			// Autoplay is not active, show options to start it
			console.log('[SlotController] Showing autoplay options');
			EventBus.emit('autoplay');
		}
	}

	/**
	 * Start autoplay with specified number of spins
	 */
	public startAutoplay(spins: number): void {
		console.log(`[SlotController] Starting autoplay with ${spins} spins`);

		// Safety: if we're not in any free spin / bonus context, ensure we treat this
		// as a normal base-game autoplay (not a leftover freeround autoplay state).
		const inFreeRoundContext =
			gameStateManager.isBonus ||
			((gameStateManager as any).isInFreeSpinRound === true);
		if (!inFreeRoundContext) {
			this.isFreeRoundAutoplay = false;
		}

		// Update state
		this.autoplaySpinsRemaining = spins;
		
		// Update GameData and GameStateManager
		if (this.gameData) {
			this.gameData.isAutoPlaying = true;
		}
		gameStateManager.isAutoPlaying = true;
		console.log('[SlotController] Set gameStateManager.isAutoPlaying to true for autoplay start');
		
		// Update UI
		this.setAutoplayButtonState(true);

		this.currentSpinAllowsManualButtonSkip = false;
		this.manualSpinSkipConsumedForCurrentSpin = false;

		// For normal autoplay, show the SlotController autoplay counter and stop icon.
		// For dedicated freeround autoplay / bonus context, rely on FreeRoundManager
		// or bonus UI instead and hide the base-game autoplay visuals.
		if (this.isFreeRoundAutoplay || inFreeRoundContext) {
			this.hideAutoplaySpinsRemainingText();
		} else {
			this.showAutoplaySpinsRemainingText();
			this.updateAutoplaySpinsRemainingText(spins);
			
			// Disable spin button interaction for normal mode autoplay until first spin is triggered
			const spinButton = this.buttons.get('spin');
			if (spinButton) {
				this.setSpinButtonInputEnabled(false);
				this.shouldReenableSpinButtonAfterFirstAutoplay = true;
				console.log('[SlotController] Disabled spin button interaction - will re-enable after first autoplay spin');
			}
		}
		this.syncAutoplaySpinButtonVisual();
		
		// Keep spin button enabled during autoplay (allow stopping autoplay)
		this.disableBetButtons();
		this.disableFeatureButton();

		// After bonus exit the Congrats cool-down greys out HUD controls; restore
		// autoplay stop + turbo toggle when resuming a paused session.
		this.enableAutoplaySessionHudControls();
		
		// Start the first autoplay spin immediately
		this.performAutoplaySpin();
	}

	/**
	 * Start a dedicated "freeround autoplay" sequence.
	 * This uses the same internal autoplay system, but is logged separately so we can
	 * distinguish it from normal autoplay in debugging/analytics.
	 */
	public startFreeRoundAutoplay(spins: number): void {
		console.log(`[SlotController] Starting freeround autoplay with ${spins} spins`);
		this.isFreeRoundAutoplay = true;
		this.startAutoplay(spins);
	}

	/**
	 * Clear live autoplay session flags when AUTO_STOP indicates the session ended.
	 * Skips manual-spin AUTO_STOP noise and preserves paused-autoplay cache waiting for bonus resume.
	 */
	private finalizeAutoplaySessionEnd(): void {
		const pausedForBonusResume =
			this.pausedAutoplaySpinsRemaining != null && this.pausedAutoplaySpinsRemaining > 0;

		const sessionStillMarkedActive =
			!!this.gameData?.isAutoPlaying ||
			gameStateManager.isAutoPlaySpinRequested ||
			this.autoplaySpinsRemaining > 0 ||
			this.isFreeRoundAutoplay ||
			!!this.autoplayTimer;

		if (!sessionStillMarkedActive && !pausedForBonusResume) {
			return;
		}

		if (pausedForBonusResume && !sessionStillMarkedActive) {
			return;
		}

		this.clearAutoplaySessionState(!pausedForBonusResume);
	}

	/**
	 * Reset autoplay counters/flags without re-enabling the full HUD.
	 * Used when a session ends or free rounds exit while AUTO_STOP deferred restore.
	 */
	private clearAutoplaySessionState(clearPausedCache: boolean = true): void {
		if (this.autoplayTimer) {
			try { this.autoplayTimer.destroy(); } catch { }
			this.autoplayTimer = null;
		}
		this.autoplayPausedForBetFailedPopup = false;
		this.autoplaySpinsRemaining = 0;
		this.isFreeRoundAutoplay = false;
		this.shouldReenableSpinButtonAfterFirstAutoplay = false;
		if (clearPausedCache) {
			this.pausedAutoplaySpinsRemaining = 0;
		}
		if (this.gameData) {
			this.gameData.isAutoPlaying = false;
		}
		gameStateManager.isAutoPlaying = false;
		gameStateManager.isAutoPlaySpinRequested = false;
		this.setAutoplayButtonState(false);
		this.hideAutoplaySpinsRemainingText();
	}

	/**
	 * Stop autoplay
	 */
	public stopAutoplay(options?: { userInitiated?: boolean; reason?: string }): void {
		console.log('[SlotController] Stopping autoplay');
		console.log('[SlotController] Before stopAutoplay - isAutoPlaying:', gameStateManager.isAutoPlaying, 'isReelSpinning:', gameStateManager.isReelSpinning);
		const userInitiated = options?.userInitiated ?? true;
		const reason = options?.reason ?? 'manual_stop';

		this.clearAutoplaySessionState(userInitiated);
		console.log('[SlotController] stopAutoplay context:', { userInitiated, reason });

		console.log('[SlotController] After stopAutoplay - isAutoPlaying:', gameStateManager.isAutoPlaying, 'isReelSpinning:', gameStateManager.isReelSpinning);

		this.currentSpinAllowsManualButtonSkip = false;
		this.manualSpinSkipConsumedForCurrentSpin = false;

		// If scatter/bonus active, keep controls disabled
		if (gameStateManager.isScatter || gameStateManager.isBonus) {
			this.disableSpinButton();
			this.disableAutoplayButton();
			this.disableAmplifyButton();
			return;
		}

		// If reels/tumbles are still active, stopping autoplay should NOT re-enable Spin/Autoplay.
		// We also explicitly disable Spin now, since it was kept enabled during autoplay to allow stopping.
		if (
			gameStateManager.isReelSpinning ||
			gameStateManager.isProcessingSpin ||
			gameStateManager.isShowingWinlines ||
			gameStateManager.isShowingWinDialog
		) {
			this.disableSpinButton();
			this.disableAutoplayButton();
			this.disableBetButtons();
			this.disableFeatureButton();
			this.disableAmplifyButton();
			console.log('[SlotController] Autoplay stopped during active spin - controls remain disabled until spin completes');
			return;
		}
		
		// Re-enable controls if not spinning and we're back in normal mode
		if (!gameStateManager.isReelSpinning && !this.shouldKeepBaseControlsLocked()) {
			this.updateSpinButtonState();
			this.enableAutoplayButton();
			this.enableBetButtons();
			// Keep feature disabled during bonus or until explicitly allowed
			if (!this.shouldKeepBaseControlsLocked() && this.canEnableFeatureButton) {
				this.enableFeatureButton();
			}
			this.enableAmplifyButton();
			this.enableBetBackgroundInteraction('after stopAutoplay');
			this.hideAutoplaySpinsRemainingText();
			this.updateAutoplayButtonState();
			console.log('[SlotController] Autoplay stopped - controls re-enabled in normal mode');
		}
	}

	public pauseAutoplay(reason: string = 'system_pause'): void {
		if (this.autoplaySpinsRemaining <= 0) {
			console.log('[SlotController] pauseAutoplay called with no active autoplay');
			return;
		}

		this.pausedAutoplaySpinsRemaining = this.autoplaySpinsRemaining;
		console.log('[SlotController] Pausing autoplay and caching remaining spins:', {
			reason,
			cachedSpins: this.pausedAutoplaySpinsRemaining
		});
		this.stopAutoplay({ userInitiated: false, reason });
	}

	public resumeAutoplayFromPause(): void {
		if (this.pausedAutoplayResumeTimer) {
			this.pausedAutoplayResumeTimer.destroy();
			this.pausedAutoplayResumeTimer = null;
		}

		const cachedSpins = this.pausedAutoplaySpinsRemaining;
		if (cachedSpins <= 0) {
			return;
		}

		const isBlocked =
			gameStateManager.isBonus ||
			gameStateManager.isScatter ||
			gameStateManager.isShowingWinDialog ||
			gameStateManager.isProcessingSpin ||
			gameStateManager.isReelSpinning ||
			gameStateManager.isBonusExitTransitionActive ||
			this.winDialogControlsLocked;

		if (isBlocked) {
			console.log('[SlotController] Resume autoplay deferred - game still busy');
			if (this.scene) {
				this.pausedAutoplayResumeTimer = this.scene.time.delayedCall(250, () => {
					this.resumeAutoplayFromPause();
				});
			}
			return;
		}

		this.pausedAutoplaySpinsRemaining = 0;
		console.log('[SlotController] Resuming paused autoplay with spins:', cachedSpins);
		this.startAutoplay(cachedSpins);
	}

	/**
	 * Perform a single autoplay spin
	 */
	private async performAutoplaySpin(): Promise<void> {
		if (this.autoplaySpinsRemaining <= 0) {
			console.log('[SlotController] No autoplay spins remaining');
			return;
		}

		// Defense-in-depth: never start a fresh spin while one is already in flight. Without this,
		// a duplicate scheduleNextAutoplaySpin() invocation (e.g. WIN_DIALOG_CLOSED listener racing
		// the cool-down timer) could fire handleSpin() twice for the same continuation, racing the
		// spin button against the buy-feature path.
		if ((gameStateManager as any).isProcessingSpin || gameStateManager.isReelSpinning) {
			console.log('[SlotController] Autoplay spin skipped - previous spin still in progress');
			return;
		}
		if (this.isAwaitingAuthoritativeSpinBalance()) {
			console.log('[SlotController] Autoplay spin skipped - awaiting response balance from previous bet');
			try {
				this.scene?.time?.delayedCall?.(100, () => this.performAutoplaySpin());
			} catch {}
			return;
		}

		console.log(`[SlotController] Performing autoplay spin. ${this.autoplaySpinsRemaining} spins remaining`);
		
		this.currentSpinAllowsManualButtonSkip = false;
		this.manualSpinSkipConsumedForCurrentSpin = false;

		// During autoplay spins, keep spin button enabled to allow stopping autoplay
		this.disableBetButtons();
		this.disableFeatureButton();
		
		// Play spin button animations
		this.playSpinButtonAnimation();
		this.rotateSpinButton();
		
		// Play autoplay button animation once per spin
		this.playAutoplayAnimation();
		
		// Removed pulsing of autoplay spins remaining text during autoplay
		
		// Use the centralized spin handler
		await this.handleSpin();
		
		// Note: autoplaySpinsRemaining is decremented in REELS_STOP handler
		// This ensures the counter is decremented after the spin is fully processed
		console.log(`[SlotController] Autoplay spin initiated, spins remaining: ${this.autoplaySpinsRemaining}`);
	}

	/**
	 * Schedule next autoplay spin based on game state
	 * @param delay - Delay in milliseconds (will be affected by turbo if not already applied)
	 */
	public scheduleNextAutoplaySpin(delay: number = 0): void {
		if (this.autoplaySpinsRemaining <= 0) {
			console.log('[SlotController] No more autoplay spins to schedule');
			return;
		}

		if (this.autoplayPausedForBetFailedPopup) {
			console.log('[SlotController] scheduleNextAutoplaySpin deferred - bet failed popup active');
			return;
		}

		// While the Congrats_KA (TotalWin) cool-down is engaged, defer: the cool-down timer
		// (WIN_DIALOG_CLOSING handler) will call scheduleNextAutoplaySpin(0) once
		// the lock clears. Without this guard, the existing WIN_DIALOG_CLOSED handler
		// would race the cool-down and fire a spin within ~600ms of the click.
		if (this.winDialogControlsLocked) {
			console.log('[SlotController] scheduleNextAutoplaySpin deferred - win-dialog cool-down active');
			return;
		}
		if (this.isAwaitingAuthoritativeSpinBalance()) {
			console.log('[SlotController] scheduleNextAutoplaySpin deferred - awaiting response balance');
			try {
				this.scene?.time?.delayedCall?.(100, () => this.scheduleNextAutoplaySpin(delay));
			} catch {}
			return;
		}

		console.log(`[SlotController] Scheduling next autoplay spin in ${delay}ms`);
		console.log('[SlotController] Scene available for timer:', !!this.scene);
		console.log('[SlotController] Current autoplay timer:', !!this.autoplayTimer);

		// Idempotency: cancel any existing timer before scheduling a new one. Multiple
		// paths can call into here in quick succession (REELS_STOP + WIN_DIALOG_CLOSED +
		// cool-down timer); without this, two performAutoplaySpin calls could fire.
		if (this.autoplayTimer) {
			console.log('[SlotController] Destroying existing autoplay timer');
			this.autoplayTimer.destroy();
			this.autoplayTimer = null;
		}

		// Create new timer
		this.autoplayTimer = this.scene?.time.delayedCall(delay, () => {
			this.autoplayTimer = null;
			console.log('[SlotController] Autoplay timer callback triggered - calling performAutoplaySpin');
			this.performAutoplaySpin();
		}) || null;
		
		console.log('[SlotController] New autoplay timer created:', !!this.autoplayTimer);
		if (this.autoplayTimer) {
			console.log('[SlotController] Timer delay set to:', this.autoplayTimer.delay);
		}
	}

	/**
	 * Change autoplay button visual state
	 */
	public setAutoplayButtonState(isOn: boolean): void {
		const autoplayButton = this.buttons.get('autoplay');
		if (autoplayButton) {
			const textureKey = isOn ? 'autoplay_on' : 'autoplay_off';
			autoplayButton.setTexture(textureKey);
			console.log(`[SlotController] Autoplay button texture changed to: ${textureKey}`);
		}
		
		// Control the autoplay animation based on state
		if (isOn) {
			this.startAutoplayAnimation();
		} else {
			this.stopAutoplayAnimation();
		}
	}

	/**
	 * Disable the turbo button (grey out and disable interaction).
	 * During free round spins the turbo button stays toggle-able and is not disabled.
	 */
	public disableTurboButton(): void {
		if ((gameStateManager as any).isInFreeSpinRound === true) {
			return; // Keep turbo always toggle-able during free rounds
		}
		const turboButton = this.buttons.get('turbo');
		if (turboButton) {
			turboButton.setTint(0x666666); // Grey out the button
			turboButton.disableInteractive();
			console.log('[SlotController] Turbo button disabled and greyed out');
		}
	}

	/**
	 * Enable the turbo button (remove grey tint and enable interaction)
	 */
	public enableTurboButton(): void {
		if (this.winDialogControlsLocked) {
			this.disableTurboButton();
			return;
		}
		const turboButton = this.buttons.get('turbo');
		if (turboButton) {
			turboButton.clearTint(); // Remove grey tint
			turboButton.setInteractive();
			console.log('[SlotController] Turbo button enabled');
		}
	}

	/**
	 * Disable the amplify button (disable interaction only, no visual changes)
	 */
	public disableAmplifyButton(): void {
		const amplifyButton = this.buttons.get('amplify');
		if (amplifyButton) {
			amplifyButton.removeInteractive();
			console.log('[SlotController] Amplify button disabled');
		}
	}

	/**
	 * Enable the amplify button (enable interaction)
	 */
	public enableAmplifyButton(): void {
		if (this.shouldKeepBaseControlsLocked() || this.isInitializationFreeRoundActive()) {
			this.disableAmplifyButton();
			const amplifyButton = this.buttons.get('amplify');
			amplifyButton?.setAlpha(0.5);
			return;
		}
		const amplifyButton = this.buttons.get('amplify');
		if (amplifyButton) {
			amplifyButton.setInteractive();
			console.log('[SlotController] Amplify button enabled');
		}
	}

	/**
	 * Update turbo button state based on game conditions.
	 * During free round spins the turbo button stays enabled (always toggle-able).
	 */
	public updateTurboButtonState(): void {
		const gameData = this.getGameData();
		if (!gameData || !this.buttons.has('turbo')) {
			return;
		}

		const turboButton = this.buttons.get('turbo');
		if (!turboButton) return;

		if (this.winDialogControlsLocked) {
			this.disableTurboButton();
			return;
		}

		// During free rounds keep turbo always toggle-able
		if ((gameStateManager as any).isInFreeSpinRound === true) {
			this.enableTurboButton();
			return;
		}

		// Disable turbo button if spinning, enable otherwise
		if (gameStateManager.isReelSpinning) {
			console.log(`[SlotController] Disabling turbo button - isReelSpinning: ${gameStateManager.isReelSpinning}`);
			this.disableTurboButton();
		} else {
			console.log(`[SlotController] Enabling turbo button - not spinning`);
			this.enableTurboButton();
		}
	}

	/**
	 * Change turbo button visual state
	 */
	public setTurboButtonState(isOn: boolean): void {
		const turboButton = this.buttons.get('turbo');
		if (turboButton) {
			const textureKey = isOn ? 'turbo_on' : 'turbo_off';
			turboButton.setTexture(textureKey);
			console.log(`[SlotController] Turbo button texture changed to: ${textureKey}`);
		}
		
		// Control the turbo animation based on state
		if (isOn) {
			this.startTurboAnimation();
		} else {
			this.stopTurboAnimation();
		}
	}

	/**
	 * Change amplify button visual state
	 */
	public setAmplifyButtonState(isOn: boolean): void {
		const amplifyButton = this.buttons.get('amplify');
		if (amplifyButton) {
			if (isOn) {
				// Add a yellow tint when active
				amplifyButton.setTint(0xffff00); // Yellow tint to indicate active
				// Don't change scale here - let the pulsing handle it
			} else {
				// Remove effects when inactive
				amplifyButton.clearTint();
				// Don't change scale here - let the pulsing handle it
			}
			console.log(`[SlotController] Amplify button state changed to: ${isOn ? 'ON' : 'OFF'}`);
		}
	}

	/**
	 * Initialize amplify button state based on GameData
	 */
	private initializeAmplifyButtonState(): void {
		const gameData = this.getGameData();
		if (!gameData) {
			return;
		}

		// Set the initial button state
		this.setAmplifyButtonState(gameData.isEnhancedBet);
		
		// Control the animation based on initial state
		this.controlAmplifyBetAnimation();

		// Ensure Buy Feature button respects initial enhance/amplify state
		if (gameData.isEnhancedBet) {
			this.disableFeatureButton();
		}
		
		console.log(`[SlotController] Amplify button initialized with state: ${gameData.isEnhancedBet ? 'ON' : 'OFF'}`);
	}

	/**
	 * Control the amplify bet animation based on toggle state
	 */
	private controlAmplifyBetAnimation(): void {
		const gameData = this.getGameData();
		if (!gameData) {
			return;
		}

		// Remove pulsing/bouncing regardless of state; keep only color/tint change
		this.stopAmplifyBetBouncing();

		// Only hide idle when turning off/resetting; show is handled after toggle animation completes
		if (!gameData.isEnhancedBet) {
			this.hideEnhanceBetIdleLoop();
		}
	}



	/**
	 * Start the amplify button pulsing effect
	 */
	private startAmplifyBetBouncing(): void {
		const amplifyButton = this.buttons.get('amplify');
		if (!amplifyButton || !this.scene) {
			console.warn('[SlotController] Amplify button or scene not available for pulsing');
			return;
		}

		// Clear any existing timer
		if (this.amplifyBetBounceTimer) {
			this.amplifyBetBounceTimer.destroy();
		}

		// Create a continuous pulsing animation
		this.scene.tweens.add({
			targets: amplifyButton,
			scaleX: amplifyButton.scaleX * 1.1,
			scaleY: amplifyButton.scaleY * 1.1,
			duration: 500,
			ease: 'Sine.easeInOut',
			yoyo: true,
			repeat: -1 // Infinite repeat
		});

		console.log('[SlotController] Amplify button pulsing started');
	}

	/**
	 * Stop the amplify button pulsing effect
	 */
	private stopAmplifyBetBouncing(): void {
		const amplifyButton = this.buttons.get('amplify');
		if (amplifyButton && this.scene) {
			// Stop any active tweens on the button
			this.scene.tweens.killTweensOf(amplifyButton);
			
			// Reset to original scale
			const originalScale = this.getAmplifyButtonOriginalScale();
			amplifyButton.setScale(originalScale, originalScale);
		}

		// Clear any existing timer
		if (this.amplifyBetBounceTimer) {
			this.amplifyBetBounceTimer.destroy();
			this.amplifyBetBounceTimer = null;
		}

		console.log('[SlotController] Amplify button pulsing stopped');
	}

	/**
	 * Get the original scale of the amplify button
	 */
	private getAmplifyButtonOriginalScale(): number {
		// Return the base scale used when creating the button
		// This should match the scale used in createPortraitController
		const screenConfig = this.screenModeManager.getScreenConfig();
		const assetScale = this.networkManager.getAssetScale();
		return assetScale; // This is the original scale used for the amplify button
	}

	/**
	 * Trigger amplify bet spine animation when spin occurs while amplify bet is on
	 */
	private triggerAmplifyBetAnimation(): void {
		const gameData = this.getGameData();
		if (!gameData || !gameData.isEnhancedBet) {
			console.log('[SlotController] Amplify bet not active, skipping animation');
			return;
		}

		if (!this.amplifyBetAnimation) {
			console.warn('[SlotController] Amplify bet animation not available');
			return;
		}

		console.log('[SlotController] Triggering amplify bet spine animation');
		
		// Stop and clear any existing animation first
		this.amplifyBetAnimation.animationState.clearTracks();
		this.amplifyBetAnimation.animationState.clearListeners();
		
		// Reset the skeleton to its initial pose
		this.amplifyBetAnimation.skeleton.setToSetupPose();
		this.amplifyBetAnimation.animationState.setEmptyAnimation(0, 0);
		
		// Hide the animation to reset it
		this.amplifyBetAnimation.setVisible(false);
		
		// Small delay to ensure proper reset, then show and play
		this.scene?.time.delayedCall(50, () => {
			console.log('[SlotController] Showing and playing amplify bet animation after delay');
			// Show the animation
			this.amplifyBetAnimation.setVisible(true);
			this.playAmplifyBetAnimation();
		});
	}

	/**
	 * Play the amplify bet animation once
	 */
	private playAmplifyBetAnimation(): void {
		if (!this.amplifyBetAnimation) {
			console.warn('[SlotController] Amplify bet animation not available for playing');
			return;
		}

		const animationName = 'animation';
		
		// Try to play the animation using animationState.setAnimation (play once)
		if (this.amplifyBetAnimation.skeleton && this.amplifyBetAnimation.skeleton.data.findAnimation(animationName)) {
			this.amplifyBetAnimation.animationState.setAnimation(0, animationName, false); // Play once, no loop
			
			// Listen for animation completion to hide it and start idle loop
			this.amplifyBetAnimation.animationState.addListener({
				complete: (entry: any) => {
					if (entry.animation.name === animationName) {
						this.amplifyBetAnimation.setVisible(false);
						console.log('[SlotController] Amplify bet animation completed and hidden');
						// After toggle animation completes, show the idle loop if enhanced bet is still ON
						const gameData = this.getGameData();
						if (gameData && gameData.isEnhancedBet) {
							this.showEnhanceBetIdleLoop();
						}
					}
				}
			});
			
			console.log('[SlotController] Playing amplify bet animation once:', animationName);
		} else {
			// Fallback: try to play any available animation
			const animations = this.amplifyBetAnimation.skeleton?.data.animations || [];
			if (animations.length > 0) {
				console.log('[SlotController] Using fallback animation:', animations[0].name);
				this.amplifyBetAnimation.animationState.setAnimation(0, animations[0].name, false);
				
				// Listen for animation completion to hide it and start idle loop
				this.amplifyBetAnimation.animationState.addListener({
					complete: (entry: any) => {
						if (entry.animation.name === animations[0].name) {
							this.amplifyBetAnimation.setVisible(false);
							console.log('[SlotController] Amplify bet fallback animation completed and hidden');
							const gameData = this.getGameData();
							if (gameData && gameData.isEnhancedBet) {
								this.showEnhanceBetIdleLoop();
							}
						}
					}
				});
			} else {
				console.warn('[SlotController] No animations found for amplify bet spine');
			}
		}
	}

	/**
	 * Hide amplify bet animation
	 */
	private hideAmplifyBetAnimation(): void {
		if (this.amplifyBetAnimation) {
			this.amplifyBetAnimation.setVisible(false);
			// Stop the animation
			this.amplifyBetAnimation.animationState.clearTracks();
			console.log('[SlotController] Amplify bet animation hidden and stopped');
		}
	}

	/**
	 * Apply 25% bet increase when amplify bet is activated
	 */
	private applyAmplifyBetIncrease(): void {
		const currentBetText = this.getBetAmountText();
		if (!currentBetText) {
			console.warn('[SlotController] No current bet amount to increase');
			return;
		}

		const increasedBet = this.baseBetAmount * 1.25; // Add 25%
		
		// Only update the display, keep baseBetAmount unchanged for API calls
		if (this.betAmountText) {
			this.betAmountText.setText(formatCurrencyNumber(increasedBet));
			// Center the amount text (no currency layout needed)
			const betX = this.scene ? this.scene.scale.width * 0.81 : this.betAmountText.x;
			this.betAmountText.setPosition(betX, this.betAmountText.y);
		}
		
		// Even though base bet doesn't change, price uses base bet x100
		this.updateFeatureAmountFromCurrentBet();
		
		// Refresh affordability when amplify toggles
		this.updateSpinButtonState();
	}

	/**
	 * Restore original bet amount when amplify bet is deactivated
	 */
	private restoreOriginalBetAmount(): void {
		// Restore display to base bet amount
		if (this.betAmountText) {
			this.betAmountText.setText(formatCurrencyNumber(this.baseBetAmount));
			// Center the amount text (no currency layout needed)
			const betX = this.scene ? this.scene.scale.width * 0.81 : this.betAmountText.x;
			this.betAmountText.setPosition(betX, this.betAmountText.y);
		}
		
		// Keep Buy Feature price in sync
		this.updateFeatureAmountFromCurrentBet();
		
		console.log(`[SlotController] Amplify bet removed: Display restored to base bet: $${this.baseBetAmount}`);

		// Refresh affordability when amplify toggles
		this.updateSpinButtonState();
	}

	/**
	 * Reset amplify bet state when bet amount is changed externally
	 */
	private resetAmplifyBetOnBetChange(): void {
		const gameData = this.getGameData();
		if (!gameData || !gameData.isEnhancedBet) {
			return; // Amplify bet is not active, nothing to reset
		}

		console.log('[SlotController] Bet amount changed externally - resetting amplify bet state');
		
		// Reset amplify bet state
		gameData.isEnhancedBet = false;
		this.setAmplifyButtonState(false);
		this.hideAmplifyBetAnimation();
		this.hideEnhanceBetIdleLoop();
		this.stopAmplifyBetBouncing();
		// Price still reflects base bet x100, so refresh it
		this.updateFeatureAmountFromCurrentBet();
		
		console.log('[SlotController] Amplify bet state reset due to bet change');
	}


	/**
	 * Apply turbo speed modifications to winline animations
	 */
	private applyTurboSpeedModifications(): void {
		const gameData = this.getGameData();
		if (!gameData) {
			console.warn('[SlotController] GameData not available for turbo speed modifications');
			return;
		}

		console.log(`[SlotController] Applying turbo speed modifications - isTurbo: ${gameData.isTurbo}`);
		console.log(`[SlotController] Current GameData reference:`, gameData);
		console.log(`[SlotController] GameData memory address:`, gameData.toString());

		if (gameData.isTurbo) {
			// Apply turbo speed to the UI GameData only.
			// Scene GameData (used by Symbols) will be synchronized separately via
			// forceApplyTurboToSceneGameData to avoid double-scaling.
			const originalWinUp = gameData.winUpDuration;
			const originalDrop = gameData.dropDuration;
			const originalDelay = gameData.dropReelsDelay;
			const originalDuration = gameData.dropReelsDuration;
			
			gameData.winUpDuration = gameData.winUpDuration * TurboConfig.TURBO_DURATION_MULTIPLIER;
			gameData.dropDuration = gameData.dropDuration * TurboConfig.TURBO_DURATION_MULTIPLIER;
			gameData.dropReelsDelay = gameData.dropReelsDelay * TurboConfig.TURBO_DELAY_MULTIPLIER;
			gameData.dropReelsDuration = gameData.dropReelsDuration * TurboConfig.TURBO_DURATION_MULTIPLIER;
			(gameData as any).compressionDelayMultiplier = TurboConfig.TURBO_DELAY_MULTIPLIER;
			
			console.log(`[SlotController] Turbo speed applied to winline animations (4x faster):`);
			console.log(`  winUpDuration: ${originalWinUp} -> ${gameData.winUpDuration}`);
			console.log(`  dropDuration: ${originalDrop} -> ${gameData.dropDuration}`);
			console.log(`  dropReelsDelay: ${originalDelay} -> ${gameData.dropReelsDelay}`);
			console.log(`  dropReelsDuration: ${originalDuration} -> ${gameData.dropReelsDuration}`);
		} else {
			// Reset to normal speed by calling setSpeed with the original delay
			const originalDelay = 2500; // This should match Data.DELAY_BETWEEN_SPINS
			setSpeed(gameData, originalDelay);
			(gameData as any).compressionDelayMultiplier = 1;
			console.log('[SlotController] Normal speed restored for winline animations');
		}
	}

	/**
	 * Hide the primary controller during bonus mode
	 */
	public hidePrimaryController(): void {
		if (this.primaryControllers) {
			console.log('[SlotController] Hiding primary controller');
			this.primaryControllers.setVisible(false);
		}
		
		// Hide all controller text labels
		this.controllerTexts.forEach(text => {
			text.setVisible(false);
		});
		console.log(`[SlotController] Hiding ${this.controllerTexts.length} controller text labels`);
		
		// Hide amplify description container
		if (this.amplifyDescriptionContainer) {
			this.amplifyDescriptionContainer.setVisible(false);
		 console.log('[SlotController] Hiding amplify description');
		}
		
		// Grey out the feature button
		if (this.featureButtonHitbox) {
			this.featureButtonHitbox.disableInteractive(); // Disable clicking
			console.log('[SlotController] Feature button greyed out and disabled');
		}
		if (this.featureImage) {
			this.featureImage.setAlpha(0.3);
		}
		
		// Grey out the bet buttons
		const decreaseBetButton = this.buttons.get('decrease_bet');
		const increaseBetButton = this.buttons.get('increase_bet');
		
		// IMPORTANT: keep them interactive (no-op) to block click-through.
		this.setBetButtonEnabled(decreaseBetButton, false);
		this.setBetButtonEnabled(increaseBetButton, false);
		console.log('[SlotController] Bet +/- buttons greyed out (interactive, but no-op)');
		
		// Note: Free spin display will be shown separately with actual scatter data
		console.log('[SlotController] Primary controller hidden, free spin display will be shown separately');
	}

	/**
	 * Hide the primary controller during bonus mode with scatter data
	 */
	public hidePrimaryControllerWithScatter(scatterIndex: number): void {
		// Hide the primary controller first
		this.hidePrimaryController();
		
		// Note: Free spin display will be shown after dialog animations complete
		console.log(`[SlotController] Primary controller hidden for scatter index ${scatterIndex}, free spin display will appear after dialog closes`);
	}

	/**
	 * Show the primary controller after bonus mode ends
	 */
	public showPrimaryController(): void {
		if (this.primaryControllers) {
			console.log('[SlotController] Showing primary controller');
			this.primaryControllers.setVisible(true);
		}
		
		// Show all controller text labels
		this.controllerTexts.forEach(text => {
			text.setVisible(true);
		});
		console.log(`[SlotController] Showing ${this.controllerTexts.length} controller text labels`);
		
		// Show amplify description container
		if (this.amplifyDescriptionContainer) {
			this.amplifyDescriptionContainer.setVisible(true);
			console.log('[SlotController] Showing amplify description');
		}
		
		// Interactivity is restored only via restoreBaseControls / enable* helpers (respect
		// win-dialog cool-down, bonus-exit transition, scatter, etc.). Here we only restore visuals.
		const canEnableFeatureNow = !this.isBuyFeatureInteractionBlocked();
		const featureAlpha = canEnableFeatureNow ? 1.0 : 0.3;
		if (this.featureButtonHitbox) {
			if (canEnableFeatureNow) {
				this.featureButtonHitbox.setInteractive();
				console.log('[SlotController] Feature button restored and enabled');
			} else {
				this.featureButtonHitbox.disableInteractive();
				console.log('[SlotController] Feature button visible but not interactive yet');
			}
		}
		if (this.featureImage) {
			this.featureImage.setAlpha(featureAlpha);
		}
		if (this.featureLabelContainer) {
			this.featureLabelContainer.setAlpha(featureAlpha);
		}
		this.featureLabelText?.setAlpha(featureAlpha);
		this.featureAmountText?.setAlpha(featureAlpha);
		this.featureDollarText?.setAlpha(featureAlpha);

		const decreaseBetButton = this.buttons.get('decrease_bet');
		const increaseBetButton = this.buttons.get('increase_bet');
		if (!this.shouldKeepBaseControlsLocked()) {
			this.setBetButtonEnabled(decreaseBetButton, true);
			this.setBetButtonEnabled(increaseBetButton, true);
			this.updateBetLimitButtons(this.getBaseBetAmount() || this.baseBetAmount || 0.2);
			console.log('[SlotController] Bet +/- buttons restored');
		}
		
		// Hide the free spin display when bonus mode ends
		this.hideFreeSpinDisplay();
		
		// Clear any pending free spins data
		if (this.pendingFreeSpinsData) {
			console.log('[SlotController] Bonus mode ended - clearing pending free spins data');
			this.pendingFreeSpinsData = null;
		}
	}

	/**
	 * Create the free spin display elements
	 */
	private createFreeSpinDisplay(scene: Scene, assetScale: number): void {
		// Position for free spin display (centrally below control panel)
		const freeSpinX = scene.scale.width * 0.45;
		const freeSpinY = scene.scale.height * 0.81; // Below the control panel
		
		// Create "Remaining" label (first line)
		this.freeSpinLabel = scene.add.text(
			freeSpinX - 20, // Offset to the left to center with the number
			freeSpinY - 10, // First line, positioned above
			this.getControllerText(CONTROLLER_REMAINING),
			{
				fontSize: '30px',
				color: '#00ff00', // Bright vibrant green as shown in image
				fontFamily: 'poppins-bold'
			}
		).setOrigin(0.5, 0.5).setDepth(15);
		this.controllerContainer.add(this.freeSpinLabel);
		
		// Create "Free Spin : " label (second line)
		this.freeSpinSubLabel = scene.add.text(
			freeSpinX - 15, // Same X position as first line
			freeSpinY + 20, // Second line, positioned below
			this.getControllerText(CONTROLLER_FREE_SPINS),
			{
				fontSize: '30px',
				color: '#00ff00', // Bright vibrant green as shown in image
				fontFamily: 'poppins-bold'
			}
		).setOrigin(0.5, 0.5).setDepth(15);
		this.controllerContainer.add(this.freeSpinSubLabel);
		
		// Create free spin number display
		this.freeSpinNumber = scene.add.text(
			freeSpinX + 110, // Positioned to the right of the label
			freeSpinY + 5, // Centered vertically between the two lines
			'3', // Default value, will be updated dynamically
			{
				fontSize: '80px', // Larger and bolder than the label
				color: '#ffffff', // Pure white as shown in image
				fontFamily: 'poppins-bold'
			}
		).setOrigin(0.5, 0.5).setDepth(15);
		this.controllerContainer.add(this.freeSpinNumber);
		
		// Initially hide the free spin display (only show during bonus mode)
		this.freeSpinLabel.setVisible(false);
		this.freeSpinSubLabel.setVisible(false);
		this.freeSpinNumber.setVisible(false);
		
		console.log('[SlotController] Free spin display created');
	}

	/**
	 * Show the free spin display with the specified number of spins
	 */
	public showFreeSpinDisplay(spinsRemaining: number): void {
		if (this.freeSpinDisplaySuppressed) {
			console.log('[SlotController] Suppressed: skipping showFreeSpinDisplay');
			return;
		}
		if (this.freeSpinLabel && this.freeSpinNumber && this.freeSpinSubLabel) {
			this.freeSpinNumber.setText(spinsRemaining.toString());
			this.freeSpinLabel.setVisible(true);
			this.freeSpinSubLabel.setVisible(true);
			this.freeSpinNumber.setVisible(true);
			console.log(`[SlotController] Free spin display shown with ${spinsRemaining} spins remaining`);
		}
	}

	/**
	 * Show the free spin display with the actual free spins won from scatter bonus
	 */
	public showFreeSpinDisplayFromScatter(scatterIndex: number): void {
		if (this.freeSpinDisplaySuppressed) {
			console.log('[SlotController] Suppressed: skipping showFreeSpinDisplayFromScatter');
			return;
		}
		// The actual free spins value will be passed directly from ScatterAnimationManager
		// This method is called when scatterBonusActivated event is received
		if (this.freeSpinLabel && this.freeSpinNumber && this.freeSpinSubLabel) {
			// Initially show with the scatter index, will be updated with actual value
			this.freeSpinNumber.setText(`Index: ${scatterIndex}`);
			this.freeSpinLabel.setVisible(true);
			this.freeSpinSubLabel.setVisible(true);
			this.freeSpinNumber.setVisible(true);
			console.log(`[SlotController] Free spin display shown for scatter index ${scatterIndex}`);
		}
	}

	/**
	 * Show the free spin display with the actual free spins value
	 */
	public showFreeSpinDisplayWithActualValue(actualFreeSpins: number): void {
		if (this.freeSpinDisplaySuppressed) {
			console.log('[SlotController] Suppressed: skipping showFreeSpinDisplayWithActualValue');
			return;
		}
		if (this.freeSpinLabel && this.freeSpinNumber && this.freeSpinSubLabel) {
			this.freeSpinNumber.setText(actualFreeSpins.toString());
			this.freeSpinLabel.setVisible(true);
			this.freeSpinSubLabel.setVisible(true);
			this.freeSpinNumber.setVisible(true);
			console.log(`[SlotController] Free spin display shown with actual value: ${actualFreeSpins} spins`);
		}
	}

	/**
	 * Update the free spin display with the actual free spins value
	 */
	public updateFreeSpinDisplayWithActualValue(actualFreeSpins: number): void {
		if (this.freeSpinLabel && this.freeSpinNumber && this.freeSpinSubLabel) {
			this.freeSpinNumber.setText(actualFreeSpins.toString());
			console.log(`[SlotController] Free spin display updated with actual value: ${actualFreeSpins} spins`);
		}
	}

	/**
 * Disable the autoplay button (grey out and disable interaction)
 */
public disableAutoplayButton(): void {
    const autoplayButton = this.buttons.get('autoplay');
    if (autoplayButton) {
        autoplayButton.setTint(0x666666); // Grey out the button
        autoplayButton.disableInteractive();
        console.log('[SlotController] Autoplay button disabled and greyed out');
    }
}

/**
 * Enable the autoplay button (remove grey tint and enable interaction)
 */
public enableAutoplayButton(): void {
    if (this.shouldKeepBaseControlsLocked()) {
        this.disableAutoplayButton();
        return;
    }
    const autoplayButton = this.buttons.get('autoplay');
    if (autoplayButton) {
        autoplayButton.clearTint(); // Remove grey tint
        autoplayButton.setInteractive();
        console.log('[SlotController] Autoplay button enabled');
    }
}

/**
 * Update autoplay button state based on game conditions
 */
public updateAutoplayButtonState(): void {
    const gameData = this.getGameData();
    if (!gameData || !this.buttons.has('autoplay')) {
        return;
    }

    const autoplayButton = this.buttons.get('autoplay');
    if (!autoplayButton) return;

    if (this.shouldKeepBaseControlsLocked()) {
        this.disableAutoplayButton();
        return;
    }

		if (gameStateManager.isReelSpinning || gameStateManager.isProcessingSpin) {
			console.log(`[SlotController] Disabling autoplay button - isReelSpinning: ${gameStateManager.isReelSpinning}, isProcessingSpin: ${gameStateManager.isProcessingSpin}`);
			this.disableAutoplayButton();
		} else {
			console.log(`[SlotController] Enabling autoplay button - spin idle`);
			this.enableAutoplayButton();
		}
}

	/**
	 * Hide the free spin display
	 */
	public hideFreeSpinDisplay(): void {
		if (this.freeSpinLabel && this.freeSpinNumber && this.freeSpinSubLabel) {
			this.freeSpinLabel.setVisible(false);
			this.freeSpinSubLabel.setVisible(false);
			this.freeSpinNumber.setVisible(false);
			console.log('[SlotController] Free spin display hidden');
		}
	}

	/**
	 * Update the free spin number display
	 * In bonus mode, decrement the display value by 1 for frontend only
	 */
	public updateFreeSpinNumber(spinsRemaining: number): void {
		if (this.freeSpinNumber) {
			// In bonus mode, decrement display value by 1 for frontend only
			let displayValue = spinsRemaining;
			if (gameStateManager.isBonus && spinsRemaining > 0) {
				displayValue = spinsRemaining;
				console.log(`[SlotController] Bonus mode: displaying ${displayValue} (actual: ${spinsRemaining})`);
			}
			
			this.freeSpinNumber.setText(displayValue.toString());
			console.log(`[SlotController] Free spin number updated to ${displayValue} (actual: ${spinsRemaining})`);
		}
	}

	/**
	 * Safely get freespin items from either legacy 'freespin' or camelCase 'freeSpin'
	 */
	private getFreeSpinItems(spinData: SpinData): any[] {
		const fs = spinData?.slot?.freespin || (spinData as any)?.slot?.freeSpin;
		return Array.isArray(fs?.items) ? fs.items : [];
	}

	/**
	 * Compare two 2D number arrays for equality
	 */
	private areasEqual(a: number[][] | undefined, b: number[][] | undefined): boolean {
		if (!a || !b) return false;
		if (a.length !== b.length) return false;
		for (let i = 0; i < a.length; i++) {
			const rowA = a[i];
			const rowB = b[i];
			if (!rowA || !rowB || rowA.length !== rowB.length) return false;
			for (let j = 0; j < rowA.length; j++) {
				if (rowA[j] !== rowB[j]) return false;
			}
		}
		return true;
	}

	/**
	 * Display the free-spin item's own spinsLeft. (No per-item MaxWin anchoring in the
	 * slot.hasMaxWin model — all items play and the counter decrements normally.)
	 */
	private spinsLeftDisplayForFreeSpinItem(items: any[], idx: number): number {
		if (!Array.isArray(items) || idx < 0 || idx >= items.length) return 0;
		const it = items[idx];
		return Number(it?.spinsLeft ?? 0) || 0;
	}

	/**
	 * Determine the spinsLeft to display from the provided spinData.
	 * Priority:
	 * 1) Match the item whose area equals the current slot area
	 * 2) First item with spinsLeft > 0
	 * 3) Fallback to Symbols.freeSpinAutoplaySpinsRemaining if available
	 */
	private computeDisplaySpinsLeft(spinData: SpinData): number {
		const items = this.getFreeSpinItems(spinData);
		if (items.length === 0) return 0;

		// Try to match by area
		const currentArea = spinData?.slot?.area;
		if (currentArea) {
			const idx = items.findIndex((it: any) => this.areasEqual(it?.area, currentArea));
			if (idx >= 0) {
				return this.spinsLeftDisplayForFreeSpinItem(items, idx);
			}
		}

		// Fallback: first with spinsLeft > 0
		const firstWithSpins = items.find((it: any) => typeof it?.spinsLeft === 'number' && it.spinsLeft > 0);
		if (firstWithSpins) return firstWithSpins.spinsLeft;

		// Last resort: use Symbols tracker if present
		const gameScene = this.scene as any;
		const remaining = gameScene?.symbols?.freeSpinAutoplaySpinsRemaining;
		if (typeof remaining === 'number') return remaining;

		return 0;
	}

	/**
	 * Spins-left to show after {@link GameAPI.simulateFreeSpin} (index already advanced).
	 * Prefer the item that was just simulated — area-based matching can fail on jagged grids
	 * and then {@link computeDisplaySpinsLeft} falls back to the first item with spinsLeft > 0,
	 * which flashes the full bonus count before a later update.
	 */
	private getSpinsLeftAfterSimulatedFreeSpin(spinData: SpinData): number {
		const items = this.getFreeSpinItems(spinData);
		if (!this.gameAPI || items.length === 0) {
			return this.computeDisplaySpinsLeft(spinData);
		}
		const nextIndex = this.gameAPI.getCurrentFreeSpinIndex();
		const justPlayedIndex = nextIndex > 0 ? nextIndex - 1 : 0;
		if (justPlayedIndex >= 0 && justPlayedIndex < items.length) {
			return this.spinsLeftDisplayForFreeSpinItem(items, justPlayedIndex);
		}
		return this.computeDisplaySpinsLeft(spinData);
	}

	/**
	 * Handle spin logic - either normal API call or free spin simulation
	 */
	private async handleSpin(): Promise<void> {
		if (this.gameAPI?.rejectIfPlayInstanceLost?.()) {
			return;
		}
		this.finalizeBalanceTweenBeforeSpin();

		if (this.shouldKeepBaseControlsLocked()) {
			return;
		}
		if (this.isAwaitingAuthoritativeSpinBalance()) {
			console.log('[SlotController] Spin blocked — awaiting authoritative balance from previous bet');
			return;
		}
		if (!this.gameAPI) {
			console.warn('[SlotController] GameAPI not available, falling back to EventBus');
			// No backend call is made in this fallback path, consider spin processing done
			(gameStateManager as any).isProcessingSpin = false;
			this.releaseManualSpinClickLock();
			this.resetManualSpinSkipButtonState();
			EventBus.emit('spin');
			return;
		}

		// Mark spin as in progress immediately (covers autoplay path where spin button handler doesn't run).
		// Prevents stopAutoplay() from re-enabling buttons when user stops autoplay right after confirm
		// while the first spin is still starting (handleSpin in flight, reels not yet dropping).
		(gameStateManager as any).isProcessingSpin = true;

		// Initialization free rounds do not charge the player's balance.
		// Do not block those spins on the base-game bet affordability check.
		const inInitFreeRoundContext =
			(gameStateManager as any)?.isInFreeSpinRound === true && !gameStateManager.isBonus;

		// Guard: ensure sufficient balance before paid spins (skipped in replay/init-free-round contexts).
		if (!this.gameAPI?.getReplayState?.() && !inInitFreeRoundContext) {
			try {
				const currentBalance = this.getBalanceAmount();
				const currentBet = this.getBaseBetAmount() || 0;
				const gd = this.getGameData();
				const totalBetToCharge = gd && gd.isEnhancedBet ? currentBet * 1.25 : currentBet;
				if (!this.isBalanceInitialized || !Number.isFinite(currentBalance)) {
					console.warn('[SlotController] Balance still loading; queueing spin until BALANCE_INITIALIZED');
					this.pendingSpinUntilBalanceReady = true;
					(gameStateManager as any).isProcessingSpin = false;
					this.releaseManualSpinClickLock();
					this.resetManualSpinSkipButtonState();
					return;
				}
				if (currentBalance < totalBetToCharge) {
					console.error(`[SlotController] Insufficient balance for spin: $${currentBalance} < $${totalBetToCharge}`);
					(gameStateManager as any).isProcessingSpin = false;
					this.releaseManualSpinClickLock();
					this.resetManualSpinSkipButtonState();
					if (this.autoplaySpinsRemaining > 0 || this.gameData?.isAutoPlaying || gameStateManager.isAutoPlaying) {
						this.stopAutoplay();
					}
					this.showOutOfBalancePopup();
					this.updateSpinButtonState();
					this.enableAutoplayButton();
					this.enableBetButtons();
					this.enableFeatureButton();
					this.enableAmplifyButton();
					return;
				}
			} catch {}
		}

		// Start clearing/dropping existing symbols immediately at spin start
		try {
			const gameScene: any = this.scene as any;
			const symbolsComponent = gameScene?.symbols;
			if (symbolsComponent && typeof symbolsComponent.startPreSpinDrop === 'function') {
				console.log('[SlotController] Triggering pre-spin symbol drop');
				symbolsComponent.startPreSpinDrop();
			}
		} catch (e) {
			console.warn('[SlotController] Failed to start pre-spin symbol drop:', e);
		}

		// Play spin sound effect
		if ((window as any).audioManager) {
			(window as any).audioManager.playSoundEffect(SoundEffectType.SPIN);
			console.log('[SlotController] Playing spin sound effect');
		}

		this.beginWalletCycleForSpinLikeAction();
		const demoPreBetBalance = this.gameAPI?.getDemoState()
			? this.gameAPI.getDemoBalance()
			: undefined;
		const shouldChargeBalance =
			!inInitFreeRoundContext &&
			!gameStateManager.isBonus &&
			!this.gameAPI?.getReplayState?.();
		if (shouldChargeBalance) {
			this.ensureSpinBalanceEpoch();
			this.applyOptimisticBetDeduction();
		}

		try {
			let spinData: SpinData;
			/** True when doSpin resolved null and we build a local dummy grid (init FS ended — not a paid result). */
			let spinDataFromNullFallback = false;

			// Start spinner timer - show spinner if fetch takes longer than 2 seconds (after symbols clear)
			this.startSpinnerTimer();

			// Check if we're in bonus mode and use free spin simulation
			if (gameStateManager.isBonus) {
				console.log('[SlotController] In bonus mode - using free spin simulation...');
				spinData = await this.gameAPI.simulateFreeSpin();
				
				// Hide spinner immediately after receiving data
				this.hideSpinner();
				
				// Update free spin display directly from spinData.freeSpin.items[].spinsLeft
				const serverSpinsLeft = this.getSpinsLeftAfterSimulatedFreeSpin(spinData);
				// Prefer UI override (e.g., +5 on retrigger) if set
				const displaySpinsOverrideApplied = this.freeSpinDisplayOverride !== null;
				const displaySpins = displaySpinsOverrideApplied ? (this.freeSpinDisplayOverride as number) : serverSpinsLeft;
				// Sync internal Symbols counter to chosen display value to handle retriggers
				try {
					const symbolsComponent = (this.scene as any)?.symbols;
					if (symbolsComponent && typeof symbolsComponent.setFreeSpinAutoplaySpinsRemaining === 'function') {
						symbolsComponent.setFreeSpinAutoplaySpinsRemaining(displaySpins);
					}
				} catch (e) {
					console.warn('[SlotController] Failed to sync Symbols free spin counter from spin data:', e);
				}
				this.updateFreeSpinNumber(displaySpins);
				console.log(`[SlotController] Updated free spin display to ${displaySpins} remaining (${displaySpinsOverrideApplied ? 'override' : 'from spin data'})`);
				
				// Check if there are any more free spins available
				const freespinData = (spinData.slot as any)?.freespin || (spinData.slot as any)?.freeSpin;
				const hasMoreFreeSpins = freespinData?.items?.some((item: any) => item.spinsLeft > 0);
				// Keep isBonus true through WIN_STOP only when the max-win cap is actually reached, so
				// Game.ts can open the MaxWin drawer before bonus exit (slot.hasMaxWin model — not per-item).
				const justPlayedMaxWin =
					spinData?.slot?.hasMaxWin === true &&
					!!(this.scene as any)?.bonusHeader?.isMaxWinCapReachedForFinalize?.(spinData);
				if (!hasMoreFreeSpins && !justPlayedMaxWin) {
					// No more free spins - end bonus mode (state only).
					// Do not emit setBonusMode(false) here: Dialogs does that when Congrats closes.
					// An early emit caused duplicate Game.setupBonusMode listeners (balance API x2).
					// Keep isBonus true through WIN_STOP when the just-played item is isMaxWin so
					// Game.ts can open the MaxWin drawer before bonus exit.
					console.log('[SlotController] No more free spins available - ending bonus mode');
					gameStateManager.isBonus = false;
					gameStateManager.isBonusFinished = true;
					this.freeSpinDisplayOverride = null;
				}
			} else {
				console.log('[SlotController] Normal mode - calling GameAPI.doSpin...');
				// Use base bet amount for API calls (without amplify bet increase)
				const currentBet = this.getBaseBetAmount() || 10;
				const gameData = this.getGameData();
				const isEnhancedBet = gameData ? gameData.isEnhancedBet : false;
				
				// Check if this is an initialization free spin
				const isInitFreeRound = inInitFreeRoundContext;
				this.ensureSpinBalanceEpoch();
				spinData = await this.gameAPI.doSpin(currentBet, 0, isEnhancedBet, isInitFreeRound, demoPreBetBalance);
				this.stampSpinBalanceEpoch(spinData);
				
				// Hide spinner immediately after receiving data
				this.hideSpinner();

				if (inInitFreeRoundContext) {
					const frUpdate = this.gameAPI.getLastFreeRoundBetUpdate?.();
					const frStatus = resolveFreeRoundStatus(
						frUpdate?.fsStatus ?? (spinData as any)?.fsStatus
					);
					if (isUnplayedFreeRoundStatus(frStatus)) {
						this.abortUnplayedFreeRoundSpin();
						return;
					}
				}
				
				console.log('[SlotController] Spin data:', spinData);
				
				// If spinData is null, it means the free spins have ended (422 error handled gracefully)
				if (!spinData) {
					spinDataFromNullFallback = true;
					console.log('[SlotController] No spin data received - free spins have ended, creating dummy spin with initial symbols');
					
					// Create a dummy SpinData with initial symbols so reels drop naturally
					spinData = this.createDummySpinDataWithInitialSymbols(currentBet);
					console.log('[SlotController] Created dummy spin data with initial symbols:', spinData);
				}
			}

			// Authoritative wallet comes from the bet response (applyWalletBalanceFromSpinResponse).
			// Skip freeround autoplay, dummy grid after graceful init-FS end, replay, and FR modal-trigger spins.
			if (!this.isFreeRoundAutoplay && !spinDataFromNullFallback && !this.gameAPI?.getReplayState?.()) {
				this.applyWalletBalanceFromSpinResponse(spinData);
			}

			// Display comprehensive spin data information
			console.log('[SlotController] 🎰 ===== SPIN DATA RECEIVED =====');
			console.log('[SlotController] 📊 Basic Info:');
			console.log('  - Player ID:', spinData.playerId);
			console.log('  - Bet Amount:', spinData.bet);
			console.log('  - Total Win:', SpinDataUtils.getTotalWin(spinData));
			console.log('  - Has Wins:', SpinDataUtils.hasWins(spinData));
			console.log('  - Has Free Spins:', SpinDataUtils.hasFreeSpins(spinData));
			console.log('  - Win Multiplier:', SpinDataUtils.getWinMultiplier(spinData));
			
            console.log('[SlotController] 🎯 Grid Layout (columns x rows):');
            if (spinData.slot?.area) {
                // area is [column][row]
                for (let col = 0; col < spinData.slot.area.length; col++) {
                    console.log(`  Column ${col}: [${spinData.slot.area[col].join(', ')}]`);
                }
                // Also show a row-wise view for readability
                const cols = spinData.slot.area.length;
                const rows = cols > 0 ? spinData.slot.area[0].length : 0;
                for (let row = 0; row < rows; row++) {
                    const rowValues: number[] = [];
                    for (let col = 0; col < cols; col++) {
                        rowValues.push(spinData.slot.area[col][row]);
                    }
                    console.log(`  Row ${row}: [${rowValues.join(', ')}]`);
                }
            } else {
                console.log('  No area data available');
            }
			
			console.log('[SlotController] 💎 Paylines:');
			if (spinData.slot?.paylines && spinData.slot.paylines.length > 0) {
				spinData.slot.paylines.forEach((payline, index) => {
					console.log(`  Payline ${index}:`, {
						lineKey: payline.lineKey,
						symbol: payline.symbol,
						count: payline.count,
						win: payline.win,
						multipliers: payline.multipliers
					});
				});
			} else {
				console.log('  No paylines data available');
			}
			
			console.log('[SlotController] 🎁 Free Spins Info:');
			if (spinData.slot?.freespin) {
				console.log(`  - Count: ${spinData.slot.freespin.count}`);
				console.log(`  - Total Win: ${spinData.slot.freespin.totalWin}`);
				console.log(`  - Items: ${spinData.slot.freespin.items.length} items`);
			} else {
				console.log('  No free spins data available');
			}
			
			console.log('[SlotController] 🎰 ===== END SPIN DATA =====');
			
			// Emit the spin data response event
			gameEventManager.emit(GameEventType.SPIN_DATA_RESPONSE, {
				spinData: spinData
			});

		} catch (error) {
			console.error('[SlotController] ❌ Spin failed:', error);
			gameEventManager.emit(GameEventType.SPIN_RESPONSE_FAILED);
			if (!(error as any)?.popupHandled) {
				showBetFailureModalFromError(error);
			}
		}
	}

	/**
	 * Show the buy feature drawer
	 */
	private showBuyFeatureDrawer(): void {
		console.log('[SlotController] Showing buy feature drawer');

		if (this.isBuyFeatureInteractionBlocked()) {
			console.log('[SlotController] Buy feature open blocked (spin/tumble/autoplay/active lock)');
			return;
		}

		if (!this.buyFeature) {
			console.warn('[SlotController] Buy feature component not initialized');
			return;
		}

		// Show the buy feature drawer
		this.buyFeature.show({
			featurePrice: 24000.00, // Default feature price
			onClose: () => {
				console.log('[SlotController] Buy feature drawer closed');
			},
			onConfirm: () => {
				console.log('[SlotController] Buy feature confirmed');
				// Treat buy-feature confirmation like a spin start: prevent immediate UI re-enable
				// until REELS_STOP (GameStateManager clears isProcessingSpin on REELS_STOP).
				(gameStateManager as any).isProcessingSpin = true;
				// Immediately disable interactions to prevent other actions
				this.disableSpinButton();
				this.disableAutoplayButton();
				this.disableFeatureButton();
				this.disableBetButtons();
				this.disableAmplifyButton();
				this.disableBetBackgroundInteraction('buy feature confirmed');
				this.handleBuyFeature();
			}
		});
	}

	/**
	 * Handle buy feature purchase
	 */
	private async handleBuyFeature(): Promise<void> {
		console.log('[SlotController] Processing buy feature purchase');
		
		if (!this.buyFeature || !this.gameAPI) {
			console.error('[SlotController] Buy feature or GameAPI not available');
			(gameStateManager as any).isProcessingSpin = false;
			this.updateSpinButtonState();
			this.enableAutoplayButton();
			this.enableFeatureButton();
			this.enableBetButtons();
			this.enableAmplifyButton();
			this.enableBetBackgroundInteraction('buy feature unavailable');
			return;
		}
		
		try {
			// Get the current bet from BuyFeature
			const buyFeatureBet = this.buyFeature.getCurrentBetAmount();
			const calculatedPrice = buyFeatureBet * 100; // Same multiplier as BuyFeature uses
			
			// Update SlotController bet to match the selected Buy Feature bet
			// This updates both the displayed bet and the internal baseBetAmount
			this.updateBetAmount(buyFeatureBet);
			// Re-disable bet +/- buttons; updateBetAmount calls updateBetLimitButtons which re-enables them
			this.disableBetButtons();

			console.log(`[SlotController] Buy feature bet: $${buyFeatureBet.toFixed(2)}, calculated price: $${calculatedPrice.toFixed(2)}`);
			
			// Check if player has enough balance
			const currentBalance = this.getBalanceAmount();
			if (!this.isBalanceInitialized || !Number.isFinite(currentBalance)) {
				console.warn('[SlotController] Balance still loading; blocking buy feature until BALANCE_INITIALIZED');
				this.updateSpinButtonState();
				this.enableAutoplayButton();
				this.enableFeatureButton();
				this.enableBetButtons();
				this.enableAmplifyButton();
				this.enableBetBackgroundInteraction('buy feature blocked: balance loading');
				return;
			}
			if (currentBalance < calculatedPrice) {
			console.error(`[SlotController] Insufficient balance: $${currentBalance.toFixed(2)} < $${calculatedPrice.toFixed(2)}`);
			(gameStateManager as any).isProcessingSpin = false;
			// Re-enable controls since purchase cannot proceed
			this.updateSpinButtonState();
			this.enableAutoplayButton();
			this.enableFeatureButton();
			this.enableBetButtons();
			this.enableAmplifyButton();
			this.enableBetBackgroundInteraction('buy feature insufficient balance');
			this.showOutOfBalancePopup();
			return;
			}
			
			// New buy-feature session: clear any leftover bonus accumulation from a prior max-win
			// session. Back-to-back buys never hit the normal-mode REELS_START that clears these, so
			// without this the prior session's cumulativeBonusWin (== cap) makes isMaxWinCapReached
			// fire on this session's first free spin and the bonus stops after one spin.
			try {
				(this.scene as any)?.bonusHeader?.resetBonusSessionTracking?.();
			} catch (e) {
				console.warn('[SlotController] Failed to reset bonus session tracking for buy feature:', e);
			}

			// Trigger pre-spin symbol drop so previous symbols are cleared before
			// the buy feature spin result applies new symbols.
			try {
				const gameScene: any = this.scene as any;
				const symbolsComponent = gameScene?.symbols;
				if (symbolsComponent && typeof symbolsComponent.startPreSpinDrop === 'function') {
					console.log('[SlotController] Triggering pre-spin symbol drop for buy feature spin');
					symbolsComponent.startPreSpinDrop();
				}
			} catch (e) {
				console.warn('[SlotController] Failed to start pre-spin symbol drop for buy feature spin:', e);
			}

			// Call doSpin with buy feature parameters
			console.log('[SlotController] Calling doSpin for buy feature...');
			const demoPreBetBalance = this.gameAPI?.getDemoState?.()
				? this.gameAPI.getDemoBalance()
				: undefined;
			this.finalizeBalanceTweenBeforeSpin();
			const newBalance = Math.max(0, this.roundCurrency(currentBalance - calculatedPrice));
			this.armSpinBalanceEpoch();
			const keptTimestamp = renderedWalletTimestamp();
			this.startBalanceTween(newBalance, 200, undefined, keptTimestamp > 0 ? keptTimestamp : undefined);
			if (this.gameAPI?.getDemoState?.()) {
				this.gameAPI.updateDemoBalance(newBalance);
			}
			this.beginWalletCycleForSpinLikeAction();
			const spinData = await this.gameAPI.doSpin(buyFeatureBet, 1, false, false, demoPreBetBalance);
			this.stampSpinBalanceEpoch(spinData); // buyFeat: 1, isEnhancedBet: false
			
			console.log('[SlotController] Buy feature spin completed:', spinData);

			if (spinData) {
				this.applyWalletBalanceFromSpinResponse(spinData);
			}
			
			// If this buy feature spin contains free spin data (scatter), temporarily disable turbo so
			// scatter symbol animations and sequence play at normal speed, then restore after dialogs
			try {
				const hasFsItems = !!(spinData?.slot?.freespin?.items || spinData?.slot?.freeSpin?.items);
				if (hasFsItems) {
					const gd = this.getGameData();
					if (gd) {
						const wasTurboGD = !!gd.isTurbo;
						const wasTurboGSM = !!gameStateManager.isTurbo;
						if (wasTurboGD || wasTurboGSM) {
							console.log('[SlotController] Buy feature with scatter during turbo - temporarily disabling turbo for scatter sequence');
							// Disable both UI/gameData and central state turbo flags
							gd.isTurbo = false;
							gameStateManager.isTurbo = false;
							// Restore turbo after dialog animations complete
							if (this.scene) {
								this.scene.events.once('dialogAnimationsComplete', () => {
									try {
										if (wasTurboGD) {
											gd.isTurbo = true;
										}
										if (wasTurboGSM) {
											gameStateManager.isTurbo = true;
										}
										console.log('[SlotController] Restored turbo after scatter sequence dialogs completed');
									} catch (e) {
										console.warn('[SlotController] Failed to restore turbo after dialogs:', e);
									}
								});
							}
						}
					}
				}
			} catch (e) {
				console.warn('[SlotController] Turbo normalization for buy feature scatter failed:', e);
			}
			
			// Process the spin result (same as normal spin)
			if (spinData) {
				gameEventManager.emit(GameEventType.SPIN_DATA_RESPONSE, { spinData });
			}
			
		} catch (error) {
			console.error('[SlotController] Error processing buy feature purchase:', error);
			try {
				(this.scene as any)?.symbols?.cancelClientSpinPresentation?.({ restoreSymbols: true, clearPreparedSymbols: true });
			} catch {}
			(gameStateManager as any).isProcessingSpin = false;
			this.updateSpinButtonState();
			this.enableFeatureButton();
			this.enableAutoplayButton();
			this.enableBetButtons();
			this.enableAmplifyButton();
			this.enableBetBackgroundInteraction('buy feature error');
			gameEventManager.emit(GameEventType.SPIN_RESPONSE_FAILED);
			if (!(error as any)?.popupHandled) {
				showBetFailureModalFromError(error);
			}
		}
	}

	/**
	 * Reconcile balance from spin payload captured for the current spin.
	 */
	private async updateBalanceFromServer(spinData?: any): Promise<void> {
		const walletTimestamp = readWalletTimestamp(spinData);
		if (isStaleWalletTimestamp(walletTimestamp)) return;
		const __taggedBalanceEpoch = Number((spinData as any)?.__balanceDisplayEpoch);
		if (walletTimestamp == null && Number.isFinite(__taggedBalanceEpoch) && __taggedBalanceEpoch > 0 && __taggedBalanceEpoch !== currentBalanceDisplayEpoch()) {
			return;
		}

		if (this.bonusExitBalanceApplied) {
			console.log('[SlotController] Skipping balance reconcile — bonus exit balance already applied');
			return;
		}
		if (this.freezeBalanceUi) {
			console.log('[SlotController] Skipping balance reconcile — bonus HUD frozen');
			return;
		}
		if (this.shouldDeferFreeRoundWalletUntilModal()) {
			console.log('[SlotController] Skipping balance reconcile — free-round status modal owns wallet');
			return;
		}
		if (this.gameAPI?.getReplayState?.()) {
			return;
		}
		try {
			console.log('[SlotController] 💰 Reconciling balance from spin payload...');

			if (!this.gameAPI) {
				console.warn('[SlotController] GameAPI not available for balance update');
				return;
			}

			const payload = spinData ?? (this.symbols as any)?.currentSpinData ?? this.gameAPI?.getCurrentSpinData?.();
			const newBalance = this.extractBalanceFromSpinPayload(payload);
			if (newBalance === null) {
				console.log('[SlotController] Skipping balance reconcile - spin payload has no valid balance');
				return;
			}

			const oldBalance = this.getBalanceAmount();
			console.log(`[SlotController] 💰 Server balance update: $${oldBalance} -> $${newBalance}`);

			const epoch = Number.isFinite(__taggedBalanceEpoch) && __taggedBalanceEpoch > 0
				? __taggedBalanceEpoch
				: undefined;
			if (this.balanceAnimationInProgress) {
				this.pendingServerBalanceForReconcile = newBalance;
				this.pendingServerBalanceTimestamp = walletTimestamp;
				this.pendingServerBalanceEpoch = epoch ?? this.activeBalanceTweenEpoch;
				console.log('[SlotController] Balance animation in progress; deferring server reconcile.');
			} else {
				this.startBalanceTween(newBalance, 200, epoch, walletTimestamp);
			}

			if (this.gameAPI.getDemoState()) {
				try {
					this.gameAPI.updateDemoBalance(newBalance);
				} catch {}
			}

			console.log('[SlotController] ✅ Balance reconciled from spin payload successfully');
		} catch (error) {
			console.error('[SlotController] ❌ Error updating balance from server:', error);
		}
	}

	/**
	 * Setup bonus mode event listener to hide/show primary controller
	 */
	private isBonusExitTransitionActive(): boolean {
		return gameStateManager.isBonusExitTransitionActive;
	}

	private shouldKeepBaseControlsLocked(): boolean {
		return gameStateManager.isScatter
			|| gameStateManager.isBonus
			|| this.isBonusExitTransitionActive()
			|| gameStateManager.isShowingWinDialog
			|| this.winDialogControlsLocked;
	}

	/** True while buy feature, bet controls, and amplify must stay locked (incl. active spin). */
	private shouldLockAuxiliaryControls(): boolean {
		return (
			this.shouldKeepBaseControlsLocked() ||
			gameStateManager.isProcessingSpin ||
			gameStateManager.isReelSpinning ||
			this.isAwaitingAuthoritativeSpinBalance()
		);
	}

	private lockBaseControls(): void {
		this.disableSpinButton();
		this.disableAutoplayButton();
		this.disableBetButtons();
		this.disableFeatureButton();
		this.disableAmplifyButton();
		this.disableBetBackgroundInteraction('base controls locked');
	}

	private restoreBaseControls(): void {
		if (this.shouldKeepBaseControlsLocked()) {
			return;
		}
		this.updateSpinButtonState();
		this.enableAutoplayButton();
		this.enableTurboButton();
		this.updateTurboButtonState();
		this.enableBetButtons();
		this.enableAmplifyButton();
		if (this.canEnableFeatureButton) {
			this.enableFeatureButton();
		}
		this.enableBetBackgroundInteraction('bonus exit transition complete');
	}

	/** Retry enabling buy feature / aux controls after win animation and balance tween settle. */
	private schedulePostSpinControlsRefresh(): void {
		try {
			this.scene?.time?.delayedCall(80, () => {
				try { this.refreshControlsWhenSpinSettled(); } catch {}
			});
			this.scene?.time?.delayedCall(360, () => {
				try { this.refreshControlsWhenSpinSettled(); } catch {}
			});
			this.scene?.time?.delayedCall(700, () => {
				try { this.refreshControlsWhenSpinSettled(); } catch {}
			});
		} catch {
			try { this.refreshControlsWhenSpinSettled(); } catch {}
		}
	}

	private restoreBaseGameControlsAfterIdleSpin(): void {
		try {
			if (gameStateManager.isShowingWinDialog || this.winDialogControlsLocked) {
				return;
			}
			try {
				const dialogs: any = (this.scene as any)?.dialogs;
				if (dialogs?.isDialogShowing?.()) {
					return;
				}
			} catch {}
			if (this.isAutoplaySpinControlActive()) {
				return;
			}
			if (gameStateManager.isScatter || gameStateManager.isBonus) {
				return;
			}
			try {
				if (this.symbols?.isFreeSpinAutoplayActive?.()) {
					return;
				}
			} catch {}
			if (gameStateManager.isReelSpinning || gameStateManager.isProcessingSpin) {
				return;
			}

			// Late tumble WIN_START can re-latch this after WIN_STOP; clear when spin is idle.
			try { gameStateManager.isShowingWinlines = false; } catch {}

			if (!this.isManualSpinPresentationActive()) {
				this.resetManualSpinSkipButtonState();
			}

			this.releaseManualSpinClickLock();
			this.updateSpinButtonState();
			this.enableTurboButton();
			this.updateTurboButtonState();

			// Init free rounds: only spin + turbo between spins. Bet / autoplay / feature stay locked.
			if (this.isInitializationFreeRoundActive()) {
				return;
			}

			this.updateAutoplayButtonState();
			this.enableAutoplayButton();
			if (!this.shouldLockAuxiliaryControls()) {
				this.enableBetButtons();
				this.enableAmplifyButton();
				this.enableBetBackgroundInteraction('spin-pipeline-idle');
				if (this.canEnableFeatureButton) {
					this.enableFeatureButton();
				}
			}
		} catch {}
	}

	private scheduleRestoreControlsPoll(): void {
		if (this.postSpinControlsRefreshPollScheduled) {
			return;
		}
		this.postSpinControlsRefreshPollScheduled = true;
		this.scene?.time?.delayedCall?.(100, () => {
			this.postSpinControlsRefreshPollScheduled = false;
			try { this.refreshControlsWhenSpinSettled(); } catch {}
		});
	}

	private refreshControlsWhenSpinSettled(): void {
		if (this.isAutoplaySpinControlActive()) {
			return;
		}
		if (gameStateManager.isScatter || gameStateManager.isBonus) {
			return;
		}

		const spinPipelineActive =
			gameStateManager.isReelSpinning ||
			gameStateManager.isProcessingSpin;

		const presentationBlocked =
			gameStateManager.isShowingWinDialog ||
			this.winDialogControlsLocked ||
			this.isBonusExitTransitionActive();

		if (spinPipelineActive || presentationBlocked) {
			this.scheduleRestoreControlsPoll();
			return;
		}

		// Balance tween must not block autoplay; only bet/feature use shouldLockAuxiliaryControls.
		try { gameStateManager.isShowingWinlines = false; } catch {}

		this.restoreBaseGameControlsAfterIdleSpin();
		if (!this.isManualSpinPresentationActive()) {
			this.resetManualSpinSkipButtonState();
		}
	}

	/** Re-enable autoplay stop + turbo toggle after bonus/cool-down locks (paused resume path). */
	private enableAutoplaySessionHudControls(): void {
		const autoplayButton = this.buttons.get('autoplay');
		if (autoplayButton) {
			autoplayButton.clearTint();
			autoplayButton.setInteractive();
		}
		this.enableTurboButton();
		this.updateTurboButtonState();
	}

	private setupBonusModeEventListener(): void {
		if (!this.scene) {
			console.warn('[SlotController] Cannot setup bonus mode listener - scene not available');
			return;
		}

		console.log('[SlotController] Setting up bonus mode event listener');

		this.scene.events.on('bonusEndDialogClosed', () => {
			try {
				this.applyBonusExitBalance(220);
			} catch {}
		});
		
		// Listen for bonus mode events from the scene
		this.scene.events.on('setBonusMode', (isBonus: boolean) => {
			if (isBonus) {
				console.log('[SlotController] Bonus mode activated - hiding primary controller');
				try {
					// rainbow_fist: do not freeze balance during freespin/feature
					this.freezeBalanceUi = false;
					this.deferredBalanceAfterBonus = null;
					this.bonusStartBalanceSnapshot = this.getBalanceAmount();
					this.capturedBonusTotalWin = 0;
					try {
						const sd = this.gameAPI?.getCurrentSpinData?.();
						this.bonusTriggerWalletBalance = this.extractBalanceFromSpinPayload(sd);
					} catch {
						this.bonusTriggerWalletBalance = null;
					}
				} catch {
					this.bonusTriggerWalletBalance = null;
				}
				this.hidePrimaryController();
				this.lockBaseControls();
				// Always keep the buy feature disabled during bonus mode
				this.canEnableFeatureButton = false;
				this.disableFeatureButton();
			} else {
				if (gameStateManager.isBonusExitTransitionActive) {
					console.log('[SlotController] Bonus mode deactivated but transition still active - keeping base controls locked');
				} else {
					console.log('[SlotController] Bonus mode deactivated - showing primary controller');
					this.showPrimaryController();
				}
				try {
					this.applyBonusExitBalance(220);
				} catch {}
				// Clear any pending free spins data when bonus mode ends
				if (this.pendingFreeSpinsData) {
					console.log('[SlotController] Bonus mode ended - clearing pending free spins data');
					this.pendingFreeSpinsData = null;
				}
				if (!gameStateManager.isBonusExitTransitionActive) {
					this.canEnableFeatureButton = true;
					this.restoreBaseControls();
				} else {
					this.canEnableFeatureButton = false;
					this.lockBaseControls();
				}
			}
		});

		this.scene.events.on('bonusTransitionComplete', () => {
			console.log('[SlotController] bonusTransitionComplete received');
			this.showPrimaryController();

			// Congrats close starts WIN_DIALOG_CONTROLS_REENABLE_DELAY_MS on click; do not
			// cancel that timer here or controls will re-enable ~1s after Congrats instead of
			// after the full cool-down window.
			if (this.winDialogControlsLocked) {
				console.log(
					'[SlotController] bonusTransitionComplete - HUD visible, controls stay locked until Congrats cool-down expires',
				);
				return;
			}

			this.canEnableFeatureButton = true;
			this.restoreBaseControls();
			this.resumeAutoplayFromPause();
		});

		// Ensure free spin UI is hidden on generic bonus-reset events as well
		this.scene.events.on('resetFreeSpinState', () => {
			console.log('[SlotController] resetFreeSpinState received - hiding free spin display and clearing overrides');
			this.hideFreeSpinDisplay();
			this.freeSpinDisplayOverride = null;
			this.pendingFreeSpinsData = null;
			try {
				this.gameAPI?.clearBonusSessionSnapshots?.();
			} catch { /* noop */ }
		});

		// Also hide free spin UI when bonus header is hidden (defensive in case setBonusMode is not emitted)
		this.scene.events.on('hideBonusHeader', () => {
			console.log('[SlotController] hideBonusHeader received - hiding free spin display');
			this.hideFreeSpinDisplay();
		});

		// Listen for scatter bonus events with scatter index and actual free spins
		this.scene.events.on('scatterBonusActivated', (data: { scatterIndex: number; actualFreeSpins: number; isRetrigger?: boolean }) => {
			console.log(`[SlotController] scatterBonusActivated event received with data:`, data);
			console.log(`[SlotController] Data validation: scatterIndex=${data.scatterIndex}, actualFreeSpins=${data.actualFreeSpins}`);
			
			// Pause normal autoplay when scatter is hit (resume after bonus exit)
			if (this.autoplaySpinsRemaining > 0) {
				this.pauseAutoplay('scatter_triggered_bonus');
			}
			
			// Keep controls disabled/greyed out while scatter/bonus sequence proceeds
			this.disableSpinButton();
			this.disableAutoplayButton();
			this.disableAmplifyButton();
			
			console.log(`[SlotController] Scatter bonus activated with index ${data.scatterIndex} and ${data.actualFreeSpins} free spins - hiding primary controller, free spin display will appear after dialog closes`);
			this.hidePrimaryControllerWithScatter(data.scatterIndex);
			// Store the free spins data for later display after dialog closes
			this.pendingFreeSpinsData = data;
			
			// If this is a retrigger, add +5 to remaining spins in the frontend and override display
			try {
				if (data?.isRetrigger) {
					// Determine current remaining free spins
					// Priority: Symbols tracker (authoritative) > API data > display text
					let currentRemaining = 0;
					
					// First, try Symbols' internal tracker (most accurate)
					try {
						const sym = (this.scene as any)?.symbols;
						if (sym && typeof sym.freeSpinAutoplaySpinsRemaining === 'number') {
							currentRemaining = sym.freeSpinAutoplaySpinsRemaining;
							console.log(`[SlotController] Retrigger: Using Symbols tracker for current remaining: ${currentRemaining}`);
						}
					} catch {}
					
					// Fallback to computing from API data
					if (currentRemaining <= 0) {
						try {
							const apiSpinData = this.gameAPI?.getCurrentSpinData();
							if (apiSpinData) {
								currentRemaining = this.computeDisplaySpinsLeft(apiSpinData);
								console.log(`[SlotController] Retrigger: Using API data for current remaining: ${currentRemaining}`);
							}
						} catch {}
					}
					
					// Last resort: use display text (may be stale, but better than 0)
					if (currentRemaining <= 0) {
						try {
							const txt = (this.freeSpinNumber?.text || '').toString().trim();
							const val = parseInt(txt, 10);
							if (!isNaN(val) && val >= 0) {
								currentRemaining = val;
								console.log(`[SlotController] Retrigger: Using display text for current remaining: ${currentRemaining}`);
							}
						} catch {}
					}
					
					// Ensure we don't use a value > 1 if we're on the last spin
					// If currentRemaining is 1, it means we just finished the last spin, so base should be 0
					if (currentRemaining === 1) {
						console.log('[SlotController] Retrigger: Last spin detected (currentRemaining=1), using 0 as base for retrigger calculation');
						currentRemaining = 0;
					}
					
					const newRemaining = Math.max(0, currentRemaining + 5);
					this.freeSpinDisplayOverride = newRemaining;
					
					// Sync Symbols' tracker
					try {
						const symbolsComponent = (this.scene as any)?.symbols;
						if (symbolsComponent && typeof symbolsComponent.setFreeSpinAutoplaySpinsRemaining === 'function') {
							symbolsComponent.setFreeSpinAutoplaySpinsRemaining(newRemaining);
						}
					} catch {}
					
					// Update UI immediately
					this.updateFreeSpinNumber(newRemaining);
					console.log(`[SlotController] Retrigger detected - increased remaining free spins by +5: ${currentRemaining} -> ${newRemaining}`);
				}
			} catch (e) {
				console.warn('[SlotController] Failed to apply +5 override on retrigger:', e);
			}
		});

		// Listen for dialog animations completion to show free spin display
		this.scene.events.on('dialogAnimationsComplete', () => {
			console.log('[SlotController] Dialog animations completed - checking if free spin display should be shown');
			console.log('[SlotController] Current pendingFreeSpinsData:', this.pendingFreeSpinsData);

			// A staged/base-game win dialog can close before the scatter symbol hit
			// animation and free-spin intro begin. In that pre-bonus gap, do not
			// initialize the remaining free spins display from API data yet.
			if (gameStateManager.isScatter && !gameStateManager.isBonus) {
				console.log('[SlotController] Scatter trigger still pending bonus intro - deferring free spin display initialization');
				return;
			}
			
			// If free spin autoplay is active, do NOT reinitialize the counter from API; keep Symbols' tracked value
			let skipInitialization = false;
			try {
				const symbolsComponent = (this.scene as any)?.symbols;
				if (symbolsComponent && typeof symbolsComponent.isFreeSpinAutoplayActive === 'function') {
					if (symbolsComponent.isFreeSpinAutoplayActive()) {
						skipInitialization = true;
						console.log('[SlotController] Free spin autoplay active - skipping free spin display reinitialization from API');
					}
				}
			} catch {}

			if (!skipInitialization) {
				// Prefer scatterBonusActivated pending data (authoritative remaining count), then the item at the
				// current free-spin index (mid-bonus / unresolved resume), then items[0]. Using items[0] first
				// flashes the round-start spinsLeft (e.g. 10) when we later emit dialogAnimationsComplete for
				// unresolved resume before autoplay has marked itself active — see spinsleft_issue.
				let initializedFromFreeSpinData = false;
				try {
					// If we have an override (e.g., from retrigger), prefer to show that and skip server initialization
					if (this.freeSpinDisplayOverride !== null) {
						try {
							this.showFreeSpinDisplayWithActualValue(this.freeSpinDisplayOverride as number);
							console.log(`[SlotController] Showing free spin display from override: ${this.freeSpinDisplayOverride}`);
							initializedFromFreeSpinData = true;
							this.pendingFreeSpinsData = null;
						} catch {}
					}

					if (!initializedFromFreeSpinData && this.pendingFreeSpinsData) {
						const pending = this.pendingFreeSpinsData.actualFreeSpins;
						if (typeof pending === 'number' && pending > 0) {
							console.log(
								`[SlotController] Initializing free spin display from scatterBonusActivated pending: ${pending}`
							);
							this.showFreeSpinDisplayWithActualValue(pending);
							this.pendingFreeSpinsData = null;
							initializedFromFreeSpinData = true;
						}
					}

					if (!initializedFromFreeSpinData) {
						const apiSpinData = this.gameAPI?.getCurrentSpinData();
						const fs = apiSpinData?.slot?.freespin || (apiSpinData as any)?.slot?.freeSpin;
						if (fs?.items && fs.items.length > 0) {
							let initialSpinsLeft = 0;
							try {
								const idx = this.gameAPI?.getCurrentFreeSpinIndex?.() ?? 0;
								const safeIdx = Math.max(0, Math.min(Math.floor(idx), fs.items.length - 1));
								const itemAtIdx = fs.items[safeIdx];
								if (itemAtIdx && typeof itemAtIdx.spinsLeft === 'number' && itemAtIdx.spinsLeft > 0) {
									initialSpinsLeft = itemAtIdx.spinsLeft;
									console.log(
										`[SlotController] Initializing free spin display from items[${safeIdx}].spinsLeft=${initialSpinsLeft}`
									);
								}
							} catch (e) {
								console.warn('[SlotController] Failed to read spinsLeft at current free-spin index:', e);
							}
							if (initialSpinsLeft <= 0) {
								const firstItem = fs.items[0];
								initialSpinsLeft = typeof firstItem?.spinsLeft === 'number' ? firstItem.spinsLeft : 0;
								if (initialSpinsLeft > 0) {
									console.log(
										`[SlotController] Initializing free spin display from first freeSpin item: spinsLeft=${initialSpinsLeft}`
									);
								}
							}
							if (initialSpinsLeft > 0) {
								this.showFreeSpinDisplayWithActualValue(initialSpinsLeft);
								initializedFromFreeSpinData = true;
								// Consume pending so a later dialogAnimationsComplete cannot reuse stale data
								this.pendingFreeSpinsData = null;
							}
						}
					}
				} catch (e) {
					console.warn('[SlotController] Failed to initialize from freeSpin data:', e);
				}

				// Fallback: pending with 0 spins or missing items
				if (!initializedFromFreeSpinData) {
					if (this.pendingFreeSpinsData) {
						console.log(
							`[SlotController] Fallback: showing free spin display with ${this.pendingFreeSpinsData.actualFreeSpins} spins after dialog closed`
						);
						this.showFreeSpinDisplayWithActualValue(this.pendingFreeSpinsData.actualFreeSpins);
						this.pendingFreeSpinsData = null;
					} else {
						console.log('[SlotController] No free spin data available to initialize display');
					}
				}
			}

			// If an autoplay spin was already triggered before the display appeared, apply the -1 now (deferred UI decrement)
			try {
				if (gameStateManager.isBonus && this.freeSpinNumber) {
					if (this.shouldSubtractOneFromServerFsDisplay && !this.uiFsDecrementApplied) {
						const currentText = (this.freeSpinNumber.text || '').toString().trim();
						const currentVal = parseInt(currentText, 10);
						if (!isNaN(currentVal) && currentVal > 0) {
							const decremented = Math.max(0, currentVal - 1);
							this.freeSpinNumber.setText(decremented.toString());
							this.uiFsDecrementApplied = true;
							console.log(`[SlotController] Applied deferred -1 on display after dialog: ${currentVal} -> ${decremented}`);
						}
					}
				}
			} catch (e) {
				console.warn('[SlotController] Failed to apply deferred -1 after dialog:', e);
			}
		});

		// Listen for free spin autoplay events
		gameEventManager.on(GameEventType.FREE_SPIN_AUTOPLAY, async () => {
			console.log('[SlotController] FREE_SPIN_AUTOPLAY event received - triggering free spin simulation');
			
			// Drop/clear previous symbols at the start of each free spin in bonus mode,
			// same as we do for normal spins and buy feature spins.
			try {
				const gameScene: any = this.scene as any;
				const symbolsComponent = gameScene?.symbols;
				if (symbolsComponent && typeof symbolsComponent.startPreSpinDrop === 'function') {
					console.log('[SlotController] Triggering pre-spin symbol drop for FREE_SPIN_AUTOPLAY');
					symbolsComponent.startPreSpinDrop();
				}
			} catch (e) {
				console.warn('[SlotController] Failed to start pre-spin symbol drop for FREE_SPIN_AUTOPLAY:', e);
			}
			
			// Apply turbo mode to game data and winlines (same as normal autoplay)
			this.forceApplyTurboToSceneGameData();
			this.applyTurboToWinlineAnimations();

			// Do not optimistically decrement UI; wait for actual REELS_START to sync
			this.shouldSubtractOneFromServerFsDisplay = false;
			this.uiFsDecrementApplied = false;
			
			if (gameStateManager.isBonus && this.gameAPI && this.symbols) {
				try {
					// Get free spin data from GameAPI directly (this should have the original scatter data)
					const gameAPISpinData = this.gameAPI.getCurrentSpinData();
					if (gameAPISpinData && (gameAPISpinData.slot?.freespin?.items || gameAPISpinData.slot?.freeSpin?.items)) {
						console.log('[SlotController] Found free spin data in GameAPI');
						const freespinData = gameAPISpinData.slot?.freespin || gameAPISpinData.slot?.freeSpin;
						console.log('[SlotController] GameAPI currentSpinData has freespin:', !!gameAPISpinData.slot?.freespin);
						console.log('[SlotController] GameAPI currentSpinData has freeSpin:', !!gameAPISpinData.slot?.freeSpin);
						console.log('[SlotController] GameAPI currentSpinData has items:', !!freespinData?.items);
						console.log('[SlotController] GameAPI currentSpinData items count:', freespinData?.items?.length);
					} else {
						console.error('[SlotController] No free spin data available in GameAPI');
						console.error('[SlotController] GameAPI currentSpinData:', gameAPISpinData);
						console.error('[SlotController] GameAPI currentSpinData.slot:', gameAPISpinData?.slot);
						console.error('[SlotController] GameAPI currentSpinData.slot.freespin:', gameAPISpinData?.slot?.freespin);
						console.error('[SlotController] GameAPI currentSpinData.slot.freeSpin:', gameAPISpinData?.slot?.freeSpin);
						console.error('[SlotController] GameAPI currentSpinData.slot.freespin.items:', gameAPISpinData?.slot?.freespin?.items);
						console.error('[SlotController] GameAPI currentSpinData.slot.freeSpin.items:', gameAPISpinData?.slot?.freeSpin?.items);
						return;
					}
					
					// Use our free spin simulation
					const spinData = await this.gameAPI.simulateFreeSpin();
					
					// Compute raw server spinsLeft and sync internal Symbols counter (handles retriggers)
					const serverSpinsLeft = this.getSpinsLeftAfterSimulatedFreeSpin(spinData);
					try {
						const symbolsComponent = (this.scene as any)?.symbols;
						if (symbolsComponent && typeof symbolsComponent.setFreeSpinAutoplaySpinsRemaining === 'function') {
							symbolsComponent.setFreeSpinAutoplaySpinsRemaining(serverSpinsLeft);
						}
					} catch (e) {
						console.warn('[SlotController] Failed to sync Symbols free spin counter during autoplay:', e);
					}
					
					// Update free spin display from symbols tracker (authoritative), fallback to override or server value
					let displaySpins = serverSpinsLeft;
					try {
						const symbolsComponent = (this.scene as any)?.symbols;
						if (symbolsComponent && typeof symbolsComponent.freeSpinAutoplaySpinsRemaining === 'number') {
							displaySpins = symbolsComponent.freeSpinAutoplaySpinsRemaining;
						} else if (this.freeSpinDisplayOverride !== null) {
							displaySpins = this.freeSpinDisplayOverride as number;
						}
					} catch {}
					this.updateFreeSpinNumber(displaySpins);
					console.log(`[SlotController] Updated free spin display to ${displaySpins} remaining (from spin data)`);
					
					// Check if there are any more free spins available
					const freespinData = (spinData.slot as any)?.freespin || (spinData.slot as any)?.freeSpin;
					const hasMoreFreeSpins = freespinData?.items?.some((item: any) => item.spinsLeft > 0);
					if (!hasMoreFreeSpins) {
						// No more free spins - mark completion and let congrats dialog own bonus exit.
						console.log('[SlotController] No more free spins available - marking bonus as finished');
						gameStateManager.isBonusFinished = true;
						this.shouldSubtractOneFromServerFsDisplay = false;
						this.uiFsDecrementApplied = false;
					}

					// Process the spin data directly for free spin autoplay
					if (this.scene && (this.scene as any).symbols) {
						const symbolsComponent = (this.scene as any).symbols;
						if (symbolsComponent && typeof symbolsComponent.processSpinData === 'function') {
							console.log('[SlotController] Processing free spin data directly via symbols component');
							symbolsComponent.processSpinData(spinData);
						} else {
							console.log('[SlotController] Symbols component not available, falling back to SPIN_DATA_RESPONSE');
							gameEventManager.emit(GameEventType.SPIN_DATA_RESPONSE, {
								spinData: spinData
							});
						}
					} else {
						console.log('[SlotController] Scene or symbols not available, falling back to SPIN_DATA_RESPONSE');
						gameEventManager.emit(GameEventType.SPIN_DATA_RESPONSE, {
							spinData: spinData
						});
					}

				} catch (error) {
					console.error('[SlotController] Free spin simulation failed:', error);
				}
			} else {
				console.warn('[SlotController] Not in bonus mode or GameAPI not available for free spin autoplay');
			}
		});

		// Listen for scatter bonus activation to reset free spin index (but NOT on retriggers)
		this.scene.events.on('scatterBonusActivated', (data: { scatterIndex: number; actualFreeSpins: number; isRetrigger?: boolean; fromUnresolvedSpin?: boolean }) => {
			const isRetrigger = !!(data && (data as any).isRetrigger);
			const fromUnresolvedSpin = !!(data && (data as any).fromUnresolvedSpin);
			if (fromUnresolvedSpin) {
				console.log('[SlotController] Scatter bonus from unresolved spin - preserving free spin index for autoplay');
				return;
			}
			if (isRetrigger) {
				console.log('[SlotController] Scatter bonus retrigger detected - NOT resetting free spin index');
				return;
			}
			console.log('[SlotController] Scatter bonus initial activation - resetting free spin index');
			if (this.gameAPI) {
				this.gameAPI.resetFreeSpinIndex();
			}
		});

		console.log('[SlotController] Bonus mode event listener setup complete');
	}

	/**
	 * Setup spin state change listener
	 */
	private setupSpinStateListener(): void {
		if (!this.gameData) {
			console.warn('[SlotController] GameData not available for spin state listener');
			return;
		}

		// No more polling - we'll manage button state purely through events
		console.log('[SlotController] Spin state listener setup complete - no polling');
	}

	/**
	 * Refresh the GameData reference from the scene
	 */
	private refreshGameDataReference(): void {
		if (this.scene && this.scene.scene.key === 'Game') {
			const newGameData = (this.scene as any).gameData;
			if (newGameData && newGameData !== this.gameData) {
				console.log('[SlotController] Refreshing GameData reference');
				this.gameData = newGameData;
			}
		}
	}

	/**
	 * Get the current GameData instance, refreshing if needed
	 */
	private getGameData(): GameData | null {
		if (!this.gameData) {
			this.refreshGameDataReference();
		}
		return this.gameData;
	}

	private isAutoplayUiActive(): boolean {
		const gameData = this.getGameData();
		return (
			this.autoplaySpinsRemaining > 0 ||
			gameStateManager.isAutoPlaying ||
			!!gameData?.isAutoPlaying
		);
	}

	/** Keep autoplay active but block the next spin until the bet-failed popup closes. */
	private pauseAutoplayForBetFailedPopup(): void {
		if (!this.isAutoplayUiActive()) {
			return;
		}
		console.log('[SlotController] Pausing autoplay until bet-failed popup closes');
		this.autoplayPausedForBetFailedPopup = true;
		if (this.autoplayTimer) {
			this.autoplayTimer.destroy();
			this.autoplayTimer = null;
		}
	}

	private stopAutoplayStopIconTween(): void {
		try { this.autoplayStopIconTween?.stop(); } catch {}
		this.autoplayStopIconTween = null;
	}

	private stopSpinIconSkipFadeTween(): void {
		try { this.spinIconSkipFadeTween?.stop(); } catch {}
		this.spinIconSkipFadeTween = null;
	}

	private setAutoplayStopIconImmediate(visible: boolean, alpha: number = 1): void {
		const icon = this.autoplayStopIcon;
		if (!icon) return;

		this.stopAutoplayStopIconTween();
		icon.setVisible(visible);
		icon.setAlpha(alpha);
		if (visible && this.primaryControllers) {
			this.primaryControllers.bringToTop(icon);
		}
	}

	private isAutoplaySpinControlActive(): boolean {
		try {
			if (this.symbols?.isFreeSpinAutoplayActive?.()) {
				return true;
			}
		} catch {}
		if (gameStateManager.isAutoPlaying || gameStateManager.isAutoPlaySpinRequested) {
			return true;
		}
		return this.autoplaySpinsRemaining > 0;
	}

	private syncAutoplaySpinButtonVisual(): void {
		if (!this.isAutoplaySpinControlActive()) {
			return;
		}

		this.spinSkipVisualActive = false;

		const gsmAny: any = gameStateManager as any;
		if (gsmAny.isInFreeSpinRound === true || this.isFreeRoundAutoplay) {
			this.setSpinOverlayIconsImmediate(false);
			return;
		}

		this.setSpinOverlayIconsImmediate(true);
		if (this.autoplaySpinsRemainingText && this.primaryControllers) {
			this.primaryControllers.bringToTop(this.autoplaySpinsRemainingText);
		}

		const spinButton = this.buttons.get('spin');
		if (spinButton) {
			this.applySpinButtonVisualTint(null);
		}
	}

	private canOfferManualSpinSkipOnButton(): boolean {
		if (!this.currentSpinAllowsManualButtonSkip) {
			return false;
		}
		if (gameStateManager.isBonus) {
			return false;
		}
		if (this.manualSpinSkipConsumedForCurrentSpin) {
			return false;
		}
		if (this.isAutoplaySpinControlActive()) {
			return false;
		}
		try {
			if (this.symbols?.isSkipReelDropsRequested?.()) {
				return false;
			}
		} catch {}
		try {
			if (this.symbols?.isFreeSpinAutoplayActive?.()) {
				return false;
			}
		} catch {}
		try {
			return !!this.symbols?.canRequestSkipReelDropsNow?.();
		} catch {}
		return false;
	}

	/** Manual spin: keep base full-color + interactive; transition to skip affordance (no grey-out). */
	private armManualSpinSkipButtonVisual(): void {
		const spinButton = this.buttons.get('spin');
		if (!spinButton) {
			return;
		}
		this.applySpinButtonVisualTint(null);
		this.setSpinButtonInputEnabled(true);
		try {
			this.scene?.time.delayedCall(0, () => this.refreshManualSpinSkipButtonVisual());
		} catch {
			this.refreshManualSpinSkipButtonVisual();
		}
	}

	private releaseManualSpinClickLock(): void {
		this.manualSpinClickInFlight = false;
	}

	/** Clears manual skip HUD flags when the spin has fully finished (idle restore). */
	private resetManualSpinSkipButtonState(): void {
		this.manualSpinSkipConsumedForCurrentSpin = false;
		this.currentSpinAllowsManualButtonSkip = false;
		this.spinSkipVisualActive = false;
		this.stopAutoplayStopIconTween();
		this.stopSpinIconSkipFadeTween();
	}

	private isManualSpinPresentationActive(): boolean {
		if (gameStateManager.isReelSpinning) {
			return true;
		}
		try {
			if ((gameStateManager as any).isProcessingSpin) {
				return true;
			}
		} catch {}
		try {
			if (this.symbols?.reelDropInProgress || this.symbols?.preSpinDropInProgress) {
				return true;
			}
		} catch {}
		return false;
	}

	private handleManualSpinSkipRequest(): boolean {
		if (gameStateManager.isBonus) {
			return false;
		}
		if (!this.canOfferManualSpinSkipOnButton()) {
			return false;
		}
		console.log('[SlotController] Spin pressed during active spin - requesting skip of reel drops');
		try {
			if (this.symbols?.tryRequestSkipReelDrops?.()) {
				return true;
			}
		} catch {}
		return false;
	}

	public onReelDropSkipActivated(): void {
		if (!this.currentSpinAllowsManualButtonSkip || this.isAutoplaySpinControlActive()) {
			return;
		}
		this.applySpinSkipConsumedVisual();
	}

	private refreshManualSpinSkipButtonVisual(): void {
		if (this.isAutoplaySpinControlActive() || !this.currentSpinAllowsManualButtonSkip) {
			return;
		}
		if (!this.isManualSpinPresentationActive()) {
			return;
		}
		try {
			if (this.symbols?.isSkipReelDropsRequested?.() || this.manualSpinSkipConsumedForCurrentSpin) {
				this.applySpinSkipConsumedVisual();
				return;
			}
		} catch {}
		if (this.canOfferManualSpinSkipOnButton()) {
			this.showSpinSkipButtonMode();
			return;
		}
		if (this.spinSkipVisualActive && !this.manualSpinSkipConsumedForCurrentSpin) {
			this.hideSpinSkipButtonMode();
		}
	}

	private applySpinSkipConsumedVisual(_animate: boolean = true): void {
		if (!this.currentSpinAllowsManualButtonSkip || this.isAutoplaySpinControlActive()) {
			return;
		}
		this.manualSpinSkipConsumedForCurrentSpin = true;
		this.spinSkipVisualActive = true;
		this.releaseManualSpinClickLock();
		const spinButton = this.buttons.get('spin');
		if (!spinButton) {
			return;
		}

		this.applySpinButtonVisualTint(null);
		this.setSpinButtonInputEnabled(true);
		this.setSpinOverlayIconsImmediate(true);
		if (this.autoplaySpinsRemainingText && this.primaryControllers) {
			this.primaryControllers.bringToTop(this.autoplaySpinsRemainingText);
		}
	}

	public showSpinSkipButtonMode(animate: boolean = true): void {
		if (this.isAutoplaySpinControlActive()) {
			return;
		}
		try {
			if (this.symbols?.isSkipReelDropsRequested?.()) {
				return;
			}
		} catch {}

		const spinButton = this.buttons.get('spin');
		if (!spinButton) {
			return;
		}

		this.spinSkipVisualActive = true;
		this.applySpinButtonVisualTint(null);
		this.setSpinButtonInputEnabled(true);
		// Instant swap — no alpha fade (guide §6.8); `animate` retained for call-site compat.
		void animate;
		this.setSpinOverlayIconsImmediate(true);
		if (this.autoplaySpinsRemainingText && this.primaryControllers) {
			this.primaryControllers.bringToTop(this.autoplaySpinsRemainingText);
		}
	}

	private hideSpinSkipButtonMode(animate: boolean = true): void {
		if (this.isAutoplaySpinControlActive() || !this.currentSpinAllowsManualButtonSkip) {
			this.spinSkipVisualActive = false;
			return;
		}
		if (this.manualSpinSkipConsumedForCurrentSpin) {
			return;
		}
		if (!this.spinSkipVisualActive) {
			return;
		}
		this.spinSkipVisualActive = false;
		void animate;
		this.setSpinOverlayIconsImmediate(false);
	}

	/**
	 * Disable the spin button (input gate). `spin_icon` stays full-bright and spinning (guide §6.9).
	 */
	public disableSpinButton(keepInteractive: boolean = false): void {
		if (
			this.manualSpinSkipConsumedForCurrentSpin &&
			this.currentSpinAllowsManualButtonSkip &&
			!this.isAutoplaySpinControlActive()
		) {
			return;
		}
		// Manual skip spins stay full-color while interactive (no grey base during skip window).
		if (
			keepInteractive &&
			this.currentSpinAllowsManualButtonSkip &&
			!this.isAutoplaySpinControlActive()
		) {
			this.armManualSpinSkipButtonVisual();
			return;
		}
		this.spinSkipVisualActive = false;
		const spinButton = this.buttons.get('spin');
		if (spinButton || this.spinHitZone) {
			this.applySpinButtonVisualTint(0x666666);
			this.setSpinButtonInputEnabled(!!keepInteractive);
			if (this.spinIcon) {
				this.spinIcon.setAlpha(1);
				if (this.spinIcon.visible) {
					this.ensureSpinIconIdleTween();
				}
			}
			if (!this.isAutoplaySpinControlActive()) {
				// Keep arrows visible unless autoplay/skip HUD already swapped to stop icon.
				if (this.spinIcon && !this.autoplayStopIcon?.visible) {
					this.spinIcon.setVisible(true);
				}
			}
		}
	}

	/**
	 * Effective cost of one spin for affordability checks (includes enhance bet multiplier).
	 */
	private getSpinBetCost(): number {
		const baseBet = this.getBaseBetAmount() || 0;
		const gd = this.getGameData();
		const multiplier = gd && gd.isEnhancedBet ? 1.25 : 1;
		return baseBet * multiplier;
	}

	/**
	 * True if balance can cover a single spin at current bet.
	 * Free rounds are always considered affordable.
	 */
	private canAffordSpin(): boolean {
		const gsmAny: any = gameStateManager as any;
		if (gsmAny?.isInFreeSpinRound === true) {
			return true;
		}
		try {
			const cost = this.getSpinBetCost();
			if (!isFinite(cost) || cost <= 0) {
				// Safety fallback: don't block if cost is invalid
				return true;
			}
			return this.getBalanceAmount() >= cost;
		} catch {
			return true;
		}
	}

	/**
	 * Enable the spin button
	 */
	public enableSpinButton(): void {
		const spinButton = this.buttons.get('spin');
		if (!spinButton) {
			return;
		}

		if (this.isAwaitingFreeRoundStartPrompt) {
			this.disableSpinButton();
			return;
		}

		if (this.shouldKeepBaseControlsLocked()) {
			this.disableSpinButton();
			return;
		}

		if (this.isAutoplaySpinControlActive()) {
			this.syncAutoplaySpinButtonVisual();
			this.setSpinButtonInputEnabled(true);
			return;
		}

		if (this.canOfferManualSpinSkipOnButton()) {
			this.showSpinSkipButtonMode();
			return;
		}

		if (this.manualSpinSkipConsumedForCurrentSpin && this.isManualSpinPresentationActive()) {
			this.applySpinSkipConsumedVisual();
			return;
		}

		this.hideSpinSkipButtonMode();
		this.resetManualSpinSkipButtonState();

		this.applySpinButtonVisualTint(null);
		this.setSpinButtonInputEnabled(true);
		if (this.spinIcon) {
			this.spinIcon.setVisible(true);
			this.spinIcon.setAlpha(1);
		}
		this.ensureSpinIconIdleTween();
		if (!this.isAutoplaySpinControlActive()) {
			this.setSpinOverlayIconsImmediate(false);
		}
	}

	/**
	 * Public method to manually update spin button state
	 */
	public updateSpinButtonState(): void {
		const gameData = this.getGameData();
		if (!gameData || !this.buttons.has('spin')) {
			return;
		}

		const spinButton = this.buttons.get('spin');
		if (!spinButton) return;

		// Free-round starting prompt (or the delay before it appears): spin stays off until SPIN NOW.
		if (this.isAwaitingFreeRoundStartPrompt) {
			this.disableSpinButton();
			return;
		}

		if (this.shouldKeepBaseControlsLocked()) {
			this.disableSpinButton();
			return;
		}

		if (this.isAutoplaySpinControlActive()) {
			this.syncAutoplaySpinButtonVisual();
			try { this.setSpinButtonInputEnabled(true); } catch {}
			return;
		}

		if (this.canOfferManualSpinSkipOnButton()) {
			this.refreshManualSpinSkipButtonVisual();
			return;
		}

		if (
			this.manualSpinSkipConsumedForCurrentSpin &&
			this.isManualSpinPresentationActive()
		) {
			this.applySpinSkipConsumedVisual();
			return;
		}

		if (
			(gameStateManager as any).isProcessingSpin ||
			gameStateManager.isReelSpinning ||
			this.isAutoplaySpinControlActive()
		) {
			this.disableSpinButton();
			return;
		}

		if (this.manualSpinSkipConsumedForCurrentSpin || this.currentSpinAllowsManualButtonSkip) {
			this.resetManualSpinSkipButtonState();
		}

		this.enableSpinButton();
	}

	/** True while the buy-feature drawer/panel is open (for input / hotkey guards). */
	public isBuyFeatureOpen(): boolean {
		return this.buyFeature?.isOpen() ?? false;
	}

	/**
	 * External request to activate the spin button (e.g. SPACE hotkey).
	 * Keyboard during autoplay skips (while spinning) or no-ops (while idle); pointer stops autoplay.
	 */
	public async requestSpin(source: 'pointer' | 'keyboard' = 'keyboard'): Promise<void> {
		console.log('[SlotController] requestSpin:', source);
		await this.onSpinButtonActivated(source);
	}

	/** Shared spin-button activation path for pointer and keyboard. */
	private async onSpinButtonActivated(source: 'pointer' | 'keyboard'): Promise<void> {
		const autoplayActive =
			gameStateManager.isAutoPlaying ||
			gameStateManager.isAutoPlaySpinRequested ||
			this.isAutoplaySpinControlActive();

		if (autoplayActive) {
			// SPACE during autoplay: skip reel-drop while spinning; no-op while idle.
			// Pointer still stops autoplay (matches shuten_doji).
			if (source === 'keyboard') {
				if (gameStateManager.isProcessingSpin || gameStateManager.isReelSpinning) {
					this.playSpinButtonClickFeedback();
					try {
						if (this.symbols?.tryRequestSkipReelDrops?.()) {
							console.log('[SlotController] SPACE → skip reel-drop during autoplay');
						}
					} catch {}
				}
				return;
			}
			this.playSpinButtonClickFeedback();
			console.log('[SlotController] Stopping autoplay via spin button');
			this.stopAutoplay();
			return;
		}

		if (!this.isSpinButtonEnabled()) {
			return;
		}

		this.playSpinButtonClickFeedback();
		if (this.manualSpinSkipConsumedForCurrentSpin) {
			return;
		}
		if (this.handleManualSpinSkipRequest()) {
			return;
		}
		if (this.manualSpinClickInFlight || gameStateManager.isProcessingSpin) {
			console.log('[SlotController] Spin activation ignored - spin already starting');
			return;
		}
		if (gameStateManager.isScatter) {
			console.log('[SlotController] Spin blocked - scatter transition/animation in progress');
			this.disableSpinButton();
			return;
		}

		this.manualSpinClickInFlight = true;
		this.currentSpinAllowsManualButtonSkip = true;
		this.manualSpinSkipConsumedForCurrentSpin = false;
		(gameStateManager as any).isProcessingSpin = true;

		try {
			this.armManualSpinSkipButtonVisual();
			this.disableBetButtons();
			this.disableBetBackgroundInteraction('spin button clicked');
			this.disableFeatureButton();
			this.disableAmplifyButton();
			this.disableAutoplayButton();
			this.disableTurboButton();
			await this.handleSpin();
		} finally {
			this.manualSpinClickInFlight = false;
		}
	}

	/**
	 * Get the current state of the spin button
	 */
	public isSpinButtonEnabled(): boolean {
		if (this.spinHitZone?.input) {
			return !!this.spinHitZone.input.enabled;
		}
		const spinButton = this.buttons.get('spin');
		return spinButton ? spinButton.input?.enabled || false : false;
	}

	/**
	 * Force refresh the spin button state
	 */
	public refreshSpinButtonState(): void {
		this.updateSpinButtonState();
	}

	/**
	 * Re-enable the spin button (force enable regardless of state)
	 */
	public reEnableSpinButton(): void {
		console.log('[SlotController] Force re-enabling spin button');
		
		// Log current state for debugging
		const gameData = this.getGameData();
		if (gameData) {
			console.log(`[SlotController] Current state when re-enabling: isReelSpinning=${gameStateManager.isReelSpinning}, isAutoPlaying=${gameData.isAutoPlaying}`);
		}
		
		// Simply enable the button
		this.enableSpinButton();
		console.log('[SlotController] Spin button re-enabled');
	}

	/**
	 * Manually trigger spin button state update (useful for external components)
	 */
	public forceUpdateSpinButtonState(): void {
		console.log('[SlotController] Force updating spin button state');
		this.updateSpinButtonState();
	}

	/**
	 * Get current state information for debugging
	 */
	public getSpinButtonStateInfo(): string {
		const gameData = this.getGameData();
		if (!gameData) {
			return 'GameData not available';
		}
		
		const isEnabled = this.isSpinButtonEnabled();
		return `Spin Button: ${isEnabled ? 'ENABLED' : 'DISABLED'} | isReelSpinning: ${gameStateManager.isReelSpinning} | isAutoPlaying: ${gameData.isAutoPlaying}`;
	}

	/**
	 * Get current GameData animation timing values for debugging
	 */
	public getGameDataAnimationInfo(): string {
		const gameData = this.getGameData();
		if (!gameData) {
			return 'GameData not available';
		}
		
		return `GameData Animation Values: winUpDuration=${gameData.winUpDuration}, dropDuration=${gameData.dropDuration}, dropReelsDelay=${gameData.dropReelsDelay}, dropReelsDuration=${gameData.dropReelsDuration}, isTurbo=${gameData.isTurbo}`;
	}

	/**
	 * Force apply turbo speed to scene GameData (used by Symbols component)
	 */
	public forceApplyTurboToSceneGameData(): void {
		if (!this.scene || !(this.scene as any).gameData) {
			console.warn('[SlotController] Scene or scene GameData not available');
			return;
		}
		const sceneGameData = (this.scene as any).gameData;
		const gameData = this.getGameData();
		
		if (gameData) {
			if (gameData.isTurbo) {
				console.log('[SlotController] Force applying turbo to scene GameData');
				
				// Sync scene GameData from UI GameData, then apply turbo multipliers once
				sceneGameData.winUpDuration = gameData.winUpDuration * TurboConfig.TURBO_DURATION_MULTIPLIER;
				sceneGameData.dropDuration = gameData.dropDuration * TurboConfig.TURBO_DURATION_MULTIPLIER;
				sceneGameData.dropReelsDelay = gameData.dropReelsDelay * TurboConfig.TURBO_DELAY_MULTIPLIER;
				sceneGameData.dropReelsDuration = gameData.dropReelsDuration * TurboConfig.TURBO_DURATION_MULTIPLIER;
				(sceneGameData as any).compressionDelayMultiplier = TurboConfig.TURBO_DELAY_MULTIPLIER;
				
				console.log(`[SlotController] Scene GameData turbo applied:`);
				console.log(`  winUpDuration: ${sceneGameData.winUpDuration}`);
				console.log(`  dropDuration: ${sceneGameData.dropDuration}`);
				console.log(`  dropReelsDelay: ${sceneGameData.dropReelsDelay}`);
				console.log(`  dropReelsDuration: ${sceneGameData.dropReelsDuration}`);
			} else {
				console.log('[SlotController] Resetting scene GameData to normal speed');
				
				// Reset to normal speed by calling setSpeed with the original delay
				const originalDelay = 2500; // This should match Data.DELAY_BETWEEN_SPINS
				setSpeed(sceneGameData, originalDelay);
				(sceneGameData as any).compressionDelayMultiplier = 1;
				
				console.log(`[SlotController] Scene GameData reset to normal speed:`);
				console.log(`  winUpDuration: ${sceneGameData.winUpDuration}`);
				console.log(`  dropDuration: ${sceneGameData.dropDuration}`);
				console.log(`  dropReelsDelay: ${sceneGameData.dropReelsDelay}`);
				console.log(`  dropReelsDuration: ${sceneGameData.dropReelsDuration}`);
			}
		}
	}

	/**
	 * Apply turbo mode to winline animations via Symbols component
	 */
	public applyTurboToWinlineAnimations(): void {
		if (!this.scene) {
			console.warn('[SlotController] Scene not available for winline turbo');
			return;
		}

		// Try to access the Symbols component from the scene
		const symbolsComponent = (this.scene as any).symbols;
		if (symbolsComponent && typeof symbolsComponent.setTurboMode === 'function') {
			const gameData = this.getGameData();
			if (gameData) {
				symbolsComponent.setTurboMode(gameData.isTurbo);
				console.log(`[SlotController] Turbo mode ${gameData.isTurbo ? 'enabled' : 'disabled'} for winline animations via Symbols component`);
			}
		} else {
			console.warn('[SlotController] Symbols component or setTurboMode method not available');
		}
	}

	/**
	 * Reset winline animations to default timing via Symbols component
	 */
	public resetWinlineTiming(): void {
		if (!this.scene) {
			console.warn('[SlotController] Scene not available for winline timing reset');
			return;
		}

		// Try to access the Symbols component from the scene
		const symbolsComponent = (this.scene as any).symbols;
		if (symbolsComponent && typeof symbolsComponent.resetWinlineTiming === 'function') {
			symbolsComponent.resetWinlineTiming();
			console.log('[SlotController] Winline timing reset to default values via Symbols component');
		} else {
			console.warn('[SlotController] Symbols component or resetWinlineTiming method not available');
		}
	}

	/**
	 * Clear any pending balance updates
	 */
	public clearPendingBalanceUpdate(): void {
		if (this.pendingBalanceUpdate) {
			console.log('[SlotController] Clearing pending balance update:', this.pendingBalanceUpdate);
			this.pendingBalanceUpdate = null;
		}
	}

	/**
	 * Get current pending balance update for debugging
	 */
	public getPendingBalanceUpdate(): { balance: number; bet: number; winnings?: number } | null {
		return this.pendingBalanceUpdate;
	}

	/**
	 * Check if there are pending balance updates
	 */
	public hasPendingBalanceUpdate(): boolean {
		return this.pendingBalanceUpdate !== null;
	}

	/**
	 * Check if there are pending winnings to be added
	 */
	public hasPendingWinnings(): boolean {
		return this.pendingBalanceUpdate?.winnings !== undefined && this.pendingBalanceUpdate.winnings > 0;
	}

	/**
	 * Get the amount of pending winnings
	 */
	public getPendingWinnings(): number {
		return this.pendingBalanceUpdate?.winnings || 0;
	}

	/**
	 * Force apply pending balance update (useful for debugging or special cases)
	 */
	public forceApplyPendingBalanceUpdate(): void {
		if (this.pendingBalanceUpdate) {
			console.log('[SlotController] Force applying pending balance update:', this.pendingBalanceUpdate);
			
			// Update balance display
			if (this.pendingBalanceUpdate.balance !== undefined) {
				const oldBalance = this.getBalanceAmountText();
				this.startBalanceTween(this.pendingBalanceUpdate.balance, 320);
				
				if (this.pendingBalanceUpdate.winnings && this.pendingBalanceUpdate.winnings > 0) {
					console.log(`[SlotController] Balance force updated: ${oldBalance} -> ${this.pendingBalanceUpdate.balance} (added winnings: ${this.pendingBalanceUpdate.winnings})`);
				} else {
					console.log(`[SlotController] Balance force updated: ${oldBalance} -> ${this.pendingBalanceUpdate.balance}`);
				}
			}
			
			// Update bet display
			if (this.pendingBalanceUpdate.bet !== undefined) {
				this.updateBetAmount(this.pendingBalanceUpdate.bet);
				console.log('[SlotController] Bet force updated:', this.pendingBalanceUpdate.bet);
			}
			
			// Clear the pending update
			this.pendingBalanceUpdate = null;
		} else {
			console.log('[SlotController] No pending balance update to force apply');
		}
	}

	/**
	 * Log current state for debugging
	 */
	public logCurrentState(): void {
		const gameData = this.getGameData();
		if (!gameData) {
			console.log('[SlotController] GameData not available');
			return;
		}
		
		console.log(`[SlotController] Current State:`, {
			spinButtonEnabled: this.isSpinButtonEnabled(),
			isSpinning: gameData.isReelSpinning,
			isAutoPlaying: gameData.isAutoPlaying,
			hasSpinButton: this.buttons.has('spin'),
			pendingBalanceUpdate: this.pendingBalanceUpdate
		});
	}

	/**
	 * Start the turbo button animation (looping)
	 */
	private startTurboAnimation(): void {
		// Ensure the animation exists
		this.ensureTurboAnimationExists();
		
		if (!this.turboButtonAnimation) {
			console.warn('[SlotController] Turbo button animation not available');
			return;
		}

		try {
			// Show the animation
			this.turboButtonAnimation.setVisible(true);
			
			// Start looping animation following the same pattern as kobi-ass
			// Use animationState.setAnimation with loop = true for continuous looping
			this.turboButtonAnimation.animationState.setAnimation(0, "animation", true);
			
			console.log('[SlotController] Turbo button spine animation started (looping)');
		} catch (error) {
			console.error('[SlotController] Error starting turbo button animation:', error);
		}
	}

	/**
	 * Stop the turbo button animation
	 */
	private stopTurboAnimation(): void {
		if (!this.turboButtonAnimation) {
			console.warn('[SlotController] Turbo button animation not available');
			return;
		}

		try {
			// Hide the animation
			this.turboButtonAnimation.setVisible(false);
			
			// Stop the animation
			this.turboButtonAnimation.animationState.clearTracks();
			
			console.log('[SlotController] Turbo button spine animation stopped');
		} catch (error) {
			console.error('[SlotController] Error stopping turbo button animation:', error);
		}
	}

	/**
	 * Ensure the turbo animation exists and recreate if needed
	 */
	private ensureTurboAnimationExists(): void {
		if (!this.turboButtonAnimation && this.scene) {
			console.log('[SlotController] Turbo animation not found, recreating...');
			const screenConfig = this.screenModeManager.getScreenConfig();
			const assetScale = this.networkManager.getAssetScale();
			this.createTurboButtonAnimation(this.scene, assetScale);
		}
	}

	/**
	 * Create a dummy SpinData with initial symbols (same as game start)
	 * Used when 422 error occurs to allow reels to drop naturally
	 */
	private createDummySpinDataWithInitialSymbols(bet: number): any {
		console.log('[SlotController] Creating dummy spin data with initial symbols');
		
		// Initial symbols from Symbols.ts createInitialSymbols() - row-major format
		const initialRowMajor = [
			[0, 1, 3, 1, 0, 2],
			[1, 5, 2, 5, 2, 4],
			[2, 5, 5, 1, 5, 3],
			[3, 4, 1, 2, 4, 1],
			[4, 2, 0, 3, 1, 5],
		];
		
		// Convert to column-major format [col][row] for SpinData
		const rowCount = initialRowMajor.length;      // 5
		const colCount = initialRowMajor[0].length;   // 6
		const columnMajor: number[][] = [];
		
		for (let col = 0; col < colCount; col++) {
			const column: number[] = [];
			for (let row = 0; row < rowCount; row++) {
				column.push(initialRowMajor[row][col]);
			}
			columnMajor.push(column);
		}
		
		// Create dummy SpinData with no wins
		const dummySpinData = {
			playerId: 'dummy',
			bet: bet.toString(),
			slot: {
				area: columnMajor,
				paylines: [],
				tumbles: [],
				freespin: {
					count: 0,
					totalWin: 0,
					items: []
				}
			}
		};
		
		console.log('[SlotController] Dummy spin data created with area:', columnMajor);
		return dummySpinData;
	}

	/**
	 * Programmatically start a spin for replay mode (same path as spin button → {@link handleSpin}).
	 */
	public triggerReplaySpin(): void {
		if (gameStateManager.isProcessingSpin || gameStateManager.isReelSpinning) {
			console.warn('[SlotController] triggerReplaySpin blocked — spin already in progress');
			return;
		}
		console.log('[SlotController] triggerReplaySpin: starting replay spin');
		(gameStateManager as any).isProcessingSpin = true;
		this.updateAutoplayButtonState();
		this.disableSpinButton();
		this.disableBetButtons();
		this.disableBetBackgroundInteraction('replay spin');
		this.disableFeatureButton();
		this.playSpinButtonAnimation();
		this.rotateSpinButton();
		void this.handleSpin();
	}

	/**
	 * Keep Buy Feature visible but disabled (same greyed treatment as normal disable).
	 */
	public disableFeatureButtonVisible(): void {
		try {
			this.featureImage?.setVisible(true);
			this.featureButtonHitbox?.setVisible(true);
			this.featureLabelContainer?.setVisible(true);
			this.featureLabelText?.setVisible(false);
			this.featureAmountText?.setVisible(true);
			try { this.updateFeatureAmountFromCurrentBet(); } catch {}
			const featureButton = this.buttons.get('feature');
			featureButton?.setVisible(true);
		} catch {}
		this.disableFeatureButton();
	}
}

function isNonScratchReplayRequest(): boolean {
	try {
		const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
		if (params.get('replay') !== 'true') {
			return false;
		}
		return (params.get('type') || '').trim().toLowerCase() !== 'scratch';
	} catch {
		return false;
	}
}

function lockScratchControlForSlotReplay(root: any): void {
	if (!root) {
		return;
	}
	try { root.setAlpha(0.4); } catch { /* noop */ }
	try { root.disableInteractive(); } catch { /* noop */ }
	const list = root.list;
	if (!Array.isArray(list)) {
		return;
	}
	for (const child of list) {
		try { child?.disableInteractive?.(); } catch { /* noop */ }
	}
}
