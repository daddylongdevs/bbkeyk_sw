import { Scene, GameObjects } from 'phaser';
import { SpinData } from '../../backend/SpinData';
import { formatCurrencyNumber } from '../../utils/NumberPrecisionFormatter';

export class ReplayPopup extends GameObjects.Container {
    private background: GameObjects.Graphics;
    private titleText: GameObjects.Text;
    private messageText: GameObjects.Text;
    private txnLabelText: GameObjects.Text;
    private txnIdText: GameObjects.Text;
    private extraInfoText: GameObjects.Text;
    private summaryTxnValueText: GameObjects.Text;
    private buttonImage: GameObjects.Image;
    private buttonText: GameObjects.Text;
    private backgroundColor: number = 0x000000;
    private backgroundAlpha: number = 0.8;
    private cornerRadius: number = 20;
    private buttonOffsetY: number = 130;
    private buttonScale: number = 0.8;
    private buttonWidth: number = 364;
    private buttonHeight: number = 62;
    private animationDuration: number = 300;
    private overlay: Phaser.GameObjects.Graphics;
    private onContinueCallback?: () => void;
    private onHideCallback?: () => void;
    private displayMode: 'initial' | 'summary' = 'initial';

    private getPanelWidth(): number {
        return this.scene.scale.width * 0.8;
    }

    /** Horizontal space for centered txn id (matches rounded panel minus gutters). */
    private getTxnIdMaxWidthCentered(): number {
        return Math.max(64, this.getPanelWidth() - 48);
    }

    /** Space from left column (-140) to inner right edge of panel. */
    private getTxnIdMaxWidthLeftColumn(): number {
        const half = this.getPanelWidth() / 2;
        const pad = 24;
        const leftX = -140;
        return Math.max(64, half - pad - leftX);
    }

    /**
     * Shrinks font size (then scale) so one-line text stays within maxWidth.
     * Preserves current origin; reset scale before measuring.
     */
    private fitOneLineText(
        text: GameObjects.Text,
        content: string,
        maxWidth: number,
        baseStyle: {
            fontFamily: string;
            fontStyle: string;
            color: string;
            align: 'left' | 'center' | 'right';
        },
        maxFontPx: number,
        minFontPx: number = 9
    ): void {
        text.setScale(1);
        text.setText(content);
        text.setFontFamily(baseStyle.fontFamily);
        text.setFontStyle(baseStyle.fontStyle);
        text.setColor(baseStyle.color);
        text.setStyle({ align: baseStyle.align });

        let size = maxFontPx;
        while (size >= minFontPx) {
            text.setFontSize(size);
            if (text.width <= maxWidth) {
                return;
            }
            size -= 1;
        }
        text.setFontSize(minFontPx);
        if (text.width > maxWidth && text.width > 0) {
            text.setScale(maxWidth / text.width);
        }
    }

