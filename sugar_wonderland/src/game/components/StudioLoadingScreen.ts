import { Scene } from 'phaser';
import { ensureSpineLoader } from '../../utils/SpineGuard';
import { AssetLoader } from '../../utils/AssetLoader';

export interface StudioLoadingScreenOptions {
    loadingFrameOffsetX?: number;
    loadingFrameOffsetY?: number;
    loadingFrameScaleModifier?: number;
    text?: string;
    textOffsetX?: number;
    textOffsetY?: number;
    textScale?: number;
    textColor?: string;
    text2?: string;
    text2OffsetX?: number;
    text2OffsetY?: number;
    text2Scale?: number;
    text2Color?: string;
    showTime?: boolean;
    timeOffsetX?: number;
    timeOffsetY?: number;
    timeScale?: number;
    timeColor?: string;
}

export class StudioLoadingScreen {
    private scene: Scene;
    private container: Phaser.GameObjects.Container;
    private shownAtMs: number = 0;
    private spine?: any;
    private bg?: Phaser.GameObjects.Rectangle;
    private loadingFrame?: Phaser.GameObjects.Image;
    private text?: Phaser.GameObjects.Text;
    private text2?: Phaser.GameObjects.Text;
    private timeText?: Phaser.GameObjects.Text;
    private timeUpdateTimer?: Phaser.Time.TimerEvent;
    private progressBarBg?: Phaser.GameObjects.Graphics;
    private progressBarFill?: Phaser.GameObjects.Graphics;
	private progressBarX?: number;
    private progressBarY?: number;
    private progressBarWidth?: number;
    private progressBarHeight?: number;
    private progressBarPadding: number = 3;
    private onProgressHandler?: (progress: number) => void;
    private options: StudioLoadingScreenOptions;
    private dotGrid?: Phaser.GameObjects.Graphics;

    constructor(scene: Scene, options?: StudioLoadingScreenOptions) {
        this.scene = scene;
        this.container = scene.add.container(0, 0);
        this.container.setDepth(999);
        this.options = options || {
            loadingFrameOffsetX: 0,
            loadingFrameOffsetY: 0,
            loadingFrameScaleModifier: 0.06,
            text: 'Play Loud. Win Wild. DiJoker Style',
            textOffsetX: 0,
            textOffsetY: 0,
            textScale: 1.0,
            textColor: '#FFFFFF',
        };
    }

