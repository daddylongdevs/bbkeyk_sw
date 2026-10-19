import { Scene } from 'phaser';
import { notifyBuyFeaturePurchased, setBuyFeatureModalVisible } from '../EventBus';
import { SlotController } from './SlotController';
import { ensureSpineFactory } from '../../utils/SpineGuard';
import { CurrencyManager } from './CurrencyManager';
import { formatCurrencyNumber } from '../../utils/NumberPrecisionFormatter';
import { localizationManager } from '../../managers/LocalizationManager';
import { gameEventManager, GameEventType } from '../../event/EventManager';
import { COMMON_BET, BUY_FEATURE_TITLE, BUY_FEATURE_FEATURE_NAME, BUY_FEATURE_BUY_BUTTON, LOCALIZATION_DEFAULTS } from '../../backend/LocalizationData';

export interface BuyFeatureConfig {
	position?: { x: number; y: number };
	scale?: number;
	onClose?: () => void;
	onConfirm?: () => void;
	featurePrice?: number;
}

export class BuyFeature {
	private container: Phaser.GameObjects.Container;
	private background: Phaser.GameObjects.Graphics;
	private fullScreenBlocker: Phaser.GameObjects.Graphics;
	private confirmButtonMask: Phaser.GameObjects.Graphics;
	private confirmButtonImage: Phaser.GameObjects.Image;
	private featurePrice: number = 24000.00;
	private currentBet: number = 0.2; // Start with first bet option
	private slotController: SlotController | null = null;
	private readonly BET_MULTIPLIER: number = 100; // Multiplier for price display
	private readonly DISABLED_ALPHA: number = 0.5;
	private balanceEventUnsubs: (() => void)[] = [];
	private readonly BET_BUTTON_DISABLED_ALPHA: number = 0.3;
	private betOptions: number[] = [
		0.2, 0.4, 0.6, 0.8, 1,
		1.2, 1.6, 2, 2.4, 2.8,
		3.2, 3.6, 4, 5, 6,
		8, 10, 14, 18, 24,
		32, 40, 60, 80, 100,
		110, 120, 130, 140, 150
	];
	private currentBetIndex: number = 0; // Index in betOptions array
	private closeButton: Phaser.GameObjects.Text;
	private confirmButton: Phaser.GameObjects.Text;
	private betDisplay: Phaser.GameObjects.Text;
	private minusButton: Phaser.GameObjects.Text;
	private plusButton: Phaser.GameObjects.Text;
	
	// Continuous button press functionality
	private minusButtonTimer: Phaser.Time.TimerEvent | null = null;
	private plusButtonTimer: Phaser.Time.TimerEvent | null = null;
	private readonly CONTINUOUS_DELAY: number = 500; // 1 second initial delay
	private readonly CONTINUOUS_INTERVAL: number = 200; // 150ms interval for continuous press
	private priceDisplay: Phaser.GameObjects.Text;
	private featureLogo: Phaser.GameObjects.Image;
	private backgroundImage: Phaser.GameObjects.Image;
	private onCloseCallback?: () => void;
	private onConfirmCallback?: () => void;
	private scatterSpine?: any;
	private scatterFallbackSprite?: Phaser.GameObjects.Image;
	private scatterRetryCount: number = 0;
	private readonly SCATTER_MAX_RETRIES: number = 5;
	private readonly HORIZONTAL_PADDING: number = 32;

	constructor() {
		// Constructor for BuyFeature component
	}

	/**
	 * Sync bet ladder from GameData (single source of truth). Call at start of create().
	 */
	private applyBetLevelsFromGameData(scene: Scene): void {
		const levels = (scene as any).gameData?.betLevels;
		if (Array.isArray(levels) && levels.length > 0) {
			this.betOptions = levels;
			const defaultBet = Math.abs(this.currentBet - 0.2) < 0.0001;
			const idxInNew = this.betOptions.findIndex(v => Math.abs(v - this.currentBet) < 0.0001);
			if (!Number.isFinite(this.currentBet) || defaultBet || idxInNew === -1) {
				this.currentBetIndex = 0;
				this.currentBet = Number(this.betOptions[0]);
			} else {
				this.currentBetIndex = idxInNew;
			}
		}
	}

