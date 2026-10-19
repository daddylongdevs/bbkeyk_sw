import { Scene } from 'phaser';
import { NetworkManager } from '../../managers/NetworkManager';
import { ScreenModeManager } from '../../managers/ScreenModeManager';
import { NumberDisplay, NumberDisplayConfig } from './NumberDisplay';
import { CurrencyManager } from './CurrencyManager';
import { formatCurrencyNumber } from '../../utils/NumberPrecisionFormatter';
import { IrisTransition } from './IrisTransition';
import { SymbolExplosionTransition } from './SymbolExplosionTransition';
import { gameStateManager } from '../../managers/GameStateManager';
import { gameEventManager, GameEventType } from '../../event/EventManager';
import { localizationManager } from '../../managers/LocalizationManager';
import { DIALOG_PRESS_CONTINUE, LOCALIZATION_DEFAULTS } from '../../backend/LocalizationData';
import {
	DIALOG_MANUAL_DISMISS_DELAY_MS_SUMMARY,
	DIALOG_MANUAL_DISMISS_DELAY_MS_WIN_TIERS,
	DIALOG_MIN_CLOSE_DELAY_MS,
	MAX_WIN_MULTIPLIER,
	WIN_DIALOG_AUTO_CLOSE_MS,
} from '../../config/GameConfig';
import { SpinDataUtils } from '../../backend/SpinData';

export interface DialogConfig {
	type: 'Congrats_KA' | 'FreeSpinDialog_KA' | 'largeW_KA' | 'LargeW_KA' | 'MediumW_KA' | 'SmallW_KA' | 'SuperW_KA' | 'MaxWin';
	position?: { x: number; y: number };
	scale?: number;
	duration?: number;
	onComplete?: () => void;
	winAmount?: number; // Amount to display in the dialog
	maxWinMultiplier?: number; // Max-win multiplier label (e.g. 10000x)
	freeSpins?: number; // Number of free spins won
	isRetrigger?: boolean; // For FreeSpinDialog_KA: whether this is a retrigger case
	betAmount?: number; // Base bet amount for staged win animations
}

export class Dialogs {
	// Main dialog container that covers the entire screen
	private dialogOverlay: Phaser.GameObjects.Container;
	
	// Black background overlay
	private blackOverlay: Phaser.GameObjects.Graphics;
	
	// Dialog content container (the actual dialog animations)
	private dialogContentContainer: Phaser.GameObjects.Container;
	
	// Continue text
	private continueText: Phaser.GameObjects.Text | null = null;
	
	// Number display container
	private numberDisplayContainer: Phaser.GameObjects.Container | null = null;
	private numberDisplay: NumberDisplay | null = null;
	private numberTargetValue: number = 0;

	// Secondary number display for congrats dialog (e.g., free spins used)
	private congratsFreeSpinsContainer: Phaser.GameObjects.Container | null = null;
	private congratsFreeSpinsDisplay: NumberDisplay | null = null;
	
	// Click handler area
	private clickArea: Phaser.GameObjects.Rectangle | null = null;
	
	// Current dialog state
	private currentDialog: any = null; // Spine object type
	private isDialogActive: boolean = false;
	private currentDialogType: string | null = null;
	private isRetriggerFreeSpin: boolean = false; // Tracks if current FreeSpinDialog is a retrigger
	
	// Auto-close timer for win dialogs during autoplay
	private autoCloseTimer: Phaser.Time.TimerEvent | null = null;
	private readonly replayFreeSpinDialogAutoCloseMs: number = 3000;
	/** When the active dialog became dismissible by manual input (click / SPACE). */
	private dialogShownAtMs: number = 0;
	
	// Number display Y positions per dialog group (overrides). If null, default will be used.
	private numberYWin: number | null = 490;
	private numberYFreeSpin: number | null = null;
	private numberYCongrats: number | null = null;
	
	// Managers
	private networkManager: NetworkManager;
	private screenModeManager: ScreenModeManager;
	private currentScene: Scene | null = null;

	// Staged win animation state (Big -> Mega -> Epic -> Super with incremental number steps)
	private isStagedWinNumberAnimation: boolean = false;
	private stagedWinStages: Array<{ type: 'SmallW_KA' | 'MediumW_KA' | 'LargeW_KA' | 'SuperW_KA'; target: number }> = [];
	private stagedWinCurrentStageIndex: number = 0;
	private stagedWinStageTimer: Phaser.Time.TimerEvent | null = null;
	
	// Iris transition for scatter animation
	private irisTransition: IrisTransition | null = null;
	// Symbol explosion transition for free spin dialog dismissal
	private candyTransition: SymbolExplosionTransition | null = null;
	/** Custom Max Win drawer panel (not a Spine asset). */
	private maxWinRoot: Phaser.GameObjects.Container | null = null;

	// Dialog configuration
	private dialogScales: Record<string, number> = {
		'Congrats_KA': 0.45,
		'FreeSpinDialog_KA': 0.45,
		'largeW_KA': 0.45,
		'LargeW_KA': 0.45,
		'MediumW_KA':0.45,
		'SmallW_KA':0.45,
		'SuperW_KA': 0.45
	};

	// Dialog positions (relative: 0.0 = left/top, 0.5 = center, 1.0 = right/bottom)
	private dialogPositions: Record<string, { x: number; y: number }> = {
		'Congrats_KA': { x:0.55, y: 0.55 },
		'FreeSpinDialog_KA': { x: 0.55, y: 0.55 },
		'largeW_KA': { x:0.55, y: 0.55 },
		'LargeW_KA': { x: 0.55, y:0.55 },
		'MediumW_KA': { x:0.55, y: 0.55 },
		'SmallW_KA': { x: 0.55, y: 0.55 },
		'SuperW_KA': { x: 0.55, y: 0.55 }
	};

	private dialogLoops: Record<string, boolean> = {
		'Congrats_KA': true,
		'FreeSpinDialog_KA': true,
		'largeW_KA': true,
		'LargeW_KA': true,
		'MediumW_KA': true,
		'SmallW_KA': true,
		'SuperW_KA': true
	};

	// Global toggle to disable intro animations for dialogs (win, free spin, congrats)
	// When true, dialogs will start directly in their idle loop.
	private disableIntroAnimations: boolean = true;

	// Remember the intended scale for the current dialog so we can tween from 0 -> target
	private lastDialogScale: number = 1;

	// Tracks whether we've already shown at least one win dialog. Used to fix an edge
	// case where the *first* win dialog could occasionally miss the scale "pop" tween.
	private hasShownAnyWinDialog: boolean = false;

	constructor(networkManager: NetworkManager, screenModeManager: ScreenModeManager) {
		this.networkManager = networkManager;
		this.screenModeManager = screenModeManager;
	}

	/** True while the symbol explosion transition started from a dialog is playing. */
	public isCandyTransitionPlaying(): boolean {
		return this.candyTransition?.isTransitionPlaying() ?? false;
	}

	create(scene: Scene): void {
		// Store scene reference for later use
		this.currentScene = scene;
		
		// Initialize iris transition for scatter animation
		this.irisTransition = new IrisTransition(scene);
		// Initialize symbol explosion transition for free spin dialog dismissal
		this.candyTransition = new SymbolExplosionTransition(scene);
		
		// Create main dialog overlay container
		this.dialogOverlay = scene.add.container(0, 0);
		this.dialogOverlay.setDepth(1000); // Very high depth to cover everything
		this.dialogOverlay.setVisible(false); // Hidden by default
		
		// Create black overlay background first (lowest depth = behind everything)
		this.blackOverlay = scene.add.graphics();
		this.blackOverlay.fillStyle(0x000000, 0.7); // Black with 70% alpha
		this.blackOverlay.fillRect(0, 0, scene.scale.width, scene.scale.height);
		this.blackOverlay.setDepth(100); // Very low depth to be behind everything
		this.dialogOverlay.add(this.blackOverlay);
		
		// Create dialog content container (highest depth = in front of everything)
		this.dialogContentContainer = scene.add.container(0, 0);
		this.dialogContentContainer.setDepth(300); // Highest depth to be in front
		this.dialogOverlay.add(this.dialogContentContainer);
		
		console.log('[Dialogs] Dialog system created');
	}
	


