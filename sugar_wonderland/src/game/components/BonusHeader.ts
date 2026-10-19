import { Scene } from "phaser";
import { NetworkManager } from "../../managers/NetworkManager";
import { ScreenModeManager } from "../../managers/ScreenModeManager";
import { gameEventManager, GameEventType } from '../../event/EventManager';
import { gameStateManager } from '../../managers/GameStateManager';
import { formatCurrencyNumber } from '../../utils/NumberPrecisionFormatter';
import { localizationManager } from '../../managers/LocalizationManager';
import { WINBAR_YOU_WON, COMMON_TOTAL_WIN, LOCALIZATION_DEFAULTS } from '../../backend/LocalizationData';
import { SpinDataUtils } from '../../backend/SpinData';
import { fitLocalizedLogoTexture, LocalizedLogoSurface } from "@core/utils/LocalizedLogo";

export class BonusHeader {
	private bonusHeaderContainer: Phaser.GameObjects.Container;
	private networkManager: NetworkManager;
	private screenModeManager: ScreenModeManager;
	private amountText: Phaser.GameObjects.Text;
	private youWonText: Phaser.GameObjects.Text;
	private currentWinnings: number = 0;
	// Tracks cumulative total during bonus mode by incrementing each spin's subtotal
	private cumulativeBonusWin: number = 0;
	private hasStartedBonusTracking: boolean = false;
		// Seed value from scatter trigger to start cumulative tracking in bonus
	private scatterBaseWin: number = 0;
	// Track if we've already accumulated this spin's total (prevents double add with WIN_STOP)
	private accumulatedThisSpin: boolean = false;
	// Multiplier arrival progressive display
	private multiplierCumulative: number = 0;
	private multiplierSpinTotal: number = 0;
	private multipliersActive: boolean = false; // Track if multipliers are currently animating
	private maxWinMultiplierCapApplied: boolean = false;
	private scene: Scene | null = null;
	// Track if we just seeded the win to prevent immediate text overrides
	private justSeededWin: boolean = false;
	private lastTumbleCumulative: number = 0;
	private skipNextSpinAccumulation: boolean = false;

	constructor(networkManager: NetworkManager, screenModeManager: ScreenModeManager) {
		this.networkManager = networkManager;
		this.screenModeManager = screenModeManager;
	}

	preload(scene: Scene): void {
		// Assets are now loaded centrally through AssetConfig in Preloader
		console.log(`[BonusHeader] Assets loaded centrally through AssetConfig`);
	}

	create(scene: Scene): void {
		console.log("[BonusHeader] Creating bonus header elements");
		
		// Store scene reference for animations
		this.scene = scene;
		
		// Create main container for all bonus header elements
		this.bonusHeaderContainer = scene.add.container(0, 0);
		
		const screenConfig = this.screenModeManager.getScreenConfig();
		const assetScale = this.networkManager.getAssetScale();
		
		console.log(`[BonusHeader] Creating bonus header with scale: ${assetScale}x`);

		// Add bonus header elements
		this.createBonusHeaderElements(scene, assetScale);
		
		// Set up event listeners for winnings updates (like regular header)
		this.setupWinningsEventListener();
		
		// Initialize winnings display - start hidden
		this.initializeWinnings();
	}

	private createBonusHeaderElements(scene: Scene, assetScale: number): void {
		const screenConfig = this.screenModeManager.getScreenConfig();
		
		if (screenConfig.isPortrait) {
			this.createPortraitBonusHeader(scene, assetScale);
		} else {
			this.createLandscapeBonusHeader(scene, assetScale);
		}
	}

	private createPortraitBonusHeader(scene: Scene, assetScale: number): void {
		console.log("[BonusHeader] Creating portrait bonus header layout");

		// Add header logo on the left
		const logo = scene.add.image(
			scene.scale.width * 0.5,
			scene.scale.height * 0.13,
			'header-logo'
		).setOrigin(0.5, 0.5).setScale(0.15).setDepth(11);
		fitLocalizedLogoTexture(logo, 'header-logo', (scene as any).gameAPI?.getLocalizedLogoLanguage?.(), (key) => scene.textures.exists(key), { surface: LocalizedLogoSurface.BonusHeader });
		this.bonusHeaderContainer.add(logo);

		// Create winnings text at a stable position (was inside win bar)
		this.createWinBarText(scene, scene.scale.width * 0.5, scene.scale.height * 0.215);
	}

	private createLandscapeBonusHeader(scene: Scene, assetScale: number): void {
		console.log("[BonusHeader] Creating landscape bonus header layout");

		// Add header logo
		const logo = scene.add.image(
			scene.scale.width * 0.23,
			scene.scale.height * 0.10,
			'header-logo'
		).setOrigin(0.5, 0.5).setScale(0.13).setDepth(11);
		fitLocalizedLogoTexture(logo, 'header-logo', (scene as any).gameAPI?.getLocalizedLogoLanguage?.(), (key) => scene.textures.exists(key), { surface: LocalizedLogoSurface.BonusHeader });
		this.bonusHeaderContainer.add(logo);

		// Create winnings text at a stable position
		this.createWinBarText(scene, scene.scale.width * 0.5, scene.scale.height * 0.215);
	}

	private getHeaderText(key: string): string {
		return localizationManager.getTextByKey(key) ?? LOCALIZATION_DEFAULTS[key] ?? key;
	}

	private createWinBarText(scene: Scene, x: number, y: number): void {
		// Line 1: "YOU WON"
		this.youWonText = scene.add.text(x, y - 7, this.getHeaderText(WINBAR_YOU_WON), {
			fontSize: '18px',
			color: '#ffffff',
			fontFamily: 'Poppins-Bold',
			stroke: '#99030A',
			strokeThickness: 3
		}).setOrigin(0.5, 0.5).setDepth(602); // Above cloud middle (601) and symbols (600)
		// Don't add to container - add directly to scene so depth works correctly

		// Line 2: amount value
		// Check if demo mode is active - if so, use blank currency symbol
		const isDemoInitial = (this.scene as any)?.gameAPI?.getDemoState();
		const initialText = isDemoInitial ? '0.00' : this.formatCurrency(0);
		this.amountText = scene.add.text(x, y + 18, initialText, {
			fontSize: '24px',
			color: '#FFB837',
			fontFamily: 'Poppins-Bold',
			stroke: '#99030A',
			strokeThickness: 3
		}).setOrigin(0.5, 0.5).setDepth(602); // Above cloud middle (601) and symbols (600)
		// Don't add to container - add directly to scene so depth works correctly
		
		// Hide by default - only show when bonus is triggered
		this.youWonText.setVisible(false);
		this.amountText.setVisible(false);
	}