	/**
	 * Set the SlotController reference for accessing current bet
	 */
	public setSlotController(slotController: SlotController): void {
		this.slotController = slotController;
		console.log('[BuyFeature] SlotController reference set');
	}

	/**
	 * Get the current bet value multiplied by the multiplier (for price display)
	 */
	private getCurrentBetValue(): number {
		return this.currentBet * this.BET_MULTIPLIER;
	}

	/**
	 * Returns current price (bet × 100)
	 */
	private getCurrentFeaturePrice(): number {
		return this.getCurrentBetValue();
	}

	/**
	 * Returns true if the player balance can cover the current feature price.
	 */
	private canAffordFeature(): boolean {
		try {
			const balance = this.slotController?.getBalanceAmount?.();
			const price = this.getCurrentFeaturePrice();
			if (!Number.isFinite(price) || price <= 0) {
				return false;
			}
			if (!Number.isFinite(balance)) {
				return false;
			}
			return balance + 1e-9 >= price;
		} catch {
			return false;
		}
	}

	/**
	 * Dim + disable BUY FEATURE when unaffordable.
	 */
	private updateBuyButtonState(): void {
		if (!this.confirmButtonImage) return;

		const affordable = this.canAffordFeature();
		if (!affordable) {
			this.confirmButtonImage.setAlpha(this.DISABLED_ALPHA);
			this.confirmButtonImage.setTint(0x888888);
			this.confirmButtonImage.disableInteractive();
			if (this.confirmButton) {
				this.confirmButton.setAlpha(this.DISABLED_ALPHA);
				this.confirmButton.setTint(0x888888);
			}
		} else {
			this.confirmButtonImage.setAlpha(1);
			this.confirmButtonImage.clearTint();
			this.confirmButtonImage.setInteractive();
			if (this.confirmButton) {
				this.confirmButton.setAlpha(1);
				this.confirmButton.clearTint();
				this.confirmButton.setColor('#000000');
			}
		}
	}

	private clearBalanceEventSubscriptions(): void {
		for (const u of this.balanceEventUnsubs) {
			try {
				u();
			} catch {
				/* noop */
			}
		}
		this.balanceEventUnsubs = [];
	}

	private subscribeBalanceEventSubscriptions(): void {
		this.clearBalanceEventSubscriptions();
		const refresh = () => {
			if (this.container?.visible) {
				this.updateBuyButtonState();
			}
		};
		this.balanceEventUnsubs.push(
			gameEventManager.on(GameEventType.BALANCE_UPDATE, refresh),
			gameEventManager.on(GameEventType.BALANCE_INITIALIZED, refresh)
		);
	}

	/**
	 * Set bet +/- button enabled/disabled (same pattern as SlotController: grey out, keep interactive, no-op when disabled).
	 */
	private setBetButtonEnabled(button: Phaser.GameObjects.Text | undefined, enabled: boolean): void {
		if (!button) return;
		button.setAlpha(enabled ? 1.0 : this.BET_BUTTON_DISABLED_ALPHA);
		if (!button.input) {
			button.setInteractive();
		}
		button.setData('disabled', !enabled);
	}

	/**
	 * Grey out bet -/+ when at min/max (same as SlotController.updateBetLimitButtons).
	 */
	private updateBetLimitButtons(): void {
		const isAtMin = this.currentBetIndex <= 0;
		const isAtMax = this.currentBetIndex >= this.betOptions.length - 1;
		this.setBetButtonEnabled(this.minusButton, !isAtMin);
		this.setBetButtonEnabled(this.plusButton, !isAtMax);
	}

	/**
	 * Get the current bet value (for bet display)
	 */
	private getCurrentBet(): number {
		return this.currentBet;
	}

	/**
	 * Get the current bet value (public method for external access)
	 */
	public getCurrentBetAmount(): number {
		return this.currentBet;
	}

