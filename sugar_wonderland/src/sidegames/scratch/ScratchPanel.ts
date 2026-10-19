import { Scene } from 'phaser';
import { isPlayInstanceReplaced as hasLostPlayInstance } from '../../backend/PlayInstanceLock';
import { EventBus, isBuyFeatureModalVisible } from '../../game/EventBus';
import { localizationManager } from '../../managers/LocalizationManager';
import {
	SCRATCH_BUY_CARD,
	SCRATCH_SCRATCH_ALL,
	SCRATCH_TITLE,
	CONTROLLER_BET,
	WINBAR_YOU_WON,
	COMMON_TOTAL_WIN,
	LOCALIZATION_DEFAULTS,
} from '../../backend/LocalizationData';
import { Physics } from '@esotericsoftware/spine-core';
import { CurrencyManager } from '../../game/components/CurrencyManager';
import { ensureSpineFactory } from '../../utils/SpineGuard';
import { formatCurrencyNumber } from '../../utils/NumberPrecisionFormatter';
import { enableMipmapsOnPhaserTextureKeys } from '../../utils/PhaserTextureMipmaps';
import {
	ScratchClient,
	ScratchGameSnapshot,
	isScratchRoundActive,
	scratchBaseMultiplierForSymbol,
	scratchGridDimension,
	scratchGridSizeChoiceFromDimension,
	scratchLegendRowsForGrid,
	scratchMysteryFactorsForGrid,
	type ScratchCardDto,
} from './ScratchClient';
import {
	SCRATCH_BASE_PAY_LEGEND,
	SCRATCH_LEGEND_TEXTURE,
	SCRATCH_MS1_FACTOR,
	SCRATCH_MS2_FACTOR,
	SCRATCH_MULTIPLIER_SPINE_KEY,
	SCRATCH_SPINE_ANIM_SUFFIX,
	SCRATCH_SYMBOL_TEXTURE,
	baseMultiplierForMatchSymbol,
	isScratchMultiplierValue,
	isScratchSpecialSymbol,
	scratchMultiplierAnimBase,
	legendTextureKeyForScratchSymbol,
	symbolValueForScratchSymbol,
	textureKeyForScratchSymbol,
} from './symbolMap';

const DEFAULT_BET_LEVELS = [
	0.2, 0.4, 0.6, 0.8, 1, 1.2, 1.6, 2, 2.4, 2.8, 3.2, 3.6, 4, 5, 6, 8, 10, 14, 18, 24, 32, 40, 60,
	80, 100, 110, 120, 130, 140, 150,
];
const BET_STEP_DISABLED_ALPHA = 0.5;
/** Match BuyFeature continuous +/- hold. */
const BET_CONTINUOUS_DELAY_MS = 500;
const BET_CONTINUOUS_INTERVAL_MS = 200;

export interface ScratchPanelOptions {
	client: ScratchClient;
	/** Seed / reference bet (e.g. slot base bet). Scratch stake is independent after open. */
	getBetAmount: () => number;
	/** Same ladder as BET HUD +/- (from SlotController / GameData.betLevels). */
	getBetLevels?: () => number[];
	onClose: () => void;
	/**
	 * When set (outside desktop host), close control asks the host to slide away
	 * instead of instantly hiding the panel.
	 */
	onCloseRequest?: () => void;
	/** Claim a balance-display generation before a scratch wallet request is sent. */
	beginBalanceUpdate?: () => number | undefined;
	onBalanceChanged?: (balance: number, epoch?: number, timestamp?: number) => void;
	onError?: (message: string, errorCode?: string | null) => void;
	/** Dismiss any leftover error modal when the drawer opens. */
	onClearError?: () => void;
	/**
	 * When true, fill the whole scene (used by the outside-desktop host).
	 * Default: bottom drawer inside the main game scene.
	 */
	fillScene?: boolean;
}

/** Same stack as Buy Feature so header logo / winbar stay underneath. */
const PANEL_DEPTH = 2000;
/**
 * In-main drawer footprint (main game design size). Outside host uses the same
 * so sand cell size matches in both placements.
 */
export const SCRATCH_PANEL_WIDTH = 428;
export const SCRATCH_PANEL_HEIGHT = 860;
/** In-main drawer: tall enough for 5x5 sand without overlapping chrome. */
const DRAWER_HEIGHT = SCRATCH_PANEL_HEIGHT;
const HORIZONTAL_PADDING = 32;

type ScratchPanelRect = {
	x: number;
	y: number;
	w: number;
	h: number;
	mode: 'fill' | 'drawer';
};

/** Prefer tumble symbol display size when it fits. */
const TUMBLE_CELL = 62;

/** Gray foil color for unscratched cells. */
const COVER_COLOR = 0x8a8a8a;
/** Fast-forward falling-sand CA (Shadertoy-style grains). */
const SAND_COVER_MS = 1400;
const SAND_GRAIN_PX = 2;
const SAND_STEPS_PER_FRAME = 12;
const SAND_REVEAL_SCRATCH_MS = 1100;
const SAND_SIM_KEY = 'scratch_sand_ca';
const SAND_GRAIN_CAP = 420;
const SAND_EXPLODE_MS = 480;
const BRUSH_RADIUS_FRAC = 0.18;
const REVEAL_THRESHOLD = 0.42;
const STAMP_GRID = 8;

type GridSizeChoice = 0 | 1 | 2;

/** Last scratch stake across panel instances (drawer + outside host) for this page session. */
let persistedScratchBetAmount: number | null = null;
/** Last grid dim choice (0=3×3, 1=4×4, 2=5×5) across panel instances. */
let persistedScratchGridSize: GridSizeChoice | null = null;

const MODAL_WIN_LABEL_FONT_PX = 18;
const MODAL_WIN_AMOUNT_FONT_PX = 22;

interface ScratchCellView {
	index: number;
	symbol: string;
	container: Phaser.GameObjects.Container;
	cover: Phaser.GameObjects.RenderTexture;
	cellW: number;
	cellH: number;
	coverW: number;
	coverH: number;
	stamps: boolean[];
	fullyRevealed: boolean;
	symbolAnim: any | null;
	symbolValue: number | null;
}

/** All cells (covered or revealed) for win anim / floating amounts. */
interface ScratchCellVisual {
	index: number;
	symbol: string;
	container: Phaser.GameObjects.Container;
	symbolAnim: any | null;
	symbolValue: number | null;
	cellW: number;
	cellH: number;
}

/** Reel tumbles draw these keys. Padding them shifts the art to the cell's upper left. */
function isSharedReelTextureKey(key: string): boolean {
	return /^(?:symbol_?\d+|symbol_static_\d+|Symbol\d+)$/.test(key);
}

function scratchMipmapKeys(fillScene: boolean | undefined): Set<string> {
	const keys = new Set<string>([
		...Object.values(SCRATCH_SYMBOL_TEXTURE).filter((key): key is string => !!key),
		...Object.values(SCRATCH_LEGEND_TEXTURE),
		'dijoker_face',
		'long_button',
		'decrease_bet',
		'increase_bet',
	]);
	if (!fillScene) {
		for (const key of [...keys]) {
			if (isSharedReelTextureKey(key)) keys.delete(key);
		}
	}
	return keys;
}

/**
 * Scratch side-game panel — BuyFeature look/feel.
 * In-game: bottom drawer. Outside-desktop host: fillScene panel.
 */
export class ScratchPanel {
	private root: Phaser.GameObjects.Container | null = null;
	private fullScreenBlocker: Phaser.GameObjects.Graphics | null = null;
	private background: Phaser.GameObjects.Graphics | null = null;
	private backgroundImage: Phaser.GameObjects.Image | null = null;
	/** Off-list geometry mask source for rounded / flat-right panel chrome. */
	private panelClipGfx: Phaser.GameObjects.Graphics | null = null;
	private panelGeomMask: Phaser.Display.Masks.GeometryMask | null = null;
	private gridContainer: Phaser.GameObjects.Container | null = null;
	private titleText: Phaser.GameObjects.Text | null = null;
	private closeButton: Phaser.GameObjects.Text | null = null;
	/** In-modal win bar (does not touch slot Header). */
	private modalYouWonText: Phaser.GameObjects.Text | null = null;
	private modalAmountText: Phaser.GameObjects.Text | null = null;
	private modalComputeContainer: Phaser.GameObjects.Container | null = null;
	private modalCurrentWinnings = 0;
	private floatingWinTexts: Phaser.GameObjects.Text[] = [];
	private winLineGraphics: Phaser.GameObjects.Graphics | null = null;
	private winLineDrawProxy: { t: number } | null = null;
	private winLinePath: {
		pts: Array<{ x: number; y: number; special: boolean }>;
		segs: Array<{ x0: number; y0: number; x1: number; y1: number; len: number }>;
		totalLen: number;
	} | null = null;
	private sizeInputBg: Phaser.GameObjects.Graphics | null = null;
	private legendContainer: Phaser.GameObjects.Container | null = null;
	private dimButtons: Phaser.GameObjects.Container[] = [];
	private newButtonImage: Phaser.GameObjects.Image | null = null;
	private newButtonLabel: Phaser.GameObjects.Text | null = null;
	/** Buy-feature drawer is covering the slot. */
	private slotBuyFeatureOpen = false;
	private buyFeaturePurchasedListener: (() => void) | null = null;
	private buyFeatureEnableTimer: ReturnType<typeof setTimeout> | null = null;
	private buyFeatureEnableAt = 0;
	private buyFeatureVisibilityListener: ((open: boolean) => void) | null = null;
	/** BuyFeature-style bet row (label + rounded amount +/-). */
	private betLabelText: Phaser.GameObjects.Text | null = null;
	private betInputBg: Phaser.GameObjects.Graphics | null = null;
	private betDisplay: Phaser.GameObjects.Text | null = null;
	private betDecButton: Phaser.GameObjects.Text | null = null;
	private betIncButton: Phaser.GameObjects.Text | null = null;
	private betDecTimer: Phaser.Time.TimerEvent | null = null;
	private betIncTimer: Phaser.Time.TimerEvent | null = null;
	/** Scratch-only stake; does not update the slot BET. */
	private scratchBetAmount = 0.2;
	private brush: Phaser.GameObjects.Graphics | null = null;
	private sandCursor: Phaser.GameObjects.Image | null = null;
	private sandCursorActive = false;
	private sandFxContainer: Phaser.GameObjects.Container | null = null;
	private sandPaintGfx: Phaser.GameObjects.Graphics | null = null;
	private liveSandGrains = 0;
	private lastSandFxMs = 0;
	private visible = false;
	/** Replay playback ignores close and cashout. */
	private replayLocked = false;
	private replaySettledHandler: (() => void) | null = null;
	private replaySettleNotified = false;
	private replaySettleScheduled = false;
	private busy = false;
	private autoCollectScheduled = false;
	private scratchGridMaxH = 280;
	private revealed = new Set<number>();
	private lastSnap: ScratchGameSnapshot | null = null;
	private scene: Scene | null = null;
	private resizeHandler: (() => void) | null = null;
	private selectedGridSize: GridSizeChoice = 1;
	private cellViews: ScratchCellView[] = [];
	private cellVisuals: ScratchCellVisual[] = [];
	private winPresentationShown = false;
	private scratching = false;
	private foilGenerating = false;
	private explodingReveal = false;
	private foilTweens: Phaser.Tweens.Tween[] = [];
	private foilGenerateResolve: (() => void) | null = null;
	private foilTick: (() => void) | null = null;
	private coverOverExistingSymbols = false;
	private sandSim: {
		w: number;
		h: number;
		cells: Uint8Array;
		canvas: HTMLCanvasElement;
		ctx: CanvasRenderingContext2D;
		image: ImageData;
		imageObj: Phaser.GameObjects.Image;
		/** Grayscale DiJoker face luminance for the sand grid (w × gridSimH), or null. */
		faceGray: Uint8Array | null;
		filled: number;
		rng: number;
		scanDir: 1 | -1;
		dispW: number;
		dispH: number;
		dispGridH: number;
		gridSimH: number;
	} | null = null;
	private fallingSand: {
		go: Phaser.GameObjects.Rectangle;
		vx: number;
		vy: number;
		life: number;
		maxLife: number;
		spin: number;
		mode: 'fall' | 'bury' | 'explode';
	}[] = [];
	private pointerDownHandler: ((pointer: Phaser.Input.Pointer) => void) | null = null;
	private pointerMoveHandler: ((pointer: Phaser.Input.Pointer) => void) | null = null;
	private pointerUpHandler: ((pointer: Phaser.Input.Pointer) => void) | null = null;

	constructor(private readonly options: ScratchPanelOptions) {}

	isVisible(): boolean {
		return this.visible;
	}

	create(scene: Scene): void {
		this.scene = scene;
		this.bindBuyFeatureModalGuard();
		// Trilinear (`linear`) — card PNGs are heavily minified into ~62px cells;
		// the game-wide `sharp` snap looks pixelated on illustrative art.
		enableMipmapsOnPhaserTextureKeys(
			scene,
			scratchMipmapKeys(this.options.fillScene),
			'linear',
		);

		this.fullScreenBlocker = scene.add.graphics();
		this.fullScreenBlocker.fillStyle(0x000000, 0.01);
		this.fullScreenBlocker.fillRect(0, 0, scene.scale.width, scene.scale.height);
		this.fullScreenBlocker.setInteractive(
			new Phaser.Geom.Rectangle(0, 0, scene.scale.width, scene.scale.height),
			Phaser.Geom.Rectangle.Contains,
		);
		this.fullScreenBlocker.setDepth(PANEL_DEPTH - 1);
		this.fullScreenBlocker.setVisible(false);

		this.root = scene.add.container(0, 0).setDepth(PANEL_DEPTH).setVisible(false);
		this.root.setPosition(0, scene.scale.height);

		this.background = scene.add.graphics();
		this.root.add(this.background);

		this.backgroundImage = scene.add.image(0, 0, 'buy_feature_bg');
		this.root.add(this.backgroundImage);
		// Not on the display list — GeometryMask stencil source only.
		this.panelClipGfx = scene.make.graphics({ add: false });

		this.titleText = scene.add
			.text(0, 0, this.getScratchText(SCRATCH_TITLE), {
				fontSize: '24px',
				fontFamily: 'Poppins-Regular',
				color: '#00ff00',
				fontStyle: 'bold',
			})
			.setOrigin(0, 0.5);
		this.root.add(this.titleText);

		this.closeButton = scene.add
			.text(0, 0, '×', {
				fontSize: '30px',
				fontFamily: 'Poppins-Regular',
				color: '#ffffff',
			})
			.setOrigin(0.5)
			.setInteractive({ useHandCursor: true });
		this.closeButton.on('pointerdown', () => this.requestClose());
		this.root.add(this.closeButton);

		// Win display lives only inside this drawer (same look as slot winbar, local only)
		this.modalYouWonText = scene.add
			.text(0, 0, this.getScratchText(WINBAR_YOU_WON), {
				fontSize: `${MODAL_WIN_LABEL_FONT_PX}px`,
				color: '#ffffff',
				fontFamily: 'Poppins-Bold',
				stroke: '#99030A',
				strokeThickness: 3,
			})
			.setOrigin(0.5, 0.5)
			.setVisible(false);
		this.root.add(this.modalYouWonText);

		this.modalAmountText = scene.add
			.text(0, 0, '0.00', {
				fontSize: `${MODAL_WIN_AMOUNT_FONT_PX}px`,
				color: '#FFB837',
				fontFamily: 'Poppins-Bold',
				stroke: '#99030A',
				strokeThickness: 3,
			})
			.setOrigin(0.5, 0.5)
			.setVisible(false);
		this.root.add(this.modalAmountText);

		this.modalComputeContainer = scene.add.container(0, 0).setVisible(false);
		this.root.add(this.modalComputeContainer);

		this.winLineGraphics = scene.add.graphics();
		this.root.add(this.winLineGraphics);

		this.sizeInputBg = scene.add.graphics();
		this.root.add(this.sizeInputBg);

		this.dimButtons = [
			this.createDimButton(scene, '3×3', 0),
			this.createDimButton(scene, '4×4', 1),
			this.createDimButton(scene, '5×5', 2),
		];
		this.dimButtons.forEach((btn) => this.root!.add(btn));

		this.legendContainer = scene.add.container(0, 0);
		this.root.add(this.legendContainer);
		this.refreshLegend();

		this.gridContainer = scene.add.container(0, 0);
		this.root.add(this.gridContainer);
		this.sandFxContainer = scene.add.container(0, 0);
		this.root.add(this.sandFxContainer);
		scene.events.on('update', this.onSandFrame, this);

		// Primary CTA: same long_button + label as Buy Feature confirm.
		this.newButtonImage = scene.add.image(0, 0, 'long_button').setOrigin(0.5);
		this.newButtonLabel = scene.add
			.text(0, 0, this.getScratchText(SCRATCH_BUY_CARD), {
				fontSize: '24px',
				fontFamily: 'Poppins-Bold',
				color: '#000000',
			})
			.setOrigin(0.5);
		this.newButtonImage.setInteractive({ useHandCursor: true });
		this.newButtonImage.on('pointerdown', () => this.onPrimaryAction());
		this.root.add(this.newButtonImage);
		this.root.add(this.newButtonLabel);

		// Buy Feature modal bet row: "Bet" label + rounded amount with − / +.
		this.betLabelText = scene.add
			.text(0, 0, this.getScratchText(CONTROLLER_BET), {
				fontSize: '24px',
				color: '#ffffff',
				fontFamily: 'Poppins-Regular',
			})
			.setOrigin(0, 0.5);
		this.root.add(this.betLabelText);

		this.betInputBg = scene.add.graphics();
		this.root.add(this.betInputBg);

		this.betDecButton = scene.add
			.text(0, 0, '-', {
				fontSize: '30px',
				color: '#ffffff',
				fontFamily: 'Poppins-Regular',
			})
			.setOrigin(0.5);
		this.betIncButton = scene.add
			.text(0, 0, '+', {
				fontSize: '30px',
				color: '#ffffff',
				fontFamily: 'Poppins-Regular',
			})
			.setOrigin(0.5);
		this.betDisplay = scene.add
			.text(0, 0, this.formatScratchBetDisplay(), {
				fontSize: '24px',
				color: '#ffffff',
				fontFamily: 'Poppins-Regular',
			})
			.setOrigin(0.5);
		this.betDecButton.setInteractive({ useHandCursor: true });
		this.betIncButton.setInteractive({ useHandCursor: true });
		this.betDecButton.on('pointerdown', () => {
			if (this.betDecButton?.getData('disabled')) return;
			this.stopContinuousBetIncrement();
			this.adjustScratchBetByStep(-1);
			this.startContinuousBetDecrement(scene);
		});
		this.betDecButton.on('pointerup', () => this.stopContinuousBetDecrement());
		this.betDecButton.on('pointerout', () => this.stopContinuousBetDecrement());
		this.betIncButton.on('pointerdown', () => {
			if (this.betIncButton?.getData('disabled')) return;
			this.stopContinuousBetDecrement();
			this.adjustScratchBetByStep(1);
			this.startContinuousBetIncrement(scene);
		});
		this.betIncButton.on('pointerup', () => this.stopContinuousBetIncrement());
		this.betIncButton.on('pointerout', () => this.stopContinuousBetIncrement());
		this.root.add(this.betDecButton);
		this.root.add(this.betIncButton);
		this.root.add(this.betDisplay);

		this.restorePersistedScratchGridSize();
		this.syncScratchBetFromSlotSeed();
		this.refreshBuyCardLabel();
		this.updateBuyCardBetStepButtons();

		this.brush = scene.make.graphics({ x: 0, y: 0 }, false);
		this.brush.fillStyle(0xffffff, 1);
		this.brush.fillCircle(0, 0, 16);

		this.ensureSandCursor(scene);

		this.bindScratchPointers(scene);
		this.resizeHandler = () => this.layout();
		scene.scale.on('resize', this.resizeHandler);
		this.layout();
		this.refreshDimButtonStyles();
	}

	async show(): Promise<void> {
		if (hasLostPlayInstance() || !this.root || !this.scene) {
			return;
		}
		this.presentChrome();
		if (hasLostPlayInstance()) {
			this.hide();
			return;
		}
		await this.syncSession();
		if (hasLostPlayInstance()) {
			this.hide();
		}
	}

	/** Layout + show chrome immediately (no network). Used so the host can slide without waiting. */
	presentChrome(): void {
		if (hasLostPlayInstance() || !this.root || !this.scene) {
			return;
		}
		this.visible = true;
		this.fullScreenBlocker?.setVisible(!this.options.fillScene);
		this.clearError();
		this.options.onClearError?.();
		this.options.client.clearLastError();
		this.restorePersistedScratchGridSize();
		this.syncScratchBetFromSlotSeed();
		this.layout();
		// Close used to wipe the CA sand layer; restore grainy cover before network sync paints.
		if (
			isScratchRoundActive(this.lastSnap?.round) &&
			this.cellViews.length > 0 &&
			!this.sandSim
		) {
			this.rebuildGrainySandCoverInstant();
		} else if (!this.lastSnap?.round?.scratchCard?.cells?.length) {
			// First open (no card yet): show settled sand, still not scratchable.
			this.showIdleSettledSand();
		}
		this.animateIn();
		this.refreshBuyCardLabel();
	}