    public show(): void {
        try {
            this.shownAtMs = this.scene.time.now;
            // Solid background color #10161D
            const bgColor = 0x10161D;
            const bg = this.scene.add.rectangle(
                this.scene.scale.width * 0.5,
                this.scene.scale.height * 0.5,
                this.scene.scale.width,
                this.scene.scale.height,
                bgColor
            ).setOrigin(0.5, 0.5);
            this.container.add(bg);
            this.bg = bg;

            // Create dot grid background overlay
            this.createDotGrid();

            // Add loading frame if texture exists
            if (this.scene.textures.exists("loading_frame")) {
                const centerX = this.scene.scale.width * 0.5 + (this.options.loadingFrameOffsetX || 0);
                // Allow vertical positioning via options; default slightly lower to match game layout
                const frameOffsetY = this.options.loadingFrameOffsetY ?? 345;
                const loadingFrame = this.scene.add.image(
                    centerX,
                    this.scene.scale.height * 0.5 + frameOffsetY,
                    "loading_frame"
                ).setOrigin(0.5, 0.5).setScrollFactor(0);

                // Scale loading frame to cover screen, then apply scale modifier
                const frameScaleX = this.scene.scale.width / loadingFrame.width;
                const frameScaleY = this.scene.scale.height / loadingFrame.height;
                const baseScale = Math.max(frameScaleX, frameScaleY);
                const finalScale = baseScale * (this.options.loadingFrameScaleModifier || 1.0);
                loadingFrame.setScale(finalScale);

                this.container.add(loadingFrame);
                this.loadingFrame = loadingFrame;
                console.log(`[StudioLoadingScreen] Loading frame displayed at scale: ${finalScale}x (base: ${baseScale}x, modifier: ${this.options.loadingFrameScaleModifier || 1.0})`);
            } else {
                console.warn('[StudioLoadingScreen] Loading frame texture not found');
            }

            // Add text if provided
            if (this.options.text) {
                const textX = this.scene.scale.width * 0.5 + (this.options.textOffsetX || 0);
                // Allow vertical positioning via options; default slightly lower to match game layout
                const textBaseY = this.options.textOffsetY ?? 375;
                const textY = this.scene.scale.height * 0.5 + textBaseY;
                
                // Base font size - 14px as specified, scaled by textScale modifier
                const baseFontSize = 14;
                const fontSize = baseFontSize * (this.options.textScale || 1.0);
                
                // Convert rgba color to Phaser color format (0xFFFFFF with alpha)
                // rgba(255, 255, 255, 0.50) = white with 50% opacity
                const textColor = this.options.textColor || '#FFFFFF';
                const alpha = 0.50; // 50% opacity as specified
                
                // Create text with specified styles matching CSS properties:
                // color: rgba(255, 255, 255, 0.50)
                // font-family: poppins-regular
                // font-size: 14px
                // font-style: normal
                // font-weight: 500
                // text-transform: uppercase
                const text = this.scene.add.text(
                    textX,
                    textY,
                    this.options.text.toUpperCase(), // text-transform: uppercase
                    {
                        fontFamily: 'poppins-regular',
                        fontSize: `${fontSize}px`,
                        color: textColor,
                        fontStyle: 'normal',
                        align: 'center'
                    }
                ).setOrigin(0.5, 0.5)
                 .setScrollFactor(0)
                 .setAlpha(alpha);
                
                // Set font weight 500 by overriding the canvas context font
                // Phaser uses canvas rendering, so we need to set the font string with weight
                try {
                    const textObj = text as any;
                    // Override the updateText method to set font with weight 500
                    const originalUpdateText = textObj.updateText?.bind(textObj);
                    if (originalUpdateText) {
                        textObj.updateText = function(this: any) {
                            originalUpdateText();
                            // Set canvas context font with weight 500
                            if (this.context) {
                                // Format: "500 14px poppins-regular" (weight size family)
                                this.context.font = `500 ${fontSize}px poppins-regular`;
                            }
                        }.bind(textObj);
                        // Force update to apply the font weight
                        textObj.updateText();
                    }
                } catch (e) {
                    console.warn('[StudioLoadingScreen] Could not set font weight 500, using default. Error:', e);
                }

                this.container.add(text);
                this.text = text;
                console.log(`[StudioLoadingScreen] Text displayed: "${this.options.text}" at (${textX}, ${textY}) with font size ${fontSize}px, weight 500, and alpha ${alpha}`);
            }

            // Add second text if provided
            if (this.options.text2) {
                const text2X = this.scene.scale.width * 0.5 + (this.options.text2OffsetX || 0);
                // Allow vertical positioning via options; default slightly lower to match game layout
                const text2BaseY = this.options.text2OffsetY ?? 400;
                const text2Y = this.scene.scale.height * 0.5 + text2BaseY;
                
                // Base font size - 14px as specified, scaled by text2Scale modifier
                const baseFontSize = 14;
                const fontSize = baseFontSize * (this.options.text2Scale || 1.0);
                
                // Convert rgba color to Phaser color format (0xFFFFFF with alpha)
                // rgba(255, 255, 255, 0.50) = white with 50% opacity
                const textColor = this.options.text2Color || '#FFFFFF';
                const alpha = 0.50; // 50% opacity as specified
                
                // Create text with specified styles matching CSS properties:
                // color: rgba(255, 255, 255, 0.50)
                // font-family: poppins-regular
                // font-size: 14px
                // font-style: normal
                // font-weight: 500
                // text-transform: uppercase
                const text2 = this.scene.add.text(
                    text2X,
                    text2Y,
                    this.options.text2,
                    {
                        fontFamily: 'poppins-regular',
                        fontSize: `${fontSize}px`,
                        color: textColor,
                        fontStyle: 'normal',
                        align: 'center'
                    }
                ).setOrigin(0.5, 0.5)
                 .setScrollFactor(0)
                 .setAlpha(alpha);
                
                // Set font weight 500 by overriding the canvas context font
                // Phaser uses canvas rendering, so we need to set the font string with weight
                try {
                    const textObj = text2 as any;
                    // Override the updateText method to set font with weight 500
                    const originalUpdateText = textObj.updateText?.bind(textObj);
                    if (originalUpdateText) {
                        textObj.updateText = function(this: any) {
                            originalUpdateText();
                            // Set canvas context font with weight 500
                            if (this.context) {
                                // Format: "500 14px poppins-regular" (weight size family)
                                this.context.font = `500 ${fontSize}px poppins-regular`;
                            }
                        }.bind(textObj);
                        // Force update to apply the font weight
                        textObj.updateText();
                    }
                } catch (e) {
                    console.warn('[StudioLoadingScreen] Could not set font weight 500 for text2, using default. Error:', e);
                }

                this.container.add(text2);
                this.text2 = text2;
                console.log(`[StudioLoadingScreen] Text2 displayed: "${this.options.text2}" at (${text2X}, ${text2Y}) with font size ${fontSize}px, weight 500, and alpha ${alpha}`);
            }

            const applyStudioFonts = (): void => {
                this.text?.setFontFamily('poppins-regular');
                this.text2?.setFontFamily('poppins-regular');
                try {
                    (this.text as any)?.updateText?.();
                    (this.text2 as any)?.updateText?.();
                } catch {}
            };

            try {
                const fontsObj: any = (document as any).fonts;
                if (fontsObj && typeof fontsObj.load === 'function') {
                    Promise.allSettled([
                        fontsObj.load('1em poppins-regular')
                    ]).then(() => {
                        applyStudioFonts();
                    }).catch(() => {
                        applyStudioFonts();
                    });
                } else if (fontsObj && typeof fontsObj.ready?.then === 'function') {
                    fontsObj.ready.then(() => {
                        applyStudioFonts();
                    }).catch(() => {
                        applyStudioFonts();
                    });
                } else {
                    applyStudioFonts();
                }
            } catch {
                applyStudioFonts();
            }

            // Time display disabled in this game (no TimeUtils helper available)

            // Spine animation (DI JOKER)
            const hasSpine = ensureSpineLoader(this.scene, '[StudioLoadingScreen] show');
            if (hasSpine) {
                const cx = this.scene.scale.width * 0.35;
                const cy = this.scene.scale.height * 0.48;
                const spine = (this.scene.add as any).spine(cx, cy, 'di_joker', 'di_joker-atlas');
                spine.setOrigin(0.5, 0.5);

                // Auto scale to fit comfortably
                const desiredHeight = this.scene.scale.height * 0.4;
                const spineH = (spine as any).height || 800;
                const scale = desiredHeight / spineH;
                spine.setScale(0.09);
                this.container.add(spine);
                this.spine = spine;

                try { (spine as any).animationState?.setAnimation(0, 'animation', true); } catch {}
                
                // Add DiJoker logo next to the spine
                if (this.scene.textures.exists('dijoker_logo')) {
                    const logo = this.scene.add.image(
                        cx + this.scene.scale.width * 0.27, // Position to the right of the spine
                        cy,
                        'dijoker_logo'
                    );
                    
                    // Scale the logo appropriately (adjust scale factor as needed)
                    const logoScale = 1; // Adjust this value to make the logo larger or smaller
                    logo.setScale(logoScale);
                    
                    // Center the logo vertically with the spine
                    logo.setOrigin(0.5, 0.5);
                    
                    // Add to the same container as the spine for proper layering
                    this.container.add(logo);
                } else {
                    console.warn('DiJoker logo texture not found');
                }
            }

            // Progress bar (similar to Preloader) – positioned just below the spine
            const assetScale = 1; // static scale for studio screen
            const barWidth = this.scene.scale.width * 0.5;
            const barHeight = Math.max(13, 13 * assetScale);
            const barX = this.scene.scale.width * 0.5;
            let barY = this.scene.scale.height * 0.8;
            if (this.spine) {
                const cy = this.scene.scale.height * 0.5;
                const spineH = ((this.spine as any).height || 800) as number;
                const appliedScaleY = (this.spine.scaleY ?? this.spine.scale ?? 1) as number;
                const displayH = spineH * appliedScaleY;
                barY = cy + displayH * 0.5 + Math.max(20, 24 * assetScale);
            }

            // Store progress bar properties for animation updates
            this.progressBarX = barX;
            this.progressBarY = barY;
            this.progressBarWidth = barWidth;
            this.progressBarHeight = barHeight;

            // Create progress bar background
            this.progressBarBg = this.scene.add.graphics();
            this.progressBarBg.setPosition(0, 0); // Position at container origin
            this.progressBarBg.setScrollFactor(0);
            // Draw background rectangle at screen coordinates (container is at 0,0 so coordinates are absolute)
            this.progressBarBg.fillStyle(0x000000, 0.5);
            this.progressBarBg.fillRoundedRect(barX - barWidth * 0.5, barY - barHeight * 0.5, barWidth, barHeight, barHeight * 0.5);
            this.container.add(this.progressBarBg);

            // Create progress bar fill
            this.progressBarFill = this.scene.add.graphics();
            this.progressBarFill.setPosition(0, 0); // Position at container origin
            this.progressBarFill.setScrollFactor(0);
            // Initial empty fill
            const innerX = barX - barWidth * 0.5 + this.progressBarPadding;
            const innerY = barY - barHeight * 0.5 + this.progressBarPadding;
            const innerWidth = barWidth - this.progressBarPadding * 2;
            const innerHeight = barHeight - this.progressBarPadding * 2;
            this.progressBarFill.fillStyle(0x66D449, 1);
            this.progressBarFill.fillRoundedRect(innerX, innerY, 0, innerHeight, innerHeight * 0.5);
            this.container.add(this.progressBarFill);

            const updateFill = (progress: number) => {
                if (!this.progressBarFill || this.progressBarX === undefined || this.progressBarY === undefined || this.progressBarWidth === undefined || this.progressBarHeight === undefined) {
                    return;
                }
                const fillX = this.progressBarX - this.progressBarWidth * 0.5 + this.progressBarPadding;
                const fillY = this.progressBarY - this.progressBarHeight * 0.5 + this.progressBarPadding;
                const fillWidth = this.progressBarWidth - this.progressBarPadding * 2;
                const fillHeight = this.progressBarHeight - this.progressBarPadding * 2;
                const p = Math.max(0, Math.min(1, progress));
                this.progressBarFill.clear();
                this.progressBarFill.fillStyle(0x37DB6E, 1);
                this.progressBarFill.fillRoundedRect(
                    fillX,
                    fillY,
                    Math.max(0.0001, fillWidth * p),
                    fillHeight,
                    fillHeight * 0.5
                );
            };

            updateFill(0);

            this.onProgressHandler = (p: number) => updateFill(p);
            this.scene.load.on('progress', this.onProgressHandler as any);

            this.scene.load.once('complete', () => {
                this.fadeOutAndDestroy(3000, 500);
            });
        } catch (e) {
            console.warn('[StudioLoadingScreen] Failed to display spine:', e);
        }
    }