	/**
	 * Initialize bet index based on current bet from SlotController
	 */
	private initializeBetIndex(): void {
		if (this.slotController) {
			const currentBaseBet = this.slotController.getBaseBetAmount();
			
			// Find the closest bet option
			let closestIndex = 0;
			let closestDifference = Math.abs(this.betOptions[0] - currentBaseBet);
			
			for (let i = 1; i < this.betOptions.length; i++) {
				const difference = Math.abs(this.betOptions[i] - currentBaseBet);
				if (difference < closestDifference) {
					closestDifference = difference;
					closestIndex = i;
				}
			}
			
			this.currentBetIndex = closestIndex;
			this.currentBet = this.betOptions[closestIndex];
			console.log(`[BuyFeature] Initialized bet index ${closestIndex} with bet $${this.currentBet.toFixed(2)}`);
		}
	}

	create(scene: Scene): void {
		console.log("[BuyFeature] Creating buy feature component");

		// Use GameData.betLevels as single source of truth.
		this.applyBetLevelsFromGameData(scene);
		
		// Create main container
		this.container = scene.add.container(0, 0);
		this.container.setDepth(2000); // Very high depth to appear above everything
		
		// Create full-screen interaction blocker
		this.createFullScreenBlocker(scene);
		
		// Create background
		this.createBackground(scene);
		
		// Create feature logo
		this.createFeatureLogo(scene);
		// Create scatter symbol animation on top of the logo
		this.createScatterSymbolAnimation(scene);
		
		// Create title
		this.createTitle(scene);
		
		// Create feature name
		this.createFeatureName(scene);
		
		// Create price display
		this.createPriceDisplay(scene);
		
		// Create bet input
		this.createBetInput(scene);
		
		// Create buy button
		this.createBuyButton(scene);
		
		// Create close button
		this.createCloseButton(scene);
		
		// Initially hide the component immediately (no animation/flicker)
		if (this.container) {
			this.setContainerVisible(false);
			this.container.setY(scene.scale.height);
		}
		if (this.fullScreenBlocker) {
			this.fullScreenBlocker.setVisible(false);
		}
	}

	private createFullScreenBlocker(scene: Scene): void {
		const screenWidth = scene.scale.width;
		const screenHeight = scene.scale.height;
		
		// Create full-screen blocker behind the menu
		this.fullScreenBlocker = scene.add.graphics();
		this.fullScreenBlocker.fillStyle(0x000000, 0.01); // Nearly transparent, just to block interactions
		this.fullScreenBlocker.fillRect(0, 0, screenWidth, screenHeight);
		this.fullScreenBlocker.setInteractive(new Phaser.Geom.Rectangle(0, 0, screenWidth, screenHeight), Phaser.Geom.Rectangle.Contains);
		this.fullScreenBlocker.setDepth(1999); // Just below the menu container (2000)
		this.fullScreenBlocker.setVisible(false);
	}

	private createBackground(scene: Scene): void {
		const screenWidth = scene.scale.width;
		const screenHeight = scene.scale.height;
		
		// Create semi-transparent overlay with rounded top corners
		this.background = scene.add.graphics();
		this.background.fillStyle(0x000000, 0.80);
		this.background.fillRoundedRect(0, screenHeight - 736, screenWidth, 736, 20);
		
		// Make the background interactive to block clicks behind it
		this.background.setInteractive(new Phaser.Geom.Rectangle(0, screenHeight - 736, screenWidth, 736), Phaser.Geom.Rectangle.Contains);
		
		this.container.add(this.background);
		
		// Create background image to fill the background area
		const backgroundTop = screenHeight - 736;
		this.backgroundImage = scene.add.image(screenWidth / 2, backgroundTop + 368, 'buy_feature_bg');
		
		// Scale the image to fill the background area (736px height)
		const scaleY = 736 / this.backgroundImage.height;
		const scaleX = screenWidth / this.backgroundImage.width;
		const scale = Math.max(scaleX, scaleY); // Use the larger scale to ensure full coverage
		this.backgroundImage.setScale(scale);
		
		this.container.add(this.backgroundImage);
	}

	private createFeatureLogo(scene: Scene): void {
		const screenWidth = scene.scale.width;
		const screenHeight = scene.scale.height;
		const backgroundTop = screenHeight - 736;
		
		this.featureLogo = scene.add.image(screenWidth / 2, backgroundTop + 210, 'buy_feature_logo');
		this.featureLogo.setScale(0.9); // Default scale
		this.container.add(this.featureLogo);
	}

