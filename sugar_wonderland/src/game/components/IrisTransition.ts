import { Scene } from 'phaser';

/**
 * IrisTransition component that displays a black overlay with a transparent circular hole
 */
export class IrisTransition {
    private scene: Scene;
    private overlay: Phaser.GameObjects.Graphics;
    private maskShape: Phaser.GameObjects.Graphics;
    private currentRadius: number = 100;
    private centerX: number;
    private centerY: number;
    private animationSpeed: number = 1000; // Duration in milliseconds for radius changes
    private isAnimating: boolean = false;
    
    // Radius range configuration
    private minRadius: number = 0;
    private maxRadius: number = 1000;
    private radiusStep: number = 20; // How much to change per key press

    	constructor(scene: Scene) {
		this.scene = scene;
		this.createOverlay();
		this.setupKeyboardInput();
		
		// Start hidden - only show when needed for transitions
		this.overlay.setVisible(false);
	}

    /**
     * Create the black overlay graphic with transparent circular hole
     */
    private createOverlay(): void {
        // Create a graphics object for the overlay
        this.overlay = this.scene.add.graphics();
        
        // Position circle in upper right area
        this.centerX = this.scene.scale.width * 0.71; // 80% from left (upper right)
        this.centerY = this.scene.scale.height * 0.22; // 20% from top (upper right)
        this.currentRadius = 1000; // Radius of the transparent circle

        // Clear any existing graphics
        this.overlay.clear();

        // Set the fill style to black with full opacity
        this.overlay.fillStyle(0x000000, 1);

        // Draw a filled rectangle covering the entire screen
        this.overlay.fillRect(0, 0, this.scene.scale.width, this.scene.scale.height);

        // Create a graphics object for the mask
        this.maskShape = this.scene.make.graphics();
        
        // Create a circular mask for the transparent hole
        this.maskShape.fillStyle(0xffffff, 1);
        this.maskShape.beginPath();
        this.maskShape.fillCircle(this.centerX, this.centerY, this.currentRadius);
        
        // Create the mask and invert it to make the circle transparent
        const mask = this.maskShape.createGeometryMask();
        mask.invertAlpha = true; // Invert the mask so the circle is transparent

        // Apply the inverted mask to the overlay
        this.overlay.setMask(mask);

        // Set high depth to ensure overlay is in front
        this.overlay.setDepth(10000);

        // Make overlay visible
        this.overlay.setVisible(true);

        console.log('[IrisTransition] Black overlay with transparent circular hole created');
    }

    /**
     * Setup keyboard input for T and Y keys
     */
    private setupKeyboardInput(): void {
        // T key - zoom in (shrink) to 35 radius
        this.scene.input.keyboard?.on('keydown-T', () => {
            console.log('[IrisTransition] T key pressed - zooming in to 35 radius');
            this.zoomInToRadius(28);
        });

        // Y key - zoom out (enlarge) to 1000 radius
        this.scene.input.keyboard?.on('keydown-Y', () => {
            console.log('[IrisTransition] Y key pressed - zooming out to 1000 radius');
            this.zoomInToRadius(1000);
        });
    }

    /**
     * Zoom in to a specific radius smoothly
     * @param targetRadius The target radius to zoom to
     * @param customSpeed Optional custom animation speed in milliseconds
     */
    public zoomInToRadius(targetRadius: number, customSpeed?: number): void {
        if (this.isAnimating) {
            console.log('[IrisTransition] Already animating, ignoring request');
            return;
        }

        // Ensure target radius is within valid range
        targetRadius = Math.max(this.minRadius, Math.min(this.maxRadius, targetRadius));
        
        if (targetRadius === this.currentRadius) {
            console.log(`[IrisTransition] Already at target radius: ${targetRadius}`);
            return;
        }

        // Use custom speed if provided, otherwise use default animation speed
        const duration = customSpeed || this.animationSpeed;
        
        console.log(`[IrisTransition] Zooming in from ${this.currentRadius} to ${targetRadius} with speed: ${duration}ms`);
        
        // Create smooth tween to the target radius
        this.scene.tweens.add({
            targets: this,
            currentRadius: targetRadius,
            duration: duration,
            ease: 'Power2',
            onUpdate: () => {
                // Update the mask in real-time during the tween
                this.updateMask();
            },
            onComplete: () => {
                console.log(`[IrisTransition] Zoom in complete, radius: ${this.currentRadius}`);
            }
        });
    }