	/**
	 * Update the winnings display in the bonus header with scale in animation
	 */
	public updateWinningsDisplay(winnings: number): void {
		if (this.amountText && this.youWonText) {
			const spinData = (this.scene as any)?.gameAPI?.getCurrentSpinData?.()
				?? (this.scene as any)?.symbols?.currentSpinData;
			const displayWinnings = SpinDataUtils.clampToSlotTotalWin(winnings, spinData);
			this.currentWinnings = displayWinnings;
			const formattedWinnings = this.formatCurrency(displayWinnings);
			this.amountText.setText(formattedWinnings);
			
			// Stop any existing tweens on these objects
			if (this.scene) {
				this.scene.tweens.killTweensOf(this.youWonText);
				this.scene.tweens.killTweensOf(this.amountText);
			}
			
			// Show both texts first
			this.youWonText.setVisible(true);
			this.amountText.setVisible(true);
			
			// Check if already visible and scaled
			const isAlreadyVisible = this.youWonText.visible && this.amountText.visible;
			const currentScale = this.youWonText.scaleX;
			const isAlreadyScaled = currentScale > 0.9;
			
			if (isAlreadyVisible && isAlreadyScaled) {
				// Already visible and scaled - do a pulse animation (enlarge then revert)
				if (this.scene) {
					this.scene.tweens.add({
						targets: [this.youWonText, this.amountText],
						scaleX: 1.2,
						scaleY: 1.2,
						duration: 150,
						ease: 'Power2',
						yoyo: true,
						repeat: 0,
						onComplete: () => {
							// Ensure scale is exactly 1 after animation
							this.youWonText.setScale(1);
							this.amountText.setScale(1);
						}
					});
				}
				console.log(`[BonusHeader] Winnings updated with pulse animation: ${formattedWinnings} (raw: ${winnings})`);
			} else {
				// Not visible or not scaled - do full scale-in animation
				// Set initial scale to 0 for scale-in effect
				this.youWonText.setScale(0);
				this.amountText.setScale(0);
				
				// Animate scale in with bounce effect
				if (this.scene) {
					this.scene.tweens.add({
						targets: [this.youWonText, this.amountText],
						scaleX: 1,
						scaleY: 1,
						duration: 300,
						ease: 'Back.easeOut',
						onComplete: () => {
							// Ensure scale is exactly 1 after animation
							this.youWonText.setScale(1);
							this.amountText.setScale(1);
						}
					});
				}
				
				console.log(`[BonusHeader] Winnings updated with scale-in animation: ${formattedWinnings} (raw: ${winnings})`);
			}
		}
	}

	/**
	 * Seed the bonus totals.
	 * `baseAmount` should be only the trigger/scatter base portion used by formula-based TOTAL WIN recomputations.
	 * `cumulativeTotal`, when supplied, seeds the live cumulative value separately (used for unresolved resume).
	 */
	public seedCumulativeWin(baseAmount: number, cumulativeTotal?: number): void {
		this.scatterBaseWin = Math.max(0, Number(baseAmount) || 0);
		const normalizedCumulative =
			cumulativeTotal != null && Number.isFinite(cumulativeTotal)
				? Math.max(0, Number(cumulativeTotal) || 0)
				: this.scatterBaseWin;
		this.cumulativeBonusWin = normalizedCumulative;
		this.hasStartedBonusTracking = true;
		this.justSeededWin = true; // Flag that we just seeded to prevent immediate text overrides
		
		// For bonus mode, we only show per-tumble "YOU WON" values.
		// Seed the cumulative tracker silently; UI will be driven by tumble events.
		console.log(`[BonusHeader] Seeded bonus totals: base=$${this.scatterBaseWin}, cumulative=$${this.cumulativeBonusWin}`);
	}

	/**
	 * Reset all per-session bonus accumulation. Call when a NEW bonus session begins (e.g. buy
	 * feature) so a prior max-win session's leftover state can't bleed in. Without this, back-to-back
	 * buy features (no normal-mode REELS_START in between, which is the only place these are cleared)
	 * leave `hasStartedBonusTracking = true` and `cumulativeBonusWin = cap` — so the next session's
	 * first free spin sees `cumulativeBonusWin >= cap` and stops after one spin.
	 */
	public resetBonusSessionTracking(): void {
		this.cumulativeBonusWin = 0;
		this.scatterBaseWin = 0;
		this.hasStartedBonusTracking = false;
		this.justSeededWin = false;
		this.accumulatedThisSpin = false;
		this.skipNextSpinAccumulation = false;
		this.multiplierCumulative = 0;
		this.multiplierSpinTotal = 0;
		this.multipliersActive = false;
		this.maxWinMultiplierCapApplied = false;
		console.log('[BonusHeader] Reset bonus session tracking for new session');
	}

	/**
	 * Add to the cumulative bonus total (e.g., for scatter retriggers)
	 * This preserves the existing cumulative total and adds the new amount
	 */
	public addToCumulativeWin(amount: number): void {
		const amountToAdd = Math.max(0, Number(amount) || 0);
		if (amountToAdd > 0) {
			this.cumulativeBonusWin += amountToAdd;
			this.hasStartedBonusTracking = true;
			console.log(`[BonusHeader] Added to cumulative bonus win: +$${amountToAdd}, new total: $${this.cumulativeBonusWin}`);
		}
	}

	/**
	 * Hide the winnings display (both "YOU WON" text and amount) with shrink animation
	 */
	public hideWinningsDisplay(): void {
		if (this.amountText && this.youWonText) {
			// Stop any existing tweens on these objects
			if (this.scene) {
				this.scene.tweens.killTweensOf(this.youWonText);
				this.scene.tweens.killTweensOf(this.amountText);
			}
			
			// Animate scale down to 0 before hiding
			if (this.scene) {
				this.scene.tweens.add({
					targets: [this.youWonText, this.amountText],
					scaleX: 0,
					scaleY: 0,
					duration: 200,
					ease: 'Back.easeIn',
					onComplete: () => {
						// Hide both texts after animation
						this.youWonText.setVisible(false);
						this.amountText.setVisible(false);
						// Reset scale for next show
						this.youWonText.setScale(1);
						this.amountText.setScale(1);
					}
				});
			} else {
				// Fallback if scene not available
				this.youWonText.setVisible(false);
				this.amountText.setVisible(false);
			}
			
			console.log('[BonusHeader] Winnings display hidden with shrink animation');
		} else {
			console.warn('[BonusHeader] Cannot hide winnings display - text objects not available', {
				amountText: !!this.amountText,
				youWonText: !!this.youWonText
			});
		}
	}