	/**
	 * Show a dialog with the specified configuration
	 */
	public showDialog(scene: Scene, config: DialogConfig): void {
		// Reset staged win state for each new dialog
		this.isStagedWinNumberAnimation = false;
		this.stagedWinStages = [];
		this.stagedWinCurrentStageIndex = 0;

		const dialogType = this.normalizeDialogType(config.type);
		const normalizedConfig: DialogConfig = { ...config, type: dialogType };
		if (config.type === 'FreeSpinRetrigger') {
			normalizedConfig.isRetrigger = true;
		}

		if (normalizedConfig.type === 'MaxWin' && this.isDialogActive && this.currentDialogType === 'MaxWin') {
			console.log('[Dialogs] MaxWin already active — ignoring duplicate showDialog');
			return;
		}

		if (normalizedConfig.type === 'MaxWin' || normalizedConfig.type === 'Congrats_KA') {
			normalizedConfig.winAmount = this.resolveSlotTotalWinDisplayAmount(scene);
			if (normalizedConfig.type === 'MaxWin') {
				normalizedConfig.maxWinMultiplier = this.resolveMaxWinMultiplier(normalizedConfig, scene);
			}
		} else if (
			this.isWinDialogType(normalizedConfig.type) &&
			normalizedConfig.winAmount !== undefined
		) {
			try {
				const gameApi = (scene as any)?.gameAPI;
				const spin = gameApi?.getCurrentSpinData?.();
				normalizedConfig.winAmount = SpinDataUtils.resolveCappedWinDisplayAmount(
					spin,
					Number(normalizedConfig.winAmount),
				);
			} catch {}
		}

		if (this.isDialogActive) {
			this.hideDialog();
		}

		console.log(`[Dialogs] Showing dialog: ${normalizedConfig.type}`);
		
		// Track current dialog type for bonus mode detection
		this.currentDialogType = normalizedConfig.type;
		// Track retrigger state only for Free Spin dialog
		this.isRetriggerFreeSpin = (normalizedConfig.type === 'FreeSpinDialog_KA') ? !!normalizedConfig.isRetrigger : false;
		
		// If this is a win dialog, mark global state so autoplay systems can wait
		try {
			if (this.isWinDialog() || this.currentDialogType === 'MaxWin') {
				gameStateManager.isShowingWinDialog = true;
			}
		} catch {}
		
		// Debug dialog type detection
		console.log(`[Dialogs] Dialog type: ${normalizedConfig.type}, isWinDialog(): ${this.isWinDialog()}`);
		if (this.currentDialogType === 'FreeSpinDialog_KA') {
			console.log('[Dialogs] FreeSpinDialog retrigger state:', this.isRetriggerFreeSpin);
		}
		
		// If congrats dialog is appearing, suppress the SlotController's spins-left display
		if (normalizedConfig.type === 'Congrats_KA' || normalizedConfig.type === 'MaxWin') {
			try {
				const gameSceneAny = scene as any;
				const slotController = gameSceneAny?.slotController;
				if (slotController && typeof slotController.suppressFreeSpinDisplay === 'function') {
					slotController.suppressFreeSpinDisplay();
					console.log('[Dialogs] Congrats dialog shown - suppressing SlotController free spin display');
				}
			} catch {}
		}

		// If free spin dialog is appearing, clear any prior suppression to allow showing again
		if (normalizedConfig.type === 'FreeSpinDialog_KA') {
			try {
				const gameSceneAny = scene as any;
				const slotController = gameSceneAny?.slotController;
				if (slotController && typeof slotController.clearFreeSpinDisplaySuppression === 'function') {
					slotController.clearFreeSpinDisplaySuppression();
					console.log('[Dialogs] FreeSpinDialog shown - cleared suppression for SlotController free spin display');
				}
			} catch {}
		}
		
		// Ensure dialog overlay is visible and reset alpha for new dialog
		this.dialogOverlay.setVisible(true);
		this.dialogOverlay.setAlpha(1);
		this.isDialogActive = true;
		this.dialogShownAtMs = Date.now();
		
		console.log(`[Dialogs] Dialog overlay set to visible: ${this.dialogOverlay.visible}, alpha: ${this.dialogOverlay.alpha}`);
		
		// Always ensure black overlay is properly set up for new dialog
		console.log('[Dialogs] Setting up black overlay for dialog type:', normalizedConfig.type);
		console.log('[Dialogs] Black overlay current state:', {
			visible: this.blackOverlay.visible,
			alpha: this.blackOverlay.alpha,
			exists: !!this.blackOverlay
		});
		
		// Handle black overlay based on dialog type
		if (!this.isWinDialog()) {
			console.log('[Dialogs] Non-win dialog detected - setting up black overlay');
			
			// Ensure black overlay is visible and reset to transparent for fade-in
			this.blackOverlay.setVisible(true);
			this.blackOverlay.setAlpha(0);
			console.log('[Dialogs] Non-win dialog - black overlay will fade in');
			console.log('[Dialogs] Black overlay reset to visible=true, alpha=0 for fade-in');
		
			// Fade in the black overlay
			scene.tweens.add({
				targets: this.blackOverlay,
				alpha: 1,
				duration: 500,
				ease: 'Power2',
				onComplete: () => {
					console.log('[Dialogs] Black overlay fade-in complete');
				}
			});
		} else {
			console.log('[Dialogs] Win dialog - setting black overlay to semi-transparent background');
			// For win dialogs, ensure black overlay is visible and set to semi-transparent background
			this.blackOverlay.setVisible(true);
			this.blackOverlay.setAlpha(0.7); // Semi-transparent background
		}
		
		// Log final black overlay state for debugging
		console.log('[Dialogs] Final black overlay state:', {
			visible: this.blackOverlay.visible,
			alpha: this.blackOverlay.alpha,
			exists: !!this.blackOverlay
		});
		
		// Create the dialog content
		this.createDialogContent(scene, normalizedConfig);

		if (normalizedConfig.type === 'MaxWin' && this.maxWinRoot) {
			this.maxWinRoot.setAlpha(0);
			scene.tweens.add({
				targets: this.maxWinRoot,
				alpha: 1,
				duration: 400,
				ease: 'Power2',
			});
		}

		// Ensure the very first win dialog always gets the scale pop animation.
		// On some devices the initial tween applied during createDialogContent can
		// be skipped when the Win spine is created for the first time, so we force
		// a second pop once the dialog is fully initialized.
		if (!this.hasShownAnyWinDialog && this.isWinDialogType(normalizedConfig.type)) {
			this.hasShownAnyWinDialog = true;
			try {
				const sceneRef = scene;
				sceneRef.time.delayedCall(0, () => {
					if (!this.currentDialog || !this.isDialogActive) {
						return;
					}
					this.applyDialogScalePop(sceneRef);
				});
			} catch {}
		}

		// Notify the scene that a dialog has been shown (type included)
		try {
			scene.events.emit('dialogShown', this.currentDialogType);
		} catch {}

        // Play dialog-specific SFX (FreeSpin/ Congrats) when shown
		try {
			const audioManager = (window as any).audioManager;
			if (audioManager && typeof audioManager.playSoundEffect === 'function') {
				const type = (this.currentDialogType || '').toLowerCase();
                if (type === 'freespindialog_ka') {
                    // Use congrats_ka for the FreeSpin dialog per request
                    audioManager.playSoundEffect('dialog_congrats');
                    // Duck background music similar to win dialogs
                    if (typeof audioManager.duckBackground === 'function') {
                        audioManager.duckBackground(0.3);
                    }
                } else if (type === 'congrats_ka') {
					audioManager.playSoundEffect('dialog_congrats');
                    if (typeof audioManager.duckBackground === 'function') {
                        audioManager.duckBackground(0.3);
                    }
				}
			}
		} catch {}
		
		// Fade dialog content in (scale pop is applied whenever idle starts)
		if (this.currentDialog) {
			this.currentDialog.setAlpha(0);

			// Adjust timing based on dialog type
			const contentDelay = this.isWinDialog() ? 0 : 200; // No delay for win dialogs
			
			scene.tweens.add({
				targets: this.currentDialog,
				alpha: 1,
				duration: 800,
				ease: 'Power2',
				delay: contentDelay,
				onComplete: () => {
					console.log('[Dialogs] Dialog content fade-in complete');
				}
			});
		}
		
		// Create number display(s) if win amount or free spins are provided
		if (
			normalizedConfig.type !== 'MaxWin' &&
			(normalizedConfig.winAmount !== undefined || normalizedConfig.freeSpins !== undefined)
		) {
			if (normalizedConfig.type === 'Congrats_KA' || normalizedConfig.type === 'MaxWin') {
				// Congrats dialog: primary total win + secondary free spins used (if provided)
				if (normalizedConfig.winAmount !== undefined) {
					this.createNumberDisplay(scene, normalizedConfig.winAmount || 0, undefined);
				}
				if (normalizedConfig.freeSpins !== undefined) {
					this.createCongratsFreeSpinsDisplay(scene, normalizedConfig.freeSpins);
				}
			} else {
				// Other dialogs: existing single number behavior
				this.createNumberDisplay(scene, normalizedConfig.winAmount || 0, normalizedConfig.freeSpins);

				// Configure staged win number animation (Big -> Mega -> Epic -> Super)
				if (normalizedConfig.winAmount !== undefined && normalizedConfig.betAmount !== undefined && this.isWinDialogType(normalizedConfig.type)) {
					this.setupStagedWinNumberAnimation(normalizedConfig);
				}
			}

			// Fade in number display(s) after a short delay (replacing paint effect trigger)
			scene.time.delayedCall(500, () => {
				console.log('[Dialogs] Fading in number display(s)');
				this.fadeInNumberDisplay(scene);
			});
		}

		// Play win dialog SFX at the correct time (after staged setup decides the first tier)
		try {
			if (this.isWinDialog()) {
				const audioManager = (window as any).audioManager;
				// Always duck background while a win dialog is visible
				if (audioManager && typeof audioManager.duckBackground === 'function') {
					audioManager.duckBackground(0.3);
				}
				// If we're doing staged tiers, let the staged runner trigger SFX per tier.
				// Otherwise, play the SFX for the current (single) dialog type now.
				if (!this.isStagedWinNumberAnimation && audioManager && typeof audioManager.playWinDialogSfx === 'function') {
					audioManager.playWinDialogSfx(this.currentDialogType);
				}
			}
		} catch (e) {
			console.warn('[Dialogs] Failed to play win dialog SFX (post-setup):', e);
		}
		
		// Create continue text (delayed) — Max Win drawer has its own CLOSE control
		if (normalizedConfig.type !== 'MaxWin') {
			this.createContinueText(scene);
		}
		
		// Create click handler
		this.createClickHandler(scene);
		
		// Set up auto-close timer for win dialogs during autoplay
		this.setupAutoCloseTimer(scene);
	}

	/**
	 * Normalize console / legacy dialog type names to current KA types.
	 */
	private normalizeDialogType(type: string): DialogConfig['type'] {
		const normalizedMap: Record<string, DialogConfig['type']> = {
			BigWin: 'SmallW_KA',
			MegaWin: 'MediumW_KA',
			EpicWin: 'LargeW_KA',
			LargeWin: 'LargeW_KA',
			SuperWin: 'SuperW_KA',
			Congrats: 'Congrats_KA',
			TotalWin: 'Congrats_KA',
			MaxWin: 'MaxWin',
			FreeSpin: 'FreeSpinDialog_KA',
			FreeSpinRetrigger: 'FreeSpinDialog_KA',
		};

		return normalizedMap[type] || (type as DialogConfig['type']);
	}

	private resolveSlotTotalWinDisplayAmount(scene: Scene): number {
		try {
			const sceneAny = scene as any;
			const gameApi = sceneAny?.gameAPI ?? sceneAny?.slotController?.gameAPI;
			const symbolsSpinData = sceneAny?.symbols?.currentSpinData;
			return SpinDataUtils.resolveAuthoritativeSlotTotalWinForDisplay({
				gameAPI: gameApi,
				symbolsSpinData,
			});
		} catch {}
		return 0;
	}

	/**
	 * Resolve the capped total win amount shown on the Max Win drawer.
	 * Prefer authoritative spin payload (`slot.totalWin`) over console overrides.
	 */
	private resolveMaxWinDisplayAmount(config: DialogConfig, scene: Scene): number {
		return this.resolveSlotTotalWinDisplayAmount(scene);
	}

	private resolveMaxWinMultiplier(config: DialogConfig, scene: Scene): number {
		const fromConfig = Number(config.maxWinMultiplier);
		if (Number.isFinite(fromConfig) && fromConfig > 0) {
			return Math.round(fromConfig);
		}
		try {
			const gameApi = (scene as any)?.gameAPI;
			const mw = gameApi?.getMaxWin?.();
			const parsed = Number(mw);
			if (Number.isFinite(parsed) && parsed > 0) {
				return Math.round(parsed);
			}
		} catch {}
		return MAX_WIN_MULTIPLIER;
	}

	private destroyMaxWinDialogContent(): void {
		if (this.maxWinRoot) {
			try {
				this.maxWinRoot.destroy(true);
			} catch {}
			this.maxWinRoot = null;
		}
	}

	private createMaxWinDialogContent(scene: Scene, config: DialogConfig): void {
		this.destroyMaxWinDialogContent();

		const w = scene.scale.width;
		const h = scene.scale.height;
		const cx = w * 0.5;
		const cy = h * 0.5;

		const root = scene.add.container(0, 0);
		root.setDepth(102);

		const mult = this.resolveMaxWinMultiplier(config, scene);
		const formattedMult = mult.toLocaleString('en-US', { maximumFractionDigits: 0 });

		const winAmount = this.resolveMaxWinDisplayAmount(config, scene);
		const isDemo =
			(typeof sessionStorage !== 'undefined' && sessionStorage.getItem('demo') === 'true') ||
			!!(scene as any)?.gameAPI?.getDemoState?.();
		const currencyPrefix = isDemo ? '' : CurrencyManager.getCurrencySymbol();
		const formattedWin = `${currencyPrefix}${formatCurrencyNumber(winAmount)}`;

		const panel = scene.add.container(cx, cy);
		const panelW = Math.min(400, Math.max(300, w * 0.88));
		const btnW = 300;
		const btnH = 52;
		const padTop = 28;
		const padBottom = 18;
		const headerLineH = 32;
		const gapAfterHeader = 24;
		const congratsLineH = 28;
		const gapAfterCongrats = 10;
		const multiplierLineH = 24;
		const gapAfterMultiplier = 8;
		const amountLineH = 36;
		const gapBodyToBtn = 24;
		const innerContentH =
			padTop +
			headerLineH +
			gapAfterHeader +
			congratsLineH +
			gapAfterCongrats +
			multiplierLineH +
			gapAfterMultiplier +
			amountLineH +
			gapBodyToBtn +
			btnH +
			padBottom;
		const panelH = Math.min(380, Math.max(innerContentH, 260));
		const halfW = panelW * 0.5;
		const halfH = panelH * 0.5;
		const cornerR = 20;
		const borderColor = 0x007bff;

		const panelBg = scene.add.graphics();
		panelBg.fillStyle(0x000000, 0.92);
		panelBg.fillRoundedRect(-halfW, -halfH, panelW, panelH, cornerR);
		panelBg.lineStyle(2, borderColor, 1);
		panelBg.strokeRoundedRect(-halfW, -halfH, panelW, panelH, cornerR);
		panel.add(panelBg);

		const headerY = -halfH + padTop + headerLineH * 0.5;
		const title = scene.add.text(-halfW + 24, headerY, 'Max Win', {
			fontSize: '24px',
			color: '#379557',
			fontFamily: 'Poppins-Bold',
		});
		title.setOrigin(0, 0.5);
		panel.add(title);

		const onMaxWinClose = () => {
			try {
				const audioManager = (window as any).audioManager;
				if (audioManager && typeof audioManager.playSoundEffect === 'function') {
					audioManager.playSoundEffect('click_sw');
				}
			} catch {}
			this.handleDialogClick(scene);
		};

		const closeX = scene.add.text(halfW - 24, headerY, '×', {
			fontSize: '30px',
			color: '#ffffff',
			fontFamily: 'Poppins-Regular',
		});
		closeX.setOrigin(0.5, 0.5);
		closeX.setInteractive({ useHandCursor: true });
		closeX.on('pointerdown', onMaxWinClose);
		panel.add(closeX);

		const congratsY = -halfH + padTop + headerLineH + gapAfterHeader + congratsLineH * 0.5;
		const multiplierY = congratsY + congratsLineH * 0.5 + gapAfterCongrats + multiplierLineH * 0.5;
		const amountY = multiplierY + multiplierLineH * 0.5 + gapAfterMultiplier + amountLineH * 0.5;
		const btnY = amountY + amountLineH * 0.5 + gapBodyToBtn + btnH * 0.5;

		const congrats = scene.add.text(0, congratsY, 'Congratulations!', {
			fontSize: '26px',
			color: '#ffffff',
			fontFamily: 'Poppins-Bold',
		});
		congrats.setOrigin(0.5, 0.5);
		panel.add(congrats);

		const multiplierLine = scene.add.text(0, multiplierY, `MAX WIN: ${formattedMult}×`, {
			fontSize: '20px',
			color: '#ffffff',
			fontFamily: 'Poppins-Bold',
		});
		multiplierLine.setOrigin(0.5, 0.5);
		panel.add(multiplierLine);

		const amountText = scene.add.text(0, amountY, formattedWin, {
			fontSize: '32px',
			color: '#379557',
			fontFamily: 'Poppins-Bold',
		});
		amountText.setOrigin(0.5, 0.5);
		panel.add(amountText);

		if (scene.textures.exists('long_button')) {
			const btnImg = scene.add.image(0, btnY, 'long_button');
			btnImg.setOrigin(0.5, 0.5);
			btnImg.setDisplaySize(btnW, btnH);
			btnImg.setInteractive({ useHandCursor: true });
			btnImg.on('pointerdown', onMaxWinClose);
			panel.add(btnImg);

			const btnLabel = scene.add.text(0, btnY, 'CLOSE', {
				fontSize: '22px',
				color: '#000000',
				fontFamily: 'Poppins-Bold',
			});
			btnLabel.setOrigin(0.5, 0.5);
			panel.add(btnLabel);
		} else {
			const hit = scene.add.rectangle(0, btnY, btnW, btnH, 0x379557, 1);
			hit.setInteractive({ useHandCursor: true });
			hit.on('pointerdown', onMaxWinClose);
			panel.add(hit);

			const btnLabel = scene.add.text(0, btnY, 'CLOSE', {
				fontSize: '22px',
				color: '#000000',
				fontFamily: 'Poppins-Bold',
			});
			btnLabel.setOrigin(0.5, 0.5);
			panel.add(btnLabel);
		}

		root.add(panel);
		this.dialogContentContainer.add(root);
		this.maxWinRoot = root;
	}

