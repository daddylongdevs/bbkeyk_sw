import { Scene } from "phaser";
import { NetworkManager } from "../../managers/NetworkManager";
import { ScreenModeManager } from "../../managers/ScreenModeManager";
import { AssetConfig } from "../../config/AssetConfig";
import { gameStateManager } from "../../managers/GameStateManager";
import { fitLocalizedLogoTexture, LocalizedLogoSurface } from "@core/utils/LocalizedLogo";

export class Background {
	private bgContainer: Phaser.GameObjects.Container;
	private networkManager: NetworkManager;
	private screenModeManager: ScreenModeManager;
	private normalBgCover: Phaser.GameObjects.Image | null = null;
	private scene: Scene | null = null;
	private cloudUpper: Phaser.GameObjects.Image | null = null;
	private cloudMiddle: Phaser.GameObjects.Image | null = null;
	private cloudLower: Phaser.GameObjects.Image | null = null;
	private shineInstances: Phaser.GameObjects.Image[] = [];
	private activeShineCount: number = 0;
	private readonly MAX_SHINES: number = 5;
	private shineTimer: Phaser.Time.TimerEvent | null = null;

	constructor(networkManager: NetworkManager, screenModeManager: ScreenModeManager) {
		this.networkManager = networkManager;
		this.screenModeManager = screenModeManager;
	}

	preload(scene: Scene): void {
		// Assets are now loaded centrally through AssetConfig in Preloader
		console.log(`[Background] Assets loaded centrally through AssetConfig`);
	}

	create(scene: Scene): void {
		console.log("[Background] Creating background elements");
		
		// Store scene reference
		this.scene = scene;
		
		// Create main container for all background elements
		this.bgContainer = scene.add.container(0, 0);
		
		const screenConfig = this.screenModeManager.getScreenConfig();
		const assetScale = this.networkManager.getAssetScale();
		
		console.log(`[Background] Creating background with scale: ${assetScale}x`);

		// Add background layers
		this.createBackgroundLayers(scene, assetScale);
		
		// Add decorative elements
		//this.createDecorativeElements(scene, assetScale);
		
		// Add UI elements
		//this.createUIElements(scene, assetScale);
		
		// Setup bonus mode listener to toggle cover visibility
		this.setupBonusModeListener(scene);
	}

	private createBackgroundLayers(scene: Scene, assetScale: number): void {
		// Add main background
		const bgDefault = scene.add.image(
			scene.scale.width * 0.5,
			scene.scale.height * 0.5,
			'BG-Default'
		).setOrigin(0.5, 0.5).setScale(assetScale);
		this.bgContainer.add(bgDefault);

		// Add cloud elements
		const cloudYOffset = 13; // Adjust this value to move all clouds up (negative) or down (positive)
		const cloudUpperY = scene.scale.height * 0.115 + cloudYOffset;
		this.cloudUpper = scene.add.image(
			scene.scale.width * 0.5,
			cloudUpperY,
			'cloud-upper'
		).setOrigin(0.5, 0.5).setScale(assetScale).setDepth(1);
		this.bgContainer.add(this.cloudUpper);


		const cloudLowerY = scene.scale.height * 0.330 + cloudYOffset;
		this.cloudLower = scene.add.image(
			scene.scale.width * 0.5,
			cloudLowerY,
			'cloud-lower'
		).setOrigin(0.5, 0.5).setScale(assetScale).setDepth(1);
		this.bgContainer.add(this.cloudLower);


		const cloudMiddleX = scene.scale.width * 0.5;
		const cloudMiddleY = scene.scale.height * 0.195 + cloudYOffset;
		this.cloudMiddle = scene.add.image(
			cloudMiddleX,
			cloudMiddleY,
			'cloud-middle'
		).setOrigin(0.5, 0.5).setScale(assetScale).setDepth(601);
		// Don't add to container - add directly to scene so it appears in front of symbols (depth 600)

		
		
		// Animate clouds
		this.animateClouds(scene);

		// Add shine effect
		this.createShineEffect(scene, assetScale);

		// Add normal background cover overlay (centered)
		// Add directly to scene with depth 850 (above symbols 0-600, winlines 800, but below controller 900)
		this.normalBgCover = scene.add.image(
			scene.scale.width * 0.5,
			scene.scale.height * 0.776,
			'normal-bg-cover'
		).setOrigin(0.5, 0.5).setScale(assetScale).setDepth(850);
		// Don't add to container - add directly to scene so depth works correctly
		// Visibility will be controlled by bonus mode listener

    /*
    
    	// Add bulbs
		const bulb1 = scene.add.image(
			scene.scale.width * 0.21,
			scene.scale.height * 0.40,
			'bulb-01'
		).setOrigin(0.5, 0.5).setScale(0.43);
		this.bgContainer.add(bulb1);

		const bulb2 = scene.add.image(
			scene.scale.width * 0.521,
			scene.scale.height * 0.40,
			'bulb-02'
		).setOrigin(0.5, 0.5).setScale(0.43);
		this.bgContainer.add(bulb2);

		const bulb3 = scene.add.image(
			scene.scale.width * 0.818,
			scene.scale.height * 0.40,
			'bulb-03'
		).setOrigin(0.5, 0.5).setScale(0.43);
		this.bgContainer.add(bulb3);
    */

    // Tent moved to Header component
	}