	/** Join / resume session and apply snapshot (may hit the network). */
	async syncSession(): Promise<void> {
		if (!this.root || !this.scene) {
			return;
		}
		if (!this.options.client.isSlotSessionPlayable()) {
			this.reportError(new Error('Scratch requires a valid slot session.'));
			this.hide();
			return;
		}
		this.setBusy(true);
		try {
			const snap = await this.options.client.ensureJoined();
			if (!this.consumeSnapshotOrError(snap)) {
				return;
			}
			this.applySnapshot(snap);
		} catch (err) {
			this.reportError(err);
		} finally {
			this.setBusy(false);
		}
	}


	/**
	 * Locked in-canvas playback for `replay=true&type=scratch`.
	 * Shows the results grid and bet, scratches the sand slowly, then runs win presentation.
	 */
	playReplay(results: any, onSettled?: () => void): void {
		this.replaySettledHandler = onSettled ?? null;
		this.replaySettleNotified = false;
		this.replaySettleScheduled = false;
		if (!this.root || !this.scene || !results || typeof results !== 'object') {
			this.notifyReplaySettled();
			return;
		}
		const cardSrc = results.scratchCard;
		if (!cardSrc || !Array.isArray(cardSrc.cells) || cardSrc.cells.length === 0) {
			console.warn('[ScratchPanel] Replay results have no scratch card');
			this.notifyReplaySettled();
			return;
		}
		this.replayLocked = true;
		this.revealed.clear();
		this.winPresentationShown = false;

		const gridChoice = Number(results.scratchGridSize);
		const gridSize = gridChoice === 1 || gridChoice === 2 ? gridChoice : 0;
		const dimension = gridSize === 0 ? 3 : gridSize === 1 ? 4 : 5;
		const card = {
			...cardSrc,
			cells: cardSrc.cells.map((cell: any) => ({ ...cell })),
			bonusCells: Array.isArray(cardSrc.bonusCells)
				? cardSrc.bonusCells.map((cell: any) => ({ ...cell }))
				: [],
			gridDimension: dimension,
			gridSize: dimension === 3 ? 'ThreeByThree' : dimension === 4 ? 'FourByFour' : 'FiveByFive',
		};
		const bet = Number(results.betAmount);
		const win = Number(results.winAmount ?? card.winAmount ?? 0);
		if (Number.isFinite(bet) && bet > 0) {
			this.scratchBetAmount = bet;
		}
		this.selectedGridSize = gridSize;

		const snap: ScratchGameSnapshot = {
			round: {
				status: 1,
				sessionId: typeof results.sessionId === 'string' ? results.sessionId : null,
				betAmount: Number.isFinite(bet) ? bet : undefined,
				winAmount: Number.isFinite(win) ? win : 0,
				scratchGridSize: gridSize,
				scratchCard: card,
			},
		};

		this.presentChrome();
		if (Number.isFinite(bet) && bet > 0) {
			this.scratchBetAmount = bet;
		}
		this.selectedGridSize = gridSize;
		this.applySnapshot(snap);
		this.selectedGridSize = gridSize;
		if (Number.isFinite(bet) && bet > 0) {
			this.scratchBetAmount = bet;
		}
		this.refreshBuyCardLabel();
		this.refreshDimButtonStyles();
		this.closeButton?.setVisible(false);
		this.closeButton?.disableInteractive();
		this.updateActionEnabled(false);

		this.scene.time.delayedCall(550, () => {
			if (!this.replayLocked || !this.visible) {
				return;
			}
			this.playRevealSandFallOff({ speedScale: 0.045, durationMs: 7000 });
		});
	}


	private scheduleReplaySettled(delayMs = 0): void {
		if (!this.replayLocked || this.replaySettleNotified || this.replaySettleScheduled) {
			return;
		}
		this.replaySettleScheduled = true;
		const fire = () => this.notifyReplaySettled();
		if (delayMs > 0 && this.scene) {
			this.scene.time.delayedCall(delayMs, fire);
			return;
		}
		fire();
	}

	private notifyReplaySettled(): void {
		if (this.replaySettleNotified) {
			return;
		}
		this.replaySettleNotified = true;
		const handler = this.replaySettledHandler;
		this.replaySettledHandler = null;
		handler?.();
	}

	/** Close control: prefer host slide-away when provided. */
	requestClose(): void {
		if (this.replayLocked) {
			return;
		}
		if (this.options.onCloseRequest) {
			this.options.onCloseRequest();
			return;
		}
		this.hide();
	}

	hide(): void {
		if (this.replayLocked) {
			return;
		}
		this.scratching = false;
		this.visible = false;
		this.stopContinuousBetDecrement();
		this.stopContinuousBetIncrement();
		this.clearSandCursor();
		// Keep settled sand so reopen does not flash clear covers.
		this.killFoilGenerateTweens({ keepSand: true });
		if (this.sandSim) {
			this.sealSandGrid();
			this.blitSandSim();
		}
		this.clearSandGrains();
		this.clearScratchWinPresentation();
		this.fullScreenBlocker?.setVisible(false);
		this.animateOut(() => this.options.onClose());
	}

	toggle(): void {
		if (this.visible) {
			this.hide();
		} else {
			void this.show();
		}
	}

	destroy(): void {
		this.unbindBuyFeatureModalGuard();
		this.killFoilGenerateTweens();
		this.clearSandGrains();
		if (this.scene) {
			if (this.resizeHandler) {
				this.scene.scale.off('resize', this.resizeHandler);
			}
			this.scene.events.off('update', this.onSandFrame, this);
			this.unbindScratchPointers(this.scene);
		}
		this.brush?.destroy();
		this.brush = null;
		this.clearSandCursor();
		this.sandCursor?.destroy();
		this.sandCursor = null;
		this.stopContinuousBetDecrement();
		this.stopContinuousBetIncrement();
		this.sandPaintGfx?.destroy();
		this.sandPaintGfx = null;
		this.sandFxContainer = null;
		this.cellViews = [];
		try {
			this.root?.clearMask(false);
		} catch {
			/* noop */
		}
		this.panelGeomMask = null;
		this.panelClipGfx?.destroy();
		this.panelClipGfx = null;
		this.fullScreenBlocker?.destroy();
		this.fullScreenBlocker = null;
		this.root?.destroy(true);
		this.root = null;
		this.scene = null;
		this.betDecButton = null;
		this.betIncButton = null;
		this.betDisplay = null;
		this.betLabelText = null;
		this.betInputBg = null;
		this.newButtonImage = null;
		this.newButtonLabel = null;
	}

	private animateIn(): void {
		if (!this.root || !this.scene) {
			return;
		}
		const rect = this.getPanelRect();
		this.scene.tweens.killTweensOf(this.root);
		if (rect.mode === 'fill') {
			// Host CSS handles the slide from the main canvas edge; appear in place.
			this.root.setPosition(0, 0);
			this.root.setVisible(true);
			this.syncPanelChromeMask();
			return;
		}
		this.root.setPosition(0, this.scene.scale.height);
		this.root.setVisible(true);
		this.syncPanelChromeMask();
		this.scene.tweens.add({
			targets: this.root,
			y: 0,
			duration: 300,
			ease: 'Power2.easeOut',
			onUpdate: () => this.syncPanelChromeMask(),
			onComplete: () => this.syncPanelChromeMask(),
		});
	}

	private animateOut(onComplete?: () => void): void {
		if (!this.root || !this.scene) {
			onComplete?.();
			return;
		}
		const rect = this.getPanelRect();
		this.scene.tweens.killTweensOf(this.root);
		if (rect.mode === 'fill') {
			this.root?.setVisible(false);
			this.root?.setPosition(0, 0);
			onComplete?.();
			return;
		}
		this.scene.tweens.add({
			targets: this.root,
			y: this.scene.scale.height,
			duration: 250,
			ease: 'Power2.easeIn',
			onUpdate: () => this.syncPanelChromeMask(),
			onComplete: () => {
				this.root?.setVisible(false);
				onComplete?.();
			},
		});
	}

	/**
	 * Outside host: geometry-mask flat right edge.
	 * In-canvas drawer: bake buy_feature_bg into a rounded canvas texture (WebGL masks
	 * on Containers do not reliably clip this image, which is why corners looked square).
	 */
	private syncPanelChromeMask(): void {
		if (!this.scene || !this.root) {
			return;
		}
		const rect = this.getPanelRect();

		if (!this.options.fillScene) {
			try {
				this.root.clearMask(false);
			} catch {
				/* noop */
			}
			this.panelGeomMask = null;
			this.ensureRoundedDrawerBackground(rect.w, rect.h, 20);
			return;
		}

		if (!this.panelClipGfx) {
			return;
		}
		if (
			this.backgroundImage &&
			this.scene.textures.exists('buy_feature_bg') &&
			this.backgroundImage.texture.key !== 'buy_feature_bg'
		) {
			this.backgroundImage.setTexture('buy_feature_bg');
		}
		const panelRadius = { tl: 20, tr: 0, br: 0, bl: 20 };
		const x = rect.x + this.root.x;
		const y = rect.y + this.root.y;
		this.panelClipGfx.clear();
		this.panelClipGfx.fillStyle(0xffffff, 1);
		this.panelClipGfx.fillRoundedRect(x, y, rect.w, rect.h, panelRadius);
		if (!this.panelGeomMask) {
			this.panelGeomMask = this.panelClipGfx.createGeometryMask();
			this.root.setMask(this.panelGeomMask);
		}
	}

	/** Cover-scale buy_feature_bg into a w×h texture clipped to a rounded rect. */
	private ensureRoundedDrawerBackground(w: number, h: number, radius: number): void {
		if (!this.scene || !this.backgroundImage) {
			return;
		}
		if (!this.scene.textures.exists('buy_feature_bg')) {
			return;
		}
		const rw = Math.max(1, Math.round(w));
		const rh = Math.max(1, Math.round(h));
		const key = `scratch_drawer_bg_${rw}x${rh}_r${radius}`;
		if (!this.scene.textures.exists(key)) {
			const src = this.scene.textures.get('buy_feature_bg').getSourceImage() as
				| HTMLImageElement
				| HTMLCanvasElement
				| ImageBitmap;
			const sw = Math.max(1, Number((src as HTMLImageElement).width || 0));
			const sh = Math.max(1, Number((src as HTMLImageElement).height || 0));
			const canvas = document.createElement('canvas');
			canvas.width = rw;
			canvas.height = rh;
			const ctx = canvas.getContext('2d');
			if (!ctx) {
				return;
			}
			const r = Math.max(0, Math.min(radius, rw / 2, rh / 2));
			ctx.beginPath();
			ctx.moveTo(r, 0);
			ctx.lineTo(rw - r, 0);
			ctx.quadraticCurveTo(rw, 0, rw, r);
			ctx.lineTo(rw, rh - r);
			ctx.quadraticCurveTo(rw, rh, rw - r, rh);
			ctx.lineTo(r, rh);
			ctx.quadraticCurveTo(0, rh, 0, rh - r);
			ctx.lineTo(0, r);
			ctx.quadraticCurveTo(0, 0, r, 0);
			ctx.closePath();
			ctx.clip();
			const scale = Math.max(rw / sw, rh / sh);
			const dw = sw * scale;
			const dh = sh * scale;
			ctx.drawImage(src as CanvasImageSource, (rw - dw) / 2, (rh - dh) / 2, dw, dh);
			this.scene.textures.addCanvas(key, canvas);
		}
		if (this.backgroundImage.texture.key !== key) {
			this.backgroundImage.setTexture(key);
		}
		this.backgroundImage.setScale(1);
		this.backgroundImage.setDisplaySize(rw, rh);
	}

	private bindScratchPointers(scene: Scene): void {
		this.pointerDownHandler = (pointer) => {
			if (!this.visible || this.busy) return;
			this.updateSandCursor(pointer);
			if (!isScratchRoundActive(this.lastSnap?.round)) return;
			this.scratching = true;
			this.scratchAtPointer(pointer);
		};
		this.pointerMoveHandler = (pointer) => {
			this.updateSandCursor(pointer);
			if (!this.scratching || !pointer.isDown) return;
			this.scratchAtPointer(pointer);
		};
		this.pointerUpHandler = (pointer) => {
			this.scratching = false;
			this.updateSandCursor(pointer);
		};
		scene.input.on('pointerdown', this.pointerDownHandler);
		scene.input.on('pointermove', this.pointerMoveHandler);
		scene.input.on('pointerup', this.pointerUpHandler);
	}

	private unbindScratchPointers(scene: Scene): void {
		if (this.pointerDownHandler) scene.input.off('pointerdown', this.pointerDownHandler);
		if (this.pointerMoveHandler) scene.input.off('pointermove', this.pointerMoveHandler);
		if (this.pointerUpHandler) scene.input.off('pointerup', this.pointerUpHandler);
		this.pointerDownHandler = null;
		this.pointerMoveHandler = null;
		this.pointerUpHandler = null;
		this.clearSandCursor();
	}

	private ensureSandCursor(scene: Scene): void {
		const key = 'scratch_djcoin_cursor';
		const spawn = () => {
			if (!this.root || !this.scene || this.sandCursor) return;
			if (!this.scene.textures.exists(key)) return;
			const img = this.scene.add.image(0, 0, key);
			img.setOrigin(0.5, 0.5);
			img.setDisplaySize(48, 48);
			img.setVisible(false);
			img.setScrollFactor(0);
			this.root.add(img);
			this.sandCursor = img;
		};
		if (scene.textures.exists(key)) {
			spawn();
			return;
		}
		try {
			scene.load.image(key, 'assets/scratch/djcoin_cursor.png');
			scene.load.once(Phaser.Loader.Events.COMPLETE, () => spawn());
			scene.load.start();
		} catch (err) {
			console.warn('[ScratchPanel] Failed to load sand cursor', err);
		}
	}

	/** True when the pointer is over the scratch sand / foil grid. */
	private isPointerOverSandArea(pointer: Phaser.Input.Pointer): boolean {
		if (!this.visible || !this.gridContainer || !this.scene) {
			return false;
		}
		const local = new Phaser.Math.Vector2();
		this.gridContainer
			.getWorldTransformMatrix()
			.applyInverse(pointer.worldX, pointer.worldY, local);

		if (this.sandSim) {
			const hw = this.sandSim.dispW / 2;
			const hh = this.sandSim.dispGridH / 2;
			return local.x >= -hw && local.x <= hw && local.y >= -hh && local.y <= hh;
		}

		if (this.cellViews.length === 0) {
			return false;
		}
		for (const view of this.cellViews) {
			const cellLocal = new Phaser.Math.Vector2();
			view.container
				.getWorldTransformMatrix()
				.applyInverse(pointer.worldX, pointer.worldY, cellLocal);
			const halfW = view.cellW / 2;
			const halfH = view.cellH / 2;
			if (
				cellLocal.x >= -halfW &&
				cellLocal.x <= halfW &&
				cellLocal.y >= -halfH &&
				cellLocal.y <= halfH
			) {
				return true;
			}
		}
		return false;
	}

	private updateSandCursor(pointer: Phaser.Input.Pointer): void {
		if (!this.scene || !this.visible) {
			this.clearSandCursor();
			return;
		}
		if (!this.sandCursor) {
			this.ensureSandCursor(this.scene);
		}
		const over =
			isScratchRoundActive(this.lastSnap?.round) && this.isPointerOverSandArea(pointer);
		if (!over || !this.sandCursor) {
			this.clearSandCursor();
			return;
		}
		const p = this.pointerToRoot(pointer.worldX, pointer.worldY);
		this.sandCursor.setPosition(p.x, p.y);
		this.sandCursor.setVisible(true);
		this.root?.bringToTop(this.sandCursor);
		if (!this.sandCursorActive) {
			this.sandCursorActive = true;
			try {
				this.scene.input.setDefaultCursor('none');
			} catch {
				/* noop */
			}
		}
	}

	private clearSandCursor(): void {
		this.sandCursor?.setVisible(false);
		if (this.sandCursorActive && this.scene) {
			this.sandCursorActive = false;
			try {
				this.scene.input.setDefaultCursor('default');
			} catch {
				/* noop */
			}
		}
	}

	private async onNewCard(): Promise<void> {
		if (this.busy) return;
		if ((this.newButtonImage as Phaser.GameObjects.Image & { __disabled?: boolean })?.__disabled) {
			return;
		}
		if (!this.options.client.isSlotSessionPlayable()) {
			this.reportError(new Error('Scratch requires a valid slot session.'));
			this.hide();
			return;
		}
		this.enforceGridMinBet();
		this.refreshBuyCardLabel();
		this.setBusy(true);
		this.autoCollectScheduled = false;
		this.clearScratchWinPresentation();
		this.clearError();
		try {
			const bet = this.getScratchBetAmount();
			const balanceEpoch = this.options.beginBalanceUpdate?.();
			const snap = await this.options.client.startRound(bet, this.selectedGridSize);
			if (!this.consumeSnapshotOrError(snap)) {
				return;
			}
			this.killFoilGenerateTweens();
			const card = snap.round?.scratchCard ?? null;
			const reuse = this.canReuseGridForSandCover(card);
			this.revealed.clear();
			this.coverOverExistingSymbols = reuse;
			if (!reuse) {
				this.cellViews = [];
				this.cellVisuals = [];
			}
			this.applySnapshot(snap, { generateFoil: true, reuseVisuals: reuse });
			if (typeof snap.player?.balance === 'number') {
				const player = snap.player as { timestamp?: number; Timestamp?: number };
				this.options.onBalanceChanged?.(
					snap.player.balance,
					balanceEpoch,
					player.timestamp ?? player.Timestamp,
				);
			}
			await this.playFoilGenerateAnimation();
		} catch (err) {
			this.reportError(err);
		} finally {
			this.foilGenerating = false;
			this.coverOverExistingSymbols = false;
			this.setBusy(false);
			this.refreshBuyCardLabel();
		}
	}

	/** Single CTA: buy when idle, scratch-all when a card is active. */
	private onPrimaryAction(): void {
		if (isScratchRoundActive(this.lastSnap?.round)) {
			this.onRevealAll();
			return;
		}
		void this.onNewCard();
	}

	private onRevealAll(): void {
		if (this.busy || this.foilGenerating || this.explodingReveal) {
			return;
		}
		if ((this.newButtonImage as Phaser.GameObjects.Image & { __disabled?: boolean })?.__disabled) {
			return;
		}
		if (this.areAllSymbolsRevealed()) {
			return;
		}
		this.playRevealSandFallOff();
	}

	/** Remaining sand is wiped with the same scratch strokes as the finger. */
	private playRevealSandFallOff(pace?: { speedScale?: number; durationMs?: number }): void {
		if (!this.scene) {
			this.revealAllCells();
			return;
		}
		const remaining = this.cellViews.filter((view) => !view.fullyRevealed);
		if (remaining.length === 0) {
			this.revealAllCells();
			return;
		}
		this.explodingReveal = true;
		this.updateActionEnabled(false);
		for (const view of remaining) {
			try {
				view.cover?.clear();
				view.cover?.setVisible(false);
			} catch {
				/* noop */
			}
		}
		if (!this.sandSim) {
			this.explodingReveal = false;
			this.revealAllCells();
			return;
		}
		const bounds = this.remainingSandSimBounds();
		if (!bounds) {
			this.explodingReveal = false;
			this.revealAllCells();
			return;
		}
		this.root?.bringToTop(this.sandFxContainer!);
		if (this.gridContainer && this.sandSim.imageObj) {
			this.gridContainer.bringToTop(this.sandSim.imageObj);
		}
		this.detachFoilTick();
		const sim = this.sandSim;
		const dim = Math.max(3, Math.round(Math.sqrt(this.cellViews.length)));
		const radius = Math.max(3, Math.round((sim.w / dim) * BRUSH_RADIUS_FRAC * 1.7));
		const speedScale = pace?.speedScale ?? 1;
		const revealMs = pace?.durationMs ?? SAND_REVEAL_SCRATCH_MS;
		const speed = Math.max(speedScale < 1 ? 1.5 : 8, Math.round(sim.w * 0.28 * speedScale));
		const rowStep = Math.max(2, Math.round(radius * 0.85));
		const brushes = [0, 1, 2].map((i) => {
			const seed = this.pickRemainingSandCell() ?? {
				x: bounds.x0 + ((i + 1) * (bounds.x1 - bounds.x0)) / 4,
				y: bounds.y0 + ((i + 0.5) * (bounds.y1 - bounds.y0)) / 3,
			};
			return {
				x: seed.x,
				y: seed.y,
				prevX: seed.x,
				prevY: seed.y,
				vx: i % 2 === 0 ? speed : -speed,
			};
		});
		const startAt = this.scene.time.now;
		this.foilTick = () => {
			if (!this.scene || !this.sandSim) {
				this.finishSandFallOff();
				return;
			}
			const box = this.remainingSandSimBounds() ?? bounds;
			let erased = 0;
			for (const brush of brushes) {
				brush.prevX = brush.x;
				brush.prevY = brush.y;
				brush.x += brush.vx;
				brush.y += (Math.random() - 0.5) * 1.8;
				if (brush.x < box.x0 || brush.x >= box.x1) {
					brush.vx *= -1;
					brush.x = Phaser.Math.Clamp(brush.x, box.x0, box.x1 - 1);
					brush.y += rowStep;
				}
				if (brush.y < box.y0 || brush.y >= box.y1) {
					const next = this.pickRemainingSandCell();
					if (next) {
						brush.x = next.x;
						brush.y = next.y;
					} else {
						brush.y = box.y0 + Math.random() * Math.max(1, box.y1 - box.y0);
					}
				}
				const dist = Math.hypot(brush.x - brush.prevX, brush.y - brush.prevY);
				const stamps = Math.max(1, Math.ceil(dist / Math.max(2, radius * 0.45)));
				let strokeErased = 0;
				for (let s = 1; s <= stamps; s++) {
					const t = s / stamps;
					const sx = brush.prevX + (brush.x - brush.prevX) * t;
					const sy = brush.prevY + (brush.y - brush.prevY) * t;
					strokeErased += this.eraseSandSimCircle(sx, sy, radius);
				}
				if (strokeErased <= 0) {
					const next = this.pickRemainingSandCell();
					if (next) {
						brush.x = next.x;
						brush.y = next.y;
						strokeErased += this.eraseSandSimCircle(brush.x, brush.y, radius);
					}
				}
				erased += strokeErased;
				if (strokeErased > 0) {
					const rootPos = this.simToRoot(brush.x, brush.y);
					this.spawnFallingSandGrains(rootPos.x, rootPos.y, 10);
				}
			}
			if (erased > 0) {
				this.blitSandSim();
				this.revealCellsClearedByScratch();
			}
			const elapsed = this.scene.time.now - startAt;
			if (
				!this.sandSim ||
				this.sandSim.filled <= 0 ||
				this.areAllSymbolsRevealed() ||
				elapsed >= revealMs
			) {
				this.finishSandFallOff();
			}
		};
		this.scene.events.on('update', this.foilTick);
		this.scene.time.delayedCall(revealMs + 80, () => this.finishSandFallOff());
	}

	private remainingSandSimBounds(): { x0: number; y0: number; x1: number; y1: number } | null {
		const sim = this.sandSim;
		if (!sim) return null;
		let x0 = sim.w;
		let y0 = sim.gridSimH;
		let x1 = 0;
		let y1 = 0;
		let any = false;
		for (const view of this.cellViews) {
			if (view.fullyRevealed) continue;
			const rect = this.cellToSimRect(view);
			if (!rect) continue;
			any = true;
			x0 = Math.min(x0, rect.x0);
			y0 = Math.min(y0, rect.y0);
			x1 = Math.max(x1, rect.x1);
			y1 = Math.max(y1, rect.y1);
		}
		if (!any || x1 <= x0 || y1 <= y0) {
			return null;
		}
		return { x0, y0, x1, y1 };
	}

	private pickRemainingSandCell(): { x: number; y: number } | null {
		const sim = this.sandSim;
		if (!sim || sim.filled <= 0) {
			return null;
		}
		const limit = sim.w * sim.gridSimH;
		const start = (this.sandRand() * limit) | 0;
		for (let n = 0; n < limit; n++) {
			const i = (start + n) % limit;
			if (sim.cells[i] !== 0) {
				return { x: i % sim.w, y: (i / sim.w) | 0 };
			}
		}
		return null;
	}

	private simToRoot(sx: number, sy: number): { x: number; y: number } {
		const sim = this.sandSim;
		if (!sim || !this.gridContainer) {
			return { x: 0, y: 0 };
		}
		const localX = ((sx + 0.5) / sim.w) * sim.dispW - sim.dispW / 2;
		const localY = ((sy + 0.5) / sim.gridSimH) * sim.dispGridH - sim.dispGridH / 2;
		return {
			x: this.gridContainer.x + localX,
			y: this.gridContainer.y + localY,
		};
	}

	private eraseSandSimCircle(sx: number, sy: number, radius: number): number {
		const sim = this.sandSim;
		if (!sim) return 0;
		const cx = Math.round(sx);
		const cy = Math.round(sy);
		const r = Math.max(1, radius);
		const r2 = r * r;
		let erased = 0;
		for (let dy = -r; dy <= r; dy++) {
			for (let dx = -r; dx <= r; dx++) {
				if (dx * dx + dy * dy > r2) continue;
				const x = cx + dx;
				const y = cy + dy;
				if (x < 0 || y < 0 || x >= sim.w || y >= sim.gridSimH) continue;
				const i = y * sim.w + x;
				if (sim.cells[i] !== 0) {
					sim.cells[i] = 0;
					sim.filled = Math.max(0, sim.filled - 1);
					erased += 1;
				}
			}
		}
		return erased;
	}

	private revealCellsClearedByScratch(): void {
		for (const view of this.cellViews) {
			if (view.fullyRevealed || this.revealed.has(view.index)) continue;
			if (this.sandCoverageInCell(view) <= 1 - REVEAL_THRESHOLD) {
				this.clearSandInCell(view);
				this.finishCellReveal(view, true, false);
			}
		}
		if (this.areAllSymbolsRevealed()) {
			this.destroySandSim();
		}
	}

	private finishSandFallOff(): void {
		if (!this.explodingReveal) {
			return;
		}
		this.detachFoilTick();
		this.destroySandSim();
		this.explodingReveal = false;
		if (!this.scene || !this.visible) {
			return;
		}
		this.revealAllCells();
	}

	private revealAllCells(): void {
		const card = this.lastSnap?.round?.scratchCard;
		if (!card?.cells?.length) {
			return;
		}
		card.cells.forEach((cell) => this.revealed.add(cell.index));
		this.cellViews.forEach((view) => {
			if (!view.fullyRevealed) {
				this.finishCellReveal(view, false, false);
			}
		});
		this.maybeStartWinLineOnMatch();
		if (this.replayLocked && !this.winPresentationShown) {
			this.scheduleReplaySettled();
		}
		this.updateActionEnabled(isScratchRoundActive(this.lastSnap?.round));
		this.scheduleAutoCollect();
	}

	/** Cash out automatically once every cell is revealed. */
	private scheduleAutoCollect(): void {
		if (this.replayLocked) return;
		if (this.autoCollectScheduled || this.busy) return;
		if (!isScratchRoundActive(this.lastSnap?.round)) return;
		if (!this.areAllSymbolsRevealed()) return;
		if (!this.scene) return;

		this.autoCollectScheduled = true;
		const card = this.lastSnap?.round?.scratchCard ?? null;
		const winAmount = Number(card?.winAmount ?? this.lastSnap?.round?.winAmount ?? 0);
		const hasWin = winAmount > 0 && !!this.getWinningMatchSymbol(card);
		// Let win-line + fly-to-header finish before cashout
		const delay = hasWin ? 2400 : 350;

		this.scene.time.delayedCall(delay, () => {
			void this.autoCollect();
		});
	}

	private async autoCollect(): Promise<void> {
		if (!isScratchRoundActive(this.lastSnap?.round)) {
			this.autoCollectScheduled = false;
			return;
		}
		if (!this.areAllSymbolsRevealed()) {
			this.autoCollectScheduled = false;
			return;
		}
		if (!this.options.client.isSlotSessionPlayable()) {
			this.autoCollectScheduled = false;
			this.reportError(new Error('Scratch requires a valid slot session.'));
			this.hide();
			return;
		}
		this.setBusy(true);
		try {
			const winBefore = Number(this.lastSnap?.round?.scratchCard?.winAmount ?? 0);
			const winMatch = this.getWinningMatchSymbol(this.lastSnap?.round?.scratchCard ?? null);
			if (winBefore > 0 && winMatch && !this.winPresentationShown) {
				this.maybeStartWinLineOnMatch();
			}
			const balanceEpoch = this.options.beginBalanceUpdate?.();
			const snap = await this.options.client.cashout();
			if (!this.consumeSnapshotOrError(snap)) {
				this.autoCollectScheduled = false;
				return;
			}
			this.applySnapshot(snap);
			const winAmount = Number(
				snap.round?.scratchCard?.winAmount ?? snap.round?.winAmount ?? winBefore ?? 0,
			);
			const safeWin = Number.isFinite(winAmount) && winAmount > 0 ? winAmount : 0;
			if (safeWin > 0) {
				const card = snap.round?.scratchCard ?? this.lastSnap?.round?.scratchCard ?? null;
				const match = this.getWinningMatchSymbol(card);
				if (card && match && !this.modalComputeContainer?.visible) {
					this.showModalCompute(card, match);
				}
			} else if (this.modalComputeContainer) {
				this.modalComputeContainer.removeAll(true);
				this.modalComputeContainer.setVisible(false).setScale(1);
			}
			// Always report the settled win — including 0 on a lose card.
			this.showModalWinnings(safeWin, this.getScratchTotalWinLabel());
			if (typeof snap.player?.balance === 'number') {
				const player = snap.player as { timestamp?: number; Timestamp?: number };
				this.options.onBalanceChanged?.(
					snap.player.balance,
					balanceEpoch,
					player.timestamp ?? player.Timestamp,
				);
			}
		} catch (err) {
			this.reportError(err);
			this.autoCollectScheduled = false;
		} finally {
			this.setBusy(false);
		}
	}

	private areAllSymbolsRevealed(): boolean {
		const card = this.lastSnap?.round?.scratchCard;
		if (!card?.cells?.length) {
			return false;
		}
		return card.cells.every((c) => this.revealed.has(c.index));
	}

	private applySnapshot(
		snap: ScratchGameSnapshot,
		opts?: { generateFoil?: boolean; reuseVisuals?: boolean },
	): void {
		this.lastSnap = snap;
		const card = snap.round?.scratchCard ?? null;
		const active = isScratchRoundActive(snap.round);
		if (!active && card?.cells?.length) {
			card.cells.forEach((c) => this.revealed.add(c.index));
		}
		if (card) {
			const dim = scratchGridDimension(card, snap.config);
			if (dim === 3) this.selectedGridSize = 0;
			else if (dim === 4) this.selectedGridSize = 1;
			else this.selectedGridSize = 2;
			this.persistScratchGridSize();
		} else {
			this.restorePersistedScratchGridSize();
		}
		this.layout();
		const generateFoil = !!opts?.generateFoil && active;
		if (generateFoil && opts?.reuseVisuals && card && this.canReuseGridForSandCover(card)) {
			this.coverExistingSymbolsWithSand(card);
			if (this.cellViews.length === 0) {
				this.coverOverExistingSymbols = false;
				this.renderGrid(card, false, true);
			}
		} else {
			this.renderGrid(card, !active, generateFoil);
		}
		if (!card?.cells?.length) {
			this.showIdleSettledSand();
		}
		// Closing destroys the CA sand layer; rebuild it when resuming an active card
		// so unscratched cells look sandy again (not clear / flat RT fills).
		if (active && !generateFoil && this.cellViews.length > 0) {
			this.rebuildGrainySandCoverInstant();
		}
		this.refreshLegend();
		this.updateActionEnabled(active);
		this.refreshDimButtonStyles();
		this.restoreSettledWinLineIfNeeded();
	}

	/** Server errors come back on the snapshot (errorCode), not as thrown exceptions. */
	private consumeSnapshotOrError(snap: ScratchGameSnapshot): boolean {
		const message =
			(typeof snap.message === 'string' && snap.message.trim()) || '';
		const code = snap.errorCode;
		const noActiveRound = /no active round/i.test(message);
		if (code || noActiveRound) {
			this.reportError(message || String(code || 'ERR'), code || (noActiveRound ? 'ERR' : null));
			this.options.client.clearLastError();
			return false;
		}
		this.clearError();
		return true;
	}

	private reportError(err: unknown, errorCode?: string | null): void {
		let message = '';
		let code = errorCode ?? null;
		if (typeof err === 'string') {
			message = err;
		} else if (err instanceof Error) {
			message = err.message;
			const anyErr = err as Error & { errorCode?: string; code?: string };
			code = code ?? anyErr.errorCode ?? anyErr.code ?? null;
		} else if (err && typeof err === 'object') {
			const o = err as { message?: string; errorCode?: string };
			message = o.message || String(err);
			code = code ?? o.errorCode ?? null;
		} else {
			message = String(err);
		}
		if (!message.trim()) {
			message = 'Something went wrong.';
		}
		this.options.onError?.(message, code);
	}

	private clearError(): void {
		/* Errors are modal-only; kept for call-site clarity. */
	}

	private getPanelRect(): ScratchPanelRect {
		const sw = this.scene?.scale.width ?? 428;
		const sh = this.scene?.scale.height ?? 926;
		if (this.options.fillScene) {
			const maxW = SCRATCH_PANEL_WIDTH;
			const w = Math.min(sw, maxW);
			const x = Math.floor((sw - w) / 2);
			return { x, y: 0, w, h: sh, mode: 'fill' };
		}
		// Full-width drawer with BuyFeature-style rounded corners (radius 20).
		return {
			x: 0,
			y: sh - DRAWER_HEIGHT,
			w: sw,
			h: DRAWER_HEIGHT,
			mode: 'drawer',
		};
	}

	private getBuyCardButtonWidth(panelW: number = SCRATCH_PANEL_WIDTH): number {
		const pad = Math.min(HORIZONTAL_PADDING, Math.floor(panelW * 0.08));
		return Math.min(364, panelW - pad * 2);
	}

	private getScratchCellMetrics(dim: number): {
		cellW: number;
		cellH: number;
		gridW: number;
		gridH: number;
	} {
		// Sand size locked to reference chrome (not live drawer width/height).
		const btnW = this.getBuyCardButtonWidth(SCRATCH_PANEL_WIDTH);
		const maxGridW = Math.max(80, btnW - 24);
		const maxGridH = Math.max(120, this.getReferenceSandMaxH());
		const refDim = 5;
		const cell = Math.max(
			20,
			Math.min(Math.floor(maxGridW / refDim), Math.floor(maxGridH / refDim)),
		);
		const safeDim = Math.max(1, Math.floor(dim));
		return {
			cellW: cell,
			cellH: cell,
			gridW: cell * safeDim,
			gridH: cell * safeDim,
		};
	}

	/**
	 * Vertical room for sand — always from SCRATCH_PANEL_HEIGHT so cell size is
	 * identical in the in-main drawer and the outside host (drawer chrome is 736).
	 */
	private getReferenceSandMaxH(): number {
		const top = 0;
		const h = SCRATCH_PANEL_HEIGHT;
		const legendY = top + 240;
		const btnH = 62;
		const betInputH = 74;
		const betLabelH = 28;
		const stackGap = 10;
		const btnBottomPad = 20;
		const btnY = top + h - btnBottomPad - btnH / 2;
		const betY = btnY - btnH / 2 - stackGap - betInputH / 2;
		const betLabelY = betY - betInputH / 2 - stackGap - betLabelH / 2;
		const gridAreaTop = legendY + 40;
		const gridAreaBottom = betLabelY - betLabelH / 2 - stackGap;
		return Math.max(120, Math.floor(gridAreaBottom - gridAreaTop));
	}

	/** Static PNG centered in the sand cell (Canvas Spine cannot stay in-cell). */
	private createSymbolVisual(
		cellContainer: Phaser.GameObjects.Container,
		symbol: string,
		cellW: number,
		cellH: number,
		playWin: boolean,
	): { anim: any | null; value: number | null } {
		const scene = this.scene!;
		const value = symbolValueForScratchSymbol(symbol);

		if (isScratchSpecialSymbol(symbol)) {
			return this.createSpecialSymbolVisual(cellContainer, symbol, cellW, cellH, playWin);
		}

		if (isScratchMultiplierValue(value)) {
			return this.createMultiplierVisual(cellContainer, value, cellW, cellH, playWin);
		}

		// Static PNG in the cell. MF Spine on the Canvas host ignores displayOrigin and
		// draws the authored mesh off in the lower-right, outside the sand.
		const tex = textureKeyForScratchSymbol(symbol);
		if (tex && scene.textures.exists(tex)) {
			const img = this.makeScratchImageCrisp(scene.add.image(0, 0, tex).setOrigin(0.5, 0.5));
			const srcW = Math.max(1, img.width);
			const srcH = Math.max(1, img.height);
			const pad = tex === 'dijoker_face' ? 0.86 : 1;
			const scale = Math.min((cellW * pad) / srcW, (cellH * pad) / srcH);
			img.setScale(scale);
			cellContainer.add(img);
			return { anim: img, value };
		}

		if (symbol !== 'Blank') {
			const label = scene.add
				.text(0, 0, symbol.slice(0, 2), {
					fontFamily: 'Poppins-Bold',
					fontSize: `${Math.max(12, Math.floor(Math.min(cellW, cellH) * 0.28))}px`,
					color: '#ffffff',
				})
				.setOrigin(0.5);
			cellContainer.add(label);
			return { anim: label, value };
		}

		return { anim: null, value };
	}

	/** Ms1: SymbolBombs_SW Spine. Ms2: static `symbol0` scatter art. */
	private createSpecialSymbolVisual(
		cellContainer: Phaser.GameObjects.Container,
		symbol: string,
		cellW: number,
		cellH: number,
		playWin: boolean,
	): { anim: any | null; value: number | null } {
		const value = symbolValueForScratchSymbol(symbol);
		// Ms2 uses sugar_symbols/statics/symbol0 — not bomb spine.
		if (symbol === 'Ms2') {
			const { anim } = this.createStaticMultiplierVisual(
				cellContainer,
				symbol,
				cellW,
				cellH,
				playWin,
			);
			return { anim, value };
		}
		if (typeof value === 'number' && isScratchMultiplierValue(value)) {
			return this.createMultiplierVisual(cellContainer, value, cellW, cellH, playWin);
		}
		const { anim } = this.createStaticMultiplierVisual(
			cellContainer,
			symbol,
			cellW,
			cellH,
			false,
		);
		return { anim, value };
	}

	/** Ms1/Ms2 static PNG (optional win pulse). */
	private createStaticMultiplierVisual(
		cellContainer: Phaser.GameObjects.Container,
		symbol: string,
		cellW: number,
		cellH: number,
		playWin: boolean = false,
	): { anim: any | null; value: null } {
		const scene = this.scene!;
		const wrap = scene.add.container(0, 0);
		const tex = textureKeyForScratchSymbol(symbol);
		if (tex && scene.textures.exists(tex)) {
			const img = this.makeScratchImageCrisp(scene.add.image(0, 0, tex).setOrigin(0.5, 0.5));
			const scale = Math.min(
				cellW / Math.max(1, img.width),
				cellH / Math.max(1, img.height),
			);
			img.setScale(scale);
			wrap.add(img);
		}

		(wrap as any).__scratchMsStatic = true;
		cellContainer.add(wrap);
		if (playWin) {
			this.playMsStaticWinPulse(wrap);
		}
		return { anim: wrap, value: null };
	}


	/** Multiplier visual: bomb assets when present, otherwise animated Joker Ace wilds. */
	private createMultiplierVisual(
		cellContainer: Phaser.GameObjects.Container,
		value: number,
		cellW: number,
		cellH: number,
		playWin: boolean,
	): { anim: any | null; value: number | null } {
		const scene = this.scene!;
		const wrap = scene.add.container(0, 0);
		try {
			(wrap as any).symbolValue = value;
		} catch {
			/* noop */
		}

		if (ensureSpineFactory(scene, '[ScratchPanel] createMultiplierVisual')) {
			const cacheJson: any = scene.cache.json;
			if (
				cacheJson?.has?.(SCRATCH_MULTIPLIER_SPINE_KEY) &&
				typeof (scene.add as any).spine === 'function'
			) {
				try {
					const plugin: any =
						(scene as any).sys?.['spine.SpinePlugin'] ||
						(scene as any).sys?.spine ||
						(scene as any).spine;
					if (plugin?.canvasRenderer) {
						plugin.canvasRenderer.triangleRendering = true;
					}
					const go: any = (scene.add as any).spine(
						0,
						0,
						SCRATCH_MULTIPLIER_SPINE_KEY,
						`${SCRATCH_MULTIPLIER_SPINE_KEY}-atlas`,
					);
					if (go) {
						try {
							(go as any).symbolValue = value;
						} catch {
							/* noop */
						}
						if (typeof go.setOrigin === 'function') go.setOrigin(0.5, 0.5);
						this.fitSpineToCell(go, cellW, cellH);
						wrap.add(go);
						(wrap as any).__spine = go;
						this.playSymbolSpine(go, value, playWin);
					}
				} catch (err) {
					console.warn('[ScratchPanel] Multiplier spine failed, overlay only', err);
				}
			}
		}

		// Joker Ace does not ship the Sugar bomb atlas. Use its animated wild
		// symbols while preserving Ms1/Ms2 math and legend behavior.
		if (!wrap.list.length && ensureSpineFactory(scene, '[ScratchPanel] createMultiplierVisual JA')) {
			const visualValue = value === 11 ? 9 : 10;
			const cacheJson: any = scene.cache.json;
			const spineKey = [
				`symbol${visualValue}_spine`,
				`symbol_${visualValue}_spine`,
				`symbol_${visualValue}_sugar_spine`,
			].find((key) => cacheJson?.has?.(key));
			if (spineKey && typeof (scene.add as any).spine === 'function') {
				try {
					const go: any = (scene.add as any).spine(0, 0, spineKey, `${spineKey}-atlas`);
					if (go) {
						(go as any).symbolValue = value;
						(go as any).__scratchVisualValue = visualValue;
						if (typeof go.setOrigin === 'function') go.setOrigin(0.5, 0.5);
						this.fitSpineToCell(go, cellW, cellH);
						wrap.add(go);
						(wrap as any).__spine = go;
						this.playSymbolSpine(go, value, playWin);
					}
				} catch (err) {
					console.warn('[ScratchPanel] Joker Ace multiplier Spine failed', err);
				}
			}
		}

		// No PNG number overlay on Ms cells — bomb Spine / Symbol10 / symbol0 art only.

		if (!wrap.list.length) {
			wrap.destroy();
			const fallbackTex =
				legendTextureKeyForScratchSymbol(value === 11 ? 'Ms2' : 'Ms1') ||
				textureKeyForScratchSymbol(value === 11 ? 'Ms2' : 'Ms1');
			if (fallbackTex && scene.textures.exists(fallbackTex)) {
				const img = this.makeScratchImageCrisp(scene.add.image(0, 0, fallbackTex));
				const srcW = Math.max(1, img.width);
				const srcH = Math.max(1, img.height);
				const scale = Math.min(cellW / srcW, cellH / srcH);
				img.setScale(scale);
				cellContainer.add(img);
				return { anim: img, value };
			}
			return { anim: null, value };
		}
		cellContainer.add(wrap);
		return { anim: wrap, value };
	}

	private spineFromAnim(go: any): any {
		if (go?.animationState) return go;
		if (go?.__spine?.animationState) return go.__spine;
		return go;
	}

	/**
	 * Smooth sampling for scratch PNGs (match Spine softness when minified).
	 * Do NOT call setFilter(LINEAR) after mipmaps — Phaser sets MIN_FILTER to plain
	 * LINEAR and strips mipmap sampling, which aliases badly at cell size.
	 */
	private makeScratchImageCrisp<T extends Phaser.GameObjects.Image>(image: T): T {
		let mipmapped = false;
		try {
			const key = image.texture?.key;
			// Reel tumbles use these same keys. Padding them on the slot scene
			// leaves the art in the upper left of each cell.
			const sharedWithReels = !this.options.fillScene && !!key && isSharedReelTextureKey(key);
			if (this.scene && key && !sharedWithReels) {
				mipmapped =
					enableMipmapsOnPhaserTextureKeys(this.scene, [key], 'linear') > 0;
			}
		} catch {
			/* Canvas renderer and unsupported textures are intentional no-ops. */
		}
		if (!mipmapped) {
			try {
				image.texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
			} catch {
				/* noop */
			}
		}
		return image;
	}

	/**
	 * Scale a Spine into the sand cell. Use one AABB for both fit and centering
	 * so Canvas placement does not drift lower-left.
	 */
	private fitSpineToCell(spineObj: any, cellW: number, cellH: number): void {
		try {
			if (typeof spineObj.setScale === 'function') spineObj.setScale(1);
			spineObj.setPosition?.(0, 0);

			const skeleton = spineObj.skeleton;
			let width = 0;
			let height = 0;
			let originX = 0;
			let originY = 0;

			try {
				if (skeleton) {
					skeleton.x = 0;
					skeleton.y = 0;
					skeleton.scaleX = 1;
					skeleton.scaleY = 1;
				}
				try {
					spineObj.animationState?.clearTracks?.();
				} catch {
					/* noop */
				}
				skeleton?.setToSetupPose?.();
				skeleton?.updateWorldTransform?.(Physics.update);
				const b = skeleton?.getBoundsRect?.();
				width = Number(b?.width ?? 0);
				height = Number(b?.height ?? 0);
				originX = Number(b?.x ?? 0) + width * 0.5;
				originY = Number(b?.y ?? 0) + height * 0.5;
			} catch {
				/* fall through */
			}
			if (!(width > 1 && height > 1)) {
				width = Number(spineObj.width ?? 0);
				height = Number(spineObj.height ?? 0);
				originX = 0;
				originY = 0;
			}
			if (!(width > 1 && height > 1)) {
				return;
			}

			const scale = Math.min(cellW / width, cellH / height) * 0.98;
			if (!(Number.isFinite(scale) && scale > 0)) {
				return;
			}
			spineObj.setScale(scale);

			const canvas = this.scene?.game?.renderer?.type === Phaser.CANVAS;
			if (canvas) {
				spineObj.setOrigin?.(0, 0);
				spineObj.setDisplayOrigin?.(0, 0);
				spineObj.setPosition?.(-originX * scale, -originY * scale);
			} else {
				spineObj.setOrigin?.(0.5, 0.5);
				spineObj.setPosition?.(0, 0);
				try {
					spineObj.updateSize?.();
				} catch {
					/* noop */
				}
			}
		} catch {
			/* noop */
		}
	}

	/** Play win clip. Matches slot tumble `SW_Win` timing (native speed + delayed scale-up). */
	private playSymbolSpine(
		go: any,
		value: number,
		playWin: boolean,
		loop: boolean = true,
	): boolean {
		go = this.spineFromAnim(go);
		const state: any = go?.animationState;
		if (!state || typeof state.setAnimation !== 'function') {
			return false;
		}
		const visualValue = Number(go?.__scratchVisualValue ?? value);
		const multiBase = scratchMultiplierAnimBase(value);
		const suffix = SCRATCH_SPINE_ANIM_SUFFIX;
		const winCandidates = multiBase
			? [
					`${multiBase}_Win`,
					`${multiBase}_win`,
					`Symbol${visualValue}_${suffix}_win`,
					`Symbol${visualValue}_${suffix}_Win`,
					`symbol${visualValue}_${suffix}_win`,
				]
			: [
					`Symbol${visualValue}_${suffix}_win`,
					`Symbol${visualValue}_${suffix}_Win`,
					`symbol${visualValue}_${suffix}_win`,
					`Symbol${visualValue}_JA_win`,
					`Symbol${visualValue}_JA_Win`,
					`Symbol${value}_JA_win`,
					`Symbol${value}_SW_Win`,
				];

		if (playWin) {
			for (const win of winCandidates) {
				try {
					if (!go?.skeleton?.data?.findAnimation?.(win)) continue;
					const entry = state.setAnimation(0, win, loop);
					if (entry) {
						// Slot tumble plays SW_Win at native Spine speed (no 1.15× boost).
						entry.timeScale = 1;
					}
					try {
						if (typeof go.setUpdate === 'function') go.setUpdate?.(true);
						else go.autoUpdate = true;
					} catch {
						/* noop */
					}
					return true;
				} catch {
					/* try next win animation */
				}
			}
		}

		// Bombs / Ms: setup pose is empty — play Idle so the cell is visible.
		if (multiBase) {
			const idleCandidates = [`${multiBase}_Idle`, `${multiBase}_idle`];
			for (const idle of idleCandidates) {
				try {
					if (!go?.skeleton?.data?.findAnimation?.(idle)) continue;
					state.setAnimation(0, idle, true);
					try {
						if (typeof go.setUpdate === 'function') go.setUpdate?.(true);
						else go.autoUpdate = true;
					} catch {
						/* noop */
					}
					return true;
				} catch {
					/* try next idle */
				}
			}
		}

		try {
			state.clearTracks?.();
		} catch {
			/* noop */
		}
		try {
			go.skeleton?.setToSetupPose?.();
			go.skeleton?.updateWorldTransform?.(Physics.none);
		} catch {
			/* noop */
		}
		try {
			if (typeof go.setUpdate === 'function') go.setUpdate?.(false);
			else go.autoUpdate = false;
		} catch {
			/* noop */
		}
		return false;
	}

	/**
	 * Keep win assets at the same display size as the static cell art (no scale-up).
	 */
	private scheduleScratchWinScaleUp(obj: any, _delayMs: number = 500): void {
		if (!obj) {
			return;
		}
		try {
			const prev = (obj as any).__scratchWinScaleTimer;
			if (prev) {
				try {
					prev.remove?.(false);
				} catch {
					/* noop */
				}
				(obj as any).__scratchWinScaleTimer = null;
			}
			const baseX =
				typeof (obj as any).__scratchWinBaseScaleX === 'number'
					? (obj as any).__scratchWinBaseScaleX
					: typeof obj.scaleX === 'number'
						? obj.scaleX
						: 1;
			const baseY =
				typeof (obj as any).__scratchWinBaseScaleY === 'number'
					? (obj as any).__scratchWinBaseScaleY
					: typeof obj.scaleY === 'number'
						? obj.scaleY
						: 1;
			(obj as any).__scratchWinBaseScaleX = baseX;
			(obj as any).__scratchWinBaseScaleY = baseY;
			this.scene?.tweens.killTweensOf(obj);
			obj.setScale?.(baseX, baseY);
		} catch {
			/* noop */
		}
	}

	/** Winning 3-of-a-kind symbol on a paying card, if any. */
	private getWinningMatchSymbol(card: ScratchCardDto | null): string | null {
		if (!card?.cells?.length) {
			return null;
		}
		const winAmount = Number(card.winAmount ?? 0);
		if (!card.isWin && !(winAmount > 0)) {
			return null;
		}
		const counts = new Map<string, number>();
		for (const c of card.cells) {
			if (c.symbol === 'Blank' || isScratchSpecialSymbol(c.symbol)) {
				continue;
			}
			counts.set(c.symbol, (counts.get(c.symbol) ?? 0) + 1);
		}
		for (const [sym, n] of counts) {
			if (n >= 3) {
				return sym;
			}
		}
		return null;
	}

	/** Match cells + Ms1/Ms2 when present on a winning card. */
	private getWinLineVisuals(
		card: ScratchCardDto,
		winMatch: string,
	): ScratchCellVisual[] {
		return this.cellVisuals.filter(
			(v) => v.symbol === winMatch || isScratchSpecialSymbol(v.symbol),
		);
	}

	private getWinLineIndexes(card: ScratchCardDto, winMatch: string): number[] {
		return card.cells
			.filter((c) => c.symbol === winMatch || isScratchSpecialSymbol(c.symbol))
			.map((c) => c.index);
	}

	private addComputeSymbolIcon(
		parent: Phaser.GameObjects.Container,
		symbol: string,
		x: number,
		size: number,
	): number {
		if (!this.scene) return x;
		const cx = x + size / 2;
		const tex =
			legendTextureKeyForScratchSymbol(symbol) || textureKeyForScratchSymbol(symbol);
		if (tex && this.scene.textures.exists(tex)) {
			const img = this.makeScratchImageCrisp(this.scene.add.image(cx, 0, tex)).setOrigin(0.5);
			const scale = Math.min(
				size / Math.max(1, img.width),
				size / Math.max(1, img.height),
			);
			img.setScale(scale);
			parent.add(img);
		} else {
			parent.add(
				this.scene.add
					.text(cx, 0, symbol.slice(0, 2), {
						fontSize: '11px',
						fontFamily: 'Poppins-Bold',
						color: '#ffffff',
					})
					.setOrigin(0.5),
			);
		}
		return x + size + 4;
	}

	private addComputeLabel(
		parent: Phaser.GameObjects.Container,
		text: string,
		x: number,
		color = '#ffe08a',
	): number {
		if (!this.scene) return x;
		const t = this.scene.add
			.text(x, 0, text, {
				fontSize: '13px',
				fontFamily: 'Poppins-Bold',
				color,
			})
			.setOrigin(0, 0.5);
		parent.add(t);
		return x + t.width + 6;
	}

	private playRevealWinOnView(view: ScratchCellVisual | ScratchCellView): void {
		if (!view.symbolAnim && view.symbolValue === null) {
			return;
		}
		// Ms bombs already have SymbolBombs_SW on the cell — play win on that spine.
		if (
			view.symbolValue !== null &&
			this.spineFromAnim(view.symbolAnim)?.animationState &&
			scratchMultiplierAnimBase(view.symbolValue)
		) {
			this.playSymbolSpine(view.symbolAnim, view.symbolValue, true);
			return;
		}
		if (this.spawnWinSpine(view)) {
			return;
		}
		if (view.symbolValue !== null && this.spineFromAnim(view.symbolAnim)?.animationState) {
			this.playSymbolSpine(view.symbolAnim, view.symbolValue, true);
			return;
		}
		if (view.symbolAnim) {
			this.playMsStaticWinPulse(view.symbolAnim);
		}
	}

	/**
	 * Match slot wins: SymbolN_*_win Spine when available, then hit_effect / poof
	 * PNG fallback (RF-style), then dust tumble VFX.
	 */
	private spawnWinSpine(view: ScratchCellVisual | ScratchCellView): boolean {
		const scene = this.scene;
		if (!scene || !view.container?.active) {
			return false;
		}
		if ((view.container as any).__scratchWinCycleActive) {
			return true;
		}
		if (this.spawnSymbolWinSpineOverlay(view)) {
			return true;
		}
		if (this.spawnPngWinWithHitEffect(view)) {
			return true;
		}
		const cacheJson: any = scene.cache.json;
		if (cacheJson?.has?.('dust_effects_AE')) {
			if (!ensureSpineFactory(scene, '[ScratchPanel] spawnWinSpine')) {
				return false;
			}
			(view.container as any).__scratchWinCycleActive = true;
			const run = () => {
				if (!(view.container as any)?.__scratchWinCycleActive) return;
				this.playScratchDustExplode(view, () => {
					if (!(view.container as any)?.__scratchWinCycleActive) return;
					scene.time.delayedCall(280, run);
				});
			};
			run();
			return true;
		}
		return false;
	}

	/** Loop SymbolN_*_win over the cell PNG when dust VFX is not available. */
	private spawnSymbolWinSpineOverlay(view: ScratchCellVisual | ScratchCellView): boolean {
		const scene = this.scene;
		const value = view.symbolValue;
		if (!scene || !view.container?.active || value === null || value === undefined) {
			return false;
		}
		if (!ensureSpineFactory(scene, '[ScratchPanel] spawnSymbolWinSpine')) {
			return false;
		}
		const cacheJson: any = scene.cache.json;
		const spineKey = [
			`symbol_${value}_spine`,
			`symbol${value}_spine`,
			`symbol_${value}_sugar_spine`,
		].find((key) => cacheJson?.has?.(key));
		if (!spineKey || typeof (scene.add as any).spine !== 'function') {
			return false;
		}

		try {
			const prev = (view.container as any).__scratchWinSpine;
			if (prev) {
				try {
					prev.destroy();
				} catch {
					/* noop */
				}
				(view.container as any).__scratchWinSpine = null;
			}

			let go: any = null;
			if (typeof (scene.make as any)?.spine === 'function') {
				go = (scene.make as any).spine({
					x: 0,
					y: 0,
					dataKey: spineKey,
					atlasKey: `${spineKey}-atlas`,
					add: false,
				});
			} else {
				go = (scene.add as any).spine(0, 0, spineKey, `${spineKey}-atlas`);
			}
			if (!go) {
				return false;
			}
			(go as any).symbolValue = value;
			(go as any).__scratchVisualValue = value;
			if (typeof go.setOrigin === 'function') go.setOrigin(0.5, 0.5);
			this.fitSpineToCell(go, view.cellW, view.cellH);
			view.container.add(go);
			(view.container as any).__scratchWinSpine = go;
			(view.container as any).__scratchWinCycleActive = true;

			// Hide static PNG while Spine win plays so we don't double-draw.
			this.setScratchSymbolVisible(view, false);
			const played = this.playSymbolSpine(go, value, true, true);
			if (!played) {
				try {
					go.destroy();
				} catch {
					/* noop */
				}
				(view.container as any).__scratchWinSpine = null;
				(view.container as any).__scratchWinCycleActive = false;
				this.setScratchSymbolVisible(view, true);
				return false;
			}
			return true;
		} catch (err) {
			console.warn('[ScratchPanel] Symbol win spine overlay failed', err);
			return false;
		}
	}


	/**
	 * Slot tumble PNG fallback: keep static size, then `hit_effect` at scale 0.25.
	 */
	private spawnPngWinWithHitEffect(view: ScratchCellVisual | ScratchCellView): boolean {
		const scene = this.scene;
		if (!scene || !view.container?.active) {
			return false;
		}
		const cacheJson: any = scene.cache.json;
		const hitKey = cacheJson?.has?.('hit_effect')
			? 'hit_effect'
			: cacheJson?.has?.('Poof_VFX_RF')
				? 'Poof_VFX_RF'
				: null;
		const canHit =
			!!hitKey &&
			ensureSpineFactory(scene, '[ScratchPanel] hitEffect') &&
			typeof (scene.add as any).spine === 'function';
		if (!canHit) {
			return false;
		}

		(view.container as any).__scratchWinCycleActive = true;
		this.setScratchSymbolVisible(view, true);

		const run = () => {
			if (!(view.container as any)?.__scratchWinCycleActive) return;
			const png = view.symbolAnim;
			if (png) {
				this.scheduleScratchWinScaleUp(png);
			}

			scene.time.delayedCall(500, () => {
				if (!(view.container as any)?.__scratchWinCycleActive) return;
				this.setScratchSymbolVisible(view, false);
				this.playScratchHitEffect(view, hitKey!, () => {
					if (!(view.container as any)?.__scratchWinCycleActive) return;
					try {
						const baseScaleX = (png as any)?.__scratchWinBaseScaleX ?? png?.scaleX ?? 1;
						const baseScaleY = (png as any)?.__scratchWinBaseScaleY ?? png?.scaleY ?? 1;
						png?.setScale?.(baseScaleX, baseScaleY);
						png?.setY?.(0);
					} catch {
						/* noop */
					}
					this.setScratchSymbolVisible(view, true);
					scene.time.delayedCall(200, run);
				});
			});
		};
		run();
		return true;
	}

	/** One-shot hit_effect / poof — same scale as slot tumble (0.25). */
	private playScratchHitEffect(
		view: ScratchCellVisual | ScratchCellView,
		hitKey: string,
		onDone?: () => void,
	): void {
		const scene = this.scene;
		const container = view.container;
		if (!scene || !container?.active) {
			onDone?.();
			return;
		}
		try {
			const prev = (container as any).__scratchHitFx;
			if (prev) {
				try {
					prev.destroy();
				} catch {
					/* noop */
				}
				(container as any).__scratchHitFx = null;
			}

			let fx: any = null;
			if (typeof (scene.make as any)?.spine === 'function') {
				fx = (scene.make as any).spine({
					x: 0,
					y: 0,
					dataKey: hitKey,
					atlasKey: `${hitKey}-atlas`,
					add: false,
				});
			} else {
				fx = (scene.add as any).spine(0, 0, hitKey, `${hitKey}-atlas`);
			}
			if (!fx) {
				onDone?.();
				return;
			}
			container.add(fx);
			(container as any).__scratchHitFx = fx;
			fx.setOrigin?.(0.5, 0.5);
			fx.setPosition?.(0, 0);
			const reelSlot = 110;
			const hitScale = this.options.fillScene
				? 0.25 * (Math.min(view.cellW, view.cellH) / reelSlot)
				: 0.25;
			fx.setScale?.(hitScale);

			const state = fx.animationState;
			const dataAnims = fx.skeleton?.data?.animations as Array<{ name: string }> | undefined;
			const animName =
				fx.skeleton?.data?.findAnimation?.('Poof_RF_Explosion')?.name ||
				dataAnims?.[0]?.name ||
				'animation';
			let finished = false;
			const finish = () => {
				if (finished) return;
				finished = true;
				try {
					fx.destroy();
				} catch {
					/* noop */
				}
				if ((container as any).__scratchHitFx === fx) {
					(container as any).__scratchHitFx = null;
				}
				onDone?.();
			};
			if (state?.setAnimation) {
				try {
					state.setAnimation(0, animName, false);
					state.addListener?.({
						complete: finish,
						end: finish,
					});
				} catch {
					finish();
					return;
				}
				scene.time.delayedCall(1200, finish);
			} else {
				finish();
			}
		} catch (err) {
			console.warn('[ScratchPanel] hit_effect failed', err);
			onDone?.();
		}
	}

	private setScratchSymbolVisible(
		view: ScratchCellVisual | ScratchCellView,
		visible: boolean,
	): void {
		const anim = view.symbolAnim;
		if (!anim) return;
		try {
			anim.setVisible?.(visible);
			if (typeof anim.setAlpha === 'function') {
				anim.setAlpha(visible ? 1 : 0);
			} else if (typeof anim.alpha === 'number') {
				anim.alpha = visible ? 1 : 0;
			}
		} catch {
			/* noop */
		}
	}