    constructor(
        scene: Scene,
        replayId: string | number,
        x: number = 0,
        y: number = 0,
        options: {
            opacity?: number;
            cornerRadius?: number;
            buttonOffsetY?: number;
            buttonScale?: number;
            overlayColor?: number;
            overlayAlpha?: number;
            displayMode?: 'initial' | 'summary';
            spinData?: SpinData | null;
            currencyCode?: string;
            createdAt?: string;
            buttonText?: string;
            onContinueCallback?: () => void;
            onHideCallback?: () => void;
        } = {}
    ) {
        super(scene, x, y);
        this.scene = scene;

        this.overlay = new GameObjects.Graphics(scene);
        this.overlay.fillStyle(
            options.overlayColor || 0x000000,
            options.overlayAlpha !== undefined ? Phaser.Math.Clamp(options.overlayAlpha, 0, 1) : 0.35
        );
        this.overlay.fillRect(0, 0, scene.scale.width, scene.scale.height);
        this.overlay.setScrollFactor(0);
        this.overlay.setInteractive(
            new Phaser.Geom.Rectangle(0, 0, scene.scale.width, scene.scale.height),
            Phaser.Geom.Rectangle.Contains
        );
        this.overlay.visible = false;
        scene.add.existing(this.overlay);

        if (options.opacity !== undefined) this.backgroundAlpha = Phaser.Math.Clamp(options.opacity, 0, 1);
        if (options.cornerRadius !== undefined) this.cornerRadius = Math.max(0, options.cornerRadius);
        if (options.buttonOffsetY !== undefined) this.buttonOffsetY = options.buttonOffsetY;
        if (options.buttonScale !== undefined) this.buttonScale = Phaser.Math.Clamp(options.buttonScale, 0.1, 2);
        if (options.onContinueCallback !== undefined) this.onContinueCallback = options.onContinueCallback;
        if (options.onHideCallback !== undefined) this.onHideCallback = options.onHideCallback;

        this.background = new Phaser.GameObjects.Graphics(scene);
        this.drawBackground();

        this.titleText = new GameObjects.Text(
            scene,
            0,
            -122,
            'Replay',
            {
                fontFamily: 'poppins-bold',
                fontSize: '24px',
                color: '#ffffff',
                align: 'left',
            }
        );
        this.titleText.setOrigin(0, 0.5);

        this.messageText = new GameObjects.Text(
            scene,
            -140,
            -55,
            'Press continue to start',
            {
                fontFamily: 'poppins-regular',
                fontSize: '18px',
                color: '#ffffff',
                align: 'left',
                wordWrap: { width: scene.scale.width * 0.7, useAdvancedWrap: true },
            }
        );
        this.messageText.setOrigin(0, 0.5);

        this.txnLabelText = new GameObjects.Text(
            scene,
            -140,
            -10,
            'Txn ID:',
            {
                fontFamily: 'poppins-regular',
                fontSize: '18px',
                color: '#ffffff',
                align: 'left',
            }
        );
        this.txnLabelText.setOrigin(0, 0.5);

        this.txnIdText = new GameObjects.Text(
            scene,
            -140,
            30,
            `${replayId}`,
            {
                fontFamily: 'poppins-regular',
                fontStyle: 'bold',
                fontSize: '24px',
                color: '#ffffff',
                align: 'left',
            }
        );
        this.txnIdText.setOrigin(0, 0.5);

        this.extraInfoText = new GameObjects.Text(
            scene,
            -140,
            70,
            '',
            {
                fontFamily: 'poppins-regular',
                fontSize: '18px',
                color: '#ffffff',
                align: 'left',
            }
        );
        this.extraInfoText.setOrigin(0, 0.5);

        this.summaryTxnValueText = new GameObjects.Text(
            scene,
            -140,
            90,
            '',
            {
                fontFamily: 'poppins-regular',
                fontSize: '18px',
                color: '#ffffff',
                align: 'left',
            }
        );
        this.summaryTxnValueText.setOrigin(0, 0.5);
        this.summaryTxnValueText.setVisible(false);

        const buttonX = 0;
        const buttonY = this.buttonOffsetY;
        const scaledWidth = this.buttonWidth * this.buttonScale;
        const scaledHeight = this.buttonHeight * this.buttonScale;

        this.buttonImage = new GameObjects.Image(scene, buttonX, buttonY, 'long_button');
        this.buttonImage.setOrigin(0.5, 0.5);
        this.buttonImage.setDisplaySize(scaledWidth, scaledHeight);
        this.buttonImage.setScale(this.buttonScale);

        this.buttonText = new GameObjects.Text(scene, buttonX, buttonY, options.buttonText ?? 'Continue', {
            fontFamily: 'poppins-bold',
            fontSize: '24px',
            color: '#000000',
            align: 'center',
        });
        this.buttonText.setOrigin(0.5);

        this.buttonImage.setInteractive({ useHandCursor: true });
        this.buttonImage.on('pointerdown', () => {
            try {
                (window as any).audioManager?.playSoundEffect?.('button_fx');
            } catch {}
            this.onContinueCallback?.();
            this.hide();
        });
        this.buttonImage.on('pointerover', () => this.buttonImage.setTint(0xcccccc));
        this.buttonImage.on('pointerout', () => this.buttonImage.clearTint());

        this.add([
            this.background,
            this.titleText,
            this.messageText,
            this.txnLabelText,
            this.txnIdText,
            this.extraInfoText,
            this.summaryTxnValueText,
            this.buttonImage,
            this.buttonText,
        ]);
        this.setPosition(scene.scale.width / 2, scene.scale.height / 2);
        this.setVisible(false);
        scene.add.existing(this);

        this.applyDisplayMode(
            options.displayMode ?? 'initial',
            replayId,
            options.spinData ?? null,
            options.currencyCode,
            options.createdAt
        );
    }