	/**
	 * Map old dialog types to new Win.json animation names
	 */
	private getAnimationNameForDialogType(dialogType: string): { intro: string; idle: string; outro?: string } | null {
		const animationMap: Record<string, { intro: string; idle: string; outro?: string }> = {
			// Win dialog animations
			'SmallW_KA': { intro: 'BigWin-Intro', idle: 'BigWin-Idle', outro: 'BigWin-Outro' },
			'MediumW_KA': { intro: 'MegaWin-Intro', idle: 'MegaWin-Idle' },
			'LargeW_KA': { intro: 'EpicWin-Intro', idle: 'EpicWin-Idle' },
			'SuperW_KA': { intro: 'SuperWin-Intro', idle: 'SuperWin-Idle' },
			'FreeSpinDialog_KA': { intro: 'FreeSpin-Intro', idle: 'FreeSpin-Idle' },

			// Congrats dialog should also use the Win spine (shared Win.json)
			// Expecting dedicated "Congrats" animations to be present in the Win asset.
			// If the intro animation is missing, we will gracefully fall back to the idle animation.
			'Congrats_KA': { intro: 'Congrats-Intro', idle: 'Congrats-Idle' }
		};
		
		return animationMap[dialogType] || null;
	}

	/**
	 * Check if dialog type should use the new Win.json asset
	 */
	private shouldUseWinAsset(dialogType: string): boolean {
		// These dialog types all share the common Win.json spine asset
		// including Congrats_KA which should now use the "congrats" animations
		// from the Win spine instead of its legacy Congrats_KA-specific spine.
		return [
			'SmallW_KA',
			'MediumW_KA',
			'LargeW_KA',
			'SuperW_KA',
			'FreeSpinDialog_KA',
			'Congrats_KA'
		].includes(dialogType);
	}

	/**
	 * Create the main dialog content (FreeSpinDialog_KA, LargeW_KA, etc.)
	 */
	private createDialogContent(scene: Scene, config: DialogConfig): void {
		// Clean up existing dialog
		if (this.currentDialog) {
			this.currentDialog.destroy();
			this.currentDialog = null;
		}

		// Max Win drawer is a separate container (not currentDialog). Always clear it
		// before opening any other dialog so a prior MaxWin close cannot bleed through.
		if (config.type !== 'MaxWin') {
			this.destroyMaxWinDialogContent();
		}

		if (config.type === 'MaxWin') {
			this.destroyMaxWinDialogContent();
			this.createMaxWinDialogContent(scene, config);
			return;
		}

		const position = config.position || this.getDialogPosition(config.type, scene);
		const scale = config.scale || this.getDialogScale(config.type);
		this.lastDialogScale = scale;
		
		// Create Spine animation for the dialog
		try {
			// Check if we should use the new Win.json asset
			const useWinAsset = this.shouldUseWinAsset(config.type);
			const assetKey = useWinAsset ? 'Win' : config.type;
			const atlasKey = useWinAsset ? 'Win-atlas' : `${config.type}-atlas`;
			
			console.log(`[Dialogs] Creating Spine animation for dialog: ${config.type}`);
			console.log(`[Dialogs] Using asset: ${assetKey}, atlas: ${atlasKey}`);
			
			this.currentDialog = scene.add.spine(
				position.x,
				position.y,
				assetKey,
				atlasKey
			);
			this.currentDialog.setOrigin(0.5, 0.5);
			// Set the base scale *before* we trigger any pop tweens.
			// If we do this after applyDialogScalePop, it overrides the tween's
			// starting scale of 0 and the pop animation can appear to be skipped.
			this.currentDialog.setScale(scale);
			
			// Get animation names based on dialog type
			const shouldLoop = this.getDialogLoop(config.type);
			
			if (useWinAsset) {
				// Use new Win.json animation names
				const animations = this.getAnimationNameForDialogType(config.type);
				if (animations) {
					try {
						if (this.disableIntroAnimations) {
							console.log(`[Dialogs] Intro disabled for dialog ${config.type}, starting idle with pop: ${animations.idle}`);
							this.currentDialog.animationState.setAnimation(0, animations.idle, shouldLoop);
							this.applyDialogScalePop(scene);
						} else {
							console.log(`[Dialogs] Playing intro animation: ${animations.intro}`);
							this.currentDialog.animationState.setAnimation(0, animations.intro, false);
							this.currentDialog.animationState.addAnimation(0, animations.idle, shouldLoop, 0);
							this.applyDialogScalePop(scene);
						}
					} catch (error) {
						console.log(`[Dialogs] Intro/idle animation failed, falling back to idle with pop: ${animations.idle}`);
						// Fallback to idle animation if something goes wrong
						this.currentDialog.animationState.setAnimation(0, animations.idle, shouldLoop);
						this.applyDialogScalePop(scene);
					}
				} else {
					console.error(`[Dialogs] No animation mapping found for dialog type: ${config.type}`);
					return;
				}
			} else {
				// Use old animation format for other dialogs that still rely on the
				// "{spine-keyname}_win" / "{spine-keyname}_idle" naming convention.
				// We also apply the same pop-in effect so these dialogs visually
				// match the new Win.json-based dialogs.
				try {
					if (this.disableIntroAnimations) {
						console.log(`[Dialogs] (legacy) Intro disabled for dialog ${config.type}, starting idle with pop: ${config.type}_idle`);
						this.currentDialog.animationState.setAnimation(0, `${config.type}_idle`, shouldLoop);
						this.applyDialogScalePop(scene);
					} else {
						console.log(`[Dialogs] Playing legacy intro animation: ${config.type}_win`);
						this.currentDialog.animationState.setAnimation(0, `${config.type}_win`, false);
						this.currentDialog.animationState.addAnimation(0, `${config.type}_idle`, shouldLoop, 0);
						this.applyDialogScalePop(scene);
					}
				} catch (error) {
					console.log(`[Dialogs] Legacy intro animation failed, falling back to idle with pop: ${config.type}_idle`);
					// Fallback to idle animation if intro is missing
					this.currentDialog.animationState.setAnimation(0, `${config.type}_idle`, shouldLoop);
					this.applyDialogScalePop(scene);
				}
			}
		} catch (error) {
			console.error(`[Dialogs] Error creating dialog content: ${config.type}`, error);
			console.error(`[Dialogs] This might be due to missing assets for ${config.type}`);
			return;
		}
		
		this.currentDialog.setDepth(101);
		
		// Add to dialog content container
		this.dialogContentContainer.add(this.currentDialog);
		
		console.log(`[Dialogs] Created dialog content: ${config.type}`);
	}

	/**
	 * Set up auto-close timer for win dialogs during autoplay or when scatter is hit
	 */
	private setupAutoCloseTimer(scene: Scene): void {
		// Clear any existing timer
		if (this.autoCloseTimer) {
			this.autoCloseTimer.destroy();
			this.autoCloseTimer = null;
		}

		// MaxWin requires manual dismiss — never auto-close (autoplay waits for the player).
		if (this.currentDialogType === 'MaxWin') {
			console.log('[Dialogs] MaxWin dialog — no auto-close; manual dismiss only');
			return;
		}

		// FreeSpin trigger/retrigger dialog: auto-close after 5s in EVERY mode (base, bonus, replay)
		// so the bonus begins without requiring a tap and the flow never stalls. Mirrors the MaxWin
		// drawer above and the FreeSpin auto-close in grave_threat / beelze_bop.
		if (this.currentDialogType === 'FreeSpinDialog_KA') {
			this.autoCloseTimer = scene.time.delayedCall(5000, () => {
				this.handleDialogClick(scene, true);
			});
			return;
		}

		if (this.isWinDialog()) {
			this.scheduleWinTierAutoClose(scene);
		}
	}

	/** Tier win dialogs (not MaxWin): auto-close after WIN_DIALOG_AUTO_CLOSE_MS. */
	private scheduleWinTierAutoClose(scene: Scene): void {
		if (!this.isWinDialog()) {
			return;
		}
		if (this.autoCloseTimer) {
			this.autoCloseTimer.destroy();
			this.autoCloseTimer = null;
		}
		let delayMs = WIN_DIALOG_AUTO_CLOSE_MS;
		if (this.isStagedWinNumberAnimation && this.stagedWinStages.length > 1) {
			const perStageDwellMs = 2000;
			delayMs = Math.max(WIN_DIALOG_AUTO_CLOSE_MS, perStageDwellMs * this.stagedWinStages.length + 1500);
		}
		delayMs = Math.max(delayMs, DIALOG_MIN_CLOSE_DELAY_MS);
		console.log(`[Dialogs] Win dialog auto-close scheduled in ${delayMs}ms`);
		this.autoCloseTimer = scene.time.delayedCall(delayMs, () => {
			this.handleDialogClick(scene, true);
		});
	}


	/**
	 * Create the "Press anywhere to continue" text.
	 * Text wraps dynamically; origin is top-center so the top-most line stays fixed when it wraps.
	 */
	private createContinueText(scene: Scene): void {
		console.log('[Dialogs] Creating continue text for dialog type:', this.currentDialogType);
		
		// Clean up existing text
		if (this.continueText) {
			this.continueText.destroy();
			this.continueText = null;
		}
		
		const wrapWidth = Math.max(200, scene.scale.width * 0.9);
		const continueStr = localizationManager.getTextByKey(DIALOG_PRESS_CONTINUE) ?? LOCALIZATION_DEFAULTS[DIALOG_PRESS_CONTINUE] ?? DIALOG_PRESS_CONTINUE;
		// Create the text with word wrap so long localized strings wrap downward
		this.continueText = scene.add.text(
			scene.scale.width / 2,
			scene.scale.height / 2 + 300,
			continueStr,
			{
				fontFamily: 'Poppins-Bold',
				fontSize: '20px',
				color: '#FFFFFF',
				stroke: '#379557',
				strokeThickness: 5,
				align: 'center',
				shadow: {
					offsetX: 2,
					offsetY: 2,
					color: '#000000',
					blur: 4,
					fill: true
				},
				wordWrap: { width: wrapWidth, useAdvancedWrap: true }
			}
		);
		
		// Top-center origin so when text wraps, the top line stays in the same position
		this.continueText.setOrigin(0.5, 0);
		this.continueText.setDepth(104);
		this.continueText.setAlpha(0); // Start invisible
		
		// Add to dialog overlay
		this.dialogOverlay.add(this.continueText);
		
		// Fade in the text after 1.5 seconds (reduced from 4.5 seconds)
		scene.tweens.add({
			targets: this.continueText,
			alpha: 1,
			duration: 500,
			delay: 1500,
			ease: 'Power2',
			onComplete: () => {
				console.log('[Dialogs] Continue text fade-in complete');
			}
		});
		
		console.log('[Dialogs] Created continue text with original styling');
	}

	/**
	 * Keep primary win/total number within screen bounds (oppals-style auto-fit).
	 */
	private refreshNumberDisplayLayout(scene: Scene): void {
		if (!this.numberDisplay) {
			return;
		}

		this.numberDisplay.setPosition(
			scene.scale.width / 2,
			this.getNumberDisplayY(scene, this.currentDialogType)
		);

		const maxWidth = Math.max(1, scene.scale.width * 0.88);
		const maxHeight = Math.max(1, scene.scale.height * 0.16);
		this.numberDisplay.updateConfig({
			autoFit: true,
			maxWidth,
			maxHeight,
		});
	}