	/**
	 * Create the animated scatter symbol on top of the buy feature logo.
	 * Uses the sugar scatter Spine (`symbol_0_sugar_spine`) with its Win loop if available,
	 * and falls back to the PNG sprite with a pulsing tween if Spine is not ready.
	 */
	private createScatterSymbolAnimation(scene: Scene): void {
		// Ensure we have a logo to anchor to
		if (!this.featureLogo) {
			return;
		}

		const createWithSpine = () => {
			try {
				// Ensure Spine data is available in cache; retry a few times if needed
				const cacheJson: any = scene.cache.json;
				if (!cacheJson.has('symbol_0_sugar_spine')) {
					if (this.scatterRetryCount < this.SCATTER_MAX_RETRIES) {
						this.scatterRetryCount++;
						console.warn(
							`[BuyFeature] Spine json 'symbol_0_sugar_spine' not ready. Retrying (${this.scatterRetryCount}/${this.SCATTER_MAX_RETRIES})...`
						);
						scene.time.delayedCall(200, () => this.createScatterSymbolAnimation(scene));
						return;
					}
					console.error('[BuyFeature] Spine assets for scatter still not ready after retries. Falling back to PNG.');
					this.createScatterFallbackSprite(scene);
					return;
				}

				const x = this.featureLogo.x;
				// Slightly above the logo center so it appears "on top" visually
				const y = this.featureLogo.y - this.featureLogo.displayHeight * 0;

				this.scatterSpine = (scene.add as any).spine(
					x,
					y,
					'symbol_0_sugar_spine',
					'symbol_0_sugar_spine-atlas'
				);

				if (!this.scatterSpine) {
					console.warn('[BuyFeature] Failed to create scatter Spine object, using PNG fallback.');
					this.createScatterFallbackSprite(scene);
					return;
				}

				this.scatterSpine.setOrigin(0.5, 0.5);

				// Scale relative to the logo width so it looks good on different resolutions
				try {
					const targetWidth = this.featureLogo.displayWidth * 0.4;
					const baseWidth = (this.scatterSpine.width || 1);
					// Increase scale by 40% over the base size
					const scale = (targetWidth / baseWidth) * 1.8;
					this.scatterSpine.setScale(scale);
				} catch {
					// Safe fallback scale
					this.scatterSpine.setScale(0.4 * 1.8);
				}

				// Bring on top of the logo
				if (this.container) {
					this.container.add(this.scatterSpine);
				}

				// Play continuous "win" loop for the scatter sugar symbol
				try {
					const symbolValue = 0;
					const winAnimationName = `Symbol${symbolValue}_SW_Win`;
					const state: any = this.scatterSpine.animationState;
					if (state && typeof state.setAnimation === 'function') {
						try { if (typeof state.clearTracks === 'function') state.clearTracks(); } catch {}
						state.setAnimation(0, winAnimationName, true);
						console.log(`[BuyFeature] Playing scatter Spine win loop: ${winAnimationName}`);
					}
				} catch (e) {
					console.warn('[BuyFeature] Failed to start scatter Spine win animation:', e);
				}
			} catch (error) {
				console.error('[BuyFeature] Error creating scatter Spine animation:', error);
				this.createScatterFallbackSprite(scene);
			}
		};

		// Prefer Spine when available
		try {
			// Ensure Spine factory + plugin instance are attached/synced before calling add.spine.
			if (!ensureSpineFactory(scene, '[BuyFeature] createScatterSymbolAnimation')) {
				console.warn('[BuyFeature] Spine factory not available, using PNG scatter sprite.');
				this.createScatterFallbackSprite(scene);
				return;
			}
		} catch {
			this.createScatterFallbackSprite(scene);
			return;
		}

		createWithSpine();
	}

