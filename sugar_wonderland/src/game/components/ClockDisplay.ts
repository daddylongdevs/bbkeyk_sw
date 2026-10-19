import { Scene } from 'phaser';
import { getMilitaryTime } from '../../utils/TimeUtils';

export interface ClockDisplayOptions {
    offsetX?: number;
    offsetY?: number;
    fontSize?: number;
    fontFamily?: string;
    color?: string;
    alpha?: number;
    depth?: number;
    scale?: number;
    /** Legacy: text after live clock (e.g. " | Sugar Wonderland | DEMO") */
    suffixText?: string;
    /** Static title when {@link showClock} is false (e.g. replay banner). */
    gameTitle?: string;
    /** When false, only {@link gameTitle} is shown and the periodic clock update is disabled. */
    showClock?: boolean;
    additionalText?: string;
    additionalTextOffsetX?: number;
    additionalTextOffsetY?: number;
    additionalTextScale?: number;
    additionalTextColor?: string;
    additionalTextFontSize?: number;
    additionalTextFontFamily?: string;
}

export class ClockDisplay {
    private scene: Scene;
    private timeText?: Phaser.GameObjects.Text;
    private additionalText?: Phaser.GameObjects.Text;
    private timeUpdateTimer?: Phaser.Time.TimerEvent;
    private options: ClockDisplayOptions;
    private suffixText: string;
    private showClock: boolean = true;

    constructor(scene: Scene, options?: ClockDisplayOptions) {
        this.scene = scene;
        this.options = options || {
            offsetX: 0,
            offsetY: 0,
            fontSize: 14,
            color: '#FFFFFF',
            alpha: 0.50,
            depth: 30000
        };
        this.showClock = this.options.showClock !== false;
    }

    public create(): void {
        const timeX = (this.options.offsetX || 0);
        const timeY = (this.options.offsetY || 0);
        const fontSize = this.options.fontSize || 14;
        const fontFamily = this.options.fontFamily || 'Arial';
        const textColor = this.options.color || '#FFFFFF';
        const alpha = this.options.alpha !== undefined ? this.options.alpha : 0.50;
        const depth = this.options.depth || 30000;
        const scale = this.options.scale !== undefined ? this.options.scale : 1.0;

        if (this.showClock) {
            this.suffixText = this.options.suffixText || '';
        } else {
            this.suffixText = this.options.gameTitle || this.options.suffixText || '';
        }

        const initialTime = getMilitaryTime();
        const displayText = this.showClock
            ? (this.suffixText ? `${initialTime}${this.suffixText}` : initialTime)
            : this.suffixText;

        const timeText = this.scene.add.text(
            timeX,
            timeY,
            displayText,
            {
                fontFamily: fontFamily,
                fontSize: `${fontSize}px`,
                color: textColor,
                fontStyle: 'normal',
                align: 'left'
            }
        ).setOrigin(0.0, 0.0)
         .setScrollFactor(0)
         .setAlpha(alpha)
         .setDepth(depth)
         .setScale(scale);

        try {
            const textObj = timeText as any;
            const originalUpdateText = textObj.updateText?.bind(textObj);
            if (originalUpdateText) {
                textObj.updateText = function(this: any) {
                    originalUpdateText();
                    if (this.context) {
                        this.context.font = `500 ${fontSize}px ${fontFamily}`;
                    }
                }.bind(textObj);
                textObj.updateText();
            }
        } catch (e) {
            console.warn('[ClockDisplay] Could not set font weight 500, using default. Error:', e);
        }

        this.timeText = timeText;
        console.log(`[ClockDisplay] Clock created at (${timeX}, ${timeY}) with font size ${fontSize}px`);

        if (this.options.additionalText) {
            const additionalX = this.scene.scale.width - (this.options.additionalTextOffsetX || 0);
            const additionalY = (this.options.offsetY || 0) + (this.options.additionalTextOffsetY || 0);
            const additionalFontSize = this.options.additionalTextFontSize || fontSize;
            const additionalFontFamily = this.options.additionalTextFontFamily || fontFamily;
            const additionalColor = this.options.additionalTextColor || textColor;
            const additionalScale = this.options.additionalTextScale !== undefined ? this.options.additionalTextScale : 1.0;

            const additionalTextObj = this.scene.add.text(
                additionalX,
                additionalY,
                this.options.additionalText,
                {
                    fontFamily: additionalFontFamily,
                    fontSize: `${additionalFontSize}px`,
                    color: additionalColor,
                    fontStyle: 'normal',
                    align: 'right'
                }
            ).setOrigin(1.0, 0.0)
             .setScrollFactor(0)
             .setAlpha(alpha)
             .setDepth(depth)
             .setScale(additionalScale);

            try {
                const textObj = additionalTextObj as any;
                const originalUpdateText = textObj.updateText?.bind(textObj);
                if (originalUpdateText) {
                    textObj.updateText = function(this: any) {
                        originalUpdateText();
                        if (this.context) {
                            this.context.font = `500 ${additionalFontSize}px ${additionalFontFamily}`;
                        }
                    }.bind(textObj);
                    textObj.updateText();
                }
            } catch (e) {
                console.warn('[ClockDisplay] Could not set font weight 500 for additional text. Error:', e);
            }

            this.additionalText = additionalTextObj;
        }

        if (this.showClock) {
            this.timeUpdateTimer = this.scene.time.addEvent({
                delay: 1000,
                callback: () => {
                    this.refreshDisplayText();
                },
                loop: true
            });
        }
    }

    private refreshDisplayText(): void {
        if (!this.timeText) {
            return;
        }
        if (!this.showClock) {
            this.timeText.setText(this.suffixText);
            return;
        }
        const currentTime = getMilitaryTime();
        const displayText = this.suffixText ? `${currentTime}${this.suffixText}` : currentTime;
        this.timeText.setText(displayText);
    }

    public setSuffixText(suffixText: string): void {
        if (!this.showClock) {
            return;
        }
        this.suffixText = suffixText;
        this.refreshDisplayText();
    }

    /** Update static title (replay label) when {@link showClock} is false. */
    public setGameTitle(gameTitle: string): void {
        this.suffixText = gameTitle;
        this.refreshDisplayText();
    }

    public destroy(): void {
        try {
            if (this.timeUpdateTimer) {
                this.timeUpdateTimer.destroy();
                this.timeUpdateTimer = undefined;
            }
        } catch {}

        try {
            if (this.timeText) {
                this.timeText.destroy();
                this.timeText = undefined;
            }
        } catch {}

        try {
            if (this.additionalText) {
                this.additionalText.destroy();
                this.additionalText = undefined;
            }
        } catch {}
    }
}