	/** Slot tumble destroy VFX (`dust_effects_AE`) centered on the cell. */
	private playScratchDustExplode(
		view: ScratchCellVisual | ScratchCellView,
		onDone?: () => void,
	): void {
		const scene = this.scene;
		const container = view.container;
		if (!scene || !container?.active) {
			onDone?.();
			return;
		}
		const cacheJson: any = scene.cache.json;
		const dustKey = 'dust_effects_AE';
		if (!cacheJson?.has?.(dustKey) || !ensureSpineFactory(scene, '[ScratchPanel] dust')) {
			onDone?.();
			return;
		}

		/** Hide PNG shortly after burst starts so the dust reads as the symbol breaking apart. */
		const HIDE_AFTER_MS = 120;
		/** Keep PNG gone briefly after dust ends before the next loop. */
		const GONE_AFTER_MS = 240;

		try {
			const prevDust = (container as any).__scratchDustSpine;
			if (prevDust) {
				try {
					prevDust.destroy();
				} catch {
					/* noop */
				}
				(container as any).__scratchDustSpine = null;
			}
			const prevHideTimer = (container as any).__scratchSymbolHideTimer;
			if (prevHideTimer) {
				try {
					prevHideTimer.remove?.(false);
				} catch {
					/* noop */
				}
				(container as any).__scratchSymbolHideTimer = null;
			}
			const prevShowTimer = (container as any).__scratchSymbolShowTimer;
			if (prevShowTimer) {
				try {
					prevShowTimer.remove?.(false);
				} catch {
					/* noop */
				}
				(container as any).__scratchSymbolShowTimer = null;
			}

			let dust: any = null;
			if (typeof (scene.make as any)?.spine === 'function') {
				dust = (scene.make as any).spine({
					x: 0,
					y: 0,
					dataKey: dustKey,
					atlasKey: `${dustKey}-atlas`,
					add: false,
				});
			} else if (typeof (scene.add as any).spine === 'function') {
				dust = (scene.add as any).spine(0, 0, dustKey, `${dustKey}-atlas`);
			}
			if (!dust) {
				onDone?.();
				return;
			}

			this.fitSpineToCell(dust, view.cellW, view.cellH);
			container.add(dust);
			(container as any).__scratchDustSpine = dust;
			this.setScratchSymbolVisible(view, true);

			const state: any = dust.animationState;
			const animName = 'dust_effects_AE';
			const finish = () => {
				try {
					if ((container as any).__scratchDustSpine === dust) {
						(container as any).__scratchDustSpine = null;
					}
					dust.destroy();
				} catch {
					/* noop */
				}
				this.setScratchSymbolVisible(view, false);
				const showTimer = scene.time.delayedCall(GONE_AFTER_MS, () => {
					(container as any).__scratchSymbolShowTimer = null;
					if (!(container as any).__scratchWinCycleActive) return;
					this.setScratchSymbolVisible(view, true);
					onDone?.();
				});
				(container as any).__scratchSymbolShowTimer = showTimer;
			};

			if (state && typeof state.setAnimation === 'function') {
				let finished = false;
				const finishOnce = () => {
					if (finished) return;
					finished = true;
					finish();
				};
				const listener = {
					complete: (entry: any) => {
						try {
							if (entry?.animation?.name !== animName) return;
						} catch {
							/* noop */
						}
						try {
							state.removeListener?.(listener);
						} catch {
							/* noop */
						}
						finishOnce();
					},
				};
				try {
					state.addListener?.(listener);
				} catch {
					/* noop */
				}
				state.setAnimation(0, animName, false);
				try {
					if (typeof dust.setUpdate === 'function') dust.setUpdate?.(true);
					else dust.autoUpdate = true;
				} catch {
					/* noop */
				}
				const hideTimer = scene.time.delayedCall(HIDE_AFTER_MS, () => {
					(container as any).__scratchSymbolHideTimer = null;
					if (!(container as any).__scratchWinCycleActive) return;
					this.setScratchSymbolVisible(view, false);
				});
				(container as any).__scratchSymbolHideTimer = hideTimer;
				scene.time.delayedCall(1600, finishOnce);
			} else {
				finish();
			}
		} catch (err) {
			console.warn('[ScratchPanel] Dust explode failed', err);
			this.setScratchSymbolVisible(view, true);
			onDone?.();
		}
	}

	/** Stop dust cycle (New Card / re-cover). */
	private clearWinSpine(view: ScratchCellVisual | ScratchCellView): void {
		(view.container as any).__scratchWinCycleActive = false;
		const hitFx = (view.container as any)?.__scratchHitFx;
		if (hitFx) {
			try {
				hitFx.destroy();
			} catch {
				/* noop */
			}
			(view.container as any).__scratchHitFx = null;
		}
		const png = view.symbolAnim;
		if (png) {
			try {
				this.scene?.tweens?.killTweensOf?.(png);
				const bx = (png as any).__scratchBaseScaleX;
				const by = (png as any).__scratchBaseScaleY;
				if (typeof bx === 'number' && typeof by === 'number') {
					png.setScale?.(bx, by);
				}
				png.setY?.(0);
			} catch {
				/* noop */
			}
		}
		const badge = (view.container as any)?.__scratchWinBadge;
		if (badge) {
			try {
				badge.destroy();
			} catch {
				/* noop */
			}
			(view.container as any).__scratchWinBadge = null;
		}
		const hideTimer = (view.container as any)?.__scratchSymbolHideTimer;
		if (hideTimer) {
			try {
				hideTimer.remove?.(false);
			} catch {
				/* noop */
			}
			(view.container as any).__scratchSymbolHideTimer = null;
		}
		const showTimer = (view.container as any)?.__scratchSymbolShowTimer;
		if (showTimer) {
			try {
				showTimer.remove?.(false);
			} catch {
				/* noop */
			}
			(view.container as any).__scratchSymbolShowTimer = null;
		}
		const dust = (view.container as any)?.__scratchDustSpine;
		if (dust) {
			try {
				dust.destroy();
			} catch {
				/* noop */
			}
			(view.container as any).__scratchDustSpine = null;
		}
		const go = (view.container as any)?.__scratchWinSpine;
		if (go) {
			try {
				const listener = (view.container as any)?.__scratchWinListener;
				const state: any = go.animationState;
				if (listener && state?.removeListener) {
					state.removeListener(listener);
				}
			} catch {
				/* noop */
			}
			(view.container as any).__scratchWinListener = null;
			try {
				go.destroy();
			} catch {
				/* noop */
			}
			(view.container as any).__scratchWinSpine = null;
		}
		this.setScratchSymbolVisible(view, true);
	}

	/** Lightweight win feedback when Ms has no Spine clip — keep static size. */
	private playMsStaticWinPulse(target: any): void {
		if (!this.scene || !target) {
			return;
		}
		try {
			this.scene.tweens.killTweensOf(target);
			const baseScaleX = typeof target.scaleX === 'number' ? target.scaleX : 1;
			const baseScaleY = typeof target.scaleY === 'number' ? target.scaleY : 1;
			target.setScale?.(baseScaleX, baseScaleY);
			this.scene.tweens.add({
				targets: target,
				alpha: { from: 1, to: 0.72 },
				duration: 280,
				yoyo: true,
				repeat: -1,
				ease: 'Sine.easeInOut',
			});
		} catch {
			/* noop */
		}
	}

	private canReuseGridForSandCover(card: ScratchCardDto | null): boolean {
		if (!card?.cells?.length || !this.scene || !this.gridContainer) {
			return false;
		}
		if (this.cellVisuals.length !== card.cells.length) {
			return false;
		}
		return this.cellVisuals.every((v) => !!v.container?.active);
	}

	/** Pour sand over the current revealed symbols instead of rebuilding the grid. */
	private coverExistingSymbolsWithSand(card: ScratchCardDto): void {
		if (!this.scene) {
			return;
		}
		for (const view of this.cellViews) {
			try {
				view.cover?.destroy();
			} catch {
				/* noop */
			}
		}
		this.cellViews = [];
		const nextVisuals: ScratchCellVisual[] = [];
		this.cellVisuals.forEach((visual, i) => {
			const cell = card.cells[i];
			if (!cell || !visual.container?.active) {
				return;
			}
			this.clearWinSpine(visual);
			if (visual.symbolAnim && typeof visual.symbolAnim.setY === 'function') {
				visual.symbolAnim.setY(0);
			}
			const coverW = Math.ceil(visual.cellW) + 2;
			const coverH = Math.ceil(visual.cellH) + 2;
			const cover = this.scene!.add.renderTexture(0, 0, coverW, coverH);
			this.paintFullSandCover(cover, coverW, coverH);
			cover.setOrigin(0, 0);
			cover.setPosition(-coverW / 2, -coverH / 2);
			cover.setVisible(false);
			cover.clear();
			visual.container.add(cover);
			nextVisuals.push({
				...visual,
				index: cell.index,
			});
			this.cellViews.push({
				index: cell.index,
				symbol: cell.symbol,
				container: visual.container,
				cover,
				cellW: visual.cellW,
				cellH: visual.cellH,
				coverW,
				coverH,
				stamps: new Array(STAMP_GRID * STAMP_GRID).fill(false),
				fullyRevealed: false,
				symbolAnim: visual.symbolAnim,
				symbolValue: visual.symbolValue,
			});
		});
		this.cellVisuals = nextVisuals;
	}

	private swapSymbolsUnderCover(): void {
		const card = this.lastSnap?.round?.scratchCard;
		if (!this.scene || !card?.cells?.length) {
			return;
		}
		for (let i = 0; i < this.cellViews.length; i++) {
			const view = this.cellViews[i];
			const cell = card.cells.find((c) => c.index === view.index) ?? card.cells[i];
			if (!cell || !view.container?.active) {
				continue;
			}
			this.clearWinSpine(view);
			const oldAnim = view.symbolAnim;
			if (oldAnim) {
				try {
					oldAnim.destroy();
				} catch {
					/* noop */
				}
				view.symbolAnim = null;
			}
			const { anim, value } = this.createSymbolVisual(
				view.container,
				cell.symbol,
				view.cellW,
				view.cellH,
				false,
			);
			view.symbolAnim = anim;
			view.symbolValue = value;
			view.symbol = cell.symbol;
			if (view.cover?.active) {
				view.container.bringToTop(view.cover);
			}
			const visual =
				this.cellVisuals.find((v) => v.index === view.index) ?? this.cellVisuals[i];
			if (visual) {
				visual.symbolAnim = anim;
				visual.symbolValue = value;
				visual.symbol = cell.symbol;
			}
		}
	}

	private renderGrid(
		card: ScratchCardDto | null,
		playWinOnRevealed = false,
		generateFoil = false,
	): void {
		if (!this.scene || !this.gridContainer) return;
		// removeAll would orphan sandSim.imageObj; tear it down cleanly first.
		this.destroySandSim();
		this.gridContainer.removeAll(true);
		this.cellViews = [];
		this.cellVisuals = [];
		if (!card?.cells?.length) return;

		const dim = scratchGridDimension(card, this.lastSnap?.config);
		const { cellW, cellH, gridW, gridH } = this.getScratchCellMetrics(dim);
		const startX = -gridW / 2 + cellW / 2;
		const startY = -gridH / 2 + cellH / 2;
		const active = isScratchRoundActive(this.lastSnap?.round);
		const winMatch = this.getWinningMatchSymbol(card);

		card.cells.forEach((cell, i) => {
			const col = i % dim;
			const row = Math.floor(i / dim);
			const x = startX + col * cellW;
			const y = startY + row * cellH;
			const cellContainer = this.scene!.add.container(x, y);

			const alreadyRevealed = this.revealed.has(cell.index) || !active;
			const shouldWinAnim =
				alreadyRevealed &&
				playWinOnRevealed &&
				!!winMatch &&
				(cell.symbol === winMatch || isScratchSpecialSymbol(cell.symbol));
			const { anim, value } = this.createSymbolVisual(
				cellContainer,
				cell.symbol,
				cellW,
				cellH,
				shouldWinAnim,
			);

			const visual: ScratchCellVisual = {
				index: cell.index,
				symbol: cell.symbol,
				container: cellContainer,
				symbolAnim: anim,
				symbolValue: value,
				cellW,
				cellH,
			};
			this.cellVisuals.push(visual);

			if (shouldWinAnim) {
				this.playRevealWinOnView(visual);
			}

			if (!alreadyRevealed) {
				const coverW = Math.ceil(cellW) + 2;
				const coverH = Math.ceil(cellH) + 2;
				const cover = this.scene!.add.renderTexture(0, 0, coverW, coverH);
				cover.setOrigin(0.5, 0.5);
				this.paintFullSandCover(cover, coverW, coverH);
				if (generateFoil) {
					cover.setOrigin(0, 0);
					cover.setPosition(-coverW / 2, -coverH / 2);
					cover.setVisible(false);
					cover.clear();
				}
				cellContainer.add(cover);
				this.cellViews.push({
					...visual,
					cover,
					coverW,
					coverH,
					stamps: new Array(STAMP_GRID * STAMP_GRID).fill(false),
					fullyRevealed: false,
				});
			} else {
				this.revealed.add(cell.index);
			}

			this.gridContainer!.add(cellContainer);
		});
	}

	private killFoilGenerateTweens(opts?: { keepSand?: boolean }): void {
		for (const tw of this.foilTweens) {
			try {
				tw.stop();
			} catch {
				/* noop */
			}
		}
		this.foilTweens = [];
		this.detachFoilTick();
		if (!opts?.keepSand) {
			this.destroySandSim();
		}
		this.explodingReveal = false;
		this.foilGenerating = false;
		const resolve = this.foilGenerateResolve;
		this.foilGenerateResolve = null;
		resolve?.();
	}

	private detachFoilTick(): void {
		if (this.scene && this.foilTick) {
			this.scene.events.off('update', this.foilTick);
		}
		this.foilTick = null;
	}

	/** Fast-forward falling sand over the whole grid (Shadertoy-style CA). */
	private playFoilGenerateAnimation(): Promise<void> {
		if (!this.scene || this.cellViews.length === 0) {
			this.foilGenerating = false;
			return Promise.resolve();
		}
		this.foilGenerating = true;
		this.root?.bringToTop(this.sandFxContainer!);
		let minY = Number.POSITIVE_INFINITY;
		let maxY = Number.NEGATIVE_INFINITY;
		let minX = Number.POSITIVE_INFINITY;
		let maxX = Number.NEGATIVE_INFINITY;
		for (const view of this.cellViews) {
			const top = view.container.y - view.coverH / 2;
			const bottom = view.container.y + view.coverH / 2;
			const left = view.container.x - view.coverW / 2;
			const right = view.container.x + view.coverW / 2;
			if (top < minY) minY = top;
			if (bottom > maxY) maxY = bottom;
			if (left < minX) minX = left;
			if (right > maxX) maxX = right;
			if (view.cover?.active) {
				view.cover.clear();
				view.cover.setVisible(false);
			}
		}
		if (!Number.isFinite(minY) || !Number.isFinite(maxY)) {
			this.foilGenerating = false;
			this.restoreCoversAfterSand();
			this.attachSymbolsUnderFoil();
			return Promise.resolve();
		}
		const gridW = Math.max(8, maxX - minX);
		const gridH = Math.max(8, maxY - minY);
		this.beginSandSim(gridW, gridH, this.extraSandFallHeight(gridH));
		const startAt = this.scene.time.now;
		return new Promise((resolve) => {
			let settled = false;
			const settle = () => {
				if (settled) {
					return;
				}
				settled = true;
				this.detachFoilTick();
				this.foilGenerating = false;
				this.foilGenerateResolve = null;
				try {
					this.keepGrainySandCover();
				} catch (err) {
					console.warn('[ScratchPanel] foil settle failed', err);
				}
				resolve();
			};
			this.foilGenerateResolve = settle;
			this.foilTick = () => {
				if (!this.scene || !this.sandSim) {
					settle();
					return;
				}
				const elapsed = this.scene.time.now - startAt;
				const sim = this.sandSim;
				const target = sim.w * sim.gridSimH;
				for (let s = 0; s < SAND_STEPS_PER_FRAME; s++) {
					if (sim.filled < target) {
						this.spawnSandSimRow();
					}
					this.stepSandSim(false);
				}
				this.blitSandSim();
				if (sim.filled >= target || elapsed >= SAND_COVER_MS) {
					settle();
				}
			};
			this.scene.events.on('update', this.foilTick);
			this.scene.time.delayedCall(SAND_COVER_MS + 200, settle);
		});
	}

	private extraSandFallHeight(gridH: number): number {
		if (!this.scene || !this.gridContainer) {
			return Math.max(48, gridH);
		}
		const local = new Phaser.Math.Vector2();
		this.gridContainer
			.getWorldTransformMatrix()
			.applyInverse(this.scene.scale.width / 2, this.scene.scale.height, local);
		return Math.max(48, local.y - gridH / 2 + 12);
	}

	private beginSandSim(gridW: number, gridH: number, extraBelow: number): void {
		this.destroySandSim();
		if (!this.scene || !this.gridContainer) {
			return;
		}
		const w = Math.max(24, Math.ceil(gridW / SAND_GRAIN_PX));
		const gridSimH = Math.max(24, Math.ceil(gridH / SAND_GRAIN_PX));
		const belowSimH = Math.max(12, Math.ceil(Math.max(0, extraBelow) / SAND_GRAIN_PX));
		const h = gridSimH + belowSimH;
		const dispFullH = gridH + extraBelow;
		const canvas = document.createElement('canvas');
		canvas.width = w;
		canvas.height = h;
		const ctx = canvas.getContext('2d', { willReadFrequently: true });
		if (!ctx) {
			return;
		}
		if (this.scene.textures.exists(SAND_SIM_KEY)) {
			this.scene.textures.remove(SAND_SIM_KEY);
		}
		this.scene.textures.addCanvas(SAND_SIM_KEY, canvas);
		const imageObj = this.scene.add.image(0, -gridH / 2, SAND_SIM_KEY);
		imageObj.setOrigin(0.5, 0);
		imageObj.setDisplaySize(gridW, dispFullH);
		this.gridContainer.add(imageObj);
		this.gridContainer.bringToTop(imageObj);
		const faceGray = this.buildSandFaceGray(w, gridSimH);
		this.sandSim = {
			w,
			h,
			cells: new Uint8Array(w * h),
			canvas,
			ctx,
			image: ctx.createImageData(w, h),
			imageObj,
			faceGray,
			filled: 0,
			rng: 0x9e3779b9,
			scanDir: 1,
			dispW: gridW,
			dispH: dispFullH,
			dispGridH: gridH,
			gridSimH,
		};
	}


	/**
	 * Stretch `dijoker_face` across the sand grid and bake grayscale luminance
	 * so filled sand grains paint the joker face over the whole area.
	 */
	private buildSandFaceGray(w: number, gridSimH: number): Uint8Array | null {
		if (!this.scene?.textures.exists('dijoker_face') || w < 1 || gridSimH < 1) {
			return null;
		}
		try {
			const texture = this.scene.textures.get('dijoker_face');
			const src = texture.getSourceImage() as
				| HTMLImageElement
				| HTMLCanvasElement
				| ImageBitmap;
			// In-canvas WebGL pads NPOT art to the next power of two for mipmaps.
			// The face stays in the top-left of that larger canvas — use the frame
			// crop so it still covers the whole sand, matching the side canvas host.
			const frame = typeof texture.get === 'function' ? texture.get() : null;
			const cropX = Math.max(0, Number(frame?.cutX ?? 0));
			const cropY = Math.max(0, Number(frame?.cutY ?? 0));
			const sw = Math.max(
				1,
				Number(frame?.cutWidth) || Number((src as HTMLImageElement).width) || 1,
			);
			const sh = Math.max(
				1,
				Number(frame?.cutHeight) || Number((src as HTMLImageElement).height) || 1,
			);
			const off = document.createElement('canvas');
			off.width = w;
			off.height = gridSimH;
			const octx = off.getContext('2d');
			if (!octx) {
				return null;
			}
			// object-fit: cover — fill the entire sand rectangle
			const scale = Math.max(w / sw, gridSimH / sh);
			const dw = sw * scale;
			const dh = sh * scale;
			const dx = (w - dw) * 0.5;
			const dy = (gridSimH - dh) * 0.5;
			octx.fillStyle = '#808080';
			octx.fillRect(0, 0, w, gridSimH);
			octx.drawImage(src as CanvasImageSource, cropX, cropY, sw, sh, dx, dy, dw, dh);
			const img = octx.getImageData(0, 0, w, gridSimH);
			const gray = new Uint8Array(w * gridSimH);
			const pix = img.data;
			for (let i = 0; i < gray.length; i++) {
				const o = i << 2;
				gray[i] =
					(pix[o] * 0.299 + pix[o + 1] * 0.587 + pix[o + 2] * 0.114) | 0;
			}
			return gray;
		} catch (err) {
			console.warn('[ScratchPanel] Failed to build sand joker face', err);
			return null;
		}
	}

	private sandRand(): number {
		const sim = this.sandSim;
		if (!sim) return 0.5;
		sim.rng = (Math.imul(sim.rng, 1664525) + 1013904223) >>> 0;
		return sim.rng / 4294967296;
	}

	private spawnSandSimRow(): void {
		const sim = this.sandSim;
		if (!sim) return;
		const count = Math.max(8, Math.ceil(sim.w * 0.9));
		for (let n = 0; n < count; n++) {
			const x = (this.sandRand() * sim.w) | 0;
			const y = this.sandRand() < 0.8 ? 0 : 1;
			if (y >= sim.gridSimH) continue;
			const i = y * sim.w + x;
			if (sim.cells[i] === 0) {
				sim.cells[i] = 70 + ((this.sandRand() * 70) | 0);
				sim.filled += 1;
			}
		}
	}

	private stepSandSim(drain = false): void {
		const sim = this.sandSim;
		if (!sim) return;
		const { w, h, cells, gridSimH } = sim;
		const floorH = drain ? h : gridSimH;
		if (drain) {
			const bottom = (h - 1) * w;
			for (let x = 0; x < w; x++) {
				if (cells[bottom + x] !== 0) {
					cells[bottom + x] = 0;
					sim.filled = Math.max(0, sim.filled - 1);
				}
			}
		}
		const dir = sim.scanDir;
		sim.scanDir = dir === 1 ? -1 : 1;
		const xStart = dir === 1 ? 0 : w - 1;
		const xEnd = dir === 1 ? w : -1;
		for (let y = floorH - 2; y >= 0; y--) {
			for (let x = xStart; x !== xEnd; x += dir) {
				const i = y * w + x;
				const v = cells[i];
				if (v === 0) continue;
				const below = i + w;
				if (cells[below] === 0) {
					cells[below] = v;
					cells[i] = 0;
					continue;
				}
				const leftOk = x > 0 && cells[below - 1] === 0;
				const rightOk = x < w - 1 && cells[below + 1] === 0;
				if (leftOk && rightOk) {
					if (this.sandRand() < 0.5) {
						cells[below - 1] = v;
					} else {
						cells[below + 1] = v;
					}
					cells[i] = 0;
				} else if (leftOk) {
					cells[below - 1] = v;
					cells[i] = 0;
				} else if (rightOk) {
					cells[below + 1] = v;
					cells[i] = 0;
				}
			}
		}
	}

	private blitSandSim(): void {
		const sim = this.sandSim;
		if (!sim || !this.scene) return;
		const { cells, image, ctx, faceGray } = sim;
		const data = image.data;
		const faceLen = faceGray ? faceGray.length : 0;
		for (let i = 0; i < cells.length; i++) {
			const o = i << 2;
			const v = cells[i];
			if (v === 0) {
				data[o] = 0;
				data[o + 1] = 0;
				data[o + 2] = 0;
				data[o + 3] = 0;
			} else {
				let g: number;
				if (faceGray && i < faceLen) {
					// Face luminance + light grain variation from the CA value.
					const grain = ((v % 51) - 25) | 0;
					g = faceGray[i] + grain;
					if (g < 28) g = 28;
					else if (g > 235) g = 235;
				} else {
					g = 90 + (v % 70);
				}
				data[o] = g;
				data[o + 1] = g;
				data[o + 2] = g;
				data[o + 3] = 255;
			}
		}
		ctx.putImageData(image, 0, 0);
		try {
			const tex = this.scene.textures.get(SAND_SIM_KEY) as Phaser.Textures.CanvasTexture;
			tex.refresh();
		} catch {
			/* noop */
		}
	}

	private keepGrainySandCover(): void {
		this.sealSandGrid();
		if (this.sandSim) {
			for (let i = 0; i < 8; i++) {
				this.stepSandSim(false);
			}
			this.sealSandGrid();
		}
		this.attachSymbolsUnderFoil();
		for (const view of this.cellViews) {
			if (view.cover?.active) {
				view.cover.clear();
				view.cover.setVisible(false);
			}
		}
		if (this.sandSim?.imageObj && this.gridContainer) {
			this.gridContainer.bringToTop(this.sandSim.imageObj);
		}
		this.blitSandSim();
	}

	/**
	 * Settled sand for the selected grid before a card is bought.
	 * No cell covers, so pointer scratches do nothing until startRound.
	 */
	private showIdleSettledSand(): void {
		if (!this.scene || !this.gridContainer) {
			return;
		}
		if (isScratchRoundActive(this.lastSnap?.round)) {
			return;
		}
		if (this.lastSnap?.round?.scratchCard?.cells?.length) {
			return;
		}
		const dim = this.selectedGridSize === 0 ? 3 : this.selectedGridSize === 1 ? 4 : 5;
		const { gridW, gridH } = this.getScratchCellMetrics(dim);
		this.destroySandSim();
		this.gridContainer.removeAll(true);
		this.cellViews = [];
		this.cellVisuals = [];
		this.beginSandSim(gridW, gridH, this.extraSandFallHeight(gridH));
		this.sealSandGrid();
		if (this.sandSim) {
			for (let i = 0; i < 8; i++) {
				this.stepSandSim(false);
			}
			this.sealSandGrid();
		}
		if (this.sandSim?.imageObj && this.gridContainer) {
			this.gridContainer.bringToTop(this.sandSim.imageObj);
		}
		this.blitSandSim();
	}

	/**
	 * Instant grainy sand over remaining cells (used when reopening an unfinished card).
	 * Matches the settled look after playFoilGenerateAnimation without the fall-in.
	 */
	private rebuildGrainySandCoverInstant(): void {
		if (!this.scene || !this.gridContainer || this.cellViews.length === 0) {
			return;
		}
		// Full card footprint (same as original foil), not only remaining cells.
		const anchors =
			this.cellVisuals.length > 0
				? this.cellVisuals
				: this.cellViews.map((v) => ({
						container: v.container,
						cellW: v.cellW,
						cellH: v.cellH,
					}));
		let minY = Number.POSITIVE_INFINITY;
		let maxY = Number.NEGATIVE_INFINITY;
		let minX = Number.POSITIVE_INFINITY;
		let maxX = Number.NEGATIVE_INFINITY;
		for (const a of anchors) {
			const halfW = a.cellW / 2;
			const halfH = a.cellH / 2;
			const top = a.container.y - halfH;
			const bottom = a.container.y + halfH;
			const left = a.container.x - halfW;
			const right = a.container.x + halfW;
			if (top < minY) minY = top;
			if (bottom > maxY) maxY = bottom;
			if (left < minX) minX = left;
			if (right > maxX) maxX = right;
		}
		if (!Number.isFinite(minY) || !Number.isFinite(maxY)) {
			return;
		}
		for (const view of this.cellViews) {
			if (view.cover?.active) {
				view.cover.clear();
				view.cover.setVisible(false);
			}
		}
		const gridW = Math.max(8, maxX - minX);
		const gridH = Math.max(8, maxY - minY);
		this.beginSandSim(gridW, gridH, this.extraSandFallHeight(gridH));
		this.sealSandGrid();
		if (this.sandSim) {
			for (let i = 0; i < 8; i++) {
				this.stepSandSim(false);
			}
			this.sealSandGrid();
		}
		// Punch holes for cells already scratched before close.
		for (const visual of this.cellVisuals) {
			if (!this.revealed.has(visual.index)) continue;
			this.clearSandSimOverCell(
				visual.container.x,
				visual.container.y,
				visual.cellW,
				visual.cellH,
			);
		}
		this.attachSymbolsUnderFoil();
		if (this.sandSim?.imageObj && this.gridContainer) {
			this.gridContainer.bringToTop(this.sandSim.imageObj);
		}
		this.blitSandSim();
	}

	/** Clear sand grains covering a cell (resume after partial scratch). */
	private clearSandSimOverCell(cx: number, cy: number, cellW: number, cellH: number): void {
		const sim = this.sandSim;
		if (!sim || !this.gridContainer) return;
		const x0 = Math.floor(((cx - cellW / 2 + sim.dispW / 2) / sim.dispW) * sim.w);
		const x1 = Math.ceil(((cx + cellW / 2 + sim.dispW / 2) / sim.dispW) * sim.w);
		const y0 = Math.floor(((cy - cellH / 2 + sim.dispGridH / 2) / sim.dispGridH) * sim.gridSimH);
		const y1 = Math.ceil(((cy + cellH / 2 + sim.dispGridH / 2) / sim.dispGridH) * sim.gridSimH);
		for (let y = Math.max(0, y0); y < Math.min(sim.gridSimH, y1); y++) {
			for (let x = Math.max(0, x0); x < Math.min(sim.w, x1); x++) {
				const i = y * sim.w + x;
				if (sim.cells[i] !== 0) {
					sim.cells[i] = 0;
					sim.filled = Math.max(0, sim.filled - 1);
				}
			}
		}
	}

	private sealSandGrid(): void {
		const sim = this.sandSim;
		if (!sim) return;
		const limit = sim.w * sim.gridSimH;
		for (let i = 0; i < limit; i++) {
			if (sim.cells[i] === 0) {
				sim.cells[i] = 70 + ((this.sandRand() * 70) | 0);
				sim.filled += 1;
			}
		}
	}

	private destroySandSim(): void {
		if (!this.sandSim) {
			return;
		}
		try {
			this.sandSim.imageObj.destroy();
		} catch {
			/* noop */
		}
		try {
			if (this.scene?.textures.exists(SAND_SIM_KEY)) {
				this.scene.textures.remove(SAND_SIM_KEY);
			}
		} catch {
			/* noop */
		}
		this.sandSim = null;
	}

	private restoreCoversAfterSand(): void {
		for (const view of this.cellViews) {
			const cover = view.cover;
			if (!cover?.active) {
				continue;
			}
			cover.isCropped = false;
			if (typeof cover.setCrop === 'function') {
				cover.setCrop();
			}
			cover.setScale(1, 1);
			cover.setAlpha(1);
			cover.setOrigin(0.5, 0.5);
			cover.setPosition(0, 0);
			cover.setVisible(true);
			this.paintFullSandCover(cover, view.coverW, view.coverH);
		}
	}

	private attachSymbolsUnderFoil(): void {
		if (this.coverOverExistingSymbols) {
			this.swapSymbolsUnderCover();
			this.coverOverExistingSymbols = false;
			return;
		}
		for (const view of this.cellViews) {
			if (view.symbolAnim && typeof view.symbolAnim.setY === 'function') {
				view.symbolAnim.setY(0);
			}
			if (view.cover?.active) {
				view.container.bringToTop(view.cover);
			}
		}
	}

	private paintFullSandCover(
		cover: Phaser.GameObjects.RenderTexture,
		_coverW: number,
		_coverH: number,
	): void {
		cover.fill(COVER_COLOR, 1);
	}

	private pointerToRoot(worldX: number, worldY: number): Phaser.Math.Vector2 {
		const out = new Phaser.Math.Vector2(worldX, worldY);
		if (!this.root) {
			return out;
		}
		this.root.getWorldTransformMatrix().applyInverse(worldX, worldY, out);
		return out;
	}

	private spawnFallingSandGrains(
		x: number,
		y: number,
		count: number,
		mode: 'fall' | 'bury' | 'explode' = 'fall',
	): void {
		if (!this.scene || !this.sandFxContainer || count <= 0) {
			return;
		}
		const n = Math.min(count, SAND_GRAIN_CAP - this.liveSandGrains);
		for (let i = 0; i < n; i++) {
			this.liveSandGrains += 1;
			const size =
				mode === 'explode' ? 2.4 + Math.random() * 6.2 : 1.4 + Math.random() * 2.8;
			const g = 110 + Math.floor(Math.random() * 50);
			const shade = (g << 16) | (g << 8) | g;
			const jitterX = mode === 'explode' ? 0 : (Math.random() - 0.5) * 12;
			const jitterY = mode === 'explode' ? 0 : (Math.random() - 0.5) * 8;
			const grain = this.scene.add.rectangle(
				x + jitterX,
				y + jitterY,
				size,
				size * (0.65 + Math.random() * 0.7),
				shade,
			);
			grain.setAlpha(mode === 'explode' ? 1 : 0.95);
			grain.disableInteractive();
			this.sandFxContainer.add(grain);
			let vx: number;
			let vy: number;
			let maxLife: number;
			if (mode === 'explode') {
				const angle = Math.random() * Math.PI * 2;
				const speed = 6.2 + Math.random() * 9.5;
				vx = Math.cos(angle) * speed;
				vy = Math.sin(angle) * speed - 4.2;
				maxLife = 420 + Math.random() * 320;
			} else if (mode === 'bury') {
				vx = (Math.random() - 0.5) * 0.9;
				vy = 3.5 + Math.random() * 2.8;
				maxLife = 160 + Math.random() * 150;
			} else {
				vx = (Math.random() - 0.5) * 1.8;
				vy = 0.9 + Math.random() * 1.6;
				maxLife = 280 + Math.random() * 360;
			}
			this.fallingSand.push({
				go: grain,
				vx,
				vy,
				life: maxLife,
				maxLife,
				spin: (Math.random() - 0.5) * (mode === 'explode' ? 0.9 : 0.4),
				mode,
			});
		}
	}

	private onSandFrame(_time: number, delta: number): void {
		if (this.fallingSand.length === 0) {
			return;
		}
		const dt = Math.min(32, delta) / 16.67;
		for (let i = this.fallingSand.length - 1; i >= 0; i--) {
			const grain = this.fallingSand[i];
			const gravity = grain.mode === 'explode' ? 0.22 : grain.mode === 'bury' ? 0.55 : 0.35;
			const travel = grain.mode === 'explode' ? 18 : 8;
			grain.vy += gravity * dt;
			grain.go.x += grain.vx * dt * travel;
			grain.go.y += grain.vy * dt * travel;
			grain.go.rotation += grain.spin * dt;
			grain.life -= delta;
			grain.go.setAlpha(Math.max(0, grain.life / grain.maxLife));
			if (grain.life <= 0 || !grain.go.active) {
				grain.go.destroy();
				this.fallingSand.splice(i, 1);
				this.liveSandGrains = Math.max(0, this.liveSandGrains - 1);
			}
		}
	}

	private clearSandGrains(): void {
		for (const grain of this.fallingSand) {
			grain.go.destroy();
		}
		this.fallingSand = [];
		this.sandFxContainer?.removeAll(true);
		this.liveSandGrains = 0;
	}

	private scratchAtPointer(pointer: Phaser.Input.Pointer): void {
		if (
			!this.scene ||
			!this.gridContainer ||
			this.cellViews.length === 0 ||
			this.foilGenerating ||
			this.explodingReveal
		) {
			return;
		}

		if (this.sandSim) {
			this.scratchSandSimAtPointer(pointer);
			return;
		}

		if (!this.brush) {
			return;
		}

		let didScratch = false;
		for (const view of this.cellViews) {
			if (view.fullyRevealed || this.revealed.has(view.index)) continue;

			const world = view.container.getWorldTransformMatrix();
			const local = new Phaser.Math.Vector2();
			world.applyInverse(pointer.worldX, pointer.worldY, local);

			const halfW = view.cellW / 2;
			const halfH = view.cellH / 2;
			if (local.x < -halfW || local.x > halfW || local.y < -halfH || local.y > halfH) {
				continue;
			}

			const brushRadius = Math.max(6, Math.min(view.cellW, view.cellH) * BRUSH_RADIUS_FRAC);
			this.brush.clear();
			this.brush.fillStyle(0xffffff, 1);
			this.brush.fillCircle(0, 0, brushRadius);

			const eraseX = local.x + view.coverW / 2;
			const eraseY = local.y + view.coverH / 2;
			view.cover.erase(this.brush, eraseX, eraseY);
			didScratch = true;

			this.markStamps(view, eraseX, eraseY, brushRadius);
			if (this.stampCoverage(view) >= REVEAL_THRESHOLD) {
				this.finishCellReveal(view, true);
			}
		}

		if (didScratch) {
			const now = this.scene.time.now;
			if (now - this.lastSandFxMs >= 18) {
				this.lastSandFxMs = now;
				const p = this.pointerToRoot(pointer.worldX, pointer.worldY);
				this.spawnFallingSandGrains(p.x, p.y, 8);
			}
		}
	}

	private scratchSandSimAtPointer(pointer: Phaser.Input.Pointer): void {
		const sim = this.sandSim;
		if (!sim || !this.gridContainer || !this.scene) {
			return;
		}
		const local = new Phaser.Math.Vector2();
		this.gridContainer
			.getWorldTransformMatrix()
			.applyInverse(pointer.worldX, pointer.worldY, local);
		const sx = Math.floor(((local.x + sim.dispW / 2) / sim.dispW) * sim.w);
		const sy = Math.floor(((local.y + sim.dispGridH / 2) / sim.dispGridH) * sim.gridSimH);
		if (sx < 0 || sy < 0 || sx >= sim.w || sy >= sim.gridSimH) {
			return;
		}
		const dim = Math.max(3, Math.round(Math.sqrt(this.cellViews.length)));
		const radius = Math.max(2, Math.round((sim.w / dim) * BRUSH_RADIUS_FRAC * 1.4));
		const erased = this.eraseSandSimCircle(sx, sy, radius);
		if (erased <= 0) {
			return;
		}
		this.blitSandSim();
		this.revealCellsClearedByScratch();
		const now = this.scene.time.now;
		if (now - this.lastSandFxMs >= 18) {
			this.lastSandFxMs = now;
			const p = this.pointerToRoot(pointer.worldX, pointer.worldY);
			this.spawnFallingSandGrains(p.x, p.y, 8);
		}
	}

	private cellToSimRect(view: ScratchCellView): { x0: number; y0: number; x1: number; y1: number } | null {
		const sim = this.sandSim;
		if (!sim) return null;
		const left = view.container.x - view.coverW / 2;
		const top = view.container.y - view.coverH / 2;
		const x0 = Math.max(0, Math.floor(((left + sim.dispW / 2) / sim.dispW) * sim.w));
		const y0 = Math.max(0, Math.floor(((top + sim.dispGridH / 2) / sim.dispGridH) * sim.gridSimH));
		const x1 = Math.min(sim.w, Math.ceil(((left + view.coverW + sim.dispW / 2) / sim.dispW) * sim.w));
		const y1 = Math.min(
			sim.gridSimH,
			Math.ceil(((top + view.coverH + sim.dispGridH / 2) / sim.dispGridH) * sim.gridSimH),
		);
		return { x0, y0, x1, y1 };
	}

	private sandCoverageInCell(view: ScratchCellView): number {
		const sim = this.sandSim;
		const rect = this.cellToSimRect(view);
		if (!sim || !rect) return 0;
		let sand = 0;
		let total = 0;
		for (let y = rect.y0; y < rect.y1; y++) {
			for (let x = rect.x0; x < rect.x1; x++) {
				total += 1;
				if (sim.cells[y * sim.w + x] !== 0) sand += 1;
			}
		}
		return total > 0 ? sand / total : 0;
	}

	private clearSandInCell(view: ScratchCellView): void {
		const sim = this.sandSim;
		const rect = this.cellToSimRect(view);
		if (!sim || !rect) return;
		for (let y = rect.y0; y < rect.y1; y++) {
			for (let x = rect.x0; x < rect.x1; x++) {
				const i = y * sim.w + x;
				if (sim.cells[i] !== 0) {
					sim.cells[i] = 0;
					sim.filled = Math.max(0, sim.filled - 1);
				}
			}
		}
		this.blitSandSim();
	}

	private markStamps(view: ScratchCellView, eraseX: number, eraseY: number, radius: number): void {
		const stepX = view.coverW / STAMP_GRID;
		const stepY = view.coverH / STAMP_GRID;
		const r2 = radius * radius;
		for (let row = 0; row < STAMP_GRID; row++) {
			for (let col = 0; col < STAMP_GRID; col++) {
				const cx = (col + 0.5) * stepX;
				const cy = (row + 0.5) * stepY;
				const dx = cx - eraseX;
				const dy = cy - eraseY;
				if (dx * dx + dy * dy <= r2) {
					view.stamps[row * STAMP_GRID + col] = true;
				}
			}
		}
	}

	private stampCoverage(view: ScratchCellView): number {
		let hit = 0;
		for (const s of view.stamps) if (s) hit++;
		return hit / view.stamps.length;
	}

	private finishCellReveal(view: ScratchCellView, playWin: boolean, spawnGrains = true): void {
		if (view.fullyRevealed) return;
		view.fullyRevealed = true;
		this.revealed.add(view.index);
		view.cover.clear();
		view.cover.setVisible(false);
		if (this.sandSim) {
			this.clearSandInCell(view);
		}
		if (spawnGrains && this.scene) {
			const world = view.container.getWorldTransformMatrix();
			const p = this.pointerToRoot(world.tx, world.ty);
			this.spawnFallingSandGrains(p.x, p.y, 14);
		}
		if (playWin) {
			// Win line / SW_Win starts only once every cell on the card is revealed
			this.maybeStartWinLineOnMatch();
		}
		this.updateActionEnabled(isScratchRoundActive(this.lastSnap?.round));
		if (this.areAllSymbolsRevealed()) {
			this.scheduleAutoCollect();
		}
	}

	/** Once every cell is scratched, run win-line presentation (if the card won). */
	private maybeStartWinLineOnMatch(): void {
		const card = this.lastSnap?.round?.scratchCard ?? null;
		const winMatch = this.getWinningMatchSymbol(card);
		if (!winMatch || !card?.cells?.length) {
			return;
		}
		if (!this.areAllSymbolsRevealed()) {
			return;
		}
		const lineIndexes = this.getWinLineIndexes(card, winMatch);
		if (!lineIndexes.every((idx) => this.revealed.has(idx))) {
			return;
		}
		if (this.winPresentationShown) {
			return;
		}
		this.winPresentationShown = true;

		for (const visual of this.cellVisuals) {
			if (visual.symbol === winMatch || isScratchSpecialSymbol(visual.symbol)) {
				this.playRevealWinOnView(visual);
			}
		}

		const winAmount = Number(card.winAmount ?? this.lastSnap?.round?.winAmount ?? 0);
		if (winAmount > 0) {
			this.showTumbleStyleWinnings(winAmount, winMatch, card);
		} else {
			this.scheduleReplaySettled();
		}
	}