    /**
     * Change the radius smoothly (enlarge or shrink)
     */
    public changeRadius(change: number): void {
        if (this.isAnimating) {
            console.log('[IrisTransition] Already animating, ignoring request');
            return;
        }

        // Calculate target radius
        const targetRadius = Math.max(this.minRadius, Math.min(this.maxRadius, this.currentRadius + change));
        
        if (targetRadius === this.currentRadius) {
            console.log(`[IrisTransition] Already at ${change > 0 ? 'maximum' : 'minimum'} radius`);
            return;
        }

        this.isAnimating = true;
        const action = change > 0 ? 'enlarging' : 'shrinking';
        console.log(`[IrisTransition] Smoothly ${action} from ${this.currentRadius} to ${targetRadius}`);

        // Create smooth tween for the radius
        this.scene.tweens.add({
            targets: this,
            currentRadius: targetRadius,
            duration: this.animationSpeed,
            ease: 'Power2',
            onUpdate: () => {
                // Update the mask in real-time during the tween
                this.updateMask();
            },
            onComplete: () => {
                this.isAnimating = false;
                console.log(`[IrisTransition] ${action} complete, radius: ${this.currentRadius}`);
            }
        });
    }

    /**
     * Update the mask with current radius
     */
    private updateMask(): void {
        // Clear and redraw the mask
        this.maskShape.clear();
        this.maskShape.fillStyle(0xffffff, 1);
        this.maskShape.beginPath();
        this.maskShape.fillCircle(this.centerX, this.centerY, this.currentRadius);
    }

    /**
     * Set radius to a specific value smoothly
     */
    private setRadius(targetRadius: number): void {
        if (this.isAnimating) {
            console.log('[IrisTransition] Cannot set radius while animating');
            return;
        }

        // Clamp to valid range
        targetRadius = Math.max(this.minRadius, Math.min(this.maxRadius, targetRadius));
        
        if (targetRadius === this.currentRadius) {
            console.log(`[IrisTransition] Already at target radius: ${targetRadius}`);
            return;
        }

        console.log(`[IrisTransition] Setting radius from ${this.currentRadius} to ${targetRadius}`);
        
        // Create smooth tween to the target radius
        this.scene.tweens.add({
            targets: this,
            currentRadius: targetRadius,
            duration: this.animationSpeed,
            ease: 'Power2',
            onUpdate: () => {
                // Update the mask in real-time during the tween
                this.updateMask();
            },
            onComplete: () => {
                console.log(`[IrisTransition] Set radius complete: ${this.currentRadius}`);
            }
        });
    }

    /**
     * Reset mask to original size
     */
    private resetMask(): void {
        if (this.isAnimating) {
            console.log('[IrisTransition] Cannot reset while animating');
            return;
        }

        console.log(`[IrisTransition] Resetting mask from ${this.currentRadius} to 100`);
        
        // Create smooth tween to reset the radius
        this.scene.tweens.add({
            targets: this,
            currentRadius: 100,
            duration: this.animationSpeed,
            ease: 'Power2',
            onUpdate: () => {
                // Update the mask in real-time during the tween
                this.updateMask();
            },
            onComplete: () => {
                console.log(`[IrisTransition] Reset complete, radius: ${this.currentRadius}`);
            }
        });
    }

    /**
     * Set radius immediately without animation
     * @param radius The radius to set immediately
     */
    public setRadiusImmediate(radius: number): void {
        // Ensure radius is within valid range
        radius = Math.max(this.minRadius, Math.min(this.maxRadius, radius));
        
        this.currentRadius = radius;
        this.updateMask();
        console.log(`[IrisTransition] Radius set immediately to: ${this.currentRadius}`);
    }

    /**
     * Set animation speed (in milliseconds)
     */
    public setAnimationSpeed(speed: number): void {
        this.animationSpeed = Math.max(50, Math.min(1000, speed));
        console.log(`[IrisTransition] Animation speed set to ${this.animationSpeed}ms`);
    }

    /**
     * Get current animation speed
     */
    public getAnimationSpeed(): number {
        return this.animationSpeed;
    }

    /**
     * Set radius range configuration
     */
    public setRadiusRange(min: number, max: number, step: number): void {
        this.minRadius = Math.max(5, min);
        this.maxRadius = Math.max(this.minRadius + 10, max);
        this.radiusStep = Math.max(1, step);
        console.log(`[IrisTransition] Radius range set: min=${this.minRadius}, max=${this.maxRadius}, step=${this.radiusStep}`);
    }

    	/**
	 * Get current radius range configuration
	 */
	public getRadiusRange(): { min: number; max: number; step: number } {
		return {
			min: this.minRadius,
			max: this.maxRadius,
			step: this.radiusStep
		};
	}
	
	/**
	 * Show the iris transition overlay
	 */
	public show(): void {
		this.overlay.setVisible(true);
		console.log('[IrisTransition] Overlay shown');
	}
	
	/**
	 * Hide the iris transition overlay
	 */
	public hide(): void {
		this.overlay.setVisible(false);
		console.log('[IrisTransition] Overlay hidden');
	}
}