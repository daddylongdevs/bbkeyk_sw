import { Scene, GameObjects } from 'phaser';
import { MODAL_LAYOUT, type ModalAssets } from './types';

export type GenericModalOptions = {
	body: string;
	/** Asset keys (from config theme defaults). Layout is locked in MODAL_LAYOUT. */
	assets: ModalAssets;
	button?: false | {
		label: string;
		onPress?: () => void;
	};
	onHideCallback?: () => void;
	/** Scene depth for the dimmer. Defaults to MODAL_LAYOUT.overlayDepth. */
	overlayDepth?: number;
	/** Scene depth for the popup. Defaults to MODAL_LAYOUT.modalDepth. */
	modalDepth?: number;
};

/**
 * Single Phaser modal constructor for all standard error/session modals.
 * Layout, spacing, colors, and animation are locked via MODAL_LAYOUT — not project-configurable.
 * Optional button: omit or pass button: false for TokenExpired / IdleSession style.
 */
export class GenericModal extends GameObjects.Container {
	private background: GameObjects.Graphics;
	private messageText: GameObjects.Text;
	private buttonImage?: GameObjects.Image;
	private buttonText?: GameObjects.Text;
	private overlay: GameObjects.Graphics;
	private onHideCallback?: () => void;
	private hasButton: boolean;
	private overlayDepth: number;
	private modalDepth: number;

	constructor(scene: Scene, x: number = 0, y: number = 0, options: GenericModalOptions) {
		super(scene, x, y);
		this.scene = scene;
		this.onHideCallback = options.onHideCallback;
		this.hasButton = !!(options.button && options.button !== false);

		const L = MODAL_LAYOUT;
		this.overlayDepth = options.overlayDepth ?? L.overlayDepth;
		this.modalDepth = options.modalDepth ?? L.modalDepth;

		this.overlay = new GameObjects.Graphics(scene);
		this.overlay.fillStyle(L.overlayColor, L.overlayAlpha);
		this.overlay.fillRect(0, 0, scene.scale.width, scene.scale.height);
		this.overlay.setScrollFactor(0);
		this.overlay.setInteractive(
			new Phaser.Geom.Rectangle(0, 0, scene.scale.width, scene.scale.height),
			Phaser.Geom.Rectangle.Contains
		);
		this.overlay.visible = false;
		scene.add.existing(this.overlay);

		this.background = new GameObjects.Graphics(scene);
		this.drawBackground();

		this.messageText = new GameObjects.Text(
			scene,
			0,
			this.hasButton ? L.bodyOffsetYWithButton : L.bodyOffsetYNoButton,
			options.body,
			{
				fontFamily: options.assets.fontFamily,
				fontSize: L.bodyFontSize,
				color: L.bodyColor,
				align: 'center',
				wordWrap: {
					width: scene.scale.width * L.bodyWrapWidthFactor,
					useAdvancedWrap: true,
				},
			}
		);
		this.messageText.setOrigin(0.5);

		const children: GameObjects.GameObject[] = [this.background, this.messageText];

		if (this.hasButton && options.button && options.button !== false) {
			const buttonX = 0;
			const buttonY = L.buttonOffsetY;
			const scaledWidth = L.buttonWidth * L.buttonScale;
			const scaledHeight = L.buttonHeight * L.buttonScale;
			const onPress = options.button.onPress;

			this.buttonImage = new GameObjects.Image(
				scene,
				buttonX,
				buttonY,
				options.assets.buttonTextureKey
			);
			this.buttonImage.setOrigin(0.5, 0.5);
			this.buttonImage.setDisplaySize(scaledWidth, scaledHeight);
			this.buttonImage.setScale(L.buttonScale);

			this.buttonText = new GameObjects.Text(scene, buttonX, buttonY, options.button.label, {
				fontFamily: options.assets.fontFamilyBold,
				fontSize: L.buttonFontSize,
				color: L.buttonLabelColor,
				align: 'center',
			});
			this.buttonText.setOrigin(0.5);

			this.buttonImage.setInteractive({ useHandCursor: true });
			this.buttonImage.on('pointerdown', () => {
				try {
					(window as any).audioManager?.playSoundEffect?.('button_fx');
				} catch {}
				if (onPress) {
					onPress();
				} else {
					this.hide();
				}
			});
			this.buttonImage.on('pointerover', () => this.buttonImage?.setTint(L.buttonHoverTint));
			this.buttonImage.on('pointerout', () => this.buttonImage?.clearTint());

			children.push(this.buttonImage, this.buttonText);
		}

		this.add(children);
		this.setPosition(scene.scale.width / 2, scene.scale.height / 2);
		this.setVisible(false);
		scene.add.existing(this);
	}

	public show(): void {
		const L = MODAL_LAYOUT;
		this.overlay.setVisible(true);
		this.overlay.setDepth(this.overlayDepth);

		this.setVisible(true);
		this.setDepth(this.modalDepth);
		this.setScale(L.showFromScale);
		this.setAlpha(0);

		this.scene.tweens.add({
			targets: this,
			scaleX: 1,
			scaleY: 1,
			alpha: 1,
			duration: L.animationDurationMs,
			ease: L.showEase,
			onStart: () => {
				try {
					(window as any).audioManager?.playSoundEffect?.('popup_open');
				} catch {}
			},
		});
	}

	public hide(callback?: () => void): void {
		const L = MODAL_LAYOUT;
		this.scene.tweens.add({
			targets: this,
			scaleX: L.showFromScale,
			scaleY: L.showFromScale,
			alpha: 0,
			duration: L.animationDurationMs * L.hideDurationFactor,
			ease: L.hideEase,
			onComplete: () => {
				this.setVisible(false);
				this.overlay.setVisible(false);
				this.onHideCallback?.();
				if (callback) callback();
			},
		});
	}

	private drawBackground(): void {
		const L = MODAL_LAYOUT;
		const width = this.scene.scale.width * L.panelWidthFactor;
		const height = this.scene.scale.height * L.panelHeightFactor;

		this.background.clear();
		this.background.fillStyle(L.panelColor, L.panelAlpha);
		this.background.fillRoundedRect(-width / 2, -height / 2, width, height, L.cornerRadius);
	}

	public destroy(fromScene?: boolean): void {
		try {
			this.overlay?.destroy();
		} catch {}
		super.destroy(fromScene);
	}
}