    public fadeOutAndDestroy(minVisibleMs: number = 3000, fadeMs: number = 500, onComplete?: () => void): void {
        const elapsed = this.scene.time.now - this.shownAtMs;
        const wait = Math.max(0, minVisibleMs - elapsed);
        this.scene.time.delayedCall(wait, () => {
			// Detach progress listener and hide progress bar before fade
			try {
				if (this.onProgressHandler) {
					this.scene.load.off('progress', this.onProgressHandler as any);
					this.onProgressHandler = undefined;
				}
				this.progressBarFill?.setVisible(false);
				this.progressBarBg?.setVisible(false);
			} catch {}

            // Stop time update timer
            try {
                if (this.timeUpdateTimer) {
                    this.timeUpdateTimer.destroy();
                    this.timeUpdateTimer = undefined;
                }
            } catch {}

            // First disable/stop spine animations
            try {
                if (this.spine) {
                    this.spine.animationState?.clearTracks();
                    this.spine.setVisible(false);
                }
            } catch {}

            // Fade out the entire container (including background, loading frame, and all children)
            // This ensures everything (including the loading frame) fades together smoothly
            this.scene.tweens.add({
                targets: this.container,
                alpha: 0,
                duration: fadeMs,
                ease: 'Power2',
                onComplete: () => {
                    this.hide();
                    try { this.scene.events.emit('studio-fade-complete'); } catch {}
                    if (onComplete) onComplete();
                }
            });
        });
    }