	/**
	 * In-modal win: draw win lines on match (+ special) cells, fly amount to header, show math.
	 * Does not emit slot events or touch Header / WinTracker.
	 */
	private showTumbleStyleWinnings(
		winAmount: number,
		winMatch: string,
		card: ScratchCardDto,
	): void {
		if (!this.scene || winAmount <= 0) {
			this.scheduleReplaySettled();
			return;
		}

		const lineVisuals = this.getWinLineVisuals(card, winMatch);
		this.showModalCompute(card, winMatch);

		const pick =
			lineVisuals.length > 0
				? lineVisuals[Math.floor(lineVisuals.length / 2)]
				: null;
		const cellH = pick?.cellH ?? TUMBLE_CELL;

		const afterLineDrawn = () => {
			if (!this.scene || !this.visible || !this.root || !this.gridContainer) {
				this.scheduleReplaySettled();
				return;
			}
			const settleLine = () => {
				this.paintWinLineSettled();
				this.showModalWinnings(winAmount, this.getScratchText(WINBAR_YOU_WON));
				this.scheduleReplaySettled(500);
			};
			if (!pick?.container) {
				settleLine();
				return;
			}
			const lx = this.gridContainer.x + pick.container.x;
			const ly = this.gridContainer.y + pick.container.y;
			this.spawnFloatingWinAmount(winAmount, lx, ly, cellH, settleLine);
		};

		// Animate the stroke; only then fly the win amount.
		this.drawWinLines(lineVisuals, afterLineDrawn);
	}

	/** Stroke the win path over time (not an instant full line). */
	private drawWinLines(matchVisuals: ScratchCellVisual[], onComplete?: () => void): void {
		if (!this.winLineGraphics || !this.gridContainer || !this.scene) {
			onComplete?.();
			return;
		}
		if (matchVisuals.length < 2) {
			onComplete?.();
			return;
		}

		this.root?.bringToTop(this.winLineGraphics);
		this.stopWinLineDrawTween();

		const pts = matchVisuals
			.map((v) => ({
				x: this.gridContainer!.x + v.container.x,
				y: this.gridContainer!.y + v.container.y,
				special: isScratchSpecialSymbol(v.symbol),
			}))
			.sort((a, b) => a.y - b.y || a.x - b.x);

		const segs: Array<{ x0: number; y0: number; x1: number; y1: number; len: number }> = [];
		let totalLen = 0;
		for (let i = 1; i < pts.length; i++) {
			const dx = pts[i].x - pts[i - 1].x;
			const dy = pts[i].y - pts[i - 1].y;
			const len = Math.hypot(dx, dy) || 1;
			segs.push({
				x0: pts[i - 1].x,
				y0: pts[i - 1].y,
				x1: pts[i].x,
				y1: pts[i].y,
				len,
			});
			totalLen += len;
		}

		this.winLinePath = { pts, segs, totalLen };
		const proxy = { t: 0 };
		this.winLineDrawProxy = proxy;
		this.paintWinLineProgress(pts, segs, totalLen, 0, 'draw');

		const duration = Math.max(450, Math.min(1000, totalLen * 2.2));
		this.scene.tweens.add({
			targets: proxy,
			t: 1,
			duration,
			ease: 'Cubic.easeOut',
			onUpdate: () => {
				this.paintWinLineProgress(pts, segs, totalLen, proxy.t, 'draw');
			},
			onComplete: () => {
				this.paintWinLineProgress(pts, segs, totalLen, 1, 'draw');
				this.winLineDrawProxy = null;
				onComplete?.();
			},
		});
	}

	/** Thinner persistent stroke after float / YOU WON. */
	private paintWinLineSettled(): void {
		const path = this.winLinePath;
		if (!path) return;
		this.paintWinLineProgress(path.pts, path.segs, path.totalLen, 1, 'settled');
	}

	private paintWinLineProgress(
		pts: Array<{ x: number; y: number; special: boolean }>,
		segs: Array<{ x0: number; y0: number; x1: number; y1: number; len: number }>,
		totalLen: number,
		t: number,
		style: 'draw' | 'settled' = 'draw',
	): void {
		const g = this.winLineGraphics;
		if (!g || pts.length === 0) {
			return;
		}
		g.clear();

		const target = Math.max(0, Math.min(1, t)) * totalLen;
		let walked = 0;
		const drawn: Array<{ x: number; y: number }> = [{ x: pts[0].x, y: pts[0].y }];
		let nodesLit = 1;

		for (let i = 0; i < segs.length; i++) {
			const seg = segs[i];
			if (walked + seg.len <= target + 0.001) {
				drawn.push({ x: seg.x1, y: seg.y1 });
				walked += seg.len;
				nodesLit = i + 2;
			} else {
				const u = (target - walked) / seg.len;
				drawn.push({
					x: seg.x0 + (seg.x1 - seg.x0) * u,
					y: seg.y0 + (seg.y1 - seg.y0) * u,
				});
				break;
			}
		}

		const glowW = style === 'settled' ? 2.5 : 5;
		const coreW = style === 'settled' ? 1 : 2;
		const glowA = style === 'settled' ? 0.18 : 0.22;
		const nodeR = style === 'settled' ? { special: 2.5, normal: 2 } : { special: 4, normal: 3.5 };

		if (drawn.length >= 2) {
			g.lineStyle(glowW, 0xffb837, glowA);
			g.beginPath();
			g.moveTo(drawn[0].x, drawn[0].y);
			for (let i = 1; i < drawn.length; i++) {
				g.lineTo(drawn[i].x, drawn[i].y);
			}
			g.strokePath();

			g.lineStyle(coreW, 0xffb837, 0.95);
			g.beginPath();
			g.moveTo(drawn[0].x, drawn[0].y);
			for (let i = 1; i < drawn.length; i++) {
				g.lineTo(drawn[i].x, drawn[i].y);
			}
			g.strokePath();
		}

		for (let i = 0; i < Math.min(nodesLit, pts.length); i++) {
			const p = pts[i];
			g.fillStyle(p.special ? 0xa8ff5a : 0xffb837, 0.95);
			g.fillCircle(p.x, p.y, p.special ? nodeR.special : nodeR.normal);
		}
	}

	private stopWinLineDrawTween(): void {
		if (this.winLineDrawProxy && this.scene) {
			this.scene.tweens.killTweensOf(this.winLineDrawProxy);
		}
		this.winLineDrawProxy = null;
	}

	/**
	 * Visual win math:
	 * - no specials: [sym][sym][sym] · bet = win  (no × multiplier)
	 * - with specials: [sym]×3 · [Ms1 icon]+×2 · [Ms2 icon]+×3 = N× · bet = win
	 * Specials labeled as additional multipliers (+×2 / +×3).
	 */
	private showModalCompute(card: ScratchCardDto, winMatch: string): void {
		if (!this.scene || !this.modalComputeContainer) {
			return;
		}
		const container = this.modalComputeContainer;
		container.removeAll(true);

		const hasMs1 = card.cells.some((c) => c.symbol === 'Ms1');
		const hasMs2 = card.cells.some((c) => c.symbol === 'Ms2');
		const hasSpecials = hasMs1 || hasMs2;
		const dim = scratchGridDimension(card, this.lastSnap?.config);
		const base = baseMultiplierForMatchSymbol(winMatch, dim);
		const winMult = Number(card.winMultiplier ?? 0);
		const bet = Number(this.lastSnap?.round?.betAmount ?? this.getScratchBetAmount());
		const winAmount = Number(card.winAmount ?? 0);

		let betStr = `${bet}`;
		let winStr = `${winAmount}`;
		try {
			betStr = formatCurrencyNumber(bet);
			winStr = formatCurrencyNumber(winAmount);
		} catch {
			/* noop */
		}

		const icon = 22;
		let x = 0;

		if (hasSpecials) {
			x = this.addComputeSymbolIcon(container, winMatch, x, icon);
			x = this.addComputeLabel(container, '×3', x, '#ffffff');
			if (hasMs1) {
				x = this.addComputeLabel(container, '·', x, '#ffffff');
				x = this.addComputeSymbolIcon(container, 'Ms1', x, icon);
				x = this.addComputeLabel(container, `+×${SCRATCH_MS1_FACTOR}`, x, '#a8ff5a');
			}
			if (hasMs2) {
				x = this.addComputeLabel(container, '·', x, '#ffffff');
				x = this.addComputeSymbolIcon(container, 'Ms2', x, icon);
				x = this.addComputeLabel(container, `+×${SCRATCH_MS2_FACTOR}`, x, '#a8ff5a');
			}
			const mult =
				winMult > 0
					? winMult
					: base * (hasMs1 ? SCRATCH_MS1_FACTOR : 1) * (hasMs2 ? SCRATCH_MS2_FACTOR : 1);
			x = this.addComputeLabel(container, `= ${mult}×`, x, '#FFB837');
			x = this.addComputeLabel(container, `· ${betStr} = ${winStr}`, x, '#ffe08a');
		} else {
			for (let i = 0; i < 3; i++) {
				x = this.addComputeSymbolIcon(container, winMatch, x, icon);
			}
			x = this.addComputeLabel(container, `· ${betStr} = ${winStr}`, x, '#ffe08a');
		}

		const shift = -x / 2;
		for (const child of container.list) {
			const go = child as unknown as Phaser.GameObjects.Components.Transform;
			if (typeof go.x === 'number') {
				go.x += shift;
			}
		}

		container.setVisible(true);
		container.setAlpha(1);
		container.setScale(1);
	}


	/** Redraw settled win line + header after hide/reopen (no replay animation). */
	private restoreSettledWinLineIfNeeded(): void {
		if (!this.scene || !this.visible || !this.winLineGraphics || !this.gridContainer) {
			return;
		}
		const card = this.lastSnap?.round?.scratchCard ?? null;
		const winMatch = this.getWinningMatchSymbol(card);
		if (!winMatch || !card?.cells?.length) {
			return;
		}
		const winAmount = Number(card.winAmount ?? this.lastSnap?.round?.winAmount ?? 0);
		if (!(winAmount > 0)) {
			return;
		}
		if (!this.areAllSymbolsRevealed()) {
			return;
		}
		const lineIndexes = this.getWinLineIndexes(card, winMatch);
		if (!lineIndexes.every((idx) => this.revealed.has(idx))) {
			return;
		}
		const lineVisuals = this.getWinLineVisuals(card, winMatch);
		if (lineVisuals.length < 2) {
			return;
		}

		this.winPresentationShown = true;
		this.root?.bringToTop(this.winLineGraphics);
		this.stopWinLineDrawTween();

		const pts = lineVisuals
			.map((v) => ({
				x: this.gridContainer!.x + v.container.x,
				y: this.gridContainer!.y + v.container.y,
				special: isScratchSpecialSymbol(v.symbol),
			}))
			.sort((a, b) => a.y - b.y || a.x - b.x);

		const segs: Array<{ x0: number; y0: number; x1: number; y1: number; len: number }> = [];
		let totalLen = 0;
		for (let i = 1; i < pts.length; i++) {
			const dx = pts[i].x - pts[i - 1].x;
			const dy = pts[i].y - pts[i - 1].y;
			const len = Math.hypot(dx, dy) || 1;
			segs.push({
				x0: pts[i - 1].x,
				y0: pts[i - 1].y,
				x1: pts[i].x,
				y1: pts[i].y,
				len,
			});
			totalLen += len;
		}

		this.winLinePath = { pts, segs, totalLen };
		this.paintWinLineSettled();
		this.showModalCompute(card, winMatch);
		const active = isScratchRoundActive(this.lastSnap?.round);
		this.showModalWinnings(winAmount, active ? this.getScratchText(WINBAR_YOU_WON) : this.getScratchTotalWinLabel());
	}

	private clearWinLines(): void {
		this.stopWinLineDrawTween();
		this.winLinePath = null;
		this.winLineGraphics?.clear();
	}

	private layoutModalWinRow(centerX?: number, y?: number): void {
		if (!this.modalYouWonText || !this.modalAmountText || !this.scene) {
			return;
		}
		const rect = this.getPanelRect();
		const cx = centerX ?? rect.x + rect.w / 2;
		const rowY = y ?? rect.y + 82;
		const pad = Math.min(HORIZONTAL_PADDING, Math.floor(rect.w * 0.08));
		const maxW = Math.max(40, rect.w - pad * 2);

		// Match slot Header winbar: label above amount (avoids horizontal overlap on long wins).
		const labelY = rowY - 12;
		const amountY = rowY + 12;

		this.modalYouWonText
			.setFontSize(`${MODAL_WIN_LABEL_FONT_PX}px`)
			.setScale(1)
			.setOrigin(0.5, 0.5);
		this.modalAmountText
			.setFontSize(`${MODAL_WIN_AMOUNT_FONT_PX}px`)
			.setScale(1)
			.setOrigin(0.5, 0.5);

		if (this.modalYouWonText.width > maxW) {
			this.modalYouWonText.setScale(maxW / this.modalYouWonText.width);
		}
		if (this.modalAmountText.width > maxW) {
			this.modalAmountText.setScale(maxW / this.modalAmountText.width);
		}

		this.modalYouWonText.setPosition(cx, labelY);
		this.modalAmountText.setPosition(cx, amountY);
	}

	private showModalWinnings(winnings: number, label: string): void {
		if (!this.scene || !this.modalYouWonText || !this.modalAmountText) {
			return;
		}
		const formatted = (() => {
			try {
				return formatCurrencyNumber(winnings);
			} catch {
				return winnings.toFixed(2);
			}
		})();
		const valueChanged = Math.abs(this.modalCurrentWinnings - winnings) > 0.01;
		const wasShowing =
			this.modalYouWonText.visible && this.modalYouWonText.scaleX > 0.9;
		this.modalYouWonText.setText(label);
		this.modalAmountText.setText(formatted);
		this.layoutModalWinRow();

		this.scene.tweens.killTweensOf(this.modalYouWonText);
		this.scene.tweens.killTweensOf(this.modalAmountText);

		this.modalYouWonText.setVisible(true);
		this.modalAmountText.setVisible(true);
		if (this.modalComputeContainer && this.modalComputeContainer.list.length > 0) {
			this.modalComputeContainer.setVisible(true);
		}

		const pulseTargets: Phaser.GameObjects.GameObject[] = [
			this.modalYouWonText,
			this.modalAmountText,
		];
		if (this.modalComputeContainer?.visible) {
			pulseTargets.push(this.modalComputeContainer);
		}

		if (wasShowing) {
			this.modalCurrentWinnings = winnings;
			if (valueChanged || label === this.getScratchTotalWinLabel()) {
				this.scene.tweens.add({
					targets: pulseTargets,
					scaleX: 1.2,
					scaleY: 1.2,
					duration: 150,
					ease: 'Power2',
					yoyo: true,
					repeat: 0,
					onComplete: () => {
						this.modalYouWonText?.setScale(1);
						this.modalAmountText?.setScale(1);
						this.modalComputeContainer?.setScale(1);
						this.layoutModalWinRow();
					},
				});
			} else {
				this.modalYouWonText.setScale(1);
				this.modalAmountText.setScale(1);
			}
			return;
		}

		this.modalCurrentWinnings = winnings;
		this.modalYouWonText.setScale(0);
		this.modalAmountText.setScale(0);
		if (this.modalComputeContainer) {
			this.modalComputeContainer.setScale(0);
		}
		this.scene.tweens.add({
			targets: pulseTargets,
			scaleX: 1,
			scaleY: 1,
			duration: 300,
			ease: 'Back.easeOut',
			onComplete: () => this.layoutModalWinRow(),
		});
	}

	private spawnFloatingWinAmount(
		amount: number,
		x: number,
		y: number,
		cellH: number,
		onArrive?: () => void,
	): void {
		if (!this.scene || !this.root) {
			return;
		}
		const px = Math.max(28, Math.round(cellH * 0.42));
		let textValue = '';
		try {
			textValue = formatCurrencyNumber(amount);
		} catch {
			textValue = `${amount}`;
		}
		const txt = this.scene.add.text(x, y, textValue, {
			fontFamily: 'Poppins-Bold',
			fontSize: `${px}px`,
			color: '#FFFFFF',
			align: 'center',
		} as Phaser.Types.GameObjects.Text.TextStyle);
		txt.setOrigin(0.5, 0.5);
		try {
			(txt as any).setStroke?.('#FA2A55', Math.max(2, Math.round(px * 0.12)));
			(txt as any).setShadow?.(0, 2, '#000000', Math.max(2, Math.round(px * 0.15)), true, true);
		} catch {
			/* noop */
		}
		this.root.add(txt);
		this.floatingWinTexts.push(txt);

		const baseSX = txt.scaleX;
		const baseSY = txt.scaleY;
		this.scene.tweens.add({
			targets: txt,
			scaleX: baseSX * 1.12,
			scaleY: baseSY * 1.12,
			duration: 140,
			yoyo: true,
			repeat: 0,
			ease: Phaser.Math.Easing.Cubic.Out,
		});

		const targetX = this.modalAmountText?.x ?? x;
		const targetY = this.modalAmountText?.y ?? y - 80;
		const flyDuration = Math.max(
			450,
			((this.scene as any)?.gameData?.winUpDuration || 700) + 0,
		);

		this.scene.tweens.add({
			targets: txt,
			x: targetX,
			y: targetY,
			scaleX: baseSX * 0.55,
			scaleY: baseSY * 0.55,
			alpha: 0.85,
			duration: flyDuration,
			ease: Phaser.Math.Easing.Cubic.InOut,
			onComplete: () => {
				try {
					const i = this.floatingWinTexts.indexOf(txt);
					if (i >= 0) this.floatingWinTexts.splice(i, 1);
					txt.destroy();
				} catch {
					/* noop */
				}
				onArrive?.();
			},
		});
	}

	private clearScratchWinPresentation(): void {
		this.winPresentationShown = false;
		this.modalCurrentWinnings = 0;
		if (this.scene) {
			if (this.modalYouWonText) this.scene.tweens.killTweensOf(this.modalYouWonText);
			if (this.modalAmountText) this.scene.tweens.killTweensOf(this.modalAmountText);
			if (this.modalComputeContainer) this.scene.tweens.killTweensOf(this.modalComputeContainer);
		}
		this.modalYouWonText?.setVisible(false).setScale(1);
		this.modalAmountText?.setVisible(false).setScale(1);
		if (this.modalComputeContainer) {
			this.modalComputeContainer.removeAll(true);
			this.modalComputeContainer.setVisible(false).setScale(1);
		}
		for (const t of this.floatingWinTexts) {
			try {
				this.scene?.tweens.killTweensOf(t);
				t.destroy();
			} catch {
				/* noop */
			}
		}
		this.floatingWinTexts = [];
		this.clearWinLines();
		for (const visual of this.cellVisuals) {
			this.clearWinSpine(visual);
		}
		for (const view of this.cellViews) {
			this.clearWinSpine(view);
		}
	}


	private bindBuyFeatureModalGuard(): void {
		this.unbindBuyFeatureModalGuard();
		this.slotBuyFeatureOpen = isBuyFeatureModalVisible();
		this.buyFeatureVisibilityListener = (open: boolean) => {
			this.slotBuyFeatureOpen = !!open;
			this.updateActionEnabled(isScratchRoundActive(this.lastSnap?.round));
		};
		this.buyFeaturePurchasedListener = () => {
			this.holdBuyCardAfterPurchase();
		};
		EventBus.on('buy-feature-visibility', this.buyFeatureVisibilityListener);
		EventBus.on('buy-feature-purchased', this.buyFeaturePurchasedListener);
		this.updateActionEnabled(isScratchRoundActive(this.lastSnap?.round));
	}

	private unbindBuyFeatureModalGuard(): void {
		if (this.buyFeatureEnableTimer != null) {
			clearTimeout(this.buyFeatureEnableTimer);
			this.buyFeatureEnableTimer = null;
		}
		this.buyFeatureEnableAt = 0;
		if (this.buyFeatureVisibilityListener) {
			EventBus.off('buy-feature-visibility', this.buyFeatureVisibilityListener);
			this.buyFeatureVisibilityListener = null;
		}
		if (this.buyFeaturePurchasedListener) {
			EventBus.off('buy-feature-purchased', this.buyFeaturePurchasedListener);
			this.buyFeaturePurchasedListener = null;
		}
	}

	/** Keep buy card / scratch all disabled for 1s after a buy-feature purchase. */
	private holdBuyCardAfterPurchase(): void {
		this.buyFeatureEnableAt = Date.now() + 1000;
		if (this.buyFeatureEnableTimer != null) {
			clearTimeout(this.buyFeatureEnableTimer);
		}
		this.buyFeatureEnableTimer = setTimeout(() => {
			this.buyFeatureEnableTimer = null;
			this.buyFeatureEnableAt = 0;
			this.updateActionEnabled(isScratchRoundActive(this.lastSnap?.round));
		}, 1000);
		this.updateActionEnabled(isScratchRoundActive(this.lastSnap?.round));
	}

	private isBuyFeaturePurchaseHold(): boolean {
		return this.buyFeatureEnableAt > Date.now();
	}