	/**
	 * Show the winnings display with both "YOU WON" text and amount with scale in animation
	 */
	public showWinningsDisplay(winnings: number): void {
		if (this.amountText && this.youWonText) {
			const spinData = (this.scene as any)?.gameAPI?.getCurrentSpinData?.()
				?? (this.scene as any)?.symbols?.currentSpinData;
			winnings = SpinDataUtils.clampToSlotTotalWin(winnings, spinData);
			const formattedWinnings = this.formatCurrency(winnings);
			
			// Check if the value has actually changed before animating
			const valueChanged = Math.abs(this.currentWinnings - winnings) > 0.01; // Use small epsilon for float comparison
			
			// Stop any existing tweens on these objects
			if (this.scene) {
				this.scene.tweens.killTweensOf(this.youWonText);
				this.scene.tweens.killTweensOf(this.amountText);
			}
			
			// Update amount text with winnings before showing
			this.amountText.setText(formattedWinnings);
			
			// Check if already visible and scaled
			const isAlreadyVisible = this.youWonText.visible && this.amountText.visible;
			const currentScale = this.youWonText.scaleX;
			const isAlreadyScaled = currentScale > 0.9;
			
			// Show both texts first
			this.youWonText.setVisible(true);
			this.amountText.setVisible(true);
			
			// Update current winnings after checks
			this.currentWinnings = winnings;
			
			// Only animate if value changed or not already visible/scaled
			if (isAlreadyVisible && isAlreadyScaled) {
				if (valueChanged) {
					// Value changed - do a pulse animation (enlarge then revert)
					if (this.scene) {
						this.scene.tweens.add({
							targets: [this.youWonText, this.amountText],
							scaleX: 1.2,
							scaleY: 1.2,
							duration: 150,
							ease: 'Power2',
							yoyo: true,
							repeat: 0,
							onComplete: () => {
								// Ensure scale is exactly 1 after animation
								this.youWonText.setScale(1);
								this.amountText.setScale(1);
							}
						});
					}
					console.log(`[BonusHeader] Winnings display updated with pulse animation: ${formattedWinnings} (raw: ${winnings})`);
				} else {
					// Value hasn't changed - just ensure scale is correct without animation
					this.youWonText.setScale(1);
					this.amountText.setScale(1);
					console.log(`[BonusHeader] Winnings display value unchanged, skipping animation: ${formattedWinnings} (raw: ${winnings})`);
				}
			} else {
				// Not visible or not scaled - do full scale-in animation
				// Set initial scale to 0 for scale-in effect
				this.youWonText.setScale(0);
				this.amountText.setScale(0);
				
				// Animate scale in with bounce effect
				if (this.scene) {
					this.scene.tweens.add({
						targets: [this.youWonText, this.amountText],
						scaleX: 1,
						scaleY: 1,
						duration: 300,
						ease: 'Back.easeOut',
						onComplete: () => {
							// Ensure scale is exactly 1 after animation
							this.youWonText.setScale(1);
							this.amountText.setScale(1);
						}
					});
				}
				console.log(`[BonusHeader] Winnings display shown with scale-in animation: ${formattedWinnings} (raw: ${winnings})`);
			}
		} else {
			console.warn('[BonusHeader] Cannot show winnings display - text objects not available', {
				amountText: !!this.amountText,
				youWonText: !!this.youWonText
			});
		}
	}

	/**
	 * Format currency value for display
	 */
	private formatCurrency(amount: number): string {
		const formatted = formatCurrencyNumber(amount);
		return formatted;
	}

	/**
	 * Get current winnings amount
	 */
	public getCurrentWinnings(): number {
		return this.currentWinnings;
	}

	public getCumulativeBonusWin(): number {
		return this.cumulativeBonusWin;
	}

	public setWinningsLabel(label: string): void {
		if (this.youWonText) {
			this.youWonText.setText(label);
			this.youWonText.setVisible(true);
		}
	}

	/**
	 * Compute the value to show for "TOTAL WIN" consistently: base spin + scatter win + previous
	 * free spin items totalWin, optionally including the current spin's totalWin.
	 * Use this whenever the TOTAL WIN display is shown so the amount is consistent at every tumble/start of spin.
	 */
	private getTotalWinForDisplay(spinData: any, includeCurrentSpin: boolean): number {
		try {
			const slotAny: any = spinData?.slot || {};
			const fs = slotAny.freespin || slotAny.freeSpin;
			const items = Array.isArray(fs?.items) ? fs.items : [];
			const area = slotAny.area;
			if (items.length === 0 || !Array.isArray(area)) {
				return this.cumulativeBonusWin;
			}
			if (includeCurrentSpin && this.isMaxWinCapReached(spinData)) {
				const capped = this.getMaxWinAuthoritativeTotal(spinData);
				if (capped > 0) return capped;
			}
			const areaJson = JSON.stringify(area);
			const currentIndex = items.findIndex((item: any) =>
				Array.isArray(item?.area) && JSON.stringify(item.area) === areaJson
			);
			if (currentIndex < 0) {
				return this.cumulativeBonusWin;
			}
			const basePlusScatter = Math.max(0, Number(this.scatterBaseWin) || 0);
			let previousTotalWin = 0;
			for (let i = 0; i < currentIndex; i++) {
				const item = items[i];
				const w = Number((item as any)?.totalWin ?? (item as any)?.subTotalWin ?? 0);
				if (!isNaN(w) && w > 0) previousTotalWin += w;
			}
			let currentSpinWin = 0;
			if (includeCurrentSpin && currentIndex >= 0 && currentIndex < items.length) {
				const item = items[currentIndex];
				const w = Number((item as any)?.totalWin ?? (item as any)?.subTotalWin ?? 0);
				if (!isNaN(w) && w > 0) currentSpinWin = w;
			}
			const total = basePlusScatter + previousTotalWin + currentSpinWin;
			return total;
		} catch {
			return this.cumulativeBonusWin;
		}
	}

	/** Running bonus total from scatter base + completed freeSpin.items totalWin values. */
	private resolveBonusRunningTotalWin(spinData: any, includeCurrentSpin: boolean): number {
		if (!spinData) {
			return this.cumulativeBonusWin;
		}
		if (this.isMaxWinCapReached(spinData)) {
			const cap = this.getMaxWinCapTotal(spinData);
			if (cap > 0) return cap;
		}
		return this.getTotalWinForDisplay(spinData, includeCurrentSpin);
	}

	/** Backend cumulative bonus win for the whole feature (matches spin payload when present). */
	private getAuthoritativeFreespinTotalWin(spinData: any): number {
		try {
			const fs = spinData?.slot?.freespin || spinData?.slot?.freeSpin;
			const v = Number(fs?.totalWin);
			if (Number.isFinite(v) && v > 0) {
				return v;
			}
		} catch {}
		return 0;
	}

	/** Authoritative capped bonus total when the current item is MaxWin. */
	private getMaxWinAuthoritativeTotal(spinData: any): number {
		return this.getMaxWinCapTotal(spinData);
	}

	private resolveEndOfBonusTotalWinDisplay(spinData: any): number {
		return SpinDataUtils.getSlotTotalWin(spinData);
	}

	/**
	 * Reset winnings display to zero
	 */
	public resetWinnings(): void {
		this.updateWinningsDisplay(0);
	}

	/**
	 * Initialize winnings display when bonus header starts
	 */
	public initializeWinnings(): void {
		console.log('[BonusHeader] Initializing winnings display - starting hidden');
		this.currentWinnings = 0;
		this.hideWinningsDisplay();
	}

	/**
	 * Hide winnings display at the start of a new spin (like regular header)
	 */
	public hideWinningsForNewSpin(): void {
		console.log('[BonusHeader] Hiding winnings display for new spin');
		this.hideWinningsDisplay();
	}

	/**
	 * Switch winnings display to "TOTAL WIN" with the given amount. Called from Symbols
	 * immediately before the congrats dialog is shown so the user sees "TOTAL WIN" first.
	 * Prefer the passed totalWin (same value used for congrats dialog) so the header never
	 * shows less than the congrats total; fall back to getTotalWinForDisplay only when
	 * totalWin is 0 so header and congrats stay consistent.
	 */
	public showTotalWinBeforeCongrats(totalWin: number): void {
		const scene = this.bonusHeaderContainer.scene as any;
		const gameAPI = scene?.slotController?.gameAPI ?? scene?.gameAPI;
		const spinData =
			gameAPI?.getBonusSessionSpinData?.() ??
			gameAPI?.getCurrentSpinData?.() ??
			scene?.symbols?.currentSpinData;
		const displayTotal =
			SpinDataUtils.resolveAuthoritativeSlotTotalWinForDisplay({
				gameAPI,
				symbolsSpinData: spinData,
			}) || totalWin;
		if (displayTotal <= 0) return;

		const isMaxWinSequence = spinData?.slot?.hasMaxWin === true;
		if (isMaxWinSequence) {
			this.snapMaxWinCapDisplays(spinData);
			console.log(`[BonusHeader] showTotalWinBeforeCongrats: TOTAL WIN $${displayTotal} (max win cap)`);
			return;
		}

		this.cumulativeBonusWin = Math.max(this.cumulativeBonusWin, displayTotal);
		this.hasStartedBonusTracking = true;
		if (this.youWonText) this.youWonText.setText(this.getHeaderText(COMMON_TOTAL_WIN).toUpperCase());
		this.showWinningsDisplay(displayTotal);
		console.log(`[BonusHeader] showTotalWinBeforeCongrats: TOTAL WIN $${displayTotal}`);
	}