	/**
	 * Create a PNG-based scatter symbol with a pulsing tween as a visual fallback.
	 */
	private createScatterFallbackSprite(scene: Scene): void {
		if (this.scatterFallbackSprite || !this.featureLogo) {
			return;
		}

		try {
			const x = this.featureLogo.x;
			const y = this.featureLogo.y - this.featureLogo.displayHeight * 0.1;

			this.scatterFallbackSprite = scene.add.image(x, y, 'symbol_0');
			this.scatterFallbackSprite.setOrigin(0.5, 0.5);

			// Scale relative to logo width
			try {
				const targetWidth = this.featureLogo.displayWidth * 0.4;
				const baseWidth = this.scatterFallbackSprite.width || 1;
				// Increase scale by 40% over the base size
				const scale = (targetWidth / baseWidth) * 1.4;
				this.scatterFallbackSprite.setScale(scale);
			} catch {
				this.scatterFallbackSprite.setScale(0.4 * 1.4);
			}

			if (this.container) {
				this.container.add(this.scatterFallbackSprite);
			}

			// Simple looping "win" effect using a pulsing tween
			scene.tweens.add({
				targets: this.scatterFallbackSprite,
				scaleX: this.scatterFallbackSprite.scaleX * 1.08,
				scaleY: this.scatterFallbackSprite.scaleY * 1.08,
				duration: 600,
				yoyo: true,
				repeat: -1,
				ease: 'Sine.easeInOut'
			});

			console.log('[BuyFeature] Created PNG-based scatter symbol with pulsing tween.');
		} catch (error) {
			console.error('[BuyFeature] Error creating scatter PNG fallback animation:', error);
		}
	}

	private getBuyFeatureText(key: string): string {
		return localizationManager.getTextByKey(key) ?? LOCALIZATION_DEFAULTS[key] ?? key;
	}

	private createTitle(scene: Scene): void {
		const screenHeight = scene.scale.height;
		const backgroundTop = screenHeight - 736;
		
		const title = scene.add.text(this.HORIZONTAL_PADDING, backgroundTop + 40, this.getBuyFeatureText(BUY_FEATURE_TITLE), {
			fontSize: '24px',
			fontFamily: 'Poppins-Regular',
			color: '#00ff00',
			fontStyle: 'bold'
		});
		title.setOrigin(0, 0.5);
		this.container.add(title);
	}

	private createFeatureName(scene: Scene): void {
		const screenWidth = scene.scale.width;
		const screenHeight = scene.scale.height;
		const backgroundTop = screenHeight - 736;
		
		const featureName = scene.add.text(screenWidth / 2, backgroundTop + 100, this.getBuyFeatureText(BUY_FEATURE_FEATURE_NAME), {
			fontSize: '24px',
			fontFamily: 'Poppins-Regular',
			color: '#ffffff',
			fontStyle: 'bold'
		});
		featureName.setOrigin(0.5);
		this.container.add(featureName);
	}

	private createPriceDisplay(scene: Scene): void {
		const screenWidth = scene.scale.width;
		const screenHeight = scene.scale.height;
		const backgroundTop = screenHeight - 736;
		
		// Calculate price as 100 * current base bet
		const calculatedPrice = this.getCurrentBetValue();

		// Check if demo mode is active - if so, use blank currency symbol
		const isDemo = (scene as any).gameAPI?.getDemoState();
		const currencyCode = isDemo ? '' : CurrencyManager.getCurrencyCode();
		const formatted = this.formatNumberWithCommas(calculatedPrice);
		const priceText = currencyCode ? `${currencyCode} ${formatted}` : formatted;
		this.priceDisplay = scene.add.text(screenWidth / 2, backgroundTop + 340, priceText, {
			fontSize: '42px',
			fontFamily: 'Poppins-Regular',
			color: '#ffffff',
			fontStyle: 'bold'
		});
		this.priceDisplay.setOrigin(0.5);
		this.container.add(this.priceDisplay);
	}


	private createBuyButton(scene: Scene): void {
		const screenWidth = scene.scale.width;
		const screenHeight = scene.scale.height;
		const backgroundTop = screenHeight - 736;
		const x = screenWidth / 2;
		const y = backgroundTop + 560;

		// Use long_button image to match other confirm buttons
		const buttonImage = scene.add.image(x, y, 'long_button');
		buttonImage.setOrigin(0.5, 0.5);
		buttonImage.setDisplaySize(screenWidth - this.HORIZONTAL_PADDING * 2, 62);
		this.container.add(buttonImage);
		this.confirmButtonImage = buttonImage;
		
		// Button label
		this.confirmButton = scene.add.text(x, y, this.getBuyFeatureText(BUY_FEATURE_BUY_BUTTON), {
			fontSize: '24px',
			fontFamily: 'Poppins-Bold',
			color: '#000000'
		});
		this.confirmButton.setOrigin(0.5);
		this.container.add(this.confirmButton);
		
		buttonImage.setInteractive();
		buttonImage.on('pointerdown', () => this.confirmPurchase());
		this.updateBuyButtonState();
	}