	private createShineEffect(scene: Scene, assetScale: number): void {
		// Create pool of shine images (max 5)
		for (let i = 0; i < this.MAX_SHINES; i++) {
			const shine = scene.add.image(0, 0, 'shine')
				.setOrigin(0.5, 0.5)
				.setScale(0)
				.setAlpha(1)
				.setDepth(3) // Above clouds but below UI elements
				.setVisible(false);
			this.shineInstances.push(shine);
		}
		
		// Start the random shine animation cycle
		this.scheduleNextShine(scene, assetScale);
	}

	private scheduleNextShine(scene: Scene, assetScale: number): void {
		// Random delay between 2-5 seconds before next shine appears
		const delay = Phaser.Math.Between(400, 700);
		
		this.shineTimer = scene.time.delayedCall(delay, () => {
			// Only create new shine if we haven't reached the max
			if (this.activeShineCount < this.MAX_SHINES) {
				this.playShineAnimation(scene, assetScale);
			}
			// Always schedule the next attempt
			this.scheduleNextShine(scene, assetScale);
		});
	}

	private playShineAnimation(scene: Scene, assetScale: number): void {
		// Find an available shine instance
		const shine = this.shineInstances.find(s => !s.visible);
		if (!shine) return; // All shines are active

		// Increment active count
		this.activeShineCount++;

		// Define the area where shine can appear (from top until 1/4 of the screen)
		// Adjust these values to control the range
		const minX = scene.scale.width * 0;
		const maxX = scene.scale.width * 1;
		const minY = scene.scale.height * 0;
		const maxY = scene.scale.height * 0.25;

		// Random position within the defined area
		const randomX = Phaser.Math.Between(minX, maxX);
		const randomY = Phaser.Math.Between(minY, maxY);

		// Set position and initial state
		shine.setPosition(randomX, randomY);
		shine.setScale(0);
		shine.setAlpha(1);
		shine.setVisible(true);

		// Scale up animation
		const scaleUpDuration = 400;
		const scaleDownDuration = 400;
		const holdDuration = 200;
		const maxScale = assetScale * Phaser.Math.FloatBetween(0.8, 1.2); // Random scale variation

		scene.tweens.add({
			targets: shine,
			scale: maxScale,
			duration: scaleUpDuration,
			ease: 'Sine.easeOut',
			onComplete: () => {
				// Hold at max scale briefly
				scene.time.delayedCall(holdDuration, () => {
					if (shine && shine.visible) {
						// Scale down animation
						scene.tweens.add({
							targets: shine,
							scale: 0,
							duration: scaleDownDuration,
							ease: 'Sine.easeIn',
							onComplete: () => {
								if (shine) {
									shine.setVisible(false);
								}
								// Decrement active count
								this.activeShineCount = Math.max(0, this.activeShineCount - 1);
							}
						});
					}
				});
			}
		});
	}

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