	private getCurrentFreeSpinItem(spinData: any): any | null {
		try {
			const slot: any = spinData?.slot;
			const fs = slot?.freespin || slot?.freeSpin;
			const items = Array.isArray(fs?.items) ? fs.items : [];
			if (!items.length) return null;

			try {
				const gameAPI = (this.bonusHeaderContainer.scene as any)?.slotController?.gameAPI;
				if (gameAPI?.isFakeDataEnabled?.()) {
					const playedItem = gameAPI.getLastPlayedFreeSpinItem?.();
					if (playedItem) return playedItem;
				}
			} catch {}

			const slotArea = slot?.area;
			if (Array.isArray(slotArea)) {
				const areaJson = JSON.stringify(slotArea);
				const match = items.find((item: any) =>
					Array.isArray(item?.area) && JSON.stringify(item.area) === areaJson
				);
				if (match) return match;
			}

			if (items.length === 1) return items[0];

			try {
				const symbolsComponent = (this.bonusHeaderContainer.scene as any)?.symbols;
				const rem = symbolsComponent?.freeSpinAutoplaySpinsRemaining;
				if (typeof rem === 'number') {
					const targetB = items.find((item: any) => Number(item?.spinsLeft) === rem + 1);
					if (targetB) return targetB;
					const targetA = items.find((item: any) => Number(item?.spinsLeft) === rem);
					if (targetA) return targetA;
				}
			} catch {}

			const withSpinsLeft = items
				.filter((item: any) => typeof item?.spinsLeft === 'number' && item.spinsLeft > 0)
				.sort((a: any, b: any) => b.spinsLeft - a.spinsLeft);
			if (withSpinsLeft.length) return withSpinsLeft[0];

			return items[0];
		} catch {
			return null;
		}
	}

	private calculateBackendTotalWin(spinData: any): number {
		return SpinDataUtils.getSlotTotalWin(spinData);
	}

	/** Per MAX_WIN_IMPLEMENTATION: cap is trigger spin slot.totalWin (buy feature), not freeSpin.totalWin. */
	private getMaxWinCapTotal(spinData: any): number {
		try {
			const gameAPI = (this.bonusHeaderContainer.scene as any)?.slotController?.gameAPI;
			if (typeof gameAPI?.getMaxWinCapTotal === 'function') {
				const fromTrigger = gameAPI.getMaxWinCapTotal();
				if (fromTrigger > 0) return fromTrigger;
			}
		} catch {}
		const slotTotal = Number(spinData?.slot?.totalWin ?? 0);
		return Number.isFinite(slotTotal) && slotTotal > 0 ? slotTotal : 0;
	}

	/** Single max-win signal: the sequence-level slot.hasMaxWin flag (no per-item isMaxWin). */
	private spinHasMaxWin(spinData: any): boolean {
		return spinData?.slot?.hasMaxWin === true;
	}

	/** Sum of free-spin item totals up to and including the current (area-matched) item; null if unresolved. */
	private freeSpinItemTotalThroughCurrent(spinData: any): number | null {
		try {
			const slot: any = spinData?.slot;
			const fs = slot?.freespin || slot?.freeSpin;
			const items = Array.isArray(fs?.items) ? fs.items : [];
			const area = slot?.area;
			if (items.length === 0 || !Array.isArray(area)) return null;
			const areaJson = JSON.stringify(area);
			const idx = items.findIndex((it: any) => Array.isArray(it?.area) && JSON.stringify(it.area) === areaJson);
			if (idx < 0) return null;
			let sum = 0;
			for (let i = 0; i <= idx; i++) {
				const w = Number((items[i] as any)?.totalWin ?? (items[i] as any)?.subTotalWin ?? 0);
				if (Number.isFinite(w) && w > 0) sum += w;
			}
			return sum;
		} catch {
			return null;
		}
	}

	/**
	 * Live cap reached during freespin animations: running balance (cumulativeBonusWin) met slot.totalWin.
	 * Does not use backend item totals so tumbles/multipliers still play until the client running total hits the cap.
	 */
	public isMaxWinCapReached(spinData?: any): boolean {
		const data = spinData ?? (this.bonusHeaderContainer?.scene as any)?.symbols?.currentSpinData;
		if (!this.spinHasMaxWin(data)) return false;
		const cap = this.getMaxWinCapTotal(data);
		if (!(cap > 0)) return false;
		return this.cumulativeBonusWin >= cap - 0.0001;
	}

	/**
	 * Finalize latch for MaxWin drawer / bonus exit. Includes trigger-spin and item-total fallbacks
	 * when the live cumulative is not yet updated (e.g. bonus-trigger spin before any free spin plays).
	 */
	public isMaxWinCapReachedForFinalize(spinData?: any): boolean {
		if (this.isMaxWinCapReached(spinData)) return true;
		const data = spinData ?? (this.bonusHeaderContainer?.scene as any)?.symbols?.currentSpinData;
		if (!this.spinHasMaxWin(data)) return false;
		const cap = this.getMaxWinCapTotal(data);
		if (!(cap > 0)) return false;
		const eps = 0.0001;
		const itemTotal = this.freeSpinItemTotalThroughCurrent(data);
		if (itemTotal !== null) return itemTotal >= cap - eps;
		const slotTotal = Number(data?.slot?.totalWin ?? 0);
		return Number.isFinite(slotTotal) && slotTotal >= cap - eps;
	}

	/** When the live running balance hits the cap, snap every bonus win readout to slot.totalWin. */
	public snapMaxWinCapDisplays(spinData?: any): void {
		const data = spinData ?? (this.bonusHeaderContainer?.scene as any)?.symbols?.currentSpinData;
		if (!this.spinHasMaxWin(data)) return;
		const cap = this.getMaxWinCapTotal(data);
		if (!(cap > 0)) return;

		this.cumulativeBonusWin = cap;
		this.hasStartedBonusTracking = true;
		this.multipliersActive = false;
		this.maxWinMultiplierCapApplied = true;
		if (this.youWonText) {
			this.youWonText.setText(this.getHeaderText(COMMON_TOTAL_WIN).toUpperCase());
		}
		this.showWinningsDisplay(cap);

		try {
			const symbolsComponent = (this.bonusHeaderContainer.scene as any).symbols;
			symbolsComponent?.requestSkipTumbles?.();
			symbolsComponent?.requestSkipMultipliers?.();
		} catch {}
	}

