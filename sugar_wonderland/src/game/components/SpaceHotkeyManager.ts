import { Scene } from 'phaser';
import { gameStateManager } from '../../managers/GameStateManager';
import type { Dialogs } from './Dialogs';
import type { SlotController } from './SlotController';

/**
 * Routes SPACE keydown to the correct in-game action.
 * During autoplay: skip reel-drop while spinning; no-op while idle (does not stop autoplay).
 * Pointer on the spin button still stops autoplay.
 */
export class SpaceHotkeyManager {
	private scene: Scene;
	private dialogs: Dialogs;
	private slotController: SlotController;
	/** When true, SPACE must not trigger spin actions (panels/menus open). */
	private readonly isSpinHotkeyBlocked?: () => boolean;
	/** When true, SPACE is ignored entirely (e.g. full-screen candy transition). */
	private readonly isHotkeyBlocked?: () => boolean;

	private readonly onSpace: (event: KeyboardEvent) => void;

	constructor(
		scene: Scene,
		dialogs: Dialogs,
		slotController: SlotController,
		isSpinHotkeyBlocked?: () => boolean,
		isHotkeyBlocked?: () => boolean,
	) {
		this.scene = scene;
		this.dialogs = dialogs;
		this.slotController = slotController;
		this.isSpinHotkeyBlocked = isSpinHotkeyBlocked;
		this.isHotkeyBlocked = isHotkeyBlocked;

		this.onSpace = (event: KeyboardEvent) => {
			if (event.repeat) {
				return;
			}
			this.handlePress();
		};
	}

	public register(): void {
		const keyboard = this.scene.input?.keyboard;
		if (!keyboard) {
			console.warn('[SpaceHotkeyManager] Keyboard input not available – SPACE hotkey disabled');
			return;
		}

		keyboard.on('keydown-SPACE', this.onSpace);
		this.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());

		console.log('[SpaceHotkeyManager] SPACE hotkey registered');
	}

	public destroy(): void {
		try {
			this.scene.input?.keyboard?.off('keydown-SPACE', this.onSpace);
		} catch {
			/* scene may already be destroyed */
		}
	}

	private handlePress(): void {
		if (this.isHotkeyBlocked?.()) {
			return;
		}

		const state = gameStateManager;

		if (state.isShowingWinDialog || this.dialogs.isDialogShowing()) {
			console.log('[SpaceHotkeyManager] SPACE → dismiss win dialog');
			this.dialogs.dismissCurrentDialog(this.scene);
			return;
		}

		if (this.isSpinHotkeyBlocked?.()) {
			return;
		}

		console.log('[SpaceHotkeyManager] SPACE → spin button activation');
		void this.slotController.requestSpin('keyboard');
	}
}
