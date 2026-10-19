/**
 * Project wiring for shared core ModalManager.
 * Owns scene lookup, localization, events, and Replay (deferred custom UI).
 */

import {
	createModalManager,
	ModalType,
	type BackendErrorResponse,
} from '../../../core/ModalManager';
import { gameEventManager, GameEventType } from '../event/EventManager';
import { localizationManager } from './LocalizationManager';
import { LOCALIZATION_DEFAULTS } from '../backend/LocalizationData';
import { BET_FAILED_POPUP_AUTO_CLOSE_MS } from '../config/GameConfig';
import { ReplayPopup } from '../game/components/ReplayPopup';

function getGameScene(): unknown | null {
	try {
		const phaserGame = (window as any).phaserGame;
		if (!phaserGame?.scene) return null;
		return (
			phaserGame.scene.getScene?.('Game') ??
			phaserGame.scene.getScene?.('Preloader') ??
			phaserGame.scene.scenes?.find?.((s: any) => s?.scene?.key === 'Game') ??
			phaserGame.scene.scenes?.find?.((s: any) => s?.scene?.key === 'Preloader') ??
			null
		);
	} catch {
		return null;
	}
}

export const modalManager = createModalManager({
	getScene: getGameScene,
	localization: {
		getText: (key) => localizationManager.getTextByKey(key),
		defaults: LOCALIZATION_DEFAULTS,
	},
	onBlockingError: (modalType) => {
		gameEventManager.emit(GameEventType.BET_FAILED_ERROR, { popupType: modalType });
	},
	onBetFailedClosed: () => {
		try {
			gameEventManager.emit(GameEventType.BET_FAILED_POPUP_CLOSED);
		} catch {}
	},
	betFailedAutoCloseMs: BET_FAILED_POPUP_AUTO_CLOSE_MS,
});

export const {
	checkAndHandleModal,
	showModal,
	showBetFailureModalFromError,
	showIdleSessionExpiredModal,
	showGameLoadingFailedModal,
	clearCurrentModal,
	dismissCurrentModal,
	isModalActive,
	forceShow,
} = modalManager;

export { ModalType };
export type { BackendErrorResponse };

/**
 * Force show replay popup immediately, bypassing normal priority checks.
 * Replay UI stays project-owned (deferred from GenericModal).
 */
export function forceShowReplayPopup(
	replayId: string | number,
	options: {
		displayMode?: 'initial' | 'summary';
		spinData?: unknown;
		currencyCode?: string;
		createdAt?: string;
		buttonText?: string;
		onContinueCallback?: () => void;
		onCompleteCallback?: () => void;
	} = {}
): void {
	const scene = getGameScene();
	if (!scene) return;

	forceShow(ModalType.REPLAY, (registerHide) => {
		const replayPopup = new ReplayPopup(scene as any, replayId, 0, 0, {
			displayMode: options.displayMode,
			spinData: options.spinData as any,
			currencyCode: options.currencyCode,
			createdAt: options.createdAt,
			buttonText: options.buttonText,
			onContinueCallback: options.onContinueCallback,
			onHideCallback: () => {
				clearCurrentModal();
				options.onCompleteCallback?.();
			},
		});
		replayPopup.show();
		registerHide((cb?: () => void) => {
			replayPopup.hide(cb);
		});
	});
}