	/**
	 * When multipliers would push the spin win past slot.totalWin during a max-win sequence,
	 * cap the winbar at slot.totalWin and stop remaining multiplier fly-ins.
	 */
	private applyMaxWinMultiplierCap(spinData: any, spinTotal: number, incomingWeight: number): boolean {
		if (!this.spinHasMaxWin(spinData)) return false;
		const maxWinCap = this.getMaxWinCapTotal(spinData);
		if (maxWinCap <= 0 || incomingWeight <= 0 || spinTotal <= 0) return false;

		const nextMultiplierCumulative = this.multiplierCumulative + incomingWeight;
		const spinBase = this.multiplierSpinTotal > 0 ? this.multiplierSpinTotal : spinTotal;
		const projectedSession =
			this.cumulativeBonusWin - spinBase + spinTotal * nextMultiplierCumulative;
		if (projectedSession <= maxWinCap) return false;

		this.multiplierCumulative = nextMultiplierCumulative;
		this.snapMaxWinCapDisplays(spinData);
		console.log(`[BonusHeader] MULTIPLIER_ARRIVED: capped winbar at slot.totalWin $${maxWinCap}, skipping remaining multipliers`);
		return true;
	}

	/**
	 * Set up event listener for winnings updates from backend (like regular header)
	 */
	private setupWinningsEventListener(): void {
		// Listen for tumble win progress (during bonus mode: per-spin cumulative)
		gameEventManager.on(GameEventType.TUMBLE_WIN_PROGRESS, (data: any) => {
			try {
				if (!gameStateManager.isBonus) return;
				const symbolsComponent = (this.bonusHeaderContainer.scene as any).symbols;
				const spinData = symbolsComponent?.currentSpinData;
				const hasMaxWinCap =
					this.spinHasMaxWin(spinData) &&
					this.getMaxWinCapTotal(spinData) > 0;
				const maxWinCapTotal = hasMaxWinCap ? this.getMaxWinCapTotal(spinData) : 0;

				if (!this.hasStartedBonusTracking) {
					// MaxWin cap (slot.totalWin) is the full bonus session total — do not seed scatter into it.
					this.cumulativeBonusWin = this.spinHasMaxWin(spinData)
						? 0
						: (this.scatterBaseWin || 0);
					this.hasStartedBonusTracking = true;
				}

				const tumbleWinRaw = Number((data as any)?.tumbleWin ?? 0);
				const cumulativeFromEvent = Number((data as any)?.cumulativeWin ?? 0);
				let effectiveTumbleWin = (Number.isFinite(tumbleWinRaw) && tumbleWinRaw > 0) ? tumbleWinRaw : 0;

				if (hasMaxWinCap) {
					const remainingToCap = Math.max(0, maxWinCapTotal - this.cumulativeBonusWin);
					if (remainingToCap <= 0) {
						this.snapMaxWinCapDisplays(spinData);
						return;
					}
					if (effectiveTumbleWin > remainingToCap) {
						effectiveTumbleWin = remainingToCap;
					}
				}

				const displayWin = (effectiveTumbleWin > 0)
					? effectiveTumbleWin
					: (Number.isFinite(cumulativeFromEvent) ? cumulativeFromEvent : 0);

				let sessionIncrement = effectiveTumbleWin > 0 ? effectiveTumbleWin : 0;
				if (sessionIncrement <= 0 && Number.isFinite(cumulativeFromEvent) && cumulativeFromEvent > 0) {
					const delta = cumulativeFromEvent - this.lastTumbleCumulative;
					if (delta > 0) {
						sessionIncrement = delta;
						if (hasMaxWinCap) {
							sessionIncrement = Math.min(
								sessionIncrement,
								Math.max(0, maxWinCapTotal - this.cumulativeBonusWin),
							);
						}
					}
				}
				const projectedSession = this.cumulativeBonusWin + sessionIncrement;
				if (hasMaxWinCap && projectedSession >= maxWinCapTotal) {
					this.cumulativeBonusWin = maxWinCapTotal;
					this.snapMaxWinCapDisplays(spinData);
					return;
				}

				if (displayWin > 0 || (hasMaxWinCap && this.cumulativeBonusWin >= maxWinCapTotal)) {
					if (this.youWonText && displayWin > 0) {
						this.youWonText.setText(this.getHeaderText(WINBAR_YOU_WON));
					}
					if (this.justSeededWin) {
						this.justSeededWin = false;
					}
					if (displayWin > 0) {
						this.showWinningsDisplay(displayWin);
					}

					if (effectiveTumbleWin > 0) {
						if (this.skipNextSpinAccumulation) {
							this.accumulatedThisSpin = true;
							this.skipNextSpinAccumulation = false;
						} else {
							this.cumulativeBonusWin += effectiveTumbleWin;
							this.accumulatedThisSpin = true;
						}
					} else if (cumulativeFromEvent > 0) {
						const delta = cumulativeFromEvent - this.lastTumbleCumulative;
						if (delta > 0) {
							let effectiveDelta = delta;
							if (hasMaxWinCap) {
								const remainingToCap = Math.max(0, maxWinCapTotal - this.cumulativeBonusWin);
								effectiveDelta = Math.min(effectiveDelta, remainingToCap);
							}
							if (this.skipNextSpinAccumulation) {
								this.accumulatedThisSpin = true;
								this.skipNextSpinAccumulation = false;
							} else {
								this.cumulativeBonusWin += effectiveDelta;
								this.accumulatedThisSpin = true;
							}
						}
						this.lastTumbleCumulative = cumulativeFromEvent;
					}
					if (hasMaxWinCap && this.cumulativeBonusWin > maxWinCapTotal) {
						this.cumulativeBonusWin = maxWinCapTotal;
					}
					if (hasMaxWinCap && this.isMaxWinCapReached(spinData)) {
						this.snapMaxWinCapDisplays(spinData);
					}
				}
			} catch {}
		});

		// Listen for tumble sequence completion (during bonus mode: accumulate spin total only)
		gameEventManager.on(GameEventType.TUMBLE_SEQUENCE_DONE, (data: any) => {
			try {
				if (!gameStateManager.isBonus) return;
				const symbolsComponent = (this.bonusHeaderContainer.scene as any).symbols;
				const spinData = symbolsComponent?.currentSpinData;
				
				// Prefer totalWin from the matching freespin item (backend per-spin total),
				// matched by area so we always use the correct item for this spin.
				// Fall back to subTotalWin, then to a manual tumble+payline sum.
				let spinWin = 0;
				try {
					const slotAny: any = spinData?.slot || {};
					const fs = slotAny.freespin || slotAny.freeSpin;
					const items = Array.isArray(fs?.items) ? fs.items : [];
					const area = slotAny.area;

					if (items.length > 0 && Array.isArray(area)) {
						const areaJson = JSON.stringify(area);
						const currentFreeSpinItem = items.find((item: any) =>
							Array.isArray(item?.area) && JSON.stringify(item.area) === areaJson
						);
						if (currentFreeSpinItem) {
							const rawItemTotal =
								(currentFreeSpinItem as any).totalWin ??
								(currentFreeSpinItem as any).subTotalWin ??
								0;
							const itemTotal = Number(rawItemTotal);
							if (!isNaN(itemTotal) && itemTotal > 0) {
								spinWin = itemTotal;
								console.log(`[BonusHeader] TUMBLE_SEQUENCE_DONE: using freespin item totalWin=$${itemTotal}`);
							}
						}
					}

					// Fallback: if freespin item total not available, use the totalWin from event data (tumbles only)
					if (spinWin === 0) {
						const spinTumbleWin = Number((data as any)?.totalWin ?? 0);
						if (spinTumbleWin > 0) {
							// Still need to add paylines if tumbles don't include them
							let spinPaylineWin = 0;
							if (slotAny?.paylines && Array.isArray(slotAny.paylines) && slotAny.paylines.length > 0) {
								spinPaylineWin = this.calculateTotalWinFromPaylines(slotAny.paylines);
							}
							spinWin = spinTumbleWin + spinPaylineWin;
							console.log(`[BonusHeader] TUMBLE_SEQUENCE_DONE: fallback calculation (tumbles=$${spinTumbleWin} + paylines=$${spinPaylineWin}) = $${spinWin}`);
						}
					}
				} catch {}

				// Initialize bonus tracking if needed
				if (!this.hasStartedBonusTracking) {
					this.cumulativeBonusWin = this.scatterBaseWin || 0;
					this.hasStartedBonusTracking = true;
				}

				// Accumulate the spin's total into the bonus cumulative.
				if (spinWin > 0) {
					if (this.accumulatedThisSpin) {
						return;
					}
					if (this.skipNextSpinAccumulation) {
						this.accumulatedThisSpin = true;
						this.skipNextSpinAccumulation = false;
					} else {
						if (this.spinHasMaxWin(spinData)) {
							const cap = this.getMaxWinCapTotal(spinData);
							if (cap > 0) {
								spinWin = Math.min(spinWin, Math.max(0, cap - this.cumulativeBonusWin));
							}
						}
						if (spinWin > 0) {
							this.cumulativeBonusWin += spinWin;
						}
						this.accumulatedThisSpin = true;
						if (this.isMaxWinCapReached(spinData)) {
							this.snapMaxWinCapDisplays(spinData);
						}
					}
					console.log(`[BonusHeader] TUMBLE_SEQUENCE_DONE: added spinWin=$${spinWin}, cumulativeBonusWin=$${this.cumulativeBonusWin}, multipliersActive=${this.multipliersActive}`);
				}
			} catch {}
		});

		// When multipliers trigger during bonus, prepare progressive display and set text to "YOU WON"
		gameEventManager.on(GameEventType.MULTIPLIERS_TRIGGERED, (data: any) => {
			try {
				if (!gameStateManager.isBonus) return;
				const spinTotal = Number((data as any)?.spinTotal ?? 0);
				this.multiplierSpinTotal = Math.max(0, spinTotal);
				this.multiplierCumulative = 0;
				this.multipliersActive = true; // Mark that multipliers are now active
				// Immediately set text to "YOU WON" to prevent it from changing to "TOTAL WIN"
				if (this.youWonText) this.youWonText.setText(this.getHeaderText(WINBAR_YOU_WON));
				// Show the current spin total (not cumulative) when multipliers start
				if (spinTotal > 0) {
					this.showWinningsDisplay(spinTotal);
				}
				console.log(`[BonusHeader] MULTIPLIERS_TRIGGERED: primed progressive display with spinTotal=$${this.multiplierSpinTotal}, set text to "YOU WON", showing spin total`);
			} catch {}
		});

		// Each time a multiplier PNG reaches the center, add to cumulative and show "YOU WON $total x cum"
		gameEventManager.on(GameEventType.MULTIPLIER_ARRIVED, (data: any) => {
			try {
				if (!gameStateManager.isBonus) return;
				if (this.maxWinMultiplierCapApplied) return;
				const weight = Number((data as any)?.weight ?? 0);
				let spinTotal = Number((data as any)?.spinTotal ?? 0);
				if (!(spinTotal > 0)) {
					// Fallback to primed value from MULTIPLIERS_TRIGGERED
					spinTotal = this.multiplierSpinTotal || 0;
				} else {
					// Keep a consistent spin total if not primed yet
					if (this.multiplierSpinTotal === 0) this.multiplierSpinTotal = spinTotal;
				}
				const symbolsComponent = (this.bonusHeaderContainer.scene as any).symbols;
				const spinData = symbolsComponent?.currentSpinData;
				if (this.applyMaxWinMultiplierCap(spinData, spinTotal, weight)) {
					return;
				}
				if (weight > 0 && spinTotal > 0) {
					this.multiplierCumulative += weight;
					if (this.youWonText) this.youWonText.setText(this.getHeaderText(WINBAR_YOU_WON));
					const formatted = this.formatCurrency(spinTotal);
					const total = spinTotal * this.multiplierCumulative;
					const formattedTotal = this.formatCurrency(total);
					if (this.amountText && this.youWonText) {
						// Stop any existing tweens
						if (this.scene) {
							this.scene.tweens.killTweensOf(this.youWonText);
							this.scene.tweens.killTweensOf(this.amountText);
						}
						
						this.youWonText.setVisible(true);
						this.amountText.setVisible(true);
						this.amountText.setText(`${formatted} x ${this.multiplierCumulative} = ${formattedTotal}`);
						
						// Pulse animation when updating multiplier display
						if (this.scene) {
							this.scene.tweens.add({
								targets: [this.youWonText, this.amountText],
								scaleX: 1.2,
								scaleY: 1.2,
								duration: 150,
								ease: 'Power2',
								yoyo: true,
								repeat: 0,
								onComplete: () => {
									// Ensure scale is exactly 1 after animation
									this.youWonText.setScale(1);
									this.amountText.setScale(1);
								}
							});
						}
					} else {
						this.showWinningsDisplay(spinTotal);
					}
					console.log(`[BonusHeader] MULTIPLIER_ARRIVED: updated "${formatted} x ${this.multiplierCumulative} = ${formattedTotal}" (added ${weight})`);
				}
			} catch {}
		});

		// When multiplier animations complete on the last bonus spin, show "TOTAL WIN" immediately
		// (before congrats dialog), since WIN_STOP fires after this event.
		gameEventManager.on(GameEventType.MULTIPLIER_ANIMATIONS_COMPLETE, () => {
			try {
				if (!gameStateManager.isBonus) return;
				const symbolsComponent = (this.bonusHeaderContainer.scene as any).symbols;
				const spinData = symbolsComponent?.currentSpinData;
				if (!spinData?.slot) return;
				const currentItem = this.getCurrentFreeSpinItem(spinData);
				const isMaxWinItem = this.isMaxWinCapReached(spinData);
				const isLastSpin = currentItem != null && Number((currentItem as any).spinsLeft) === 0;
				if (isMaxWinItem || isLastSpin) {
					const totalWin = this.resolveBonusRunningTotalWin(spinData, true);
					if (totalWin > 0) {
						this.cumulativeBonusWin = Math.max(this.cumulativeBonusWin, totalWin);
						if (isMaxWinItem) {
							this.snapMaxWinCapDisplays(spinData);
						} else {
							if (this.youWonText) this.youWonText.setText(this.getHeaderText(COMMON_TOTAL_WIN).toUpperCase());
							this.showWinningsDisplay(totalWin);
						}
						console.log(`[BonusHeader] MULTIPLIER_ANIMATIONS_COMPLETE: showing TOTAL WIN $${totalWin}${isMaxWinItem ? ' (max win)' : ' before congrats'}`);
					}
				}
			} catch {}
		});

		// Listen for spin events to hide winnings display at start of manual spin
		gameEventManager.on(GameEventType.SPIN, () => {
			console.log('[BonusHeader] Manual spin started - hiding winnings display');
			this.hideWinningsDisplay();
		});

		// Listen for autoplay start to hide winnings display
		gameEventManager.on(GameEventType.AUTO_START, () => {
			console.log('[BonusHeader] Auto play started - hiding winnings display');
			this.hideWinningsDisplay();
		});

		// Listen for reels start to reset per-spin bonus state
		gameEventManager.on(GameEventType.REELS_START, () => {
			console.log('[BonusHeader] Reels started');
			if (gameStateManager.isBonus) {
				// Reset per-spin accumulation flag
				this.accumulatedThisSpin = false;
				this.lastTumbleCumulative = 0;
				this.skipNextSpinAccumulation = false;
				// Reset multiplier progressive display
				this.multiplierCumulative = 0;
				this.multiplierSpinTotal = 0;
				this.multipliersActive = false; // Reset multiplier active flag at start of new spin
				this.maxWinMultiplierCapApplied = false;
				// Initialize tracking on first spin in bonus mode
				if (!this.hasStartedBonusTracking) {
					this.cumulativeBonusWin = this.scatterBaseWin || 0;
					this.hasStartedBonusTracking = true;
				}
				const symbolsComponent = (this.bonusHeaderContainer.scene as any).symbols;
				const spinData = symbolsComponent?.currentSpinData;
				const totalWinSoFar = this.resolveBonusRunningTotalWin(spinData, false);
				if (totalWinSoFar > 0) {
					this.cumulativeBonusWin = Math.max(this.cumulativeBonusWin, totalWinSoFar);
				}
				console.log(`[BonusHeader] REELS_START (bonus): TOTAL WIN so far = $${totalWinSoFar}`);

				// Clear the justSeededWin flag when first spin starts (scatter activation complete)
				if (this.justSeededWin) {
					this.justSeededWin = false;
					console.log('[BonusHeader] Cleared justSeededWin flag - first bonus spin starting');
				}

				// At the start of each bonus spin, show the cumulative TOTAL WIN so far.
				// During the spin, per-tumble updates will switch the label to "YOU WON".
				if (totalWinSoFar > 0) {
					if (this.youWonText) {
						this.youWonText.setText(this.getHeaderText(COMMON_TOTAL_WIN).toUpperCase());
					}
					this.showWinningsDisplay(totalWinSoFar);
				} else {
					this.hideWinningsDisplay();
					if (this.youWonText) {
						this.youWonText.setText(this.getHeaderText(WINBAR_YOU_WON));
					}
				}
			} else {
				// Normal mode behavior: hide winnings at the start of the spin
				this.hasStartedBonusTracking = false;
				this.cumulativeBonusWin = 0;
				this.scatterBaseWin = 0;
				this.justSeededWin = false;
				this.hideWinningsDisplay();
			}
		});

		// Listen for reel done events to show winnings display (like regular header)
		gameEventManager.on(GameEventType.REELS_STOP, (data: any) => {
			console.log(`[BonusHeader] REELS_STOP received - checking for wins`);

			// In bonus mode, per-spin display is handled on WIN_STOP; skip here to avoid label mismatch
			if (gameStateManager.isBonus) {
				console.log('[BonusHeader] In bonus mode - skipping REELS_STOP winnings update (handled on WIN_STOP)');
				return;
			}
			
			// Get the current spin data from the Symbols component
			const symbolsComponent = (this.bonusHeaderContainer.scene as any).symbols;
			if (symbolsComponent && symbolsComponent.currentSpinData) {
				const spinData = symbolsComponent.currentSpinData;
				console.log(`[BonusHeader] Found current spin data:`, spinData);
				
				// Use the same logic as regular header - calculate from paylines
				if (spinData.slot && spinData.slot.paylines && spinData.slot.paylines.length > 0) {
					const totalWin = this.calculateTotalWinFromPaylines(spinData.slot.paylines);
					console.log(`[BonusHeader] Total winnings calculated from paylines: ${totalWin}`);
					
					if (totalWin > 0) {
						this.showWinningsDisplay(totalWin);
					} else {
						this.hideWinningsDisplay();
					}
				} else {
					console.log('[BonusHeader] No paylines in current spin data - hiding winnings display');
					this.hideWinningsDisplay();
				}
			} else {
				console.log('[BonusHeader] No current spin data available - hiding winnings display');
				this.hideWinningsDisplay();
			}
		});

		// On WIN_START during bonus, only handle non-tumble wins.
		// For tumble-based wins, the winnings display is driven exclusively by
		// TUMBLE_WIN_PROGRESS so that "YOU WON" appears tied to each tumble.
		gameEventManager.on(GameEventType.WIN_START, () => {
			if (!gameStateManager.isBonus) {
				return;
			}
			const symbolsComponent = (this.bonusHeaderContainer.scene as any).symbols;
			const spinData = symbolsComponent?.currentSpinData;

			// If this spin has tumbles, let TUMBLE_WIN_PROGRESS handle the "YOU WON"
			// label and values so the header updates are synchronized with tumbles.
			if (Array.isArray(spinData?.slot?.tumbles) && spinData.slot.tumbles.length > 0) {
				console.log('[BonusHeader] WIN_START (bonus): tumbles present - winnings display handled by TUMBLE_WIN_PROGRESS');
				return;
			}

			let spinWin = 0;
			
			// Check for paylines wins
			if (spinData?.slot?.paylines && spinData.slot.paylines.length > 0) {
				spinWin = this.calculateTotalWinFromPaylines(spinData.slot.paylines);
			}
			
			// Also check for tumbles (cluster wins) - they might not have paylines
			if (spinWin === 0 && Array.isArray(spinData?.slot?.tumbles) && spinData.slot.tumbles.length > 0) {
				spinWin = this.calculateTotalWinFromTumbles(spinData.slot.tumbles);
			}
			
			// Always change to "YOU WIN" or "YOU WON" when wins start (unless in initial scatter phase)
			if (!this.justSeededWin && this.youWonText) {
				this.youWonText.setText('YOU WIN');
			}
			
			if (spinWin > 0) {
				this.showWinningsDisplay(spinWin);
			} else {
				// Don't hide if we're showing cumulative total - only hide if truly no wins
				// The TUMBLE_WIN_PROGRESS will handle showing wins during tumbles
			}
		});

		// On WIN_STOP during bonus, finalize cumulative tracking (UI stays per-tumble "YOU WON")
		gameEventManager.on(GameEventType.WIN_STOP, () => {
			if (!gameStateManager.isBonus) {
				return;
			}

			const symbolsComponent = (this.bonusHeaderContainer.scene as any).symbols;
			const spinData = symbolsComponent?.currentSpinData;
			const currentItem = this.getCurrentFreeSpinItem(spinData);
			const isMaxWinItemEarly = this.isMaxWinCapReached(spinData);

			// Use subTotalWin from the current freespin item (includes paylines + tumbles)
			let spinWin = 0;
			try {
				if (currentItem) {
					const raw =
						(currentItem as any).totalWin ??
						(currentItem as any).subTotalWin ??
						0;
					const v = Number(raw);
					if (!isNaN(v) && v > 0) {
						spinWin = v;
						console.log(`[BonusHeader] WIN_STOP (bonus): using current freespin item total=$${spinWin} (area-matched)`);
					}
				}
				if (spinWin === 0) {
					if (spinData?.slot?.paylines && spinData.slot.paylines.length > 0) {
						spinWin += this.calculateTotalWinFromPaylines(spinData.slot.paylines);
					}
					if (Array.isArray(spinData?.slot?.tumbles) && spinData.slot.tumbles.length > 0) {
						const tumbleWin = this.calculateTotalWinFromTumbles(spinData.slot.tumbles);
						spinWin += tumbleWin;
					}
					if (spinWin > 0) {
						console.log(`[BonusHeader] WIN_STOP (bonus): fallback calculation = $${spinWin}`);
					}
				}
			} catch {}

			if (!this.hasStartedBonusTracking) {
				this.cumulativeBonusWin = this.scatterBaseWin || 0;
				this.hasStartedBonusTracking = true;
			}

			if (!this.accumulatedThisSpin) {
				if (this.skipNextSpinAccumulation) {
					this.accumulatedThisSpin = true;
					this.skipNextSpinAccumulation = false;
				} else if (!isMaxWinItemEarly) {
					let increment = spinWin || 0;
					if (this.spinHasMaxWin(spinData)) {
						const cap = this.getMaxWinCapTotal(spinData);
						if (cap > 0) {
							increment = Math.min(increment, Math.max(0, cap - this.cumulativeBonusWin));
						}
					}
					if (increment > 0) {
						this.cumulativeBonusWin += increment;
					}
					this.accumulatedThisSpin = true;
					if (this.isMaxWinCapReached(spinData)) {
						this.snapMaxWinCapDisplays(spinData);
					}
				} else {
					this.accumulatedThisSpin = true;
				}
			}

			try {
				const isMaxWinItem = isMaxWinItemEarly;
				const isLastSpinItem =
					typeof (currentItem as any)?.spinsLeft === 'number' &&
					(currentItem as any).spinsLeft <= 1;
				let hasFutureRetriggerItems = false;
				try {
					const slotAny: any = spinData?.slot || {};
					const fs = slotAny.freespin || slotAny.freeSpin;
					const items = Array.isArray(fs?.items) ? fs.items : [];
					if (items.length > 1 && currentItem) {
						const currentAreaJson =
							Array.isArray((currentItem as any)?.area) ? JSON.stringify((currentItem as any).area) : null;
						const currentIdx =
							currentAreaJson == null
								? -1
								: items.findIndex((item: any) =>
									Array.isArray(item?.area) && JSON.stringify(item.area) === currentAreaJson
								);
						if (currentIdx >= 0) {
							hasFutureRetriggerItems = items
								.slice(currentIdx + 1)
								.some((item: any) => Number(item?.spinsLeft ?? 0) > 0);
						} else {
							const currentSpinsLeft = Number((currentItem as any)?.spinsLeft ?? 0);
							if (Number.isFinite(currentSpinsLeft)) {
								hasFutureRetriggerItems = items
									.some((item: any) => Number(item?.spinsLeft ?? 0) > currentSpinsLeft);
							}
						}
					}
				} catch {}

				if (isMaxWinItem) {
					this.snapMaxWinCapDisplays(spinData);
				} else if (isLastSpinItem && !hasFutureRetriggerItems) {
					const backendTotal = this.getTotalWinForDisplay(spinData, true);
					if (backendTotal > 0) {
						this.cumulativeBonusWin = backendTotal;
						this.hasStartedBonusTracking = true;
					}
				}
			} catch {}

			try {
				const itemsRunning = this.getTotalWinForDisplay(spinData, true);
				if (itemsRunning > 0) {
					this.cumulativeBonusWin = Math.max(this.cumulativeBonusWin, itemsRunning);
				}
			} catch {}

			console.log(`[BonusHeader] WIN_STOP (bonus): finalized cumulativeBonusWin=$${this.cumulativeBonusWin} (spinWin=$${spinWin})`);

			const isMaxWinItem = this.isMaxWinCapReached(spinData);
			const isLastSpin = currentItem != null && Number((currentItem as any).spinsLeft) === 0;
			if (isMaxWinItem || isLastSpin) {
				const totalWin = this.resolveBonusRunningTotalWin(spinData, true);
				if (totalWin > 0) {
					this.cumulativeBonusWin = Math.max(this.cumulativeBonusWin, totalWin);
					if (isMaxWinItem) {
						this.snapMaxWinCapDisplays(spinData);
					} else {
						if (this.youWonText) this.youWonText.setText(this.getHeaderText(COMMON_TOTAL_WIN).toUpperCase());
						this.showWinningsDisplay(totalWin);
					}
					console.log(`[BonusHeader] WIN_STOP (bonus): showing TOTAL WIN $${totalWin}${isMaxWinItem ? ' (max win)' : ' before congrats'}`);
				}
			}
		});
	}

