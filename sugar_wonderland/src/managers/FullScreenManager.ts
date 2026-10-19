import * as Phaser from 'phaser';

export interface FullScreenToggleOptions {
	margin?: number;
	iconScale?: number;
	depth?: number;
	maximizeKey?: string;
	minimizeKey?: string;
}

export class FullScreenManager {
	static isFullscreen(scene?: Phaser.Scene): boolean {
		const w: any = window as any;
		if (w.tbMobileViewport?.isFullscreen) {
			try {
				return !!w.tbMobileViewport.isFullscreen();
			} catch {}
		}
		const doc: any = document as any;
		return !!(doc.fullscreenElement || doc.webkitFullscreenElement || doc.mozFullScreenElement || doc.msFullscreenElement || (scene && scene.scale && scene.scale.isFullscreen));
	}

	static async requestFullscreen(): Promise<void> {
		const w: any = window as any;
		if (typeof w.requestMobileFullscreen === 'function') {
			try {
				await w.requestMobileFullscreen();
				return;
			} catch {}
		}
		const elem: any = document.documentElement as any;
		const req = elem.requestFullscreen || elem.webkitRequestFullscreen || elem.mozRequestFullScreen || elem.msRequestFullscreen;
		if (req) {
			try {
				await req.call(elem);
			} catch {}
		}
	}

	static async exitFullscreen(scene?: Phaser.Scene): Promise<void> {
		const w: any = window as any;
		if (typeof w.exitMobileFullscreen === 'function') {
			try {
				await w.exitMobileFullscreen();
				return;
			} catch {}
		}
		const doc: any = document as any;
		const exit = doc.exitFullscreen || doc.webkitExitFullscreen || doc.mozCancelFullScreen || doc.msExitFullscreen;
		try {
			if (exit && (doc.fullscreenElement || doc.webkitFullscreenElement || doc.mozFullScreenElement || doc.msFullscreenElement)) {
				await exit.call(document);
			} else if (scene && (scene.scale as any).stopFullscreen) {
				await (scene.scale as any).stopFullscreen();
			}
		} catch {}
	}

	static addToggle(scene: Phaser.Scene, options: FullScreenToggleOptions = {}): Phaser.GameObjects.Image {
		const margin = options.margin ?? 16;
		const iconScale = options.iconScale ?? 1;
		const depth = options.depth ?? 10000;
		const maximizeKey = options.maximizeKey ?? 'maximize';
		const minimizeKey = options.minimizeKey ?? 'minimize';

		const startKey = this.isFullscreen(scene) ? minimizeKey : maximizeKey;
		const btn = scene.add.image(scene.scale.width - margin, margin, startKey)
			.setOrigin(1, 0)
			.setScale(iconScale)
			.setDepth(depth)
			.setInteractive({ useHandCursor: true });

		const place = () => {
			btn.setPosition(scene.scale.width - margin, margin);
		};
		scene.scale.on('resize', place);

		btn.on('pointerup', () => {
			const w: any = window as any;
			if (typeof w.toggleMobileFullscreen === 'function') {
				w.toggleMobileFullscreen()
					.then(() => btn.setTexture(this.isFullscreen(scene) ? minimizeKey : maximizeKey))
					.catch(() => {});
				return;
			}
			if (!this.isFullscreen(scene)) {
				this.requestFullscreen().then(() => {
					btn.setTexture(minimizeKey);
				}).catch(() => {});
			} else {
				this.exitFullscreen(scene).then(() => {
					btn.setTexture(maximizeKey);
				}).catch(() => {});
			}
		});

		const onFsChange = () => {
			btn.setTexture(this.isFullscreen(scene) ? minimizeKey : maximizeKey);
		};
		document.addEventListener('fullscreenchange', onFsChange);

		scene.events.once('shutdown', () => {
			document.removeEventListener('fullscreenchange', onFsChange);
			scene.scale.off('resize', place);
			btn.destroy();
		});

		return btn;
	}
}
