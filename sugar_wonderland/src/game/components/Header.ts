import { Scene } from "phaser";
import { NetworkManager } from "../../managers/NetworkManager";
import { ScreenModeManager } from "../../managers/ScreenModeManager";
import { Data } from "../../tmp_backend/Data";
import { gameEventManager, GameEventType } from '../../event/EventManager';
import { gameStateManager } from '../../managers/GameStateManager';
import { PaylineData, SpinDataUtils } from '../../backend/SpinData';
import { formatCurrencyNumber } from '../../utils/NumberPrecisionFormatter';
import { localizationManager } from '../../managers/LocalizationManager';
import { WINBAR_YOU_WON, COMMON_TOTAL_WIN, LOCALIZATION_DEFAULTS } from '../../backend/LocalizationData';
import { fitLocalizedLogoTexture, LocalizedLogoSurface } from "@core/utils/LocalizedLogo";

export class Header {
	private headerContainer: Phaser.GameObjects.Container;
	private networkManager: NetworkManager;
	private screenModeManager: ScreenModeManager;
	private amountText: Phaser.GameObjects.Text;
	private youWonText: Phaser.GameObjects.Text;
	private currentWinnings: number = 0;
	private pendingWinnings: number = 0;
	private scene: Scene | null = null;

	constructor(networkManager: NetworkManager, screenModeManager: ScreenModeManager) {
		this.networkManager = networkManager;
		this.screenModeManager = screenModeManager;
	}

	preload(scene: Scene): void {
		// Assets are now loaded centrally through AssetConfig in Preloader
		console.log(`[Header] Assets loaded centrally through AssetConfig`);
	}

	create(scene: Scene): void {
		console.log("[Header] Creating header elements");
		
		// Store scene reference for animations
		this.scene = scene;
		
		// Create main container for all header elements
		this.headerContainer = scene.add.container(0, 0);
		
		const screenConfig = this.screenModeManager.getScreenConfig();
		const assetScale = this.networkManager.getAssetScale();
		
		console.log(`[Header] Creating header with scale: ${assetScale}x`);

		// Add header elements
		this.createHeaderElements(scene, assetScale);
		
		// Set up event listeners for winnings updates
		this.setupWinningsEventListener();
		
		// Set up listener to hide winnings display when bonus mode starts
		this.setupBonusModeListener(scene);
	}

	private createHeaderElements(scene: Scene, assetScale: number): void {

		// Add logo
		const logo = scene.add.image(
			scene.scale.width * 0.5,
			scene.scale.height * 0.13,
			'header-logo'
		).setOrigin(0.5, 0.5).setScale(0.15).setDepth(1);
		fitLocalizedLogoTexture(logo, 'header-logo', (scene as any).gameAPI?.getLocalizedLogoLanguage?.(), (key) => scene.textures.exists(key), { surface: LocalizedLogoSurface.Header });
		this.headerContainer.add(logo);

		// Removed tent and kobiass from header
		
		// Removed cat spine and win bar from header
		
		// Add winnings text centered on the win bar
		this.createWinBarText(scene, scene.scale.width * 0.5, scene.scale.height * 0.215
		);
		
	}

