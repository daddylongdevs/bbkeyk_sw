import { Events } from 'phaser';

// Used to emit events between components, HTML and Phaser scenes
export const EventBus = new Events.EventEmitter();

/** True while the buy-feature drawer is on screen, including its show tween. */
let buyFeatureModalVisible = false;

export function isBuyFeatureModalVisible(): boolean {
	return buyFeatureModalVisible;
}

export function setBuyFeatureModalVisible(visible: boolean): void {
	buyFeatureModalVisible = visible;
	EventBus.emit('buy-feature-visibility', visible);
}

/** Scratch buy-card / scratch-all stays off for 1s after a confirmed purchase. */
export function notifyBuyFeaturePurchased(): void {
	EventBus.emit('buy-feature-purchased');
}

