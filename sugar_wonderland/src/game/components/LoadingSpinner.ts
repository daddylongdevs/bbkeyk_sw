import { Scene } from 'phaser';

/**
 * LoadingSpinner Component
 * 
 * A cute candy overlay that spins in the center of the symbols grid
 * when fetching spin data takes more than 2 seconds (after symbols clear).
 */
export class LoadingSpinner {
	private scene: Scene;
	private container: Phaser.GameObjects.Container | null = null;
	private candyImage: Phaser.GameObjects.Image | null = null;
	private spinnerTween: Phaser.Tweens.Tween | null = null;
	private showTimeout: any | null = null;
	private isVisible: boolean = false;
	
	// Position where the spinner should appear (center of symbols grid)
	private centerX: number = 0;
	private centerY: number = 0;

	constructor(scene: Scene, centerX: number, centerY: number) {
		this.scene = scene;
		this.centerX = centerX;
		this.centerY = centerY;
		this.createSpinner();
	}

	/**
	 * Create the candy spinner
	 */
	private createSpinner(): void {
		// Create container for the spinner
		this.container = this.scene.add.container(this.centerX, this.centerY);
		this.container.setDepth(10000); // High depth to appear above symbols
		this.container.setVisible(false);
		this.container.setAlpha(0);

		// Create the candy overlay image
		this.candyImage = this.scene.add.image(0, 0, 'candy-overlay');
		this.candyImage.setOrigin(0.5, 0.5);
		this.candyImage.setScale(0.15); // Scale down the candy to fit nicely
		this.container.add(this.candyImage);

		console.log('[LoadingSpinner] Candy spinner created at position:', this.centerX, this.centerY);
	}

	/**
	 * Start showing the spinner after a 2-second delay
	 * This should be called when the API request starts
	 * Delayed to allow previous symbols to clear first
	 */
	public startDelayedShow(): void {
		console.log('[LoadingSpinner] Starting delayed show (2 seconds)');
		
		// Clear any existing timeout
		this.cancelDelayedShow();
		
		// Set timeout to show spinner after 2 seconds (allows symbols to clear)
		this.showTimeout = setTimeout(() => {
			this.show();
		}, 2000);
	}

	/**
	 * Cancel the delayed show (call this if data arrives within 1 second)
	 */
	public cancelDelayedShow(): void {
		if (this.showTimeout) {
			clearTimeout(this.showTimeout);
			this.showTimeout = null;
			console.log('[LoadingSpinner] Cancelled delayed show');
		}
	}

	/**
	 * Show the spinner immediately with fade-in animation
	 */
	private show(): void {
		if (!this.container || this.isVisible) {
			return;
		}

		console.log('[LoadingSpinner] Showing candy spinner');
		this.isVisible = true;
		this.container.setVisible(true);

		// Reset candy angle to 0 before starting
		if (this.candyImage) {
			this.candyImage.setAngle(0);
		}

		// Fade in animation
		this.scene.tweens.add({
			targets: this.container,
			alpha: 1,
			duration: 200,
			ease: 'Power2'
		});

		// Rotate the candy continuously with smooth linear motion (counter-clockwise)
		this.spinnerTween = this.scene.tweens.add({
			targets: this.candyImage,
			angle: -360,
			duration: 1200, // Slightly slower for smoother rotation
			ease: 'Linear',
			repeat: -1,
			yoyo: false
		});
	}

	/**
	 * Hide the spinner immediately before new symbols drop.
	 * No fade delay — the candy must be gone before dropReels runs.
	 */
	public hide(): void {
		if (!this.container) {
			return;
		}

		console.log('[LoadingSpinner] Hiding spinner immediately');

		this.cancelDelayedShow();

		if (this.spinnerTween) {
			this.spinnerTween.stop();
			this.spinnerTween = null;
		}

		try {
			this.scene.tweens.killTweensOf(this.container);
			if (this.candyImage) {
				this.scene.tweens.killTweensOf(this.candyImage);
				this.candyImage.setAngle(0);
			}
		} catch {}

		this.container.setAlpha(0);
		this.container.setVisible(false);
		this.isVisible = false;
	}

	/**
	 * Update the spinner position (useful if screen is resized)
	 */
	public updatePosition(centerX: number, centerY: number): void {
		this.centerX = centerX;
		this.centerY = centerY;
		
		if (this.container) {
			this.container.setPosition(centerX, centerY);
			console.log('[LoadingSpinner] Position updated to:', centerX, centerY);
		}
	}

	/**
	 * Check if spinner is currently visible
	 */
	public isShowing(): boolean {
		return this.isVisible;
	}

	/**
	 * Clean up and destroy the spinner
	 */
	public destroy(): void {
		console.log('[LoadingSpinner] Destroying spinner');
		
		this.cancelDelayedShow();
		
		if (this.spinnerTween) {
			this.spinnerTween.stop();
			this.spinnerTween = null;
		}

		if (this.container) {
			this.container.destroy();
			this.container = null;
		}

		this.candyImage = null;
		this.isVisible = false;
	}
}