	private createCharacterSpineAnimation(scene: Scene, assetScale: number): void {}

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
		// Start hidden by default; will be shown only when there is an actual win.
		this.youWonText.setVisible(false);

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
		// Start hidden by default; will be shown only when there is an actual win.
		this.amountText.setVisible(false);
	}

	resize(scene: Scene): void {
		if (this.headerContainer) {
			this.headerContainer.setSize(scene.scale.width, scene.scale.height);
		}
	}

	getContainer(): Phaser.GameObjects.Container {
		return this.headerContainer;
	}

	/**
	 * Set up event listener for winnings updates from backend
	 */
	private setupWinningsEventListener(): void {
		

		// Note: SPIN_RESPONSE event listener removed - now using SPIN_DATA_RESPONSE

		// Listen for tumble win progress (running total during tumbles)
		gameEventManager.on(GameEventType.TUMBLE_WIN_PROGRESS, (data: any) => {
			try {
				// Don't show winnings in header if in bonus mode (bonus header handles it)
				if (gameStateManager.isBonus) {
					return;
				}
				const amount = Number((data as any)?.cumulativeWin ?? 0);
				if (amount > 0) {
					// Ensure label shows YOU WON while accumulating
					if (this.youWonText) this.youWonText.setText(this.getHeaderText(WINBAR_YOU_WON));
					this.showWinningsDisplay(amount);
				}
			} catch {}
		});

		// Listen for tumble sequence completion to display TOTAL WIN
		gameEventManager.on(GameEventType.TUMBLE_SEQUENCE_DONE, (data: any) => {
			try {
				// Don't show winnings in header if in bonus mode (bonus header handles it)
				if (gameStateManager.isBonus) {
					this.hideWinningsDisplay();
					return;
				}
				const amount = Number((data as any)?.totalWin ?? 0);
				if (amount > 0) {
					if (this.youWonText) this.youWonText.setText(this.getHeaderText(COMMON_TOTAL_WIN).toUpperCase());
					// Force an animation even if the numeric value hasn't changed from the
					// last tumble update, so the transition to "TOTAL WIN" feels responsive.
					// By resetting currentWinnings, showWinningsDisplay will detect a change
					// and play the pulse or scale-in animation as appropriate.
					this.currentWinnings = 0;
					this.showWinningsDisplay(amount);
				} else {
					// Zero win - hide if not in scatter
					if (!gameStateManager.isScatter) {
						this.hideWinningsDisplay();
					}
				}
			} catch {}
		});

		// Listen for spin events to hide winnings display at start of manual spin
		gameEventManager.on(GameEventType.SPIN, () => {
			console.log('[Header] Manual spin started - showing winnings display');
			
			// CRITICAL: Block autoplay spin actions if win dialog is showing, but allow manual spins
			// This fixes the timing issue where manual spin winnings display was blocked
			if (gameStateManager.isShowingWinDialog && gameStateManager.isAutoPlaying) {
				console.log('[Header] Autoplay SPIN event BLOCKED - win dialog is showing');
				console.log('[Header] Manual spins are still allowed to proceed');
				return;
			}
			
			// Keep winnings visible during scatter/bonus transitions
			if (gameStateManager.isScatter || gameStateManager.isBonus) {
				console.log('[Header] Skipping hide on SPIN (scatter/bonus active)');
			} else {
				// Show the winnings display with the stored winnings
				this.hideWinningsDisplay();
			}
			this.pendingWinnings = this.currentWinnings;
		});

		// Listen for autoplay start to hide winnings display
		gameEventManager.on(GameEventType.AUTO_START, () => {
			console.log('[Header] Auto play started - showing winnings display');
			// Keep winnings visible during scatter/bonus transitions (e.g., free spin autoplay)
			if (gameStateManager.isScatter || gameStateManager.isBonus) {
				console.log('[Header] Skipping hide on AUTO_START (scatter/bonus active)');
				return;
			}
			this.hideWinningsDisplay();
		});

		// Listen for reels start to hide winnings display
		gameEventManager.on(GameEventType.REELS_START, () => {
			console.log('[Header] Reels started - hiding winnings display');
			// Keep winnings visible during scatter transition and bonus start
			if (gameStateManager.isScatter || gameStateManager.isBonus) {
				console.log('[Header] Skipping hide on REELS_START (scatter/bonus active)');
				return;
			}
			this.hideWinningsDisplay();
		});

		// Listen for reel done events to show winnings display
		gameEventManager.on(GameEventType.REELS_STOP, (data: any) => {
			console.log(`[Header] REELS_STOP received - checking for wins`);
			
			// Don't show winnings in header if in bonus mode (bonus header handles it)
			if (gameStateManager.isBonus) {
				console.log('[Header] Skipping REELS_STOP winnings update - bonus mode active');
				this.hideWinningsDisplay();
				return;
			}
			
			// Get the current spin data from the Symbols component
			const symbolsComponent = (this.headerContainer.scene as any).symbols;
			if (symbolsComponent && symbolsComponent.currentSpinData) {
				const spinData = symbolsComponent.currentSpinData;
				console.log(`[Header] Found current spin data:`, spinData);
				
				// If this spin uses tumbles, let tumble events drive the display
				if (Array.isArray(spinData?.slot?.tumbles) && spinData.slot.tumbles.length > 0) {
					console.log('[Header] Tumbles present - winnings display handled by tumble events');
					return;
				}

				if (spinData.slot && spinData.slot.paylines && spinData.slot.paylines.length > 0) {
					const totalWin = this.calculateTotalWinningsFromPaylines(spinData.slot.paylines);
					console.log(`[Header] Total winnings calculated from paylines: ${totalWin}`);
					
					if (totalWin > 0) {
						if (this.youWonText) this.youWonText.setText(this.getHeaderText(WINBAR_YOU_WON));
						this.showWinningsDisplay(totalWin);
					} else {
						// If scatter is active, keep the winnings shown (it may have been set by scatter logic)
						if (gameStateManager.isScatter) {
							console.log('[Header] Skipping hide on REELS_STOP no-paylines (scatter active)');
						} else {
							this.hideWinningsDisplay();
						}
					}
				} else {
					console.log('[Header] No paylines in current spin data - hiding winnings display');
					// If scatter is active, keep the winnings shown (it may have been set by scatter logic)
					if (gameStateManager.isScatter) {
						console.log('[Header] Skipping hide on REELS_STOP (no paylines) due to scatter');
					} else {
						this.hideWinningsDisplay();
					}
				}
			} else {
				console.log('[Header] No current spin data available - hiding winnings display');
				// If scatter is active, keep the winnings shown
				if (gameStateManager.isScatter) {
					console.log('[Header] Skipping hide on REELS_STOP (no spin data) due to scatter');
				} else {
					this.hideWinningsDisplay();
				}
			}
		});
	}

	/**
	 * Update the winnings display in the header
	 */
	/**
	 * Cap the base win-bar value to slot.totalWin on a max-win spin (e.g. scatter triggered in
	 * normal game). Non-max-win spins pass through unchanged.
	 */
	private capWinningsForMaxWin(winnings: number): number {
		try {
			const spinData: any = (this.scene as any)?.symbols?.currentSpinData
				?? (this.scene as any)?.gameAPI?.getCurrentSpinData?.();
			return SpinDataUtils.clampToSlotTotalWin(winnings, spinData);
		} catch {
			return winnings;
		}
	}

	public updateWinningsDisplay(winnings: number): void {
		// Don't update winnings display if in bonus mode (bonus header handles it)
		if (gameStateManager.isBonus) {
			console.log('[Header] Skipping updateWinningsDisplay - bonus mode active (bonus header handles winnings)');
			return;
		}

		winnings = this.capWinningsForMaxWin(winnings);
		if (this.amountText) {
			this.currentWinnings = winnings;
			const formattedWinnings = this.formatCurrency(winnings);
			this.amountText.setText(formattedWinnings);
			console.log(`[Header] Winnings updated to: ${formattedWinnings} (raw: ${winnings})`);
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
			
			console.log('[Header] Winnings display hidden with shrink animation');
		} else {
			console.warn('[Header] Cannot hide winnings display - text objects not available', {
				amountText: !!this.amountText,
				youWonText: !!this.youWonText
			});
		}
	}

	/**
	 * Show the winnings display with both "YOU WON" text and amount with scale in animation
	 */
	public showWinningsDisplay(winnings: number): void {
		// Don't show winnings display if in bonus mode (bonus header handles it)
		if (gameStateManager.isBonus) {
			console.log('[Header] Skipping showWinningsDisplay - bonus mode active (bonus header handles winnings)');
			return;
		}

		winnings = this.capWinningsForMaxWin(winnings);
		if (this.amountText && this.youWonText) {
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
					console.log(`[Header] Winnings display updated with pulse animation: ${formattedWinnings} (raw: ${winnings})`);
				} else {
					// Value hasn't changed - just ensure scale is correct without animation
					this.youWonText.setScale(1);
					this.amountText.setScale(1);
					console.log(`[Header] Winnings display value unchanged, skipping animation: ${formattedWinnings} (raw: ${winnings})`);
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
				console.log(`[Header] Winnings display shown with scale-in animation: ${formattedWinnings} (raw: ${winnings})`);
			}
		} else {
			console.warn('[Header] Cannot show winnings display - text objects not available', {
				amountText: !!this.amountText,
				youWonText: !!this.youWonText
			});
		}
	}



	/**
	 * Calculate total winnings from paylines array
	 */
	private calculateTotalWinningsFromPaylines(paylines: PaylineData[]): number {
		if (!paylines || paylines.length === 0) {
			return 0;
		}
		
		const totalWin = paylines.reduce((sum, payline) => {
			const winAmount = payline.win || 0;
			console.log(`[Header] Payline ${payline.lineKey}: ${winAmount} (symbol ${payline.symbol}, count ${payline.count})`);
			return sum + winAmount;
		}, 0);
		
		console.log(`[Header] Calculated total winnings: ${totalWin} from ${paylines.length} paylines`);
		return totalWin;
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

	/**
	 * Reset winnings display to zero
	 */
	public resetWinnings(): void {
		this.updateWinningsDisplay(0);
	}

	/**
	 * Debug method to check the current state of text objects
	 */
	public debugTextObjects(): void {
		console.log('[Header] Debug - Text objects state:', {
			amountText: {
				exists: !!this.amountText,
				visible: this.amountText?.visible,
				text: this.amountText?.text,
				alpha: this.amountText?.alpha
			},
			youWonText: {
				exists: !!this.youWonText,
				visible: this.youWonText?.visible,
				text: this.youWonText?.text,
				alpha: this.youWonText?.alpha
			},
			currentWinnings: this.currentWinnings
		});
	}

	/**
	 * Initialize winnings display when game starts
	 */
	public initializeWinnings(): void {
		console.log('[Header] Initializing winnings display');
		this.currentWinnings = 0;
		
		// Debug the text objects to make sure they exist
		this.debugTextObjects();
		
		// Hide winnings display at game start
		this.hideWinningsDisplay();
	}

	/**
	 * Setup listener for bonus mode changes to hide winnings display
	 */
	private setupBonusModeListener(scene: Scene): void {
		// Listen for bonus mode events
		scene.events.on('setBonusMode', (isBonus: boolean) => {
			if (isBonus) {
				// Hide winnings display when bonus mode starts (bonus header will show its own)
				// Force hide immediately and ensure it stays hidden
				this.hideWinningsDisplay();
				// Also check gameStateManager to ensure it's hidden
				if (gameStateManager.isBonus) {
					// Double-check: if still visible after hide, force hide again
					if (this.amountText && this.youWonText && 
					    (this.amountText.visible || this.youWonText.visible)) {
						this.amountText.setVisible(false);
						this.youWonText.setVisible(false);
						console.log('[Header] Force-hiding winnings display - bonus mode active');
					}
				}
				console.log('[Header] Winnings display hidden - bonus mode started');
			} else {
				console.log('[Header] Bonus mode ended - winnings display can be shown again');
			}
		});

		// Also listen for showBonusHeader event to hide winnings display
		scene.events.on('showBonusHeader', () => {
			this.hideWinningsDisplay();
			// Force hide to ensure it's hidden
			if (this.amountText && this.youWonText) {
				this.amountText.setVisible(false);
				this.youWonText.setVisible(false);
			}
			console.log('[Header] Winnings display hidden - bonus header shown');
		});
	}
}