    public show(): void {
        this.overlay.setVisible(true);
        this.overlay.setDepth(9999);

        this.setVisible(true);
        this.setDepth(10000);
        this.setScale(0.5);
        this.setAlpha(0);

        this.scene.tweens.add({
            targets: this,
            scaleX: 1,
            scaleY: 1,
            alpha: 1,
            duration: this.animationDuration,
            ease: 'Back.Out',
            onStart: () => {
                try {
                    (window as any).audioManager?.playSoundEffect?.('popup_open');
                } catch {}
            },
        });
    }

    public hide(callback?: () => void): void {
        this.scene.tweens.add({
            targets: this,
            scaleX: 0.5,
            scaleY: 0.5,
            alpha: 0,
            duration: this.animationDuration * 0.8,
            ease: 'Back.In',
            onComplete: () => {
                this.setVisible(false);
                this.overlay.setVisible(false);
                this.onHideCallback?.();
                if (callback) callback();
            },
        });
    }

    public updateReplayId(replayId: string | number): void {
        const s = `${replayId}`;
        if (this.displayMode === 'summary') {
            this.extraInfoText.setText('Txn ID:');
            this.fitOneLineText(
                this.summaryTxnValueText,
                s,
                this.getTxnIdMaxWidthLeftColumn(),
                {
                    fontFamily: 'poppins-regular',
                    fontStyle: 'normal',
                    color: '#ffffff',
                    align: 'left',
                },
                18
            );
            this.summaryTxnValueText.setVisible(true);
        } else {
            this.summaryTxnValueText.setVisible(false);
            this.fitOneLineText(
                this.txnIdText,
                s,
                this.getTxnIdMaxWidthCentered(),
                {
                    fontFamily: 'poppins-regular',
                    fontStyle: 'bold',
                    color: '#ffffff',
                    align: 'center',
                },
                24
            );
        }
    }

    public updateButtonLabel(label: string): void {
        this.buttonText.setText(label);
    }

    private applyDisplayMode(
        mode: 'initial' | 'summary',
        replayId: string | number,
        spinData: SpinData | null,
        currencyCode?: string,
        createdAt?: string
    ): void {
        this.displayMode = mode;
        if (mode === 'summary') {
            this.txnIdText.setScale(1);
            const normalizedSpinData: any = spinData ?? ({} as any);
            const slot: any = normalizedSpinData?.slot ?? {};
            const freeSpinItems = Array.isArray(slot?.freeSpin?.items)
                ? slot.freeSpin.items
                : Array.isArray(slot?.freespin?.items)
                    ? slot.freespin.items
                    : [];
            const bonusItems = Array.isArray(slot?.bonus?.items) ? slot.bonus.items : [];
            const totalBonusLikeItems = freeSpinItems.length + bonusItems.length;
            const currencyPrefix = currencyCode ? `${currencyCode} ` : '';

            const betRaw = normalizedSpinData?.bet;
            const betNum = typeof betRaw === 'number' ? betRaw : Number(betRaw);
            const betDisplay =
                betRaw === undefined || betRaw === null
                    ? '-'
                    : Number.isFinite(betNum)
                        ? formatCurrencyNumber(betNum)
                        : '-';

            const totalWinRaw = slot?.totalWin;
            const totalWinNum =
                totalWinRaw === undefined || totalWinRaw === null
                    ? 0
                    : typeof totalWinRaw === 'number'
                        ? totalWinRaw
                        : Number(totalWinRaw);
            const totalWinDisplay = Number.isFinite(totalWinNum)
                ? formatCurrencyNumber(totalWinNum)
                : formatCurrencyNumber(0);

            this.titleText.setStyle({ align: 'left' });
            this.titleText.setOrigin(0, 0.5);
            this.titleText.setPosition(-140, -122);
            this.titleText.setText('Summary');

            const summaryBodyStartY = -67;
            const summaryLineStep = 40;

            this.messageText.setStyle({ align: 'left' });
            this.messageText.setOrigin(0, 0.5);
            this.messageText.setText(`Bet: ${currencyPrefix}${betDisplay}`);

            let bodyY = summaryBodyStartY;
            this.messageText.setPosition(-140, bodyY);
            bodyY += summaryLineStep;

            if (totalBonusLikeItems > 0) {
                this.txnLabelText.setVisible(true);
                this.txnLabelText.setStyle({ align: 'left' });
                this.txnLabelText.setOrigin(0, 0.5);
                this.txnLabelText.setText(`Free Spins: ${totalBonusLikeItems}`);
                this.txnLabelText.setPosition(-140, bodyY);
                bodyY += summaryLineStep;
            } else {
                this.txnLabelText.setVisible(false);
            }

            this.txnIdText.setPosition(-140, bodyY);
            bodyY += summaryLineStep;

            this.extraInfoText.setPosition(-140, bodyY);

            this.txnIdText.setStyle({ align: 'left' });
            this.txnIdText.setOrigin(0, 0.5);
            this.txnIdText.setFontFamily('poppins-regular');
            this.txnIdText.setFontStyle('normal');
            this.txnIdText.setFontSize(18);
            this.txnIdText.setText(`Total Win: ${currencyPrefix}${totalWinDisplay}`);
            this.extraInfoText.setVisible(true);
            this.extraInfoText.setStyle({ align: 'left' });
            this.extraInfoText.setOrigin(0, 0.5);
            this.extraInfoText.setText('Txn ID:');
            this.extraInfoText.setPosition(-140, bodyY - 10);
            this.summaryTxnValueText.setPosition(-140, bodyY + 10);
            this.summaryTxnValueText.setVisible(true);
            this.fitOneLineText(
                this.summaryTxnValueText,
                `${replayId}`,
                this.getTxnIdMaxWidthLeftColumn(),
                {
                    fontFamily: 'poppins-regular',
                    fontStyle: 'normal',
                    color: '#ffffff',
                    align: 'left',
                },
                18
            );
            return;
        }

        this.txnIdText.setScale(1);
        this.extraInfoText.setScale(1);
        this.summaryTxnValueText.setScale(1);
        this.summaryTxnValueText.setVisible(false);

        this.titleText.setStyle({ align: 'center' });
        this.titleText.setOrigin(0.5);
        this.titleText.setPosition(0, -122);
        this.titleText.setText('Replay');
        this.messageText.setStyle({ align: 'center' });
        this.messageText.setOrigin(0.5);
        this.messageText.setPosition(0, -67);
        this.messageText.setText('Press continue to start');
        this.txnLabelText.setVisible(true);
        this.txnLabelText.setStyle({ align: 'center' });
        this.txnLabelText.setOrigin(0.5);
        this.txnLabelText.setText('Txn ID:');
        this.txnLabelText.setPosition(0, -22);
        this.txnIdText.setPosition(0, 18);
        this.txnIdText.setStyle({ align: 'center' });
        this.txnIdText.setOrigin(0.5);
        this.fitOneLineText(
            this.txnIdText,
            `${replayId}`,
            this.getTxnIdMaxWidthCentered(),
            {
                fontFamily: 'poppins-regular',
                fontStyle: 'bold',
                color: '#ffffff',
                align: 'center',
            },
            24
        );
        this.extraInfoText.setVisible(true);
        this.extraInfoText.setStyle({ align: 'center' });
        this.extraInfoText.setOrigin(0.5);
        this.extraInfoText.setPosition(0, 58);
        this.extraInfoText.setText(`Date: ${createdAt ?? '-'}`);
    }

    private drawBackground(): void {
        const width = this.scene.scale.width * 0.8;
        const height = this.scene.scale.height * 0.4;

        this.background.clear();
        this.background.fillStyle(this.backgroundColor, this.backgroundAlpha);
        this.background.fillRoundedRect(-width / 2, -height / 2, width, height, this.cornerRadius);
    }

    public destroy(fromScene?: boolean): void {
        try {
            this.overlay?.destroy();
        } catch {}
        super.destroy(fromScene);
    }
}