	private createCloseButton(scene: Scene): void {
		const screenWidth = scene.scale.width;
		const screenHeight = scene.scale.height;
		const backgroundTop = screenHeight - 736;
		
		this.closeButton = scene.add.text(screenWidth / 2 + 180, backgroundTop + 40, '×', {
			fontSize: '30px',
			fontFamily: 'Poppins-Regular',
			color: '#ffffff'
		});
		this.closeButton.setOrigin(0.5);
		this.closeButton.setInteractive();
		this.closeButton.on('pointerdown', () => this.close());
		this.container.add(this.closeButton);
	}


	private confirmPurchase(): void {
		console.log(`[BuyFeature] Confirming purchase`);

		// Click safety guard
		if (!this.canAffordFeature()) {
			this.updateBuyButtonState();
			return;
		}
		
		if (this.onConfirmCallback) {
			this.onConfirmCallback();
		}
		
		notifyBuyFeaturePurchased();
		this.close();
	}

	private updatePriceDisplay(): void {
		if (this.priceDisplay) {
			const calculatedPrice = this.getCurrentBetValue();
			const isDemo = (this.container?.scene as any)?.gameAPI?.getDemoState?.();
			const currencyCode = isDemo ? '' : CurrencyManager.getCurrencyCode();
			const formatted = this.formatNumberWithCommas(calculatedPrice);
			const priceText = currencyCode ? `${currencyCode} ${formatted}` : formatted;
			this.priceDisplay.setText(priceText);
		}
		this.updateBuyButtonState();
	}

	private formatNumberWithCommas(num: number): string {
		return formatCurrencyNumber(num);
	}

	private animateIn(): void {
		if (!this.container || !this.container.scene) {
			return;
		}

		// Start positioned below the screen for slide-up effect
		this.container.setY(this.container.scene.scale.height);
		this.setContainerVisible(true);
		
		// Create slide-up animation
		this.container.scene.tweens.add({
			targets: this.container,
			y: 0,
			duration: 300,
			ease: 'Power2.easeOut',
			onComplete: () => {
				console.log("[BuyFeature] Drawer animation completed");
			}
		});
	}

	private animateOut(): void {
		if (!this.container || !this.container.scene) {
			return;
		}

		// Create slide-down animation
		this.container.scene.tweens.add({
			targets: this.container,
			y: this.container.scene.scale.height,
			duration: 250,
			ease: 'Power2.easeIn',
			onComplete: () => {
				this.setContainerVisible(false);
				console.log("[BuyFeature] Drawer hidden");
			}
		});
	}