	/**
	 * Update winnings display with subTotalWin from current spin data
	 * Hides display when no subTotalWin (similar to regular header behavior)
	 */
	public updateWinningsFromSpinData(spinData: any): void {
		if (!spinData) {
			console.warn('[BonusHeader] No spin data provided for winnings update');
			this.hideWinningsDisplay();
			return;
		}

		// Check if this is a free spin with subTotalWin (support freespin and freeSpin)
		const fs = spinData.slot?.freespin || spinData.slot?.freeSpin;
		if (fs?.items && fs.items.length > 0) {
			// Find the current free spin item (usually the first one with spinsLeft > 0)
			const currentFreeSpinItem = fs.items.find((item: any) => item.spinsLeft > 0);
			
			if (currentFreeSpinItem && currentFreeSpinItem.subTotalWin !== undefined) {
				const subTotalWin = currentFreeSpinItem.subTotalWin;
				console.log(`[BonusHeader] Found subTotalWin: $${subTotalWin}`);
				
				// Only show display if subTotalWin > 0, otherwise hide it
				if (subTotalWin > 0) {
					console.log(`[BonusHeader] Showing winnings display with subTotalWin: $${subTotalWin}`);
					this.updateWinningsDisplay(subTotalWin);
				} else {
					console.log(`[BonusHeader] subTotalWin is 0, hiding winnings display`);
					this.hideWinningsDisplay();
				}
				return;
			}
		}

		// Fallback: calculate from paylines if no subTotalWin available
		if (spinData.slot?.paylines && spinData.slot.paylines.length > 0) {
			const totalWin = this.calculateTotalWinFromPaylines(spinData.slot.paylines);
			console.log(`[BonusHeader] Calculated from paylines: $${totalWin}`);
			
			// Only show display if totalWin > 0, otherwise hide it
			if (totalWin > 0) {
				console.log(`[BonusHeader] Showing winnings display with payline calculation: $${totalWin}`);
				this.updateWinningsDisplay(totalWin);
			} else {
				console.log(`[BonusHeader] No wins from paylines, hiding winnings display`);
				this.hideWinningsDisplay();
			}
		} else {
			console.log('[BonusHeader] No win data available in spin data, hiding display');
			this.hideWinningsDisplay();
		}
	}

	/**
	 * Calculate total win from paylines (fallback method)
	 */
	private calculateTotalWinFromPaylines(paylines: any[]): number {
		let totalWin = 0;
		for (const payline of paylines) {
			if (payline.win && payline.win > 0) {
				totalWin += payline.win;
			}
		}
		return totalWin;
	}

	/**
	 * Calculate total win amount from tumbles array
	 */
	private calculateTotalWinFromTumbles(tumbles: any[]): number {
		if (!Array.isArray(tumbles) || tumbles.length === 0) {
			return 0;
		}
		let totalWin = 0;
		for (const tumble of tumbles) {
			const w = Number(tumble?.win || 0);
			totalWin += isNaN(w) ? 0 : w;
		}
		return totalWin;
	}

	resize(scene: Scene): void {
		if (this.bonusHeaderContainer) {
			this.bonusHeaderContainer.setSize(scene.scale.width, scene.scale.height);
		}
	}

	getContainer(): Phaser.GameObjects.Container {
		return this.bonusHeaderContainer;
	}

	destroy(): void {
		if (this.bonusHeaderContainer) {
			this.bonusHeaderContainer.destroy();
		}
	}
}