	/**
	 * Create number display for win amounts
	 */
	private createNumberDisplay(scene: Scene, winAmount: number, freeSpins?: number): void {
		// Clean up existing number display
		if (this.numberDisplayContainer) {
			this.numberDisplayContainer.destroy();
			this.numberDisplayContainer = null;
		}
		
		// Determine if this is the Congrats dialog showing a total win amount
		const isCongratsTotalWin = this.currentDialogType === 'Congrats_KA' && freeSpins === undefined;
		const isDemo = (scene as any).gameAPI?.getDemoState();

		const maxWidth = Math.max(1, scene.scale.width * 0.88);
		const maxHeight = Math.max(1, scene.scale.height * 0.16);

		// Create number display configuration (win amount uses precision formatter)
		const numberConfig: NumberDisplayConfig = {
			x: scene.scale.width / 2,
			y: this.getNumberDisplayY(scene, this.currentDialogType),
			scale: 0.65,
			spacing: 0,
			alignment: 'center',
			decimalPlaces: freeSpins !== undefined ? 0 : 2, // No decimals for free spins
			showCommas: freeSpins !== undefined ? false : true, // No commas for free spins
			// For Congrats dialog totals, show a dollar sign prefix.
			// Other dialogs remain unchanged.
			prefix: isCongratsTotalWin ? (isDemo ? '' : CurrencyManager.getCurrencyCode()) : '',
			suffix: '', // No suffix - only display numbers
			commaYOffset: 12,
			dotYOffset: 10,
			autoFit: true,
			maxWidth,
			maxHeight,
			...(freeSpins === undefined && { formatValue: (n) => formatCurrencyNumber(n) })
		};

		// Create the number display (primary win amount / free spins, depending on dialog)
		const numberDisplay = new NumberDisplay(this.networkManager, this.screenModeManager, numberConfig);
		numberDisplay.create(scene);
		// Display free spins if provided, otherwise display win amount
		const displayValue = freeSpins !== undefined ? freeSpins : winAmount;
		// Start from 0 (or current) and animate on fade-in
		numberDisplay.displayValue(0);
		this.numberDisplay = numberDisplay;
		this.numberTargetValue = displayValue;

		// Create container for number display
		this.numberDisplayContainer = scene.add.container(0, 0);
		this.numberDisplayContainer.setDepth(103);
		this.numberDisplayContainer.add(numberDisplay.getContainer());
		this.refreshNumberDisplayLayout(scene);
		
		// Start with alpha 0 (invisible) - will be faded in after delay
		this.numberDisplayContainer.setAlpha(0);
		
		// Add to dialog overlay
		this.dialogOverlay.add(this.numberDisplayContainer);
		
		console.log('[Dialogs] Created number display');
	}

	/**
	 * Create secondary number display for congrats dialog (free spins used)
	 */
	private createCongratsFreeSpinsDisplay(scene: Scene, freeSpins: number): void {
		// Clean up existing secondary display
		if (this.congratsFreeSpinsContainer) {
			this.congratsFreeSpinsContainer.destroy();
			this.congratsFreeSpinsContainer = null;
		}

		// Only applicable to Congrats dialog
		if (this.currentDialogType !== 'Congrats_KA') {
			return;
		}

		const numberConfig: NumberDisplayConfig = {
			x: scene.scale.width / 2 - 50,
			// Place slightly below the main total win display
			y: this.getNumberDisplayY(scene, this.currentDialogType) + 70,
			scale: 0.3,
			spacing: 0,
			alignment: 'center',
			decimalPlaces: 0,
			showCommas: false,
			prefix: '',
			suffix: '',
			commaYOffset: 12,
			dotYOffset: 10
		};

		const fsDisplay = new NumberDisplay(this.networkManager, this.screenModeManager, numberConfig);
		fsDisplay.create(scene);
		fsDisplay.displayValue(freeSpins);

		this.congratsFreeSpinsDisplay = fsDisplay;

		this.congratsFreeSpinsContainer = scene.add.container(0, 0);
		this.congratsFreeSpinsContainer.setDepth(103);
		this.congratsFreeSpinsContainer.add(fsDisplay.getContainer());

		// Start hidden; will be revealed alongside primary number
		this.congratsFreeSpinsContainer.setAlpha(0);
		this.dialogOverlay.add(this.congratsFreeSpinsContainer);

		console.log('[Dialogs] Created congrats free spins display:', freeSpins);
	}
	
	/**
	 * Compute number display Y based on dialog type with per-group overrides.
	 */
	private getNumberDisplayY(scene: Scene, dialogType: string | null): number {
		const defaultY = scene.scale.height / 2 - 50;
		if (!dialogType) return defaultY;
		
		if (dialogType === 'FreeSpinDialog_KA') {
			return this.numberYFreeSpin ?? defaultY;
		}
		
		if (dialogType === 'Congrats_KA') {
			return this.numberYCongrats ?? defaultY;
		}
		
		if (this.isWinDialogType(dialogType)) {
			return this.numberYWin ?? defaultY;
		}
		
		return defaultY;
	}
	
	/**
	 * Helper: determine if a type is one of the win dialogs.
	 */
	private isWinDialogType(type: string): boolean {
		return type === 'SmallW_KA' || type === 'MediumW_KA' || type === 'LargeW_KA' || type === 'SuperW_KA';
	}

	/** Delay before click / SPACE can skip or close (manual input only; auto-close is separate). */
	private getManualDismissDelayMs(dialogType: string | null): number {
		if (!dialogType) {
			return DIALOG_MANUAL_DISMISS_DELAY_MS_SUMMARY;
		}
		if (this.isWinDialogType(dialogType)) {
			return Math.max(DIALOG_MANUAL_DISMISS_DELAY_MS_WIN_TIERS, DIALOG_MIN_CLOSE_DELAY_MS);
		}
		if (dialogType === 'Congrats_KA' || dialogType === 'MaxWin') {
			return Math.max(DIALOG_MANUAL_DISMISS_DELAY_MS_SUMMARY, DIALOG_MIN_CLOSE_DELAY_MS);
		}
		if (dialogType === 'FreeSpinDialog_KA') {
			return DIALOG_MANUAL_DISMISS_DELAY_MS_SUMMARY;
		}
		return DIALOG_MANUAL_DISMISS_DELAY_MS_SUMMARY;
	}

	private canAcceptManualDismiss(): boolean {
		if (!this.isDialogActive || !this.currentDialogType) {
			return false;
		}
		const elapsed = Date.now() - this.dialogShownAtMs;
		return elapsed >= this.getManualDismissDelayMs(this.currentDialogType);
	}
	
	/**
	 * Public setters to configure number display Y positions per group at runtime.
	 */
	setNumberDisplayYForWin(y: number): void { this.numberYWin = y; }
	setNumberDisplayYForFreeSpin(y: number): void { this.numberYFreeSpin = y; }
	setNumberDisplayYForCongrats(y: number): void { this.numberYCongrats = y; }
	setNumberDisplayYPositions(opts: { win?: number; freeSpin?: number; congrats?: number }): void {
		if (opts.win !== undefined) this.numberYWin = opts.win;
		if (opts.freeSpin !== undefined) this.numberYFreeSpin = opts.freeSpin;
		if (opts.congrats !== undefined) this.numberYCongrats = opts.congrats;
	}
	
	/**
	 * Fade in the number display with animation
	 */
	private fadeInNumberDisplay(scene: Scene): void {
		console.log('[Dialogs] fadeInNumberDisplay called');
		
		if (this.numberDisplayContainer) {
			console.log('[Dialogs] Popping in primary number display');
			
			// Make container visible immediately (no fade)
			this.numberDisplayContainer.setAlpha(1);
			
			// Pop the inner number container so position remains anchored
			const inner = this.numberDisplay?.getContainer();
			if (inner) {
				inner.setScale(0);
				
				// Start counting up as the pop begins
				if (this.isStagedWinNumberAnimation && this.stagedWinStages.length > 0) {
					this.startStagedWinNumberSequence(scene);
				} else if (this.numberDisplay) {
					this.numberDisplay.animateToValue(this.numberTargetValue, {
						duration: 1500,
						ease: 'Power2',
						startFromCurrent: false
					});
				}
				if (this.isWinDialog()) {
					this.scheduleWinTierAutoClose(scene);
				}
				
				scene.tweens.add({
					targets: inner,
					scale: 1.08,
					duration: 400,
					ease: 'Back.Out',
					onComplete: () => {
						scene.tweens.add({
							targets: inner,
							scale: 1.0,
							duration: 180,
							ease: 'Power2',
							onComplete: () => {
								console.log('[Dialogs] Primary number display pop-in complete');
							}
						});
					}
				});
			} else {
				console.warn('[Dialogs] No inner primary number container found for pop animation');
			}
		} else {
			console.error('[Dialogs] numberDisplayContainer is null, cannot fade in');
		}

		// If a secondary congrats free spins display exists, pop it in too (no counting animation)
		if (this.congratsFreeSpinsContainer && this.congratsFreeSpinsDisplay) {
			console.log('[Dialogs] Popping in congrats free spins display');
			this.congratsFreeSpinsContainer.setAlpha(1);
			const innerFs = this.congratsFreeSpinsDisplay.getContainer();
			if (innerFs) {
				innerFs.setScale(0);
				scene.tweens.add({
					targets: innerFs,
					scale: 1.0,
					duration: 350,
					ease: 'Back.Out'
				});
			}
		}
	}

	/**
	 * Handle dialog click event.
	 *
	 * fromAutoClose:
	 *  - false: user clicked "press anywhere to continue"
	 *  - true:  internal auto-close timer fired (autoplay / scatter / retrigger)
	 */
	private handleDialogClick(scene: Scene, fromAutoClose: boolean = false): void {
		console.log('[Dialogs] Dialog clicked, starting fade-out sequence. fromAutoClose =', fromAutoClose);

		// Re-entry guard: once the dialog has begun its close sequence (isDialogActive flipped
		// false inside disableAllWinDialogElements), every subsequent entry must be a no-op so
		// WIN_DIALOG_CLOSING isn't emitted twice for a single dialog instance. Possible re-entry
		// paths: user click landing on the same frame the auto-close timer fires, or any other
		// queued "skip" path racing the in-flight close.
		if (!this.isDialogActive) {
			return;
		}

		if (!fromAutoClose && !this.canAcceptManualDismiss()) {
			console.log('[Dialogs] Manual dismiss ignored — still within per-dialog input delay');
			return;
		}

		// Clear auto-close timer if it exists (prevents double-triggering)
		if (this.autoCloseTimer) {
			this.autoCloseTimer.destroy();
			this.autoCloseTimer = null;
			console.log('[Dialogs] Auto-close timer cleared due to manual/auto close');
		}

		// When a staged win sequence is running (Big -> Mega -> Epic -> Super),
		// a MANUAL click should behave like "skip to next win animation":
		//  - Stop the current staged tier
		//  - Immediately jump to the next tier's animation (if any)
		//  - Start the number display from the previous tier's threshold (we use
		//    startFromCurrent in the NumberDisplay to preserve continuity)
		//
		// If there is NO next staged tier, we fall through to the normal
		// "close dialog" behavior so the win dialog ends.
		if (!fromAutoClose && this.isWinDialog() && this.stagedWinStages.length > 0) {
			const lastIndex = this.stagedWinStages.length - 1;
			const nextIndex = Math.min(this.stagedWinCurrentStageIndex + 1, lastIndex);
			const hasNextStage = nextIndex > this.stagedWinCurrentStageIndex;
			
			if (hasNextStage) {
				console.log('[Dialogs] Manual click during staged win - skipping to next staged tier index:', nextIndex);
				this.skipToStagedWinStage(scene, nextIndex);
				// Do NOT close the dialog here; the player now sees the next tier.
				return;
			}

			console.log('[Dialogs] Manual click during staged win - already at final tier, closing dialog normally');
		}
		
		// Important: WIN_DIALOG_CLOSED is emitted after fade-out completes.
		// For UI that must update *before* the fade (e.g., controller cool-down lock),
		// emit WIN_DIALOG_CLOSING only for TotalWin-equivalent dialogs (see porting guide).
		// Congrats_KA = bonus-end total-win summary (TotalWin). SuperW_KA and lower tiers
		// are regular win dialogs — no post-close controller cool-down.
		if (this.currentDialogType === 'Congrats_KA' || this.currentDialogType === 'MaxWin') {
			try {
				gameEventManager.emit(GameEventType.WIN_DIALOG_CLOSING, { dialogType: this.currentDialogType });
			} catch { }
		}

		// Start the fade-out sequence first (while isDialogActive is still true)
		this.startFadeOutSequence(scene);

		// Apply the same reset logic that happens when a new spin is triggered,
		// but ONLY for win dialogs. For non-win dialogs (e.g. FreeSpin / Congrats),
		// we must preserve the win queue so that any deferred win dialogs (such as
		// those queued during scatter + autoplay) can still be processed once the
		// non-win dialog finishes.
		if (this.isWinDialog()) {
			this.resetGameStateForNewSpin(scene);
		}
		
		// Note: WIN_DIALOG_CLOSED event will be emitted when fade-out completes
		// This prevents double emission of the event
	}