	private createBetInput(scene: Scene): void {
		const screenWidth = scene.scale.width;
		const screenHeight = scene.scale.height;
		const backgroundTop = screenHeight - 736;
		const x = screenWidth * 0.5;
		const y = backgroundTop + 470;
		
		// "Bet" label
		const betLabel = scene.add.text(this.HORIZONTAL_PADDING, y - 70, this.getBuyFeatureText(COMMON_BET), {
			fontSize: '24px',
			color: '#ffffff',
			fontFamily: 'Poppins-Regular'
		});
		betLabel.setOrigin(0, 0.5);
		this.container.add(betLabel);
		
		// Bet input background
		const inputBg = scene.add.graphics();
		const inputBgWidth = screenWidth - this.HORIZONTAL_PADDING * 2;
		const inputBgHeight = 74;
		inputBg.fillStyle(0x000000, 0.4);
		inputBg.fillRoundedRect(-inputBgWidth / 2, -inputBgHeight / 2, inputBgWidth, inputBgHeight, 15);
		inputBg.lineStyle(0.5, 0xffffff, 1);
		inputBg.strokeRoundedRect(-inputBgWidth / 2, -inputBgHeight / 2, inputBgWidth, inputBgHeight, 15);
		inputBg.setPosition(x, y);
		this.container.add(inputBg);
		
		// Minus button
		this.minusButton = scene.add.text(x - 150, y, '-', {
			fontSize: '30px',
			color: '#ffffff',
			fontFamily: 'Poppins-Regular'
		});
		this.minusButton.setOrigin(0.5, 0.5);
		this.minusButton.setInteractive();
		
		// Handle pointer down for continuous press (no-op when disabled, same as SlotController)
		this.minusButton.on('pointerdown', () => {
			if (this.minusButton.getData('disabled')) return;
			this.selectPreviousBet();
			this.startContinuousDecrement(scene);
		});
		
		// Handle pointer up to stop continuous press
		this.minusButton.on('pointerup', () => {
			this.stopContinuousDecrement();
		});
		
		// Handle pointer out to stop continuous press
		this.minusButton.on('pointerout', () => {
			this.stopContinuousDecrement();
		});
		
		this.container.add(this.minusButton);
		
		// Bet display - show current bet value
		// Check if demo mode is active - if so, use blank currency symbol
		const isDemoBet = (scene as any).gameAPI?.getDemoState();
		const currencyCodeBet = isDemoBet ? '' : CurrencyManager.getCurrencyCode();
		const betText = currencyCodeBet ? `${currencyCodeBet} ${formatCurrencyNumber(this.getCurrentBet())}` : formatCurrencyNumber(this.getCurrentBet());
		this.betDisplay = scene.add.text(x, y, betText, {
			fontSize: '24px',
			color: '#ffffff',
			fontFamily: 'Poppins-Regular'
		});
		this.betDisplay.setOrigin(0.5, 0.5);
		this.container.add(this.betDisplay);
		
		// Plus button
		this.plusButton = scene.add.text(x + 150, y, '+', {
			fontSize: '30px',
			color: '#ffffff',
			fontFamily: 'Poppins-Regular'
		});
		this.plusButton.setOrigin(0.5, 0.5);
		this.plusButton.setInteractive();
		
		// Handle pointer down for continuous press (no-op when disabled, same as SlotController)
		this.plusButton.on('pointerdown', () => {
			if (this.plusButton.getData('disabled')) return;
			this.selectNextBet();
			this.startContinuousIncrement(scene);
		});
		
		// Handle pointer up to stop continuous press
		this.plusButton.on('pointerup', () => {
			this.stopContinuousIncrement();
		});
		
		// Handle pointer out to stop continuous press
		this.plusButton.on('pointerout', () => {
			this.stopContinuousIncrement();
		});
		
		this.container.add(this.plusButton);
	}

	private selectPreviousBet(): void {
		if (this.currentBetIndex > 0) {
			this.currentBetIndex--;
			this.currentBet = this.betOptions[this.currentBetIndex];
			this.updateBetDisplay();
			this.updatePriceDisplay();
			this.updateBetLimitButtons();
			console.log(`[BuyFeature] Previous bet selected: $${this.currentBet.toFixed(2)}`);
		}
	}

	private selectNextBet(): void {
		if (this.currentBetIndex < this.betOptions.length - 1) {
			this.currentBetIndex++;
			this.currentBet = this.betOptions[this.currentBetIndex];
			this.updateBetDisplay();
			this.updatePriceDisplay();
			this.updateBetLimitButtons();
			console.log(`[BuyFeature] Next bet selected: $${this.currentBet.toFixed(2)}`);
		}
	}

	/**
	 * Start continuous decrement after initial delay
	 */
	private startContinuousDecrement(scene: Scene): void {
		// Clear any existing timer
		this.stopContinuousDecrement();
		
		// Start timer after initial delay
		this.minusButtonTimer = scene.time.delayedCall(this.CONTINUOUS_DELAY, () => {
			// Start continuous decrement
			this.minusButtonTimer = scene.time.addEvent({
				delay: this.CONTINUOUS_INTERVAL,
				callback: () => {
					this.selectPreviousBet();
				},
				loop: true
			});
		});
	}

	/**
	 * Stop continuous decrement
	 */
	private stopContinuousDecrement(): void {
		if (this.minusButtonTimer) {
			this.minusButtonTimer.destroy();
			this.minusButtonTimer = null;
		}
	}