    public hide(): void {
        this.container.destroy(true);
    }

    private createDotGrid(): void {
        // Create graphics object for dot grid
        const dotGridGraphics = this.scene.add.graphics();
        
        // Dot grid configuration
        const dotSpacing = 20; // Spacing between dots in pixels
        const dotRadius = 1; // Radius of each dot
        const dotColor = 0xFFFFFF; // White color
        const dotAlpha = 0.15; // 20% opacity
        
        // Calculate grid dimensions
        const width = this.scene.scale.width;
        const height = this.scene.scale.height;
        
        // Calculate number of dots needed (add padding to ensure full coverage)
        const cols = Math.ceil(width / dotSpacing) + 1;
        const rows = Math.ceil(height / dotSpacing) + 1;
        
        // Calculate starting offset to center the grid
        const offsetX = (width - (cols - 1) * dotSpacing) * 0.5;
        const offsetY = (height - (rows - 1) * dotSpacing) * 0.5;
        
        // Set fill style for dots
        dotGridGraphics.fillStyle(dotColor, dotAlpha);
        
        // Draw dots in a grid pattern
        // Since graphics are added to container at (0,0), we draw at screen coordinates
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                const x = offsetX + col * dotSpacing;
                const y = offsetY + row * dotSpacing;
                
                // Draw circle (dot)
                dotGridGraphics.fillCircle(x, y, dotRadius);
            }
        }
        
        // Position graphics at origin (0,0) relative to container
        dotGridGraphics.setPosition(0, 0);
        dotGridGraphics.setScrollFactor(0);
        
        // Add to container - will render behind loading frame (added after) but above background (added before)
        this.container.add(dotGridGraphics);
        this.dotGrid = dotGridGraphics;
        
        console.log(`[StudioLoadingScreen] Dot grid created: ${cols}x${rows} dots, spacing: ${dotSpacing}px, radius: ${dotRadius}px`);
    }

    public beginLoading(assetLoader: AssetLoader): void {
        assetLoader.loadBuyFeatureAssets(this.scene);
        assetLoader.loadBackgroundAssets(this.scene);
        assetLoader.loadBonusBackgroundAssets(this.scene);
        assetLoader.loadBonusHeaderAssets(this.scene);
        assetLoader.loadButtonAssets(this.scene);
        assetLoader.loadHeaderAssets(this.scene);
        assetLoader.loadMenuAssets(this.scene);
        assetLoader.loadHelpScreenAssets(this.scene);
        assetLoader.loadSymbolAssets(this.scene);
        assetLoader.loadNumberAssets(this.scene);
        // Optional groups not present in this game have been omitted
        assetLoader.loadDialogAssets(this.scene);
        console.log('[StudioLoadingScreen] Queued game assets (optimized, audio handled separately)');
    }
}

export function queueGameAssetLoading(scene: Scene, assetLoader: AssetLoader): void {
    assetLoader.loadBuyFeatureAssets(scene);
    assetLoader.loadBackgroundAssets(scene);
    assetLoader.loadBonusBackgroundAssets(scene);
    assetLoader.loadBonusHeaderAssets(scene);
    assetLoader.loadButtonAssets(scene);
    assetLoader.loadHeaderAssets(scene);
    assetLoader.loadMenuAssets(scene);
    assetLoader.loadHelpScreenAssets(scene);
    assetLoader.loadSymbolAssets(scene);
    assetLoader.loadNumberAssets(scene);
    assetLoader.loadDialogAssets(scene);
    // Optional groups not present in this game have been omitted
    console.log('[StudioLoadingScreen] Queued game asset loading (optimized, audio handled separately)');
}