	/**
	 * Immediately disable all win dialog elements when clicked
	 */
	private disableAllWinDialogElements(): void {
		console.log('[Dialogs] Disabling all win dialog elements immediately');
		
		// Disable click area to prevent multiple clicks
		if (this.clickArea) {
			this.clickArea.disableInteractive();
			console.log('[Dialogs] Click area disabled');
		}
		
		// Hide black overlay immediately
		if (this.blackOverlay) {
			this.blackOverlay.setVisible(false);
			this.blackOverlay.setAlpha(0);
			console.log('[Dialogs] Black overlay hidden and alpha set to 0');
		}
		
		// Hide current dialog immediately
		if (this.currentDialog) {
			this.currentDialog.setVisible(false);
			this.currentDialog.setAlpha(0);
			console.log('[Dialogs] Current dialog hidden and alpha set to 0');
			
			// Stop Spine animation if it exists
			if (this.currentDialog.animationState) {
				this.currentDialog.animationState.clearTracks();
				console.log('[Dialogs] Current dialog Spine animation cleared');
			}
		}

		if (this.maxWinRoot) {
			this.maxWinRoot.setVisible(false);
			this.maxWinRoot.setAlpha(0);
		}
		
		// Hide continue text immediately
		if (this.continueText) {
			this.continueText.setVisible(false);
			console.log('[Dialogs] Continue text hidden');
		}
		
		// Hide number display immediately
		if (this.numberDisplayContainer) {
			this.numberDisplayContainer.setVisible(false);
			console.log('[Dialogs] Number display hidden');
		}

		// Hide secondary congrats free spins display immediately
		if (this.congratsFreeSpinsContainer) {
			this.congratsFreeSpinsContainer.setVisible(false);
			console.log('[Dialogs] Congrats free spins display hidden');
		}
		
		// Hide the entire dialog overlay container
		if (this.dialogOverlay) {
			this.dialogOverlay.setVisible(false);
			this.dialogOverlay.setAlpha(0);
			console.log('[Dialogs] Dialog overlay container hidden and alpha set to 0');
		}
		
		// Set dialog as inactive immediately
		this.isDialogActive = false;
		console.log('[Dialogs] Dialog marked as inactive');
		
		console.log('[Dialogs] All win dialog elements disabled successfully');
	}

	/**
	 * Reset game state for new spin (same logic as when spin is triggered)
	 */
	private resetGameStateForNewSpin(scene: Scene): void {
		console.log('[Dialogs] Resetting game state for new spin (manual dialog close)');
		
		// Get the Game scene to access its methods
		const gameScene = scene as any; // Cast to access Game scene methods
		
		// Clear win queue if the method exists
		if (gameScene.clearWinQueue && typeof gameScene.clearWinQueue === 'function') {
			gameScene.clearWinQueue();
			console.log('[Dialogs] Cleared win queue for manual dialog close');
		}
		
		// Reset win dialog state
		gameStateManager.isShowingWinDialog = false;
		console.log('[Dialogs] Reset isShowingWinDialog to false for manual dialog close');
		
		// Reset winlines tracking if the property exists
		if (gameScene.hasWinlinesThisSpin !== undefined) {
			gameScene.hasWinlinesThisSpin = false;
			console.log('[Dialogs] Reset hasWinlinesThisSpin to false for manual dialog close');
		}
		
		// Reset win line drawer interrupted flag if symbols exist
		if (gameScene.symbols && gameScene.symbols.winLineDrawer && 
			gameScene.symbols.winLineDrawer.resetInterruptedFlag) {
			gameScene.symbols.winLineDrawer.resetInterruptedFlag();
			console.log('[Dialogs] Reset win line drawer interrupted flag for manual dialog close');
		}
		
		// NOTE: Do NOT call ensureCleanSymbolState() here as it immediately clears winning symbols
		// The winning symbols should remain visible until the next spin starts
		// The actual symbol reset will happen when the next spin is triggered
		console.log('[Dialogs] Preserving winning symbols visibility until next spin starts');
		
		console.log('[Dialogs] Game state reset complete for manual dialog close');
	}

	/**
	 * Create the click handler for the dialog
	 */
	private createClickHandler(scene: Scene): void {
		if (this.currentDialogType === 'MaxWin') {
			return;
		}
		// Create a clickable area that covers the entire dialog
		this.clickArea = scene.add.rectangle(
			scene.scale.width * 0.5,
			scene.scale.height * 0.5,
			scene.scale.width,
			scene.scale.height,
			0x000000,
			0
		);
		
		this.clickArea.setOrigin(0.5);
		this.clickArea.setDepth(105);
		this.clickArea.setInteractive();
		
		// Add to dialog overlay
		this.dialogOverlay.add(this.clickArea);

		const dismissDelayMs = this.getManualDismissDelayMs(this.currentDialogType);
		console.log(
			`[Dialogs] Binding click dismiss for ${this.currentDialogType} after ${dismissDelayMs}ms`
		);
		scene.time.delayedCall(dismissDelayMs, () => {
			if (!this.clickArea || !this.isDialogActive) {
				return;
			}
			this.clickArea.on('pointerdown', () => {
				this.handleDialogClick(scene);
			});
			console.log('[Dialogs] Click handler enabled for dialog');
		});
		
		console.log('[Dialogs] Click handler created for dialog');
	}


	/**
	 * Start the centralized transition when dialog is clicked
	 */
	private startFadeOutSequence(scene: Scene): void {
		console.log('[Dialogs] startFadeOutSequence called, isDialogActive:', this.isDialogActive, 'currentDialogType:', this.currentDialogType);
		
		if (!this.isDialogActive) {
			console.log('[Dialogs] Dialog not active, skipping fade-out sequence');
			return;
		}
		
		// Check if this is a win dialog - handle differently than free spin dialog
		if (this.isWinDialog()) {
			console.log('[Dialogs] Win dialog clicked - starting direct fade-out sequence');
			// Disable dialog elements for win dialogs
			this.disableAllWinDialogElements();
			this.startWinDialogFadeOut(scene);
			return;
		}
		
		// Check if this is a free spin dialog - use candy transition
		if (this.currentDialogType === 'FreeSpinDialog_KA') {
			// On retrigger, skip candy transition, use normal transition to avoid extra animation
			if (this.isRetriggerFreeSpin) {
				console.log('[Dialogs] Free spin dialog (retrigger) clicked - skipping all transitions and disabling immediately');
				// Immediately disable/hide everything similar to win dialog handling
				this.disableAllWinDialogElements();
				// Fully cleanup dialog elements
				this.cleanupDialog();
				// Clear scatter state BEFORE dialog completion so that any queued
				// win dialogs from the retrigger spin are not indefinitely deferred
				// by the "scatter + autoplay" check inside Game.checkAndShowWinDialog.
				try {
					gameStateManager.isScatter = false;
					console.log('[Dialogs] Retrigger FreeSpinDialog - cleared isScatter before dialogAnimationsComplete');
				} catch {}
				// Re-enable symbols immediately (match win dialog behavior)
				try {
					scene.events.emit('enableSymbols');
				} catch {}
				// Notify listeners that dialog animations are complete so retrigger flow can continue
				try {
					scene.events.emit('dialogAnimationsComplete');
				} catch {}
				// Restore background music volume if it was ducked
				try {
					const audioManager = (window as any).audioManager;
					if (audioManager && typeof audioManager.restoreBackground === 'function') {
						audioManager.restoreBackground();
					}
				} catch {}
				return;
			}
			console.log('[Dialogs] Free spin dialog clicked - starting candy transition');
			// Don't disable dialog elements yet for free spin dialogs - let candy transition handle it
			this.startCandyTransition(scene);
			return;
		}
		
		// Use normal transition for other dialogs
		console.log('[Dialogs] Other dialog type - starting normal transition');
		// Disable dialog elements for other dialogs
		this.disableAllWinDialogElements();
		this.startNormalTransition(scene);
	}

	/**
	 * Check if the current dialog is a win dialog
	 */
	private isWinDialog(): boolean {
		return this.currentDialogType === 'SmallW_KA' ||
			   this.currentDialogType === 'MediumW_KA' ||
			   this.currentDialogType === 'LargeW_KA' ||
			   this.currentDialogType === 'SuperW_KA';
	}

	/** True while the FreeSpin trigger/retrigger dialog is on screen (for max-win defer gating). */
	public isFreeSpinDialogShowing(): boolean {
		return this.isDialogActive && this.currentDialogType === 'FreeSpinDialog_KA';
	}
	
	/**
	 * Start candy transition for free spin dialog
	 */
	private startCandyTransition(scene: Scene): void {
		if (!this.candyTransition) {
			console.warn('[Dialogs] Candy transition not available, falling back to normal transition');
			this.startNormalTransition(scene);
			return;
		}

		console.log('[Dialogs] Starting candy transition for free spin dialog');

		// Disable spinner immediately when transition starts
		scene.events.emit('disableSpinner');

		// Start transition animation
		this.candyTransition.show();

		// Hide dialog content and switch to bonus visuals after a short delay,
		// giving the symbol explosion time to cover the screen first.
		scene.time.delayedCall(900, () => {
			try {
				const audioManager = (window as any).audioManager;
				if (audioManager && typeof audioManager.fadeOutSfx === 'function') {
					audioManager.fadeOutSfx('dialog_congrats', 400);
				}
				// Stop free spin music when dialog closes - bonus music will start when background changes
				if (audioManager && typeof audioManager.stopCurrentMusic === 'function') {
					audioManager.stopCurrentMusic();
					console.log('[Dialogs] Stopped free spin music as dialog closes');
				}
			} catch {}
			this.disableAllWinDialogElements();
			this.cleanupDialog();
			
			// Apply bonus mode visuals once the dialog is closed, slightly after
			// the explosion has covered the screen for a smoother transition
			this.triggerBonusMode(scene);
		});

		// Attempt to restrict explosion symbols to those currently visible on the grid
		let allowedSymbols: number[] | undefined;
		try {
			const gameSceneAny: any = scene as any;
			const symbolsComponent = gameSceneAny?.symbols;
			const grid: any = symbolsComponent?.currentSymbolData;
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
			// If anything goes wrong, simply fall back to all available symbols.
		}

		this.candyTransition.play(() => {
			// Emit dialog animations complete event after transition
			scene.events.emit('dialogAnimationsComplete');

			// Restore background music volume
			try {
				const audioManager = (window as any).audioManager;
				if (audioManager && typeof audioManager.restoreBackground === 'function') {
					audioManager.restoreBackground();
				}
			} catch {}
		}, { allowedSymbols });
	}

	/**
	 * Start iris transition for free spin dialog
	 */
	private startIrisTransition(scene: Scene): void {
		if (!this.irisTransition) {
			console.warn('[Dialogs] Iris transition not available, falling back to normal transition');
			this.startNormalTransition(scene);
			return;
		}
		
		console.log('[Dialogs] Starting iris transition for free spin dialog');
		
		// Store the dialog type before cleanup for bonus mode check
		const dialogTypeBeforeCleanup = this.currentDialogType;
		
		// Disable spinner immediately when iris transition starts
		scene.events.emit('disableSpinner');
		console.log('[Dialogs] Spinner disabled during iris transition');
		
		// Show iris transition overlay
		this.irisTransition.show();
		
		// Start iris transition - zoom in to small radius (closing iris effect)
		this.irisTransition.zoomInToRadius(28, 1500); // Fast transition to 28px radius
		
		// Hide dialog content quickly after iris starts closing (200ms delay)
		scene.time.delayedCall(200, () => {
			console.log('[Dialogs] Hiding dialog content quickly for better iris visibility');
			// Fade out FreeSpin dialog SFX if playing
			try {
				const audioManager = (window as any).audioManager;
				if (audioManager && typeof audioManager.fadeOutSfx === 'function') {
					audioManager.fadeOutSfx('dialog_congrats', 400);
				}
			} catch {}
			// Disable dialog elements before cleanup
			this.disableAllWinDialogElements();
			this.cleanupDialog();
		});
		
		// Wait for iris transition to complete, then proceed
		scene.time.delayedCall(1500, () => {
			console.log('[Dialogs] Iris closed - triggering bonus mode');
			
			// Stop free spin music when dialog closes - bonus music will start when background changes
			try {
				const audioManager = (window as any).audioManager;
				if (audioManager && typeof audioManager.stopCurrentMusic === 'function') {
					audioManager.stopCurrentMusic();
					console.log('[Dialogs] Stopped free spin music as dialog closes (iris transition)');
				}
			} catch {}
			
			// Trigger bonus mode during closed iris
			console.log('[Dialogs] Triggering bonus mode during closed iris');
			this.triggerBonusMode(scene);
			
			// Wait 0.5 seconds, then open iris (zoom out) - faster for better flow
			scene.time.delayedCall(500, () => {
				console.log('[Dialogs] Opening iris transition');
				this.irisTransition!.zoomInToRadius(1000, 1500); // Open iris to full size
				
				// Clean up after iris opens
				scene.time.delayedCall(1500, () => {
					console.log('[Dialogs] Iris transition complete');
					// Hide the iris transition overlay
					this.irisTransition!.hide();
					
					// Emit dialog animations complete event AFTER the full iris transition completes
					scene.events.emit('dialogAnimationsComplete');
					console.log('[Dialogs] Dialog animations complete event emitted after full iris transition');
					// Restore background music volume after dialog completes
					try {
						const audioManager = (window as any).audioManager;
						if (audioManager && typeof audioManager.restoreBackground === 'function') {
							audioManager.restoreBackground();
						}
					} catch {}
				});
			});
		});
	}
	