	/**
	 * Start continuous increment after initial delay
	 */
	private startContinuousIncrement(scene: Scene): void {
		// Clear any existing timer
		this.stopContinuousIncrement();
		
		// Start timer after initial delay
		this.plusButtonTimer = scene.time.delayedCall(this.CONTINUOUS_DELAY, () => {
			// Start continuous increment
			this.plusButtonTimer = scene.time.addEvent({
				delay: this.CONTINUOUS_INTERVAL,
				callback: () => {
					this.selectNextBet();
				},
				loop: true
			});
		});
	}

	/**
	 * Stop continuous increment
	 */
	private stopContinuousIncrement(): void {
		if (this.plusButtonTimer) {
			this.plusButtonTimer.destroy();
			this.plusButtonTimer = null;
		}
	}

	private updateBetDisplay(): void {
		if (this.betDisplay) {
			const isDemo = (this.container?.scene as any)?.gameAPI?.getDemoState?.();
			const currencyCode = isDemo ? '' : CurrencyManager.getCurrencyCode();
			const betText = currencyCode ? `${currencyCode} ${formatCurrencyNumber(this.getCurrentBet())}` : formatCurrencyNumber(this.getCurrentBet());
			this.betDisplay.setText(betText);
		}
	}

	public isOpen(): boolean {
		return !!this.container?.visible;
	}

	private setContainerVisible(visible: boolean): void {
		this.container?.setVisible(visible);
		setBuyFeatureModalVisible(visible);
	}

	public show(config?: BuyFeatureConfig): void {
		console.log("[BuyFeature] Showing buy feature drawer");
		
		if (config) {
			if (config.featurePrice !== undefined) {
				this.featurePrice = config.featurePrice;
			}
			if (config.onClose) {
				this.onCloseCallback = config.onClose;
			}
			if (config.onConfirm) {
				this.onConfirmCallback = config.onConfirm;
			}
		}
		
		// Initialize bet index based on current bet from SlotController
		this.initializeBetIndex();
		
		this.updatePriceDisplay();
		this.updateBetDisplay();
		this.updateBetLimitButtons();
		this.updateBuyButtonState();
		this.subscribeBalanceEventSubscriptions();
		
		// Show full-screen blocker
		if (this.fullScreenBlocker) {
			this.fullScreenBlocker.setVisible(true);
		}
		
		this.animateIn();
		
		// Show the mask when the panel is shown (same as BetOptions)
		if (this.confirmButtonMask) {
			this.confirmButtonMask.setVisible(true);
			this.confirmButtonMask.setAlpha(1);
		}
	}

	public hide(): void {
		console.log("[BuyFeature] Hiding buy feature drawer");
		this.clearBalanceEventSubscriptions();
		
		// Stop any continuous button presses
		this.stopContinuousDecrement();
		this.stopContinuousIncrement();
		
		// Hide full-screen blocker
		if (this.fullScreenBlocker) {
			this.fullScreenBlocker.setVisible(false);
		}
		
		this.animateOut();
		
		// Hide the mask when the panel is hidden (same as BetOptions)
		if (this.confirmButtonMask) {
			this.confirmButtonMask.setVisible(false);
			this.confirmButtonMask.setAlpha(0);
		}
	}

	public close(): void {
		console.log("[BuyFeature] Closing buy feature drawer");
		this.hide();
		
		if (this.onCloseCallback) {
			this.onCloseCallback();
		}
	}

	public destroy(): void {
		this.clearBalanceEventSubscriptions();
		// Stop any continuous button presses
		this.stopContinuousDecrement();
		this.stopContinuousIncrement();
		
		if (this.fullScreenBlocker) {
			this.fullScreenBlocker.destroy();
		}
		
		if (this.scatterSpine) {
			try { this.scatterSpine.destroy(); } catch {}
			this.scatterSpine = undefined;
		}

		if (this.scatterFallbackSprite) {
			try { this.scatterFallbackSprite.destroy(); } catch {}
			this.scatterFallbackSprite = undefined;
		}

		if (this.container) {
			this.container.destroy();
		}
	}
}