	private updateActionEnabled(active: boolean): void {
		if (this.replayLocked) {
			this.setLongButtonEnabled(this.newButtonImage, this.newButtonLabel, false);
			this.refreshBuyCardLabel();
			this.dimButtons.forEach((btn) => this.setContainerEnabled(btn, false));
			this.refreshDimButtonStyles();
			this.updateBuyCardBetStepButtons();
			return;
		}
		const allRevealed = this.areAllSymbolsRevealed();
		const canBuy = !this.busy && !active;
		const canScratchAll =
			!this.busy &&
			active &&
			!allRevealed &&
			!this.foilGenerating &&
			!this.explodingReveal;
		this.setLongButtonEnabled(this.newButtonImage, this.newButtonLabel, !this.slotBuyFeatureOpen && !this.isBuyFeaturePurchaseHold() && (canBuy || canScratchAll));
		this.refreshBuyCardLabel();
		const canPickDim = !this.busy && !active;
		this.dimButtons.forEach((btn) => this.setContainerEnabled(btn, canPickDim));
		this.refreshDimButtonStyles();
		this.updateBuyCardBetStepButtons();
	}

	private setBusy(busy: boolean): void {
		this.busy = busy;
		this.updateActionEnabled(isScratchRoundActive(this.lastSnap?.round));
	}

	private setSelectedGridSize(size: GridSizeChoice): void {
		if (isScratchRoundActive(this.lastSnap?.round) || this.busy) return;
		this.selectedGridSize = size;
		this.persistScratchGridSize();
		this.enforceGridMinBet();
		this.refreshDimButtonStyles();
		this.refreshLegend();
		this.refreshBuyCardLabel();
		if (!this.lastSnap?.round?.scratchCard?.cells?.length) {
			this.showIdleSettledSand();
		}
	}

	private refreshDimButtonStyles(): void {
		this.dimButtons.forEach((btn, i) => {
			const selected = i === this.selectedGridSize;
			const bg = btn.getAt(0) as Phaser.GameObjects.Graphics | undefined;
			if (!bg) return;
			const width = 72;
			const height = 40;
			bg.clear();
			bg.fillStyle(selected ? 0xffffff : 0x000000, selected ? 0.25 : 0.15);
			bg.fillRoundedRect(-width / 2, -height / 2, width, height, 10);
			bg.lineStyle(1, 0xffffff, selected ? 1 : 0.45);
			bg.strokeRoundedRect(-width / 2, -height / 2, width, height, 10);
		});
	}

	/** Compact pay legend for the selected grid (base tiers + Ms1/Ms2 when available). */

	private refreshLegend(): void {

		if (!this.scene || !this.legendContainer) {

			return;

		}

		this.legendContainer.removeAll(true);



		const rows = scratchLegendRowsForGrid(

			this.lastSnap?.config,

			this.selectedGridSize,

			SCRATCH_BASE_PAY_LEGEND,

			SCRATCH_MS1_FACTOR,

			SCRATCH_MS2_FACTOR,

		);



		const cell = 36;

		const gap = 8;

		const totalW = rows.length * cell + Math.max(0, rows.length - 1) * gap;

		let x = -totalW / 2 + cell / 2;



		for (const row of rows) {

			const col = this.scene.add.container(x, 0);

			const tex = legendTextureKeyForScratchSymbol(row.symbol);

			if (tex && this.scene.textures.exists(tex)) {

				const img = this.makeScratchImageCrisp(this.scene.add.image(0, -8, tex));

				const maxEdge = 28;

				const scale = Math.min(

					maxEdge / Math.max(1, img.width),

					maxEdge / Math.max(1, img.height),

				);

				img.setScale(scale);

				col.add(img);

			} else {

				col.add(

					this.scene.add

						.text(0, -8, String(row.symbol).slice(0, 2), {

							fontSize: '12px',

							fontFamily: 'Poppins-Bold',

							color: '#ffffff',

						})

						.setOrigin(0.5),

				);

			}

			const caption = row.label ?? `×${Number(row.mult)}`;

			col.add(

				this.scene.add

					.text(0, 16, caption, {

						fontSize: '12px',

						fontFamily: 'Poppins-Bold',

						color: '#ffe08a',

					})

					.setOrigin(0.5),

			);

			this.legendContainer.add(col);

			x += cell + gap;

		}

	}



	private layout(): void {
		if (!this.scene || !this.root || !this.background) return;

		const sw = this.scene.scale.width;
		const sh = this.scene.scale.height;
		const rect = this.getPanelRect();
		const { x: left, y: top, w, h } = rect;
		const cx = left + w / 2;
		const pad = Math.min(HORIZONTAL_PADDING, Math.floor(w * 0.08));

		if (this.fullScreenBlocker) {
			if (rect.mode === 'fill') {
				this.fullScreenBlocker.clear();
				this.fullScreenBlocker.disableInteractive();
				this.fullScreenBlocker.setVisible(false);
			} else {
				this.fullScreenBlocker.setVisible(this.visible);
				this.fullScreenBlocker.clear();
				this.fullScreenBlocker.fillStyle(0x000000, 0.01);
				this.fullScreenBlocker.fillRect(0, 0, sw, sh);
				this.fullScreenBlocker.setInteractive(
					new Phaser.Geom.Rectangle(0, 0, sw, sh),
					Phaser.Geom.Rectangle.Contains,
				);
				this.fullScreenBlocker.off('pointerdown');
			}
		}

		this.background.clear();
		// Match BuyFeature overlay (solid underlay + buy_feature_bg on top).
		this.background.fillStyle(0x000000, 0.8);
		// Outside: flat right edge. In-main drawer: BuyFeature-style round corners.
		// Outside: flat right edge. In-main drawer: same as BuyFeature fillRoundedRect(..., 20).
		const panelRadius = this.options.fillScene
			? { tl: 20, tr: 0, br: 0, bl: 20 }
			: 20;
		this.background.fillRoundedRect(left, top, w, h, panelRadius);
		this.background.setInteractive(
			new Phaser.Geom.Rectangle(left, top, w, h),
			Phaser.Geom.Rectangle.Contains,
		);

		if (this.backgroundImage) {
			this.backgroundImage.setPosition(cx, top + h / 2);
			const scaleY = h / Math.max(1, this.backgroundImage.height);
			const scaleX = w / Math.max(1, this.backgroundImage.width);
			this.backgroundImage.setScale(Math.max(scaleX, scaleY));
		}
		this.syncPanelChromeMask();

		this.titleText?.setPosition(left + pad, top + 40);
		this.closeButton?.setPosition(left + w - pad, top + 40);

		const winRowY = top + 82;
		this.layoutModalWinRow(cx, winRowY);
		// Amount sits at winRowY+12; keep summary clearly below it (was tight after stacking).
		this.modalComputeContainer?.setPosition(cx, winRowY + 50);

		const sizeY = top + 180;
		const inputW = w - pad * 2;
		const inputH = 66;
		this.sizeInputBg?.clear();
		this.sizeInputBg?.fillStyle(0x000000, 0.4);
		this.sizeInputBg?.fillRoundedRect(cx - inputW / 2, sizeY - inputH / 2, inputW, inputH, 15);
		this.sizeInputBg?.lineStyle(0.5, 0xffffff, 1);
		this.sizeInputBg?.strokeRoundedRect(cx - inputW / 2, sizeY - inputH / 2, inputW, inputH, 15);

		const dimGap = Math.min(100, inputW / 3.5);
		this.dimButtons[0]?.setPosition(cx - dimGap, sizeY);
		this.dimButtons[1]?.setPosition(cx, sizeY);
		this.dimButtons[2]?.setPosition(cx + dimGap, sizeY);
		this.dimButtons.forEach((btn) => this.root?.bringToTop(btn));
		if (this.modalYouWonText) this.root?.bringToTop(this.modalYouWonText);
		if (this.modalAmountText) this.root?.bringToTop(this.modalAmountText);
		if (this.modalComputeContainer) this.root?.bringToTop(this.modalComputeContainer);

		this.refreshLegend();
		const legendY = top + 240;
		this.legendContainer?.setPosition(cx, legendY);

		const btnH = 62;
		const betInputH = 74;
		const betLabelH = 28;
		const stackGap = 10;
		const btnBottomPad = 20;
		// Stack from bottom: BUY CARD → bet amount row → Bet label → sand (no shared row).
		const btnY = top + h - btnBottomPad - btnH / 2;
		const betY = btnY - btnH / 2 - stackGap - betInputH / 2;
		const betLabelY = betY - betInputH / 2 - stackGap - betLabelH / 2;
		const gridAreaTop = legendY + 40;
		const gridAreaBottom = betLabelY - betLabelH / 2 - stackGap;
		this.scratchGridMaxH = this.getReferenceSandMaxH();
		const gridCenterY = (gridAreaTop + gridAreaBottom) / 2;
		this.gridContainer?.setPosition(cx, gridCenterY);

		const btnW = this.getBuyCardButtonWidth(w);
		const betRowW = btnW;

		this.betLabelText?.setPosition(cx - betRowW / 2, betLabelY);
		this.betInputBg?.clear();
		this.betInputBg?.fillStyle(0x000000, 0.4);
		this.betInputBg?.fillRoundedRect(cx - betRowW / 2, betY - betInputH / 2, betRowW, betInputH, 15);
		this.betInputBg?.lineStyle(0.5, 0xffffff, 1);
		this.betInputBg?.strokeRoundedRect(cx - betRowW / 2, betY - betInputH / 2, betRowW, betInputH, 15);
		this.betDecButton?.setPosition(cx - betRowW / 2 + 32, betY);
		this.betIncButton?.setPosition(cx + betRowW / 2 - 32, betY);
		this.betDisplay?.setPosition(cx, betY);
		if (this.betDecButton) this.root?.bringToTop(this.betDecButton);
		if (this.betIncButton) this.root?.bringToTop(this.betIncButton);
		if (this.betDisplay) this.root?.bringToTop(this.betDisplay);
		if (this.betLabelText) this.root?.bringToTop(this.betLabelText);

		this.refreshBuyCardLabel();
		this.newButtonImage?.setPosition(cx, btnY).setDisplaySize(btnW, btnH);
		this.newButtonLabel?.setPosition(cx, btnY);
		this.updateBuyCardBetStepButtons();
	}

	private setLongButtonEnabled(
		image: Phaser.GameObjects.Image | null,
		label: Phaser.GameObjects.Text | null,
		enabled: boolean,
	): void {
		if (!image) return;
		(image as Phaser.GameObjects.Image & { __disabled?: boolean }).__disabled = !enabled;
		image.setAlpha(enabled ? 1 : 0.5);
		if (enabled) {
			image.clearTint();
			image.setInteractive({ useHandCursor: true });
		} else {
			image.setTint(0x888888);
			image.disableInteractive();
		}
		if (label) {
			label.setAlpha(enabled ? 1 : 0.5);
			if (enabled) {
				label.clearTint();
				label.setColor('#000000');
			} else {
				label.setTint(0x888888);
			}
		}
	}

	private formatScratchBetDisplay(): string {
		const bet = this.getScratchBetAmount();
		let betStr = `${bet}`;
		try {
			betStr = formatCurrencyNumber(bet);
		} catch {
			/* noop */
		}
		const code = CurrencyManager.getCurrencyCode().trim();
		const prefix = code ? `${code} ` : '';
		return `${prefix}${betStr}`;
	}

	private getScratchText(key: string): string {
		return localizationManager.getTextByKey(key) ?? LOCALIZATION_DEFAULTS[key] ?? key;
	}

	/** Same key as Header/BonusHeader (`common_total-win`); CMS has no `winbar_total-win`. */
	private getScratchTotalWinLabel(): string {
		return this.getScratchText(COMMON_TOTAL_WIN).toUpperCase();
	}

	private refreshBuyCardLabel(): void {
		this.titleText?.setText(this.getScratchText(SCRATCH_TITLE));
		this.betLabelText?.setText(this.getScratchText(CONTROLLER_BET));
		const active = isScratchRoundActive(this.lastSnap?.round);
		const allRevealed = this.areAllSymbolsRevealed();
		if (active && !allRevealed) {
			this.newButtonLabel?.setText(this.getScratchText(SCRATCH_SCRATCH_ALL));
		} else {
			this.newButtonLabel?.setText(this.getScratchText(SCRATCH_BUY_CARD));
		}
		if (this.betDisplay) {
			this.betDisplay.setText(this.formatScratchBetDisplay());
		}
		this.updateBuyCardBetStepButtons();
	}

	private getScratchBetAmount(): number {
		const n = Number(this.scratchBetAmount);
		return Number.isFinite(n) && n > 0 ? n : 0.2;
	}

	/** Seed scratch stake from prior scratch choice, else slot bet (once per open path). */
	private syncScratchBetFromSlotSeed(): void {
		const levels = this.getResolvedBetLevels();
		const preferred =
			persistedScratchBetAmount != null &&
			Number.isFinite(persistedScratchBetAmount) &&
			persistedScratchBetAmount > 0
				? persistedScratchBetAmount
				: Number(this.options.getBetAmount?.() ?? 0);
		if (Number.isFinite(preferred) && preferred > 0) {
			const idx = this.findBetLevelIndex(preferred);
			this.scratchBetAmount = levels[idx] ?? preferred;
		} else {
			this.scratchBetAmount = levels[0] ?? 0.2;
		}
		this.enforceGridMinBet();
		this.persistScratchBetAmount();
	}

	private persistScratchBetAmount(): void {
		if (this.replayLocked) return;
		persistedScratchBetAmount = this.getScratchBetAmount();
	}

	private persistScratchGridSize(): void {
		if (this.replayLocked) return;
		persistedScratchGridSize = this.selectedGridSize;
	}

	private restorePersistedScratchGridSize(): void {
		if (
			persistedScratchGridSize === 0 ||
			persistedScratchGridSize === 1 ||
			persistedScratchGridSize === 2
		) {
			this.selectedGridSize = persistedScratchGridSize;
		}
	}

	/**
	 * 0-based bet-ladder floors. 4×4 cannot go below index 4; 5×5 cannot go below index 8.
	 * 3×3 keeps the first bet.
	 */
	private minBetIndexForSelectedGrid(): number {
		if (this.selectedGridSize === 1) return 4;
		if (this.selectedGridSize === 2) return 8;
		return 0;
	}

	private enforceGridMinBet(): void {
		if (this.busy || isScratchRoundActive(this.lastSnap?.round)) return;
		const levels = this.getResolvedBetLevels();
		if (!levels.length) return;
		const minIdx = Math.min(this.minBetIndexForSelectedGrid(), levels.length - 1);
		const idx = this.findBetLevelIndex(this.getScratchBetAmount());
		if (idx < minIdx) {
			this.scratchBetAmount = levels[minIdx];
		}
		this.persistScratchBetAmount();
	}

	private adjustScratchBetByStep(direction: 1 | -1): void {
		if (this.busy || isScratchRoundActive(this.lastSnap?.round)) {
			this.updateBuyCardBetStepButtons();
			return;
		}
		const levels = this.getResolvedBetLevels();
		const minIdx = Math.min(this.minBetIndexForSelectedGrid(), levels.length - 1);
		const idx = this.findBetLevelIndex(this.getScratchBetAmount());
		const newIdx = Math.max(minIdx, Math.min(levels.length - 1, idx + direction));
		this.scratchBetAmount = levels[newIdx];
		this.persistScratchBetAmount();
		this.refreshBuyCardLabel();
	}

	private getResolvedBetLevels(): number[] {
		const levels = this.options.getBetLevels?.();
		if (Array.isArray(levels) && levels.length > 0) {
			return levels;
		}
		return DEFAULT_BET_LEVELS;
	}

	private findBetLevelIndex(bet: number): number {
		const levels = this.getResolvedBetLevels();
		let idx = 0;
		let bestDiff = Number.POSITIVE_INFINITY;
		for (let i = 0; i < levels.length; i++) {
			const diff = Math.abs(levels[i] - bet);
			if (diff < bestDiff) {
				bestDiff = diff;
				idx = i;
			}
		}
		return idx;
	}

	/** Match BuyFeature: grey out −/+ at min/max. */
	private setBetStepButtonEnabled(button: Phaser.GameObjects.Text | null, enabled: boolean): void {
		if (!button) return;
		button.setAlpha(enabled ? 1 : BET_STEP_DISABLED_ALPHA);
		if (enabled) {
			button.clearTint();
			button.setInteractive({ useHandCursor: true });
		} else {
			button.setTint(0x555555);
			button.disableInteractive();
			if (button === this.betDecButton) this.stopContinuousBetDecrement();
			if (button === this.betIncButton) this.stopContinuousBetIncrement();
		}
		button.setData('disabled', !enabled);
	}

	private updateBuyCardBetStepButtons(): void {
		const canAdjust =
			this.visible && !this.busy && !this.replayLocked && !isScratchRoundActive(this.lastSnap?.round);
		const levels = this.getResolvedBetLevels();
		const minIdx = Math.min(this.minBetIndexForSelectedGrid(), Math.max(0, levels.length - 1));
		const idx = this.findBetLevelIndex(this.getScratchBetAmount());
		this.setBetStepButtonEnabled(this.betDecButton, canAdjust && idx > minIdx);
		this.setBetStepButtonEnabled(this.betIncButton, canAdjust && idx < levels.length - 1);
		const betAlpha = canAdjust ? 1 : 0.55;
		this.betDisplay?.setAlpha(betAlpha);
		this.betLabelText?.setAlpha(betAlpha);
		this.betInputBg?.setAlpha(canAdjust ? 1 : 0.7);
	}

	private startContinuousBetDecrement(scene: Scene): void {
		this.stopContinuousBetDecrement();
		this.betDecTimer = scene.time.delayedCall(BET_CONTINUOUS_DELAY_MS, () => {
			this.betDecTimer = scene.time.addEvent({
				delay: BET_CONTINUOUS_INTERVAL_MS,
				callback: () => this.adjustScratchBetByStep(-1),
				loop: true,
			});
		});
	}

	private stopContinuousBetDecrement(): void {
		if (this.betDecTimer) {
			this.betDecTimer.destroy();
			this.betDecTimer = null;
		}
	}

	private startContinuousBetIncrement(scene: Scene): void {
		this.stopContinuousBetIncrement();
		this.betIncTimer = scene.time.delayedCall(BET_CONTINUOUS_DELAY_MS, () => {
			this.betIncTimer = scene.time.addEvent({
				delay: BET_CONTINUOUS_INTERVAL_MS,
				callback: () => this.adjustScratchBetByStep(1),
				loop: true,
			});
		});
	}

	private stopContinuousBetIncrement(): void {
		if (this.betIncTimer) {
			this.betIncTimer.destroy();
			this.betIncTimer = null;
		}
	}

	private createDimButton(
		scene: Scene,
		label: string,
		size: GridSizeChoice,
	): Phaser.GameObjects.Container {
		const container = scene.add.container(0, 0);
		const width = 72;
		const height = 40;
		const bg = scene.add.graphics();
		bg.fillStyle(0x000000, 0.15);
		bg.fillRoundedRect(-width / 2, -height / 2, width, height, 10);
		const text = scene.add
			.text(0, 0, label, {
				fontSize: '18px',
				fontFamily: 'Poppins-Bold',
				color: '#ffffff',
			})
			.setOrigin(0.5);
		// Explicit Zone hit target — Container hit areas are unreliable after move/resize
		const hit = scene.add
			.zone(0, 0, width, height)
			.setOrigin(0.5, 0.5)
			.setInteractive({ useHandCursor: true });
		hit.on('pointerdown', () => {
			if ((container as Phaser.GameObjects.Container & { __disabled?: boolean }).__disabled) {
				return;
			}
			this.setSelectedGridSize(size);
		});
		(container as Phaser.GameObjects.Container & { __hitZone?: Phaser.GameObjects.Zone }).__hitZone =
			hit;
		container.add([bg, text, hit]);
		container.setSize(width, height);
		return container;
	}

	private setContainerEnabled(button: Phaser.GameObjects.Container, enabled: boolean): void {
		(button as Phaser.GameObjects.Container & { __disabled?: boolean }).__disabled = !enabled;
		button.setAlpha(enabled ? 1 : 0.4);
		const hit = (button as Phaser.GameObjects.Container & { __hitZone?: Phaser.GameObjects.Zone })
			.__hitZone;
		if (hit) {
			if (enabled) {
				hit.setInteractive({ useHandCursor: true });
			} else {
				hit.disableInteractive();
			}
		}
	}
}

/** Resolve galaxite hub base URL via APP_CONFIG (same pattern as slots `game-url`). */
export function resolveScratchHubBaseUrl(): string {
	const configuredUrl = (window as unknown as { APP_CONFIG?: Record<string, string> })
		?.APP_CONFIG?.['websocket-url'];
	if (typeof configuredUrl === 'string' && configuredUrl.trim().length > 0) {
		return configuredUrl.trim().replace(/\/?$/, '/');
	}
	return 'https://stg-crashgame-api.dijoker.com/';
}

/** Staging galaxite demo Join key — used when APP_CONFIG is missing (same idea as slots URL fallback). */
const SCRATCH_DEMO_API_KEY_FALLBACK = 'Y2hhaW50YWJsZWV4YWN0anVtcGV4YW1wbGV5b3VuZ2U=';

/** Demo Join apiKey via APP_CONFIG (same pattern as slots `game-url`). */
export function resolveScratchDemoApiKey(): string | null {
	const cfg = (window as unknown as { APP_CONFIG?: Record<string, string> })?.APP_CONFIG;
	const configuredKey = cfg?.['api-key'];
	if (typeof configuredKey === 'string' && configuredKey.trim().length > 0) {
		return configuredKey.trim();
	}
	return SCRATCH_DEMO_API_KEY_FALLBACK;
}