	/**
	 * Start normal black screen transition for non-free spin dialogs
	 */
	private startNormalTransition(scene: Scene): void {
		console.log('[Dialogs] Starting normal black screen transition');
		
		
		// Store the dialog type before cleanup for bonus mode check
		const dialogTypeBeforeCleanup = this.currentDialogType;

		if (dialogTypeBeforeCleanup === 'Congrats_KA' || dialogTypeBeforeCleanup === 'MaxWin') {
			try { scene.events.emit('bonusEndTransitionStart'); } catch {}
		}
		
		// Create centralized black screen overlay
		const blackScreen = scene.add.graphics();
		blackScreen.setDepth(10000); // Very high depth to cover everything
		blackScreen.fillStyle(0x000000, 1);
		blackScreen.fillRect(0, 0, scene.scale.width, scene.scale.height);
		blackScreen.setAlpha(0); // Start transparent
		
		// Disable spinner immediately when black screen starts fading in
		scene.events.emit('disableSpinner');
		console.log('[Dialogs] Spinner disabled during transition');
		
		// Fade in black screen
		scene.tweens.add({
			targets: blackScreen,
			alpha: 1,
			duration: 300,
			ease: 'Power2',
			onComplete: () => {
				console.log('[Dialogs] Black screen fade-in complete');
				
				// Hide dialog immediately while screen is black
				this.cleanupDialog();

				// Check if we need to trigger bonus mode while screen is black
				if (dialogTypeBeforeCleanup === 'FreeSpinDialog_KA') {
					console.log('[Dialogs] Triggering bonus mode during black screen');
					this.triggerBonusMode(scene);

					// If this FreeSpinDialog was a retrigger, remove black screen immediately
					// so that the next win dialog can appear without delay
					if (this.isRetriggerFreeSpin) {
						console.log('[Dialogs] Retrigger FreeSpinDialog - removing black screen immediately for successive win dialog');
						try {
							const audioManager = (window as any).audioManager;
							if (audioManager && typeof audioManager.restoreBackground === 'function') {
								audioManager.restoreBackground();
							}
						} catch {}
						blackScreen.destroy();
						console.log('[Dialogs] Black screen removed immediately for retrigger flow');
						return;
					}
				} else {
					// If congrats closed while in bonus mode, revert to base visuals and reset symbols
					if (dialogTypeBeforeCleanup === 'Congrats_KA' || dialogTypeBeforeCleanup === 'MaxWin') {
						console.log('[Dialogs] Bonus summary dialog closed - reverting from bonus visuals to base');
						gameStateManager.isBonusExitTransitionActive = true;
						// Switch off bonus mode visuals and music
						scene.events.emit('setBonusMode', false);
						scene.events.emit('hideBonusBackground');
						scene.events.emit('hideBonusHeader');
						// Reset symbols/winlines state for base game
						scene.events.emit('resetSymbolsForBase');

						// Congrats only: re-finalize win sequence after bonus exit.
						// MaxWin must NOT re-emit WIN_STOP — spin data still has isMaxWin and Game.ts would reopen the drawer.
						if (dialogTypeBeforeCleanup === 'Congrats_KA') {
							try {
								gameEventManager.emit(GameEventType.WIN_STOP);
								console.log('[Dialogs] Emitted WIN_STOP at start of normal transition (Congrats only)');
							} catch {}
						}
					}
					// Re-enable symbols after transition completes (normal flow)
					scene.events.emit('enableSymbols');
					console.log('[Dialogs] Symbols re-enabled after transition');
				}
				
					// Emit dialog animations complete event for scatter bonus reset
					scene.events.emit('dialogAnimationsComplete');
				console.log('[Dialogs] Dialog animations complete event emitted');
					if (dialogTypeBeforeCleanup === 'MaxWin') {
						try {
							gameEventManager.emit(GameEventType.WIN_DIALOG_CLOSED, { dialogType: 'MaxWin' });
							console.log('[Dialogs] WIN_DIALOG_CLOSED emitted after MaxWin transition');
						} catch {}
					}
					// Restore background music volume after dialog completes
					try {
						const audioManager = (window as any).audioManager;
						if (audioManager && typeof audioManager.restoreBackground === 'function') {
							audioManager.restoreBackground();
						}
					} catch {}
				
				// Wait 0.7 seconds, then fade out
				scene.time.delayedCall(700, () => {
					scene.tweens.add({
						targets: blackScreen,
						alpha: 0,
						duration: 300,
						ease: 'Power2',
						onComplete: () => {
							// Clean up black screen
							blackScreen.destroy();
							
							// Ensure UI is back to normal only when congrats dialog closes
							if (dialogTypeBeforeCleanup === 'Congrats_KA' || dialogTypeBeforeCleanup === 'MaxWin') {
								console.log('[Dialogs] Black screen faded out after bonus summary - restoring normal background and header');
								scene.events.emit('hideBonusBackground');
								scene.events.emit('hideBonusHeader');
								gameStateManager.isBonusExitTransitionActive = false;
								try { scene.events.emit('bonusEndDialogClosed'); } catch {}
								scene.events.emit('bonusTransitionComplete');
							}
							
							console.log('[Dialogs] Black screen transition complete');
						}
					});
				});
			}
		});
	}

	/**
	 * Start direct fade-out sequence for win dialogs (no black overlay)
	 */
	private startWinDialogFadeOut(scene: Scene): void {
		console.log('[Dialogs] Starting win dialog direct fade-out');

		// Check if we should play outro animation before fading out
		const animations = this.currentDialogType ? this.getAnimationNameForDialogType(this.currentDialogType) : null;
		const hasOutro = animations && animations.outro;
		
		if (hasOutro && this.currentDialog && this.currentDialog.animationState) {
			console.log(`[Dialogs] Playing outro animation: ${animations.outro}`);
			try {
				// Play outro animation, then fade out after it completes
				this.currentDialog.animationState.setAnimation(0, animations.outro!, false);
				
				// Get animation duration (estimate 1 second if we can't get it)
				const outroTrack = this.currentDialog.animationState.getCurrent(0);
				const outroDuration = outroTrack?.animation?.duration ? outroTrack.animation.duration * 1000 : 0;
				
				// Wait for outro to complete, then start fade-out
				scene.time.delayedCall(outroDuration, () => {
					this.performWinDialogFadeOut(scene);
				});
				return; // Exit early, fade-out will happen after outro
			} catch (error) {
				console.warn(`[Dialogs] Failed to play outro animation, proceeding with fade-out:`, error);
				// Fall through to normal fade-out
			}
		}
		
		// No outro or outro failed, proceed with normal fade-out
		this.performWinDialogFadeOut(scene);
	}

	/**
	 * Perform the actual fade-out sequence for win dialogs
	 */
	private performWinDialogFadeOut(scene: Scene): void {
		// Fade out any currently playing win SFX
		try {
			const audioManager = (window as any).audioManager;
			if (audioManager && typeof audioManager.fadeOutCurrentWinSfx === 'function') {
				audioManager.fadeOutCurrentWinSfx(450);
			}
		} catch (e) {
			console.warn('[Dialogs] Failed to fade out win dialog SFX:', e);
		}
		
		// Keep the black overlay visible as background - don't hide it
		// The black overlay provides the dialog background for readability
		console.log('[Dialogs] Keeping black overlay visible as background for win dialog fade-out');
		
		// Re-enable symbols immediately for win dialays
		scene.events.emit('enableSymbols');
		console.log('[Dialogs] Symbols re-enabled for win dialog');
		
		// Collect all elements that need to fade out
		const fadeOutTargets: any[] = [];
		
		// Don't fade out the dialog overlay container - only fade out its contents
		// This prevents conflicts between container and child element fade-outs
		
		// Add black overlay if visible
		if (this.blackOverlay && this.blackOverlay.visible) {
			fadeOutTargets.push(this.blackOverlay);
			console.log('[Dialogs] Adding black overlay to fade-out targets');
		}
		
		// Add current dialog if it exists
		if (this.currentDialog) {
			// Don't add Spine animation to main fade-out targets - we'll control it manually
			// fadeOutTargets.push(this.currentDialog);
			console.log('[Dialogs] Current dialog found - will be controlled manually during fade-out');
			
			// Debug Spine animation properties
			if (this.currentDialog.animationState) {
				console.log('[Dialogs] Current dialog is Spine animation');
				console.log('[Dialogs] Current dialog alpha before fade-out:', this.currentDialog.alpha);
				console.log('[Dialogs] Current dialog visible:', this.currentDialog.visible);
				console.log('[Dialogs] Current dialog active animations:', this.currentDialog.animationState.getCurrent(0)?.animation?.name);
				console.log('[Dialogs] Current dialog type:', typeof this.currentDialog);
				console.log('[Dialogs] Current dialog has alpha property:', 'alpha' in this.currentDialog);
				console.log('[Dialogs] Current dialog alpha property type:', typeof this.currentDialog.alpha);
			}
		}
		
		// Add number display if it exists
		if (this.numberDisplayContainer) {
			fadeOutTargets.push(this.numberDisplayContainer);
			console.log('[Dialogs] Adding number display to fade-out targets');
		}
		
		// Add continue text if it exists
		if (this.continueText) {
			fadeOutTargets.push(this.continueText);
			console.log('[Dialogs] Adding continue text to fade-out targets');
		}
		
		console.log(`[Dialogs] Total fade-out targets: ${fadeOutTargets.length}`);
		
		// Fade out all elements together
		scene.tweens.add({
			targets: fadeOutTargets,
			alpha: 0,
			duration: 500,
			ease: 'Power2',
			onStart: () => {
				console.log('[Dialogs] Win dialog fade-out animation started');
				console.log('[Dialogs] Fade-out targets:', fadeOutTargets);
				
				// Log the current alpha values of all targets
				fadeOutTargets.forEach((target, index) => {
					if (target && typeof target.alpha === 'number') {
						console.log(`[Dialogs] Target ${index} alpha before fade-out:`, target.alpha);
					}
				});
				
				// Specifically check the Spine animation
				if (this.currentDialog && this.currentDialog.animationState) {
					console.log('[Dialogs] Spine animation alpha at fade-out start:', this.currentDialog.alpha);
					console.log('[Dialogs] Spine animation visible at fade-out start:', this.currentDialog.visible);
				}
			},
			onUpdate: (tween) => {
				// Log progress every 100ms
				const progress = Math.floor(tween.progress * 100);
				if (progress % 20 === 0) { // Log every 20%
					console.log(`[Dialogs] Fade-out progress: ${progress}%`);
					
					// Check Spine animation during fade-out
					if (this.currentDialog && this.currentDialog.animationState) {
						console.log(`[Dialogs] Spine animation alpha at ${progress}%:`, this.currentDialog.alpha);
					}
				}
				
				// Manually control Spine animation alpha during fade-out
				if (this.currentDialog && this.currentDialog.animationState) {
					const targetAlpha = 1 - tween.progress; // Calculate target alpha based on progress
					this.currentDialog.setAlpha(targetAlpha);
					console.log(`[Dialogs] Manual Spine alpha update: ${targetAlpha.toFixed(2)}`);
				}
			},
			onComplete: () => {
				console.log('[Dialogs] Win dialog fade-out complete');
				
				// Log final alpha values
				fadeOutTargets.forEach((target, index) => {
					if (target && typeof target.alpha === 'number') {
						console.log(`[Dialogs] Target ${index} alpha after fade-out:`, target.alpha);
					}
				});
				
				// Check Spine animation after fade-out
				if (this.currentDialog && this.currentDialog.animationState) {
					console.log('[Dialogs] Spine animation alpha after fade-out:', this.currentDialog.alpha);
					console.log('[Dialogs] Spine animation visible after fade-out:', this.currentDialog.visible);
				}
				
				// Wait a moment to ensure fade-out is completely visible before cleanup
				scene.time.delayedCall(100, () => {
					console.log('[Dialogs] Starting cleanup after fade-out completion');

					// Capture dialog type before cleanupDialogContent() nulls it.
					const closedDialogType = this.currentDialogType;

					// Clean up dialog content after fade-out
					this.cleanupDialogContent();

					// Now perform the actual cleanup of destroyed elements
					this.performDialogCleanup();
					console.log('[Dialogs] Dialog elements cleaned up after fade-out');

					// Reset alpha to 1 for next dialog
					this.dialogOverlay.setAlpha(1);

					// Ensure black overlay is completely hidden after win dialog closes
					if (this.blackOverlay) {
						this.blackOverlay.setVisible(false);
						this.blackOverlay.setAlpha(0);
						console.log('[Dialogs] Black overlay completely hidden after win dialog fade-out');
					}

					// Emit dialog animations complete event
					scene.events.emit('dialogAnimationsComplete');
					console.log('[Dialogs] Win dialog animations complete event emitted');

					// Emit win dialog closed event for autoplay
					gameEventManager.emit(GameEventType.WIN_DIALOG_CLOSED, { dialogType: closedDialogType ?? '' });
					console.log('[Dialogs] WIN_DIALOG_CLOSED event emitted after fade-out');
					// Restore background music volume
					try {
						const audioManager = (window as any).audioManager;
						if (audioManager && typeof audioManager.restoreBackground === 'function') {
							audioManager.restoreBackground();
						}
					} catch {}
				});
			}
		});
		
		// Remove the separate Spine tween to avoid timing conflicts
		// The main tween should handle all elements including the Spine animation
	}

