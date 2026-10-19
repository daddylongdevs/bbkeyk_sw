/**
 * Shared modal types, backend errorCode map, copy-key spec, and priorities.
 * Projects inject localization + scene; they do not pass keys, errorCodeMap, or layout.
 */

export enum ModalType {
	TOKEN_EXPIRED = 'TOKEN_EXPIRED',
	IDLE_SESSION_EXPIRED = 'IDLE_SESSION_EXPIRED',
	OUT_OF_BALANCE = 'OUT_OF_BALANCE',
	BET_FAILED = 'BET_FAILED',
	BET_LIMIT_EXCEEDED = 'BET_LIMIT_EXCEEDED',
	NETWORK_OFFLINE = 'NETWORK_OFFLINE',
	CURRENCY_ERROR = 'CURRENCY_ERROR',
	/** Project-owned custom UI (ReplayPopup); tracked in priority queue only. */
	REPLAY = 'REPLAY',
	GAME_LOADING_FAILED = 'GAME_LOADING_FAILED',
	GENERIC_ERROR = 'GENERIC_ERROR',
}

export type BackendErrorResponse = {
	status?: number;
	errorCode?: string;
	message?: string;
	message_text?: string;
};

/** Higher number = higher priority. */
export const DEFAULT_PRIORITY: Record<ModalType, number> = {
	[ModalType.GAME_LOADING_FAILED]: 110,
	[ModalType.TOKEN_EXPIRED]: 100,
	[ModalType.IDLE_SESSION_EXPIRED]: 90,
	[ModalType.REPLAY]: 80,
	[ModalType.OUT_OF_BALANCE]: 70,
	[ModalType.BET_FAILED]: 60,
	[ModalType.BET_LIMIT_EXCEEDED]: 50,
	[ModalType.NETWORK_OFFLINE]: 40,
	[ModalType.CURRENCY_ERROR]: 30,
	[ModalType.GENERIC_ERROR]: 10,
};

/** Shared backend errorCode → ModalType (same for every project). */
export const ERROR_CODE_MAP: Record<string, ModalType> = {
	DJ401UA: ModalType.TOKEN_EXPIRED,
	DJ401TE: ModalType.TOKEN_EXPIRED,
	DJ400NEB: ModalType.OUT_OF_BALANCE,
	DJ400BF: ModalType.BET_FAILED,
	DJ400BL: ModalType.BET_LIMIT_EXCEEDED,
};

export type ModalSpec = {
	bodyKey: string;
	/** Omit = no button (TokenExpired / IdleSession). */
	buttonKey?: string;
	/** Default dismiss. callback = supplied at show time (e.g. reload). */
	buttonMode?: 'dismiss' | 'callback';
	/** If true, uses config.betFailedAutoCloseMs (default 2500). */
	autoClose?: boolean;
};

/**
 * Core-owned: which localization keys + chrome each modal uses.
 * REPLAY is intentionally absent — project custom UI.
 */
export const MODAL_SPEC: Partial<Record<ModalType, ModalSpec>> = {
	[ModalType.GENERIC_ERROR]: {
		bodyKey: 'popup_generic-error',
		buttonKey: 'common_ok',
	},
	[ModalType.BET_FAILED]: {
		bodyKey: 'popup_bet-failed',
		buttonKey: 'common_ok',
		autoClose: true,
	},
	[ModalType.BET_LIMIT_EXCEEDED]: {
		bodyKey: 'popup_bet-limit-exceeded',
		buttonKey: 'common_ok',
		// Dismiss via OK only — no autoClose. Autoplay is stopped on show, not resumed on hide.
	},
	[ModalType.NETWORK_OFFLINE]: {
		bodyKey: 'popup_network-offline',
		buttonKey: 'common_ok',
	},
	[ModalType.OUT_OF_BALANCE]: {
		bodyKey: 'popup_insufficient-balance',
		buttonKey: 'common_ok',
	},
	[ModalType.CURRENCY_ERROR]: {
		bodyKey: 'popup_currency-error',
		buttonKey: 'common_ok',
	},
	[ModalType.TOKEN_EXPIRED]: {
		bodyKey: 'popup_session-expired',
	},
	[ModalType.IDLE_SESSION_EXPIRED]: {
		bodyKey: 'popup_idle-session-expired',
	},
	[ModalType.GAME_LOADING_FAILED]: {
		bodyKey: 'popup_game-loading-failed',
		buttonKey: 'popup_reload',
		buttonMode: 'callback',
	},
};

export const DEFAULT_BET_FAILED_AUTO_CLOSE_MS = 2500;