		// Animate cloud-lower: move up and down slowly
		if (this.cloudLower) {
			const startY = this.cloudLower.y;
			scene.tweens.add({
				targets: this.cloudLower,
				y: startY - 10,
				duration: 3500,
				ease: 'Sine.easeInOut',
				repeat: -1,
				yoyo: true
			});
		}
	}

	private createDecorativeElements(scene: Scene, assetScale: number): void {
		// Add balloons
		const balloon1 = scene.add.image(
			scene.scale.width * 0.04,
			scene.scale.height * 0.5,
			'balloon-01'
		).setOrigin(0.5, 0.5).setScale(assetScale);
		this.bgContainer.add(balloon1);

		const balloon2 = scene.add.image(
			scene.scale.width * 0.06,
			scene.scale.height * 0.3,
			'balloon-02'
		).setOrigin(0.5, 0.5).setScale(assetScale);
		this.bgContainer.add(balloon2);

		const balloon3 = scene.add.image(
			scene.scale.width * 0.95,
			scene.scale.height * 0.6,
			'balloon-03'
		).setOrigin(0.5, 0.5).setScale(assetScale);
		this.bgContainer.add(balloon3);

		const balloon4 = scene.add.image(
			scene.scale.width * 0.92,
			scene.scale.height * 0.35,
			'balloon-04'
		).setOrigin(0.5, 0.5).setScale(assetScale);
		this.bgContainer.add(balloon4);

		// Add Christmas lights
		const xmasLights = scene.add.image(
			scene.scale.width * 0.495,
			scene.scale.height * 0.40,
			'reel-xmaslight-default'
		).setOrigin(0.5, 0.5).setScale(assetScale);
		this.bgContainer.add(xmasLights);

	
	}

	private createUIElements(scene: Scene, assetScale: number): void {
		// Add logo
		const logo = scene.add.image(
			scene.scale.width * 0.5,
			scene.scale.height * 0.05,
			'header-logo'
		).setOrigin(0.5, 0.5).setScale(assetScale).setDepth(1);
		fitLocalizedLogoTexture(logo, 'header-logo', (scene as any).gameAPI?.getLocalizedLogoLanguage?.(), (key) => scene.textures.exists(key), { surface: LocalizedLogoSurface.Header });
		this.bgContainer.add(logo);
	}

	resize(scene: Scene): void {
		if (this.bgContainer) {
			this.bgContainer.setSize(scene.scale.width, scene.scale.height);
		}
	}

	getContainer(): Phaser.GameObjects.Container {
		return this.bgContainer;
	}

	/**
	 * Clean up shine effect when component is destroyed
	 */
	destroy(): void {
		if (this.shineTimer) {
			this.shineTimer.destroy();
			this.shineTimer = null;
		}
		// Destroy all shine instances
		this.shineInstances.forEach(shine => {
			if (shine) {
				shine.destroy();
			}
		});
		this.shineInstances = [];
		this.activeShineCount = 0;
	}

	/**
	 * Setup listener for bonus mode changes to toggle cover visibility
	 */
	private setupBonusModeListener(scene: Scene): void {
		// Listen for bonus mode events
		scene.events.on('setBonusMode', (isBonus: boolean) => {
			if (this.normalBgCover) {
				// Show normal cover only when NOT in bonus mode
				this.normalBgCover.setVisible(!isBonus);
				console.log(`[Background] Normal bg cover visibility set to: ${!isBonus} (isBonus: ${isBonus})`);
			}
			if (this.cloudMiddle) {
				// Hide cloud_middle when IN bonus mode
				this.cloudMiddle.setVisible(!isBonus);
				console.log(`[Background] Cloud middle visibility set to: ${!isBonus} (isBonus: ${isBonus})`);
			}
		});

		// Set initial visibility based on current bonus state
		const isBonus = gameStateManager.isBonus;
		if (this.normalBgCover) {
			this.normalBgCover.setVisible(!isBonus);
			console.log(`[Background] Initial normal bg cover visibility: ${!isBonus} (isBonus: ${isBonus})`);
		}
		if (this.cloudMiddle) {
			this.cloudMiddle.setVisible(!isBonus);
			console.log(`[Background] Initial cloud middle visibility: ${!isBonus} (isBonus: ${isBonus})`);
		}
	}
}
