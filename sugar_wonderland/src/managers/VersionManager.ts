import { Scene } from 'phaser';

export interface VersionDisplayOptions {
    offsetX?: number;
    offsetY?: number;
    fontSize?: number;
    fontFamily?: string;
    color?: string;
    alpha?: number;
    depth?: number;
    scale?: number;
}

/**
 * Manages application version and provides a display component.
 * Version format: v1.x.x.x (e.g. v1.1.0.0)
 */
export class VersionManager {
    private static readonly FALLBACK_VERSION = '1.0.0.22';

    /**
     * Returns the application version in v1.x.x.x format.
     * Reads from window.APP_CONFIG['version'] (same source as game-url).
     */
    public static getVersion(): string {
        const configured = (window as any)?.APP_CONFIG?.['version'];
        const raw = typeof configured === 'string' && configured.length > 0
            ? configured
            : VersionManager.FALLBACK_VERSION;
        return VersionManager.formatVersion(raw);
    }

    /**
     * Normalizes a semver string to v1.x.x.x format (4 segments).
     */
    public static formatVersion(raw: string): string {
        const cleaned = String(raw).trim().replace(/^v/i, '');
        const parts = cleaned.split('.').map((p) => p.replace(/\D/g, '') || '0');
        const [major = '1', minor = '0', patch = '0', build = '0'] = parts;
        return `v${major}.${minor}.${patch}.${build}`;
    }

    private scene: Scene;
    private versionText?: Phaser.GameObjects.Text;
    private options: VersionDisplayOptions;

    constructor(scene: Scene, options?: VersionDisplayOptions) {
        this.scene = scene;
        this.options = options ?? {};
    }

    /**
     * Creates the version display in the scene.
     * Uses the same text formatting as ClockDisplay (poppins-regular, alpha 0.5, etc.).
     */
    public create(): void {
        const versionStr = VersionManager.getVersion();
        const fontSize = this.options.fontSize ?? 16;
        const fontFamily = this.options.fontFamily ?? 'poppins-regular';
        const textColor = this.options.color ?? '#FFFFFF';
        const alpha = this.options.alpha ?? 0.5;
        const depth = this.options.depth ?? 30000;
        const scale = this.options.scale ?? 0.7;

        // Bottom right: origin at (1, 1), offset from right and bottom
        const marginX = 16;
        const marginY = 16;
        const x = this.scene.scale.width - marginX + (this.options.offsetX ?? 0);
        const y = this.scene.scale.height - marginY + (this.options.offsetY ?? 0);

        const versionText = this.scene.add.text(
            x,
            y,
            versionStr,
            {
                fontFamily,
                fontSize: `${fontSize}px`,
                color: textColor,
                fontStyle: 'normal',
                align: 'right',
            }
        )
            .setOrigin(1, 1)
            .setScrollFactor(0)
            .setAlpha(alpha)
            .setDepth(depth)
            .setScale(scale);

        // Match ClockDisplay: font weight 500 via canvas context
        try {
            const textObj = versionText as Phaser.GameObjects.Text & { updateText?: () => void; context?: CanvasRenderingContext2D };
            const originalUpdateText = textObj.updateText?.bind(textObj);
            if (originalUpdateText) {
                textObj.updateText = function (this: typeof textObj) {
                    originalUpdateText();
                    if (this.context) {
                        this.context.font = `500 ${fontSize}px ${fontFamily}`;
                    }
                }.bind(textObj);
                textObj.updateText();
            }
        } catch {
            // Ignore if font weight override fails
        }

        this.versionText = versionText;
    }

    /** Re-apply font family (call when document.fonts.ready resolves). */
    public setFontFamily(fontFamily: string): void {
        this.versionText?.setFontFamily(fontFamily);
    }

    public destroy(): void {
        try {
            if (this.versionText) {
                this.versionText.destroy();
                this.versionText = undefined;
            }
        } catch {}
    }
}