/**
 * Locked visual layout for GenericModal — same for every project.
 * Do not expose these as project config; change here only when the shared design changes.
 */
export const MODAL_LAYOUT = {
	panelWidthFactor: 0.8,
	panelHeightFactor: 0.4,
	panelColor: 0x000000,
	panelAlpha: 0.8,
	cornerRadius: 20,

	overlayColor: 0x000000,
	overlayAlpha: 0.35,
	overlayDepth: 9999,
	modalDepth: 10000,

	bodyOffsetYWithButton: -40,
	bodyOffsetYNoButton: 0,
	bodyFontSize: '21px',
	bodyColor: '#ffffff',
	bodyWrapWidthFactor: 0.7,

	buttonOffsetY: 130,
	buttonScale: 0.8,
	buttonWidth: 364,
	buttonHeight: 62,
	buttonFontSize: '24px',
	buttonLabelColor: '#000000',
	buttonHoverTint: 0xcccccc,

	animationDurationMs: 300,
	hideDurationFactor: 0.8,
	showFromScale: 0.5,
	showEase: 'Back.Out',
	hideEase: 'Back.In',
} as const;

/** Default Phaser asset keys every project should load under these names. */
export const DEFAULT_MODAL_ASSETS = {
	buttonTextureKey: 'long_button',
	fontFamily: 'Poppins-Regular',
	fontFamilyBold: 'Poppins-Bold',
} as const;

export type ModalAssets = {
	buttonTextureKey: string;
	fontFamily: string;
	fontFamilyBold: string;
};

/**
 * Optional asset-key aliases only. Layout/spacing/colors are not configurable —
 * projects that use standard keys can omit `theme` entirely.
 */
export type ModalThemeConfig = Partial<ModalAssets>;

export type ModalManagerConfig = {
	getScene: () => unknown | null;
	localization: {
		getText?: (key: string) => string | null | undefined;
		defaults: Record<string, string>;
	};
	/** Optional; defaults to DEFAULT_MODAL_ASSETS (`long_button` + Poppins). */
	theme?: ModalThemeConfig;
	/** Fired when a spin-blocking modal is shown (autoplay stop, etc.). */
	onBlockingError?: (modalType: ModalType) => void;
	/** Fired when BET_FAILED modal finishes hiding (autoplay resume). */
	onBetFailedClosed?: () => void;
	/** Auto-dismiss for BET_FAILED; defaults to 2500. */
	betFailedAutoCloseMs?: number;
	/**
	 * Phaser depth for the error dimmer and popup.
	 * Defaults stay at MODAL_LAYOUT (9999 / 10000). Raise these when a project
	 * draws another full-scene panel above that band.
	 */
	overlayDepth?: number;
	modalDepth?: number;
};

export function resolveModalAssets(theme?: ModalThemeConfig): ModalAssets {
	return {
		buttonTextureKey: theme?.buttonTextureKey ?? DEFAULT_MODAL_ASSETS.buttonTextureKey,
		fontFamily: theme?.fontFamily ?? DEFAULT_MODAL_ASSETS.fontFamily,
		fontFamilyBold: theme?.fontFamilyBold ?? DEFAULT_MODAL_ASSETS.fontFamilyBold,
	};
}

export type ModalHideFn = (callback?: () => void) => void;
export type RegisterHideFn = (hideFn: ModalHideFn) => void;
export type ModalShowAction = (registerHide: RegisterHideFn) => void;

export type ModalManagerApi = {
	checkAndHandleModal: (
		response: BackendErrorResponse | null | undefined,
		options?: { recoverSlot?: boolean },
	) => boolean;
	showModal: (
		type: ModalType,
		overrides?: {
			scene?: unknown;
			onPress?: () => void;
			showButton?: boolean;
			onHide?: () => void;
			body?: string;
		}
	) => void;
	showBetFailureModalFromError: (error: unknown) => void;
	showIdleSessionExpiredModal: () => void;
	showGameLoadingFailedModal: (opts?: {
		scene?: unknown;
		showReloadButton?: boolean;
		onReload?: () => void;
	}) => void;
	clearCurrentModal: () => void;
	/** Hide the active modal and clear the manager slot. */
	dismissCurrentModal: () => void;
	isModalActive: () => boolean;
	getActiveModalType: () => ModalType | string | null;
	showCustom: (type: string, priority: number, showAction: ModalShowAction) => void;
	forceShow: (type: string, showAction: ModalShowAction) => void;
	/** Low-level priority show (also used by showCustom). */
	show: (type: string, priority: number, showAction: ModalShowAction) => void;
};
