import { GenericModal } from './GenericModal';
import { isNetworkOfflineBetError } from './networkHeuristic';
import {
	DEFAULT_BET_FAILED_AUTO_CLOSE_MS,
	DEFAULT_PRIORITY,
	ERROR_CODE_MAP,
	MODAL_SPEC,
	ModalType,
	resolveModalAssets,
	type BackendErrorResponse,
	type ModalHideFn,
	type ModalManagerApi,
	type ModalManagerConfig,
	type ModalShowAction,
	type RegisterHideFn,
} from './types';

const PLAY_INSTANCE_DISCONNECT_MESSAGE =
	'This game was opened in another window. This session has been disconnected.';

type CurrentModal = {
	type: string;
	priority: number;
	hide: ModalHideFn;
};

type SceneLike = {
	time?: {
		delayedCall: (ms: number, cb: () => void) => { destroy: () => void };
	};
};

/**
 * Create a ModalManager instance bound to project config (scene, localization, events).
 * Visual layout is locked in core (MODAL_LAYOUT); theme only remaps asset keys if needed.
 */
export function createModalManager(config: ModalManagerConfig): ModalManagerApi {
	let current: CurrentModal | null = null;
	let pending: { type: string; priority: number; token: number } | null = null;
	let tokenCounter = 0;
	let betFailedAutoCloseTimer: { destroy: () => void } | null = null;

	const autoCloseMs = config.betFailedAutoCloseMs ?? DEFAULT_BET_FAILED_AUTO_CLOSE_MS;
	const assets = resolveModalAssets(config.theme);

	function resolveText(key: string): string {
		const live = config.localization.getText?.(key);
		if (typeof live === 'string' && live.length > 0) return live;
		const fallback = config.localization.defaults[key];
		if (typeof fallback === 'string' && fallback.length > 0) return fallback;
		return key;
	}

	function getPriority(type: string): number {
		if (type in DEFAULT_PRIORITY) {
			return DEFAULT_PRIORITY[type as ModalType];
		}
		return 0;
	}

	/** Drop the manager slot only (does not call hide — for already-closing UIs). */
	function clearCurrentModal(): void {
		pending = null;
		current = null;
	}

	/** Hide the active modal (if any) and clear the manager slot. */
	function dismissCurrentModal(): void {
		pending = null;
		if (!current) {
			return;
		}
		const prevHide = current.hide;
		current = null;
		try {
			prevHide();
		} catch {
			/* noop */
		}
	}

	function clearCurrentIfType(type: string): void {
		if (current?.type === type) {
			current = null;
		}
	}

	function isModalActive(): boolean {
		return current !== null || pending !== null;
	}

	function getActiveModalType(): ModalType | string | null {
		return current?.type ?? null;
	}

	function show(type: string, priority: number, showAction: ModalShowAction): void {
		if ((current && current.type === type) || (pending && pending.type === type)) {
			return;
		}
		if ((current && current.priority >= priority) || (pending && pending.priority >= priority)) {
			return;
		}

		const doShow = (): void => {
			const token = ++tokenCounter;
			pending = { type, priority, token };
			showAction((hideFn: ModalHideFn) => {
				if (!pending || pending.token !== token) {
					try {
						hideFn();
					} catch {}
					return;
				}
				pending = null;
				current = { type, priority, hide: hideFn };
			});
		};

		if (current) {
			const prevHide = current.hide;
			current = null;
			prevHide();
			doShow();
			return;
		}

		if (pending) {
			pending = null;
		}

		doShow();
	}

	function showCustom(type: string, priority: number, showAction: ModalShowAction): void {
		show(type, priority, showAction);
	}

	function forceShow(type: string, showAction: ModalShowAction): void {
		pending = null;

		const doShow = (): void => {
			showAction((hideFn: ModalHideFn) => {
				current = {
					type,
					priority: Number.MAX_SAFE_INTEGER,
					hide: hideFn,
				};
			});
		};

		if (current) {
			const prevHide = current.hide;
			current = null;
			prevHide(doShow);
			return;
		}

		doShow();
	}

	function clearBetFailedAutoCloseTimer(): void {
		if (betFailedAutoCloseTimer) {
			betFailedAutoCloseTimer.destroy();
			betFailedAutoCloseTimer = null;
		}
	}

	function scheduleBetFailedAutoClose(hideFn: ModalHideFn, scene: SceneLike | null): void {
		clearBetFailedAutoCloseTimer();
		if (!scene?.time) return;
		betFailedAutoCloseTimer = scene.time.delayedCall(autoCloseMs, () => {
			betFailedAutoCloseTimer = null;
			hideFn();
		});
	}

	function emitBlocking(modalType: ModalType): void {
		try {
			config.onBlockingError?.(modalType);
		} catch {}
	}

	function buildAndShow(
		type: ModalType,
		registerHide: RegisterHideFn,
		opts?: {
			scene?: unknown;
			onPress?: () => void;
			showButton?: boolean;
			onHide?: () => void;
			/** When set, overrides localized MODAL_SPEC body (e.g. API error message). */
			body?: string;
		}
	): void {
		const spec = MODAL_SPEC[type];
		if (!spec) return;

		const scene = (opts?.scene ?? config.getScene()) as SceneLike | null;
		if (!scene) return;

		const overrideBody = typeof opts?.body === 'string' ? opts.body.trim() : '';
		const body = overrideBody || resolveText(spec.bodyKey);
		const wantButton = spec.buttonKey != null && opts?.showButton !== false;
		const buttonLabel = wantButton && spec.buttonKey ? resolveText(spec.buttonKey) : '';

		const modal = new GenericModal(scene as any, 0, 0, {
			body,
			assets,
			overlayDepth: config.overlayDepth,
			modalDepth: config.modalDepth,
			onHideCallback: () => {
				clearCurrentIfType(type);
				opts?.onHide?.();
			},
			button: wantButton
				? {
						label: buttonLabel,
						onPress: () => {
							if (spec.buttonMode === 'callback' && opts?.onPress) {
								opts.onPress();
								return;
							}
							modal.hide();
						},
					}
				: false,
		});

		const isBetFailed = type === ModalType.BET_FAILED && spec.autoClose;

		if (isBetFailed) {
			const originalHide = modal.hide.bind(modal);
			const hideFn: ModalHideFn = (callback?: () => void) => {
				clearBetFailedAutoCloseTimer();
				originalHide(() => {
					clearCurrentIfType(ModalType.BET_FAILED);
					try {
						config.onBetFailedClosed?.();
					} catch {}
					if (callback) callback();
				});
			};
			modal.hide = hideFn as typeof modal.hide;
			modal.show();
			registerHide(hideFn);
			scheduleBetFailedAutoClose(hideFn, scene);
			return;
		}

		modal.show();
		registerHide((cb) =>
			modal.hide(() => {
				clearCurrentIfType(type);
				if (cb) cb();
			})
		);
	}

	function showModal(
		type: ModalType,
		overrides?: {
			scene?: unknown;
			onPress?: () => void;
			showButton?: boolean;
			onHide?: () => void;
			body?: string;
		}
	): void {
		const priority = getPriority(type);
		show(type, priority, (registerHide) => {
			buildAndShow(type, registerHide, overrides);
		});
	}

	function checkAndHandleModal(
		response: BackendErrorResponse | null | undefined,
		options?: { recoverSlot?: boolean },
	): boolean {
		if (!response) return false;

		const errorCode = typeof response.errorCode === 'string' ? response.errorCode : '';
		const scene = config.getScene();
		if (!scene) return false;

		const modalType = (errorCode && ERROR_CODE_MAP[errorCode]) || ModalType.GENERIC_ERROR;
		if (options?.recoverSlot !== false) {
			emitBlocking(modalType);
		}

		const apiMessage =
			(typeof response.message === 'string' && response.message.trim()) ||
			(typeof response.message_text === 'string' && response.message_text.trim()) ||
			'';
		const lockReplacedSession = apiMessage === PLAY_INSTANCE_DISCONNECT_MESSAGE;

		show(modalType, getPriority(modalType), (registerHide) => {
			buildAndShow(modalType, registerHide, {
				...(apiMessage ? { body: apiMessage } : {}),
				...(lockReplacedSession ? { showButton: false } : {}),
			});
		});
		return true;
	}

	function showBetFailureModalFromError(error: unknown): void {
		const scene = config.getScene();
		if (!scene) return;

		// Client-side fetch/offline only. BET_FAILED is DJ400BF via checkAndHandleModal — never a fallback.
		if (!isNetworkOfflineBetError(error)) {
			return;
		}

		emitBlocking(ModalType.NETWORK_OFFLINE);
		show(ModalType.NETWORK_OFFLINE, getPriority(ModalType.NETWORK_OFFLINE), (registerHide) => {
			buildAndShow(ModalType.NETWORK_OFFLINE, registerHide);
		});
	}

	function showIdleSessionExpiredModal(): void {
		const scene = config.getScene();
		if (!scene) return;
		emitBlocking(ModalType.IDLE_SESSION_EXPIRED);
		showModal(ModalType.IDLE_SESSION_EXPIRED);
	}

	function showGameLoadingFailedModal(opts?: {
		scene?: unknown;
		showReloadButton?: boolean;
		onReload?: () => void;
	}): void {
		const scene = opts?.scene ?? config.getScene();
		if (!scene) return;

		showModal(ModalType.GAME_LOADING_FAILED, {
			scene,
			showButton: opts?.showReloadButton !== false,
			onPress: opts?.onReload,
		});
	}

	return {
		checkAndHandleModal,
		showModal,
		showBetFailureModalFromError,
		showIdleSessionExpiredModal,
		showGameLoadingFailedModal,
		clearCurrentModal,
		dismissCurrentModal,
		isModalActive,
		getActiveModalType,
		showCustom,
		forceShow,
		show,
	};
}