	/**
	 * Clean up dialog content without hiding the overlay (for win dialogs)
	 */
	private cleanupDialogContent(): void {
		console.log('[Dialogs] Cleaning up dialog content (keeping overlay visible)');
		
		// Don't hide the dialog overlay - keep it visible for next dialog
		// this.dialogOverlay.setVisible(false);
		// Don't set isDialogActive to false yet - keep it true until cleanup is complete
		// this.isDialogActive = false;
		
		// Reset current dialog type
		this.currentDialogType = null;

		// Reset staged win state
		this.isStagedWinNumberAnimation = false;
		if (this.stagedWinStageTimer) {
			(this.stagedWinStageTimer as Phaser.Time.TimerEvent).destroy();
			this.stagedWinStageTimer = null;
		}
		this.stagedWinStages = [];
		this.stagedWinCurrentStageIndex = 0;
		
		// Don't call performDialogCleanup here - it destroys elements that are still fading out
		// Instead, just reset the state and let the fade-out animation complete naturally
		// The actual cleanup will happen after the fade-out completes
		
		// Don't hide the black overlay when win dialog closes - let the next dialog handle it
		// This ensures that if a free spin dialog appears next, it will have the black overlay available
		console.log('[Dialogs] Keeping black overlay visible for potential next dialog');
		
		console.log('[Dialogs] Dialog content cleanup complete (overlay remains visible)');
	}

	/**
	 * Check if we should trigger bonus mode based on current dialog type
	 */
	private shouldTriggerBonusMode(): boolean {
		return this.currentDialogType === 'FreeSpinDialog_KA';
	}

	/**
	 * Trigger bonus mode by enabling bonus background and header
	 */
	private triggerBonusMode(scene: Scene): void {
		console.log('[Dialogs] ===== TRIGGERING BONUS MODE TRANSITION =====');
		console.log('[Dialogs] Scene exists:', !!scene);
		console.log('[Dialogs] Scene events exists:', !!scene.events);
		
		// Set bonus mode in backend data
		scene.events.emit('setBonusMode', true);
		console.log('[Dialogs] Emitted setBonusMode event');
		
		// Clear scatter state so win dialogs are not deferred or auto-closed after retrigger
		try {
			gameStateManager.isScatter = false;
			console.log('[Dialogs] Cleared isScatter state on bonus mode trigger');
		} catch {}
		
		// Switch to bonus background
		scene.events.emit('showBonusBackground');
		console.log('[Dialogs] Emitted showBonusBackground event');
		
		// Switch to bonus header
		scene.events.emit('showBonusHeader');
		console.log('[Dialogs] Emitted showBonusHeader event');
		
		// Re-enable symbols after bonus mode setup
		scene.events.emit('enableSymbols');
		console.log('[Dialogs] Emitted enableSymbols event');
		
		console.log('[Dialogs] ===== BONUS MODE ACTIVATED - BACKGROUND AND HEADER SWITCHED =====');
	}

	/**
	 * Clean up dialog without any transition effects
	 */
	private cleanupDialog(): void {
		if (!this.isDialogActive) return;
		
		console.log('[Dialogs] Cleaning up dialog');
		
		// Hide the dialog overlay
		this.dialogOverlay.setVisible(false);
		this.isDialogActive = false;
		
		// Reset current dialog type
		this.currentDialogType = null;

		// Reset staged win state
		this.isStagedWinNumberAnimation = false;
		if (this.stagedWinStageTimer) {
			(this.stagedWinStageTimer as Phaser.Time.TimerEvent).destroy();
			this.stagedWinStageTimer = null;
		}
		this.stagedWinStages = [];
		this.stagedWinCurrentStageIndex = 0;
		
		// Clean up all dialog elements
		this.performDialogCleanup();
		
		console.log('[Dialogs] Dialog cleanup complete');
	}

	/**
	 * Perform the actual cleanup of dialog elements
	 */
	private performDialogCleanup(): void {
		console.log('[Dialogs] Starting dialog cleanup');
		
		// Clean up current dialog
		if (this.currentDialog) {
			console.log('[Dialogs] Destroying current dialog');
			this.currentDialog.destroy();
			this.currentDialog = null;
		}
		
		// Clean up continue text
		if (this.continueText) {
			console.log('[Dialogs] Destroying continue text');
			this.continueText.destroy();
			this.continueText = null;
		}
		
		// Clean up number display
		if (this.numberDisplayContainer) {
			console.log('[Dialogs] Destroying number display');
			this.numberDisplayContainer.destroy();
			this.numberDisplayContainer = null;
		}
		
		// Clean up click area
		if (this.clickArea) {
			console.log('[Dialogs] Destroying click area');
			// Properly disable interactivity before destroying
			if (this.clickArea.input && this.clickArea.input.enabled) {
				this.clickArea.disableInteractive();
			}
			this.clickArea.destroy();
			this.clickArea = null;
		}
		
		// Clean up congrats secondary free spins display if present
		if (this.congratsFreeSpinsContainer) {
			console.log('[Dialogs] Destroying congrats free spins display');
			this.congratsFreeSpinsContainer.destroy();
			this.congratsFreeSpinsContainer = null;
			this.congratsFreeSpinsDisplay = null;
		}

		this.destroyMaxWinDialogContent();

		// Clear auto-close timer if it exists
		if (this.autoCloseTimer) {
			console.log('[Dialogs] Destroying auto-close timer during cleanup');
			this.autoCloseTimer.destroy();
			this.autoCloseTimer = null;
		}
		
		// Now that all elements are destroyed, set dialog as inactive
		this.isDialogActive = false;
		console.log('[Dialogs] Dialog cleanup complete - isDialogActive set to false');
	}

	/**
	 * Hide the dialog with a simple black overlay transition
	 */
	hideDialog(): void {
		if (!this.isDialogActive) return;
		
		console.log('[Dialogs] Hiding dialog with black overlay transition');
		
		if (this.currentScene) {
			// Create a black overlay for transition
			const transitionOverlay = this.currentScene.add.graphics();
			transitionOverlay.setDepth(10000); // Very high depth to cover everything
			transitionOverlay.fillStyle(0x000000, 1);
			transitionOverlay.fillRect(0, 0, this.currentScene.scale.width, this.currentScene.scale.height);
			transitionOverlay.setAlpha(0); // Start transparent
			
			// Fade in black overlay over 0.75 seconds
			this.currentScene.tweens.add({
				targets: transitionOverlay,
				alpha: 1,
				duration: 750,
				ease: 'Power2',
				onComplete: () => {
					console.log('[Dialogs] Transition overlay fade-in complete');
					
					// Hide dialog immediately while screen is black
					this.dialogOverlay.setVisible(false);
					this.isDialogActive = false;
					
					// Fade out black overlay over 0.75 seconds
					this.currentScene!.tweens.add({
						targets: transitionOverlay,
						alpha: 0,
						duration: 750,
						ease: 'Power2',
						onComplete: () => {
							// Clean up transition overlay
							transitionOverlay.destroy();
							console.log('[Dialogs] Black overlay transition complete, dialog hidden');
						}
					});
				}
			});
		} else {
			// Fallback if no scene reference
			this.dialogOverlay.setVisible(false);
			this.isDialogActive = false;
		}
		
		// Perform cleanup after transition
		this.performDialogCleanup();
		
		console.log('[Dialogs] Dialog hidden and cleaned up');
	}

	/**
	 * Check if dialog is currently showing
	 */
	isDialogShowing(): boolean {
		return this.isDialogActive;
	}

	/**
	 * Public helper used by keyboard routing (SPACE hotkey) to close the current dialog
	 * using the same path as a click/tap.
	 */
	public dismissCurrentDialog(scene: Scene): void {
		try {
			if (!this.isDialogShowing()) {
				return;
			}
			this.handleDialogClick(scene, false);
		} catch (e) {
			console.warn('[Dialogs] dismissCurrentDialog failed:', e);
		}
	}

	/**
	 * Get the current dialog type
	 */
	getCurrentDialogType(): string | null {
		return this.currentDialog ? this.currentDialog.texture.key : null;
	}

	/**
	 * Resize the dialog overlay when screen size changes
	 */
	resize(scene: Scene): void {
		// Update stored scene reference
		this.currentScene = scene;
		
		if (this.blackOverlay) {
			this.blackOverlay.clear();
			this.blackOverlay.fillStyle(0x000000, 0.7);
			this.blackOverlay.fillRect(0, 0, scene.scale.width, scene.scale.height);
		}

		// Reposition continue text (if visible); update wrap width so it reflows on resize
		if (this.continueText) {
			const wrapWidth = Math.max(200, scene.scale.width * 0.9);
			this.continueText.setStyle({ wordWrap: { width: wrapWidth, useAdvancedWrap: true } });
			this.continueText.setPosition(scene.scale.width / 2, scene.scale.height / 2 + 300);
		}

		if (this.numberDisplayContainer && this.numberDisplay) {
			this.refreshNumberDisplayLayout(scene);
		}
	}

	/**
	 * Get the dialog overlay container
	 */
	getContainer(): Phaser.GameObjects.Container {
		return this.dialogOverlay;
	}

	/**
	 * Destroy the dialog system
	 */
	destroy(): void {
		this.hideDialog();
		if (this.dialogOverlay) {
			this.dialogOverlay.destroy();
		}
	}

	/**
	 * Configure staged win number and animation thresholds based on bet and total win.
	 * Example (bet=0.20, win=0.60, final type=SuperW_KA):
	 *  - SmallW_KA (BigWin)   -> 0.16 (0.8x)
	 *  - MediumW_KA (MegaWin) -> 0.20 (1x)
	 *  - LargeW_KA (EpicWin)  -> 0.40 (2x)
	 *  - SuperW_KA (SuperWin) -> 0.60 (final win)
	 */
	private setupStagedWinNumberAnimation(config: DialogConfig): void {
		const winAmount = config.winAmount ?? 0;
		const betAmount = config.betAmount ?? 0;

		if (winAmount <= 0 || betAmount <= 0) {
			console.log('[Dialogs] Staged win: invalid bet/win, skipping staged animation');
			this.isStagedWinNumberAnimation = false;
			this.stagedWinStages = [];
			this.stagedWinCurrentStageIndex = 0;
			this.numberTargetValue = winAmount;
			return;
		}

		// Order of tiers and their multiplier thresholds
		const orderedTypes: Array<'SmallW_KA' | 'MediumW_KA' | 'LargeW_KA' | 'SuperW_KA'> = [
			'SmallW_KA',
			'MediumW_KA',
			'LargeW_KA',
			'SuperW_KA'
		];
		const thresholds = [20, 30, 45, 60]; // multipliers relative to bet

		const finalIndex = orderedTypes.indexOf(config.type as any);
		if (finalIndex <= 0) {
			// Only apply staged behavior when final tier is at least Medium (MegaWin) or higher
			console.log('[Dialogs] Staged win: final tier is SmallW_KA or unknown - using simple animation');
			this.isStagedWinNumberAnimation = false;
			this.stagedWinStages = [];
			this.stagedWinCurrentStageIndex = 0;
			this.numberTargetValue = winAmount;
			return;
		}

		let stages: Array<{ type: 'SmallW_KA' | 'MediumW_KA' | 'LargeW_KA' | 'SuperW_KA'; target: number }> = [];
		let lastTarget = 0;

		// Add intermediate tiers (below the final tier) only at their threshold values,
		// but only if the win actually reaches those thresholds.
		for (let i = 0; i < finalIndex && i < thresholds.length; i++) {
			const type = orderedTypes[i];
			const multiplier = thresholds[i];
			const thresholdValue = betAmount * multiplier;

			if (winAmount >= thresholdValue && thresholdValue > lastTarget) {
				stages.push({ type, target: thresholdValue });
				lastTarget = thresholdValue;
			}
		}

		// Always add exactly one stage for the final tier, targeting the actual win amount.
		// This prevents showing the same tier twice (once at its threshold and once at the final win).
		stages.push({ type: config.type as any, target: winAmount });
		lastTarget = winAmount;

		// If we ended up with only a single stage (no intermediate thresholds crossed),
		// just use the normal single-number animation on the final tier.
		if (stages.length <= 1) {
			console.log('[Dialogs] Staged win: no stages produced, falling back to simple animation');
			this.isStagedWinNumberAnimation = false;
			this.stagedWinStages = [];
			this.stagedWinCurrentStageIndex = 0;
			this.numberTargetValue = winAmount;
			return;
		}

		this.isStagedWinNumberAnimation = true;
		this.stagedWinStages = stages;
		this.stagedWinCurrentStageIndex = 0;
		// For staged animation, the numberTargetValue is only used as a fallback.
		this.numberTargetValue = winAmount;

		console.log('[Dialogs] Staged win configured. Stages:', stages);

		// Ensure the visual sequence starts from the first tier (e.g. BigWin),
		// not from the final tier that was passed into showDialog.
		try {
			const firstStage = this.stagedWinStages[0];
			this.currentDialogType = firstStage.type;

			if (this.currentDialog && this.currentDialog.animationState) {
				const animations = this.getAnimationNameForDialogType(firstStage.type);
				if (animations) {
					const shouldLoop = this.getDialogLoop(firstStage.type);
					console.log('[Dialogs] Staged win: initializing spine animation to first stage', animations);
					try {
						if (this.disableIntroAnimations) {
							this.currentDialog.animationState.setAnimation(0, animations.idle, shouldLoop);
						} else {
							this.currentDialog.animationState.setAnimation(0, animations.intro, false);
							this.currentDialog.animationState.addAnimation(0, animations.idle, shouldLoop, 0);
						}
						// Apply scale pop whenever we transition into idle
						const sceneRef = this.currentScene;
						if (sceneRef) {
							this.applyDialogScalePop(sceneRef);
						}
					} catch (err) {
						console.warn('[Dialogs] Staged win: failed to play intro/idle for first stage, using idle only', err);
						this.currentDialog.animationState.setAnimation(0, animations.idle, shouldLoop);
						const sceneRef = this.currentScene;
						if (sceneRef) {
							this.applyDialogScalePop(sceneRef);
						}
					}
				}
			}
		} catch (e) {
			console.warn('[Dialogs] Staged win: failed to initialize first stage animation sequence', e);
		}
	}

