import { Scene } from "phaser";
import { NetworkManager } from "../../managers/NetworkManager";
import { ScreenModeManager } from "../../managers/ScreenModeManager";
import { gameStateManager } from "../../managers/GameStateManager";

export class BonusBackground {
	private bonusContainer: Phaser.GameObjects.Container;
	private networkManager: NetworkManager;
	private screenModeManager: ScreenModeManager;
	private bonusBgCover: Phaser.GameObjects.Image | null = null;
	private scene: Scene | null = null;
	private cloudUpper: Phaser.GameObjects.Image | null = null;
	private cloudMiddle: Phaser.GameObjects.Image | null = null;

	constructor(networkManager: NetworkManager, screenModeManager: ScreenModeManager) {
		this.networkManager = networkManager;
		this.screenModeManager = screenModeManager;
	}

	preload(scene: Scene): void {
		// Assets are loaded centrally through AssetConfig in Preloader
		console.log(`[BonusBackground] Assets loaded centrally through AssetConfig`);
	}

	create(scene: Scene): void {
		console.log("[BonusBackground] Creating bonus background elements");
		
		// Store scene reference
		this.scene = scene;
		
		// Create main container for all bonus background elements
		this.bonusContainer = scene.add.container(0, 0);
		
		const screenConfig = this.screenModeManager.getScreenConfig();
		const assetScale = this.networkManager.getAssetScale();
		
		console.log(`[BonusBackground] Creating bonus background with scale: ${assetScale}x`);

		// Add bonus background elements
		this.createBonusElements(scene, assetScale);
		
		// Setup bonus mode listener to toggle cover visibility
		this.setupBonusModeListener(scene);
	}

	private createBonusElements(scene: Scene, assetScale: number): void {
		const screenConfig = this.screenModeManager.getScreenConfig();
		
		if (screenConfig.isPortrait) {
			this.createPortraitBonusBackground(scene, assetScale);
		} else {
			this.createLandscapeBonusBackground(scene, assetScale);
		}
	}


	private createPortraitBonusBackground(scene: Scene, assetScale: number): void {
		console.log("[BonusBackground] Creating portrait bonus background layout");
		
		// Main bonus background
		const bonusBg = scene.add.image(
			scene.scale.width * 0.5,
			scene.scale.height * 0.5,
			'bonus_background'
		).setOrigin(0.5, 0.5).setScale(assetScale).setDepth(1);
		this.bonusContainer.add(bonusBg);

		// Add cloud elements (similar to normal background)
		const cloudYOffset = 18; // Same offset as normal background
		const cloudUpperY = scene.scale.height * 0.09 + cloudYOffset;
		this.cloudUpper = scene.add.image(
			scene.scale.width * 0.5,
			cloudUpperY,
			'cloud-upper-bonus'
		).setOrigin(0.5, 0.5).setScale(assetScale).setDepth(1);
		this.bonusContainer.add(this.cloudUpper);

		const cloudMiddleX = scene.scale.width * 0.5;
		const cloudMiddleY = scene.scale.height * 0.1 + cloudYOffset;
		this.cloudMiddle = scene.add.image(
			cloudMiddleX,
			cloudMiddleY,
			'cloud-middle-bonus'
		).setOrigin(0.5, 0.5).setScale(assetScale).setDepth(601);
		// Don't add to container - add directly to scene so it appears in front of symbols (depth 600)

		// Animate clouds
		this.animateClouds(scene);

		// Bonus cover overlay (centered)
		// Add directly to scene with depth 850 (above symbols 0-600, winlines 800, but below controller 900)
		this.bonusBgCover = scene.add.image(
			scene.scale.width * 0.5,
			scene.scale.height * 0.776,
			'bonus-bg-cover'
		).setOrigin(0.5, 0.5).setScale(assetScale).setDepth(850);
		// Don't add to container - add directly to scene so depth works correctly
		// Visibility will be controlled by bonus mode listener


	}

