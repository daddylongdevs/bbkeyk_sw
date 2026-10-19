import { Scene } from 'phaser';
import { SpineGameObject } from '@esotericsoftware/spine-phaser-v3';
import { SoundEffectType } from '../../managers/AudioManager';
import {
	enableMipmapsOnSpineSkeleton,
	enableSymbolSpineAtlasMipmaps,
} from '../layout/SymbolSpineMipmaps';

/**
 * SymbolExplosionTransition
 *
 * A full-screen candy-style transition that reuses existing symbol Spine assets.
 * It spawns a burst of symbol spines from the center of the screen and
 * animates them outward so they cover the entire view before fading out.
 *
 * Usage:
 *   const symbolExplosion = new SymbolExplosionTransition(scene);
 *   symbolExplosion.play(() => {
 *     // Transition complete
 *   });
 */
	export class SymbolExplosionTransition {
		private scene: Scene;
		private container: Phaser.GameObjects.Container;
		private particles: SpineGameObject[] = [];
		private isPlaying: boolean = false;

		/** True while the explosion tween sequence is running (from play() until finish()). */
		public isTransitionPlaying(): boolean {
			return this.isPlaying;
		}
		private depth: number = 22000;
		// Invisible full-screen interaction blocker so clicks can't pass through
		private inputBlocker: Phaser.GameObjects.Rectangle | null = null;

		// Configuration
		private defaultDuration: number = 1500; // total ms for out+hold+in
	private defaultParticleCount: number = 80;

		constructor(scene: Scene) {
			this.scene = scene;
			this.container = scene.add.container(0, 0);
			this.container.setDepth(this.depth);
			this.container.setVisible(false);

			// Create an invisible, full-screen interaction blocker that sits above
			// everything else while the explosion transition is playing. This
			// prevents any buttons or UI behind the transition from being clicked.
			try {
				const width = scene.scale.width;
				const height = scene.scale.height;

				this.inputBlocker = scene.add.rectangle(
					width * 0.5,
					height * 0.5,
					width,
					height,
					0x000000,
					0
				);

				this.inputBlocker.setScrollFactor(0);
				this.inputBlocker.setDepth(this.depth + 10);
				this.inputBlocker.setVisible(false);
				this.inputBlocker.setActive(false);
				this.inputBlocker.setName('symbolExplosionInteractionBlocker');

				// Prepare input; we'll enable/disable it in show/hide.
				this.inputBlocker.setInteractive({ useHandCursor: false });
				this.inputBlocker.disableInteractive();
			} catch {
				// If anything goes wrong creating the blocker, fail silently so the
				// transition still works (but without input blocking).
				this.inputBlocker = null;
			}
		}

		public show(): void {
			this.container.setVisible(true);

			// Enable the interaction blocker while the transition is visible
			if (this.inputBlocker) {
				this.inputBlocker.setVisible(true);
				this.inputBlocker.setActive(true);
				this.inputBlocker.setInteractive({ useHandCursor: false });
			}
		}

		public hide(): void {
			this.container.setVisible(false);
			this.destroyParticles();

			// Disable the interaction blocker once the transition is finished
			if (this.inputBlocker) {
				this.inputBlocker.setVisible(false);
				this.inputBlocker.setActive(false);
				this.inputBlocker.disableInteractive();
			}
		}

	/**
	 * Play the explosion transition.
	 *
	 * @param onComplete Optional callback when the transition has fully finished.
	 * @param options Optional overrides for duration, particle count and allowed symbols.
	 */
	public play(
		onComplete?: () => void,
		options?: { duration?: number; particleCount?: number; allowedSymbols?: number[] }
	): void {
		if (this.isPlaying) {
			return;
		}
		this.isPlaying = true;
		this.show();

		// Play candy transition SFX twice whenever the explosion transition starts,
		// with a 0.5s delay between each play.
		try {
			const sceneAny: any = this.scene as any;
			const audioManager =
				(sceneAny && sceneAny.audioManager) ||
				((window as any)?.audioManager ?? null);

			if (audioManager && typeof audioManager.playSoundEffect === 'function') {
				// First immediate play
				audioManager.playSoundEffect(SoundEffectType.CANDY_TRANSITION);
				// Second play after 500ms
				this.scene.time.delayedCall(2300, () => {
					try {
						audioManager.playSoundEffect(SoundEffectType.CANDY_TRANSITION);
					} catch (inner) {
						console.warn('[SymbolExplosionTransition] Failed second candy transition SFX play:', inner);
					}
				});
				console.log('[SymbolExplosionTransition] Playing candy_transition SFX twice on play()');
			}
		} catch (e) {
			console.warn('[SymbolExplosionTransition] Failed to play candy transition SFX:', e);
		}

		this.destroyParticles();

		const duration = options?.duration ?? this.defaultDuration;
		const particleCount = options?.particleCount ?? this.defaultParticleCount;
		const allowedSymbols = options?.allowedSymbols;

		// Logical game size (camera.centerX/width are physical px under HiResRender).
		const screenWidth = this.scene.scale.width;
		const screenHeight = this.scene.scale.height;
		const centerX = screenWidth * 0.5;
		const centerY = screenHeight * 0.5;

		// We'll compute a per-particle max radius that keeps symbols inside the screen
		// (with a small margin) instead of using a single large radius that can go off-screen.

		const symbolDescriptors = this.getAvailableSymbolDescriptors(allowedSymbols);

		if (symbolDescriptors.length === 0) {
			// No symbol spines available – fail gracefully
			this.finish(onComplete);
			return;
		}

		let completedCount = 0;
		const totalParticles = particleCount;

		// Build a dense grid of target positions that covers the entire screen.
		// This ensures no gaps where the background is visible during the hold phase.
		const gridCols = 8;
		const gridRows = 10; // dense grid to reduce vertical gaps between symbol bands
		const cellWidth = screenWidth / gridCols;
		const cellHeight = screenHeight / gridRows;
		const gridTargets: Array<{ x: number; y: number }> = [];

		for (let row = 0; row < gridRows; row++) {
			for (let col = 0; col < gridCols; col++) {
				const x = (col + 0.5) * cellWidth;
				const y = (row + 0.5) * cellHeight;
				gridTargets.push({ x, y });
			}
		}

		// Shuffle grid targets so placement is less obviously row/column based
		for (let i = gridTargets.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			const tmp = gridTargets[i];
			gridTargets[i] = gridTargets[j];
			gridTargets[j] = tmp;
		}

		// Phase timing: explode out -> quick full-screen linger -> disperse out of frame
		// Keep the explosion smooth, but reduce how long symbols linger on screen.
		const explodeDuration = duration * 0.55; // smooth outward motion
		const holdDuration = Math.max(600, duration * 0.25); // shorter linger (at least 0.6s)
		const collapseDuration = duration * 0.25; // fast disperse phase

		for (let i = 0; i < totalParticles; i++) {
			const desc = symbolDescriptors[Math.floor(Math.random() * symbolDescriptors.length)];

			const particle = this.createParticle(desc, centerX, centerY);
			if (!particle) {
				continue;
			}

			this.particles.push(particle);
			this.container.add(particle);

			// Give each symbol a slightly different local depth so layering feels more natural
			try {
				particle.setDepth(this.depth + Phaser.Math.Between(0, 200));
			} catch {
				// ignore depth errors
			}

			// Pick a base target from the grid so we form a solid wall of symbols,
			// then jitter it slightly so placement feels more organic.
			const baseTarget = gridTargets[i % gridTargets.length];
			const jitterX = Phaser.Math.FloatBetween(-cellWidth * 0.25, cellWidth * 0.25);
			const jitterY = Phaser.Math.FloatBetween(-cellHeight * 0.25, cellHeight * 0.25);
			const targetX = Phaser.Math.Clamp(baseTarget.x + jitterX, 0, screenWidth);
			const targetY = Phaser.Math.Clamp(baseTarget.y + jitterY, 0, screenHeight);

			// Give each symbol a distinct starting rotation, then ease it back to upright
			// as it reaches its target so the wall of symbols is cleanly aligned.
			const startAngle = Phaser.Math.FloatBetween(-270, 270); // up to ~3/4 turn either way
			try {
				particle.setAngle(startAngle);
			} catch {
				// ignore angle errors
			}

			// Slight stagger so the explosion feels more organic (only for the explode phase)
			const delay = Phaser.Math.Between(0, 150);

			// Scale up and fly outward
			const initialScale = particle.scaleX || 0.4;
			// Gentle, slightly random scale-up so symbols stay similar in size
			const explosionScaleMultiplier = Phaser.Math.FloatBetween(1.2, 1.6);
			const finalScale = initialScale * explosionScaleMultiplier;

			// Precompute a second outward target for the disperse phase.
			// Compute a radius large enough so the symbol travels fully OFF-SCREEN before fade.
			const dirX = targetX - centerX;
			const dirY = targetY - centerY;
			const len = Math.sqrt(dirX * dirX + dirY * dirY) || 1;
			const ux = dirX / len;
			const uy = dirY / len;

			const margin = 80; // how far beyond the edge we want to guarantee off-screen
			const halfWidth = screenWidth / 2 + margin;
			const halfHeight = screenHeight / 2 + margin;
			const absUx = Math.abs(ux) || 0.0001;
			const absUy = Math.abs(uy) || 0.0001;

			// Distance from center required to be beyond all screen edges in this direction
			const radiusX = halfWidth / absUx;
			const radiusY = halfHeight / absUy;
			const disperseRadius = Math.max(radiusX, radiusY) + margin;

			const disperseX = centerX + ux * disperseRadius;
			const disperseY = centerY + uy * disperseRadius;

			particle.setAlpha(0);

			// Phase 1: explode out from center to target position
			this.scene.tweens.add({
				targets: particle,
				x: targetX,
				y: targetY,
				// Rotate from the random starting angle back to 0 (upright)
				angle: 0,
				scaleX: finalScale,
				scaleY: finalScale,
				alpha: 1,
				delay,
				duration: explodeDuration,
				ease: 'Cubic.easeOut',
				onStart: () => {
					particle.setAlpha(1);
				},
				onComplete: () => {
					// Phase 2: hold in place (no tween needed for hold, just delayed call)
					this.scene.time.delayedCall(holdDuration, () => {
						// Phase 3a: small "cockback" opposite the disperse direction
						const cockbackDistance = Math.min(200, Math.min(cellWidth, cellHeight) * 1.3);
						const cockbackX = targetX - ux * cockbackDistance;
						const cockbackY = targetY - uy * cockbackDistance;

						const cockbackDuration = collapseDuration * 1.5;
						const disperseDuration = collapseDuration * 0.7;

						this.scene.tweens.add({
							targets: particle,
							x: cockbackX,
							y: cockbackY,
							duration: cockbackDuration,
							ease: 'Cubic.easeOut',
							onComplete: () => {
								// Phase 3b: disperse further outwards (stay mostly opaque during movement)
								this.scene.tweens.add({
									targets: particle,
									x: disperseX,
									y: disperseY,
									angle: 0, // settle to upright as it disperses away
									// Slight additional scale change as it flies out
									scaleX: finalScale * 1.05,
									scaleY: finalScale * 1.05,
									duration: disperseDuration,
									ease: 'Cubic.easeIn',
									onComplete: () => {
										// Phase 3c: gentle fade-out after symbols have dispersed off-frame
										this.scene.tweens.add({
											targets: particle,
											alpha: 0,
											duration: collapseDuration * 0.8,
											ease: 'Linear',
											onComplete: () => {
												completedCount++;
												if (completedCount >= totalParticles) {
													this.finish(onComplete);
												}
											}
										});
									}
								});
							}
						});
					});
				}
			});
		}

		// Safety timeout: ensure we always finish even if some tweens are killed
		this.scene.time.delayedCall(explodeDuration + holdDuration + collapseDuration * 1.8 + 800, () => {
			if (this.isPlaying) {
				this.finish(onComplete);
			}
		});
	}

	private finish(onComplete?: () => void): void {
		if (!this.isPlaying) {
			return;
		}
		this.isPlaying = false;
		this.hide();
		if (onComplete) {
			onComplete();
		}
	}

	private destroyParticles(): void {
		this.particles.forEach((p) => {
			try {
				p.destroy();
			} catch {
				// ignore
			}
		});
		this.particles = [];
	}

	/**
	 * Descriptor for different symbol Spine variants that we can use in the explosion.
	 * We reuse the same keys that Symbols/AssetConfig already load.
	 */
	private getAvailableSymbolDescriptors(allowedSymbols?: number[]): Array<{
		spineKey: string;
		isSugar: boolean;
		symbolValue?: number;
	}> {
		const descriptors: Array<{ spineKey: string; isSugar: boolean; symbolValue?: number }> = [];
		const cacheJson: any = this.scene.cache.json;

		const hasFilter = Array.isArray(allowedSymbols) && allowedSymbols.length > 0;
		const allowedSet = hasFilter ? new Set<number>(allowedSymbols as number[]) : null;

		// Sugar idle symbol spines only: symbol_1_sugar_spine – symbol_9_sugar_spine
		// Exclude scatter (Symbol0) and multiplier symbols from this transition.
		for (let i = 1; i <= 9; i++) {
			const sugarKey = `symbol_${i}_sugar_spine`;
			if (cacheJson && typeof cacheJson.has === 'function' && cacheJson.has(sugarKey)) {
				descriptors.push({ spineKey: sugarKey, isSugar: true, symbolValue: i });
			}
		}

		// If no filter is provided, return all available descriptors.
		if (!hasFilter || !allowedSet) {
			return descriptors;
		}

		// Otherwise, restrict descriptors to the symbols that are currently in use.
		const filtered = descriptors.filter((d) => {
			if (typeof d.symbolValue !== 'number') {
				return false;
			}
			return allowedSet.has(d.symbolValue);
		});

		return filtered;
	}

	/**
	 * Create a single Spine particle at the given position.
	 */
	private createParticle(
		desc: { spineKey: string; isSugar: boolean; symbolValue?: number },
		x: number,
		y: number
	): SpineGameObject | null {
		const spineAtlasKey = `${desc.spineKey}-atlas`;

		let particle: SpineGameObject;
		try {
			enableSymbolSpineAtlasMipmaps(this.scene);
			particle = (this.scene.add as any).spine(x, y, desc.spineKey, spineAtlasKey);
			try { enableMipmapsOnSpineSkeleton((particle as any)?.skeleton, this.scene); } catch {}
		} catch (e) {
			console.warn('[SymbolExplosionTransition] Failed to create Spine particle:', desc.spineKey, e);
			return null;
		}

		if (!particle) {
			return null;
		}

		particle.setOrigin(0.5, 0.5);

		// Base scale: single base per type, with moderate random variation per symbol.
		let baseScale = desc.isSugar ? 0.18 : 0.16;

		// Random factor in a tight range (±15%) so sizes differ but not wildly
		const randomScaleFactor = Phaser.Math.FloatBetween(0.85, 1.15);
		baseScale *= randomScaleFactor;

		try {
			particle.setScale(baseScale);
		} catch {
			// ignore scaling failure, keep default
		}

		// Try to play a nice looped animation if available, otherwise leave default pose.
		try {
			const state: any = particle.animationState;
			if (state && typeof state.setAnimation === 'function') {
				// For sugar symbols, prefer the SW Idle/Win loops if they exist.
				if (desc.isSugar && typeof desc.symbolValue === 'number') {
					const symbolValue = desc.symbolValue;
					const baseName = `Symbol${symbolValue}_SW`;
					const idleName = `${baseName}_Idle`;
					const winName = `${baseName}_Win`;

					try {
						const entry: any = state.setAnimation(0, idleName, true);
						// Randomize animation phase so candies don't loop in sync
						if (entry) {
							entry.trackTime = Phaser.Math.FloatBetween(0, 1.0);
						}
					} catch {
						try {
							const entry: any = state.setAnimation(0, winName, true);
							if (entry) {
								entry.trackTime = Phaser.Math.FloatBetween(0, 1.0);
							}
						} catch {
							// Fall back silently – default animation will be used
						}
					}
				} else {
					// Generic fallback: follow the project's "{spine-keyname}_idle" convention when possible.
					const idleName = `${desc.spineKey}_idle`;
					try {
						const entry: any = state.setAnimation(0, idleName, true);
						if (entry) {
							entry.trackTime = Phaser.Math.FloatBetween(0, 1.0);
						}
					} catch {
						// If that fails, leave the Spine at its default pose/animation.
					}
				}
			}
		} catch {
			// Ignore animation errors; particle will still render.
		}

		return particle;
	}
}