	/**
	 * Run staged win number sequence and switch spine animations per stage.
	 */
	private startStagedWinNumberSequence(scene: Scene): void {
		if (!this.numberDisplay || !this.currentDialog) {
			console.warn('[Dialogs] Cannot start staged win sequence - missing numberDisplay or currentDialog');
			this.isStagedWinNumberAnimation = false;
			return;
		}

		// Clear any previous staged win timer before starting
		if (this.stagedWinStageTimer) {
			(this.stagedWinStageTimer as Phaser.Time.TimerEvent).destroy();
			this.stagedWinStageTimer = null;
		}

		this.runStagedWinStage(scene, 0, false);
	}

	/**
	 * Execute a single staged win tier and schedule the next one if applicable.
	 * When fastFromSkip is true, we use a shorter number animation for manual skips.
	 */
	private runStagedWinStage(scene: Scene, index: number, fastFromSkip: boolean): void {
		// Abort if staged sequencing has been disabled (e.g., user manually
		// closed the dialog).
		if (!this.isStagedWinNumberAnimation) {
			console.log('[Dialogs] Staged win: staging disabled, aborting stage run');
			return;
		}

		// Abort if dialog has been deactivated (e.g., user clicked to close)
		if (!this.isDialogActive) {
			console.log('[Dialogs] Staged win: dialog inactive, aborting stage run');
			this.isStagedWinNumberAnimation = false;
			return;
		}

		if (!this.numberDisplay || !this.currentDialog) {
			console.warn('[Dialogs] Staged win: display or dialog missing during stage run');
			this.isStagedWinNumberAnimation = false;
			return;
		}

		if (index >= this.stagedWinStages.length) {
			console.log('[Dialogs] Staged win: all stages complete');
			this.isStagedWinNumberAnimation = false;
			return;
		}

		this.stagedWinCurrentStageIndex = index;
		const stage = this.stagedWinStages[index];

		console.log('[Dialogs] Staged win: running stage', {
			index,
			type: stage.type,
			target: stage.target,
			fastFromSkip
		});

		// Play correct audio for the current tier and fade out any previous tier SFX
		try {
			if (!this.isDialogActive) {
				console.log('[Dialogs] Staged win: dialog inactive before SFX, skipping audio');
				this.isStagedWinNumberAnimation = false;
				return;
			}
			const audioManager = (window as any).audioManager;
			if (audioManager) {
				if (typeof audioManager.fadeOutCurrentWinSfx === 'function') {
					audioManager.fadeOutCurrentWinSfx(200);
				}
				if (typeof audioManager.playWinDialogSfx === 'function') {
					audioManager.playWinDialogSfx(stage.type);
				}
				if (typeof audioManager.duckBackground === 'function') {
					audioManager.duckBackground(0.3);
				}
			}
		} catch (e) {
			console.warn('[Dialogs] Failed to trigger staged tier SFX:', e);
		}

		// Switch the spine animation to match the current tier.
		// For the first stage, the animation was already initialized in setupStagedWinNumberAnimation,
		// so avoid resetting it here to prevent the "first tier plays twice" effect.
		if (index > 0 || fastFromSkip) {
			try {
				const animations = this.getAnimationNameForDialogType(stage.type);
				if (animations && this.currentDialog.animationState) {
					const shouldLoop = this.getDialogLoop(stage.type);
					console.log('[Dialogs] Staged win: switching spine animation to', animations);
					try {
						if (this.disableIntroAnimations) {
							this.currentDialog.animationState.setAnimation(0, animations.idle, shouldLoop);
						} else {
							this.currentDialog.animationState.setAnimation(0, animations.intro, false);
							this.currentDialog.animationState.addAnimation(0, animations.idle, shouldLoop, 0);
						}
						// Apply scale pop whenever we transition into idle
						const sceneRef = this.currentScene || scene;
						if (sceneRef) {
							this.applyDialogScalePop(sceneRef);
						}
					} catch (err) {
						console.warn('[Dialogs] Staged win: intro/idle animation failed, using idle only', err);
						this.currentDialog.animationState.setAnimation(0, animations.idle, shouldLoop);
						const sceneRef = this.currentScene || scene;
						if (sceneRef) {
							this.applyDialogScalePop(sceneRef);
						}
					}
				}
			} catch (e) {
				console.warn('[Dialogs] Staged win: failed to switch spine animation for stage', stage.type, e);
			}
		}

		// Animate the number to this stage target
		const isFirstStage = index === 0;
		const defaultDurationMs = 2500; // time for the counter animation
		const fastDurationMs = 2500; // shorter animation when skipping
		const numberAnimDurationMs = fastFromSkip ? fastDurationMs : defaultDurationMs;
		const perStageDwellMs = 2000; // approximate dwell time per tier (matches original auto-close)

		this.numberDisplay!.animateToValue(stage.target, {
			duration: numberAnimDurationMs,
			ease: 'Power2',
			startFromCurrent: !isFirstStage || fastFromSkip
		});

		const lastIndex = this.stagedWinStages.length - 1;

		// Schedule next stage after the per-stage dwell time so that, visually,
		// each tier behaves like its own win dialog before the next one appears.
		if (index + 1 < this.stagedWinStages.length) {
			// Cancel any previous stage timer before scheduling the next one
			const timer = this.stagedWinStageTimer;
			if (timer) {
				timer.destroy();
				this.stagedWinStageTimer = null;
			}

			this.stagedWinStageTimer = scene.time.delayedCall(perStageDwellMs, () => {
				// Guard again in case dialog was closed during the dwell
				if (!this.isDialogActive || !this.isStagedWinNumberAnimation) {
					console.log('[Dialogs] Staged win: dialog inactive during dwell, stopping sequence');
					this.isStagedWinNumberAnimation = false;
					this.stagedWinStageTimer = null;
					return;
				}
				this.stagedWinStageTimer = null;
				this.runStagedWinStage(scene, index + 1, false);
			});
		} else {
			console.log('[Dialogs] Staged win: last stage scheduled, will end at full win amount');

			// If we're in autoplay/end-of-bonus and the original auto-close timer was cleared (e.g. manual
			// skip), ensure the final staged tier still auto-closes after a sensible dwell.
			try {
				if (!this.autoCloseTimer && this.isWinDialog()) {
					const finalStageDwellMs = WIN_DIALOG_AUTO_CLOSE_MS;

					console.log('[Dialogs] Creating auto-close timer for final staged tier', {
						delayMs: finalStageDwellMs,
						currentStageIndex: this.stagedWinCurrentStageIndex,
						totalStages: this.stagedWinStages.length
					});

					this.autoCloseTimer = scene.time.delayedCall(finalStageDwellMs, () => {
						console.log('[Dialogs] Auto-close after final staged tier - closing dialog');
						this.handleDialogClick(scene, true);
					});
				}
			} catch (e) {
				console.warn('[Dialogs] Failed to create auto-close timer for final staged tier:', e);
			}
		}
	}

	/**
	 * Skip directly to a specific staged win tier (used for manual "press anywhere"
	 * skips while a staged win dialog is playing).
	 */
	private skipToStagedWinStage(scene: Scene, nextIndex: number): void {
		if (!this.numberDisplay || !this.currentDialog) {
			console.warn('[Dialogs] skipToStagedWinStage: missing numberDisplay or currentDialog - closing dialog instead');
			// Fallback: behave like a normal close
			this.startFadeOutSequence(scene);
			this.resetGameStateForNewSpin(scene);
			return;
		}

		if (nextIndex < 0 || nextIndex >= this.stagedWinStages.length) {
			console.warn('[Dialogs] skipToStagedWinStage: invalid staged index', nextIndex);
			this.isStagedWinNumberAnimation = false;
			// Fallback: close dialog normally
			this.startFadeOutSequence(scene);
			this.resetGameStateForNewSpin(scene);
			return;
		}

		// Cancel any pending staged win timer from the previous stage so we can
		// take over progression from this skipped-to tier.
		if (this.stagedWinStageTimer) {
			this.stagedWinStageTimer.destroy();
			this.stagedWinStageTimer = null;
		}

		console.log('[Dialogs] Skipping to staged win tier', {
			index: nextIndex,
			type: this.stagedWinStages[nextIndex].type,
			target: this.stagedWinStages[nextIndex].target
		});

		// Ensure staged sequencing remains active for this dialog and run the
		// requested tier with a faster number animation.
		this.isStagedWinNumberAnimation = true;
		this.runStagedWinStage(scene, nextIndex, true);
	}

	/**
	 * Apply a scale "pop-in" from 0 -> lastDialogScale on the current dialog.
	 * Called whenever we transition into an idle animation so it also applies
	 * to subsequent dialogs / staged win tiers.
	 */
	private applyDialogScalePop(scene: Scene): void {
		if (!this.currentDialog) {
			return;
		}

		const targetScale = this.lastDialogScale || 1;
		try {
			(this.currentDialog as any).setScale?.(0);
		} catch {}

		scene.tweens.add({
			targets: this.currentDialog,
			scaleX: targetScale,
			scaleY: targetScale,
			duration: 800,
			ease: 'Back.Out'
		});
	}

	// Helper methods for dialog configuration
	private getDialogScale(dialogType: string): number {
		return this.dialogScales[dialogType] || 1.0;
	}

	private getDialogPosition(dialogType: string, scene: Scene): { x: number; y: number } {
		const position = this.dialogPositions[dialogType];
		if (position) {
			// Convert relative positions (0.0 to 1.0) to absolute screen coordinates
			return {
				x: position.x * scene.scale.width,
				y: position.y * scene.scale.height
			};
		}
		// Default to center of screen
		return { x: scene.scale.width / 2, y: scene.scale.height / 2 };
	}

	private getDialogLoop(dialogType: string): boolean {
		return this.dialogLoops[dialogType] || false;
		}
		
	// Convenience methods for specific dialog types
	showCongrats(scene: Scene, config?: Partial<DialogConfig>): void {
		this.showDialog(scene, { type: 'Congrats_KA', ...config });
	}

	showFreeSpinDialog(scene: Scene, config?: Partial<DialogConfig>): void {
		this.showDialog(scene, { type: 'FreeSpinDialog_KA', ...config });
	}

	showLargeWin(scene: Scene, config?: Partial<DialogConfig>): void {
		this.showDialog(scene, { type: 'LargeW_KA', ...config });
		}
		
	showMediumWin(scene: Scene, config?: Partial<DialogConfig>): void {
		this.showDialog(scene, { type: 'MediumW_KA', ...config });
		}

	showSmallWin(scene: Scene, config?: Partial<DialogConfig>): void {
		this.showDialog(scene, { type: 'SmallW_KA', ...config });
		}

	showSuperWin(scene: Scene, config?: Partial<DialogConfig>): void {
		this.showDialog(scene, { type: 'SuperW_KA', ...config });
		}

	showMaxWin(scene: Scene, config?: Partial<DialogConfig>): void {
		this.showDialog(scene, {
			type: 'MaxWin',
			maxWinMultiplier: config?.maxWinMultiplier ?? MAX_WIN_MULTIPLIER,
			...config,
		});
	}

	isMaxWinShowing(): boolean {
		return this.isDialogActive && this.currentDialogType === 'MaxWin';
	}
}