	private createLandscapeBonusBackground(scene: Scene, assetScale: number): void {
		console.log("[BonusBackground] Creating landscape bonus background layout");
		
		// Main bonus background
		const bonusBg = scene.add.image(
			scene.scale.width * 0.5,
			scene.scale.height * 0.5,
			'bonus_background'
		).setOrigin(0.5, 0.5).setScale(assetScale).setDepth(1);
		this.bonusContainer.add(bonusBg);

		// Bonus cover overlay
		// Add directly to scene with depth 850 (above symbols 0-600, winlines 800, but below controller 900)
		this.bonusBgCover = scene.add.image(
			scene.scale.width * 0.5,
			scene.scale.height * 0.5,
			'bonus-bg-cover'
		).setOrigin(0.5, 0.5).setScale(assetScale).setDepth(850);
		// Don't add to container - add directly to scene so depth works correctly
		// Visibility will be controlled by bonus mode listener


	}

	resize(scene: Scene): void {
		if (this.bonusContainer) {
			this.bonusContainer.setSize(scene.scale.width, scene.scale.height);
		}
	}

	getContainer(): Phaser.GameObjects.Container {
		return this.bonusContainer;
	}

	destroy(): void {
		if (this.bonusContainer) {
			this.bonusContainer.destroy();
		}
	}

	/**
	 * Animate clouds similar to normal background
	 */
	private animateClouds(scene: Scene): void {
		// Animate cloud-upper: move up and down slowly
		if (this.cloudUpper) {
			const startY = this.cloudUpper.y;
			scene.tweens.add({
				targets: this.cloudUpper,
				y: startY + 10,
				duration: 3000,
				ease: 'Sine.easeInOut',
				repeat: -1,
				yoyo: true
			});
		}

		// Animate cloud-middle: move side to side slowly
		if (this.cloudMiddle) {
			const startX = this.cloudMiddle.x;
			// Set initial position to left, then animate to right and back (oscillates left <-> right)
			this.cloudMiddle.x = startX - 10;
			scene.tweens.add({
				targets: this.cloudMiddle,
				x: startX + 10,
				duration: 5000,
				ease: 'Sine.easeInOut',
				repeat: -1,
				yoyo: true
			});
		}
	}

	/**
	 * Setup listener for bonus mode changes to toggle cover and cloud visibility
	 */
	private setupBonusModeListener(scene: Scene): void {
		// Listen for bonus mode events
		scene.events.on('setBonusMode', (isBonus: boolean) => {
			if (this.bonusBgCover) {
				// Show bonus cover only when IN bonus mode
				this.bonusBgCover.setVisible(isBonus);
				console.log(`[BonusBackground] Bonus bg cover visibility set to: ${isBonus} (isBonus: ${isBonus})`);
			}
			
			// Show clouds only when IN bonus mode
			if (this.cloudUpper) {
				this.cloudUpper.setVisible(isBonus);
				console.log(`[BonusBackground] Cloud upper visibility set to: ${isBonus} (isBonus: ${isBonus})`);
			}
			
			if (this.cloudMiddle) {
				this.cloudMiddle.setVisible(isBonus);
				console.log(`[BonusBackground] Cloud middle visibility set to: ${isBonus} (isBonus: ${isBonus})`);
			}
		});

		// Set initial visibility based on current bonus state
		const isBonus = gameStateManager.isBonus;
		
		if (this.bonusBgCover) {
			this.bonusBgCover.setVisible(isBonus);
			console.log(`[BonusBackground] Initial bonus bg cover visibility: ${isBonus} (isBonus: ${isBonus})`);
		}
		
		if (this.cloudUpper) {
			this.cloudUpper.setVisible(isBonus);
			console.log(`[BonusBackground] Initial cloud upper visibility: ${isBonus} (isBonus: ${isBonus})`);
		}
		
		if (this.cloudMiddle) {
			this.cloudMiddle.setVisible(isBonus);
			console.log(`[BonusBackground] Initial cloud middle visibility: ${isBonus} (isBonus: ${isBonus})`);
		}
	}
}
