import Phaser from 'phaser';
import { SoundEffectType } from '../managers/AudioManager';

/**
 * Play the shared utility button SFX when a UI interaction succeeds.
 * Falls back to a global audioManager reference if the scene doesn't expose one.
 */
export const playUtilityButtonSfx = (scene?: Phaser.Scene | null): void => {
	const audio =
		(scene as any)?.audioManager ??
		((window as any)?.audioManager ?? null);

	if (audio && typeof audio.playSoundEffect === 'function') {
		audio.playSoundEffect(SoundEffectType.UTILITY_BUTTON);
	}
};
