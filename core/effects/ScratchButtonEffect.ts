import type { Scene, GameObjects } from 'phaser';

import { SCRATCH_BUTTON_EFFECT_CONFIG, type ScratchButtonEffectOptions } from './ScratchButtonEffectConfig';
import { sampleLifetimeCurve } from './ScratchButtonEffectMath';

export type { ScratchButtonEffectOptions } from './ScratchButtonEffectConfig';

const TEXTURE_KEY = '__core_scratch_button_particles';
const TRAIL_SAMPLES = 28;
const RIBBON_SAMPLES = 64;

/** One shared texture for glow, glitter, and solid ribbon segments, so they can batch together. */
function ensureParticleTexture(scene: Scene): void {
	if (scene.textures.exists(TEXTURE_KEY)) return;
	const texture = scene.textures.createCanvas(TEXTURE_KEY, 80, 64);
	if (!texture) throw new Error('Could not create scratch button particle texture');
	const context = texture.getContext();
	const glow = context.createRadialGradient(32, 32, 0, 32, 32, 32);
	glow.addColorStop(0, 'rgba(255,255,255,0.8)');
	glow.addColorStop(0.2, 'rgba(255,255,255,0.4)');
	glow.addColorStop(0.5, 'rgba(255,255,255,0.12)');
	glow.addColorStop(1, 'rgba(255,255,255,0)');
	context.fillStyle = glow;
	context.fillRect(0, 0, 64, 64);
	const fleck = context.createRadialGradient(72, 8, 0, 72, 8, 6);
	fleck.addColorStop(0, 'rgba(255,255,255,1)');
	fleck.addColorStop(0.3, 'rgba(255,255,255,0.8)');
	fleck.addColorStop(1, 'rgba(255,255,255,0)');
	context.fillStyle = fleck;
	context.fillRect(64, 0, 16, 16);
	texture.add('glow', 0, 0, 0, 64, 64);
	texture.add('fleck', 0, 64, 0, 16, 16);
	// White padding around the frame prevents sampling transparent neighbors on thin rotated segments.
	context.fillStyle = 'rgba(255,255,255,1)';
	context.fillRect(64, 16, 16, 16);
	texture.add('ribbon', 0, 66, 18, 12, 12);
	texture.refresh();
}

type OrbitPoint = { x: number; y: number };
type OrbitSegment = { length: number; pointAt: (progress: number) => OrbitPoint };

/** Shared local bounds for the orbit and the sparkle spawn area. */
function getOrbitBounds(width: number, height: number, options: ScratchButtonEffectOptions) {
	const defaults = SCRATCH_BUTTON_EFFECT_CONFIG;
	const x1 = width * (options.orbitLeft ?? defaults.orbitLeft);
	const x2 = width * (options.orbitRight ?? defaults.orbitRight);
	const y1 = height * (options.orbitTop ?? defaults.orbitTop);
	const y2 = height * (options.orbitBottom ?? defaults.orbitBottom);
	return {
		left: Math.min(x1, x2),
		right: Math.max(x1, x2),
		top: Math.min(y1, y2),
		bottom: Math.max(y1, y2),
	};
}

/** Constant-speed rounded rectangle, starting at its bottom-left tangent. */
function createOrbit(width: number, height: number, options: ScratchButtonEffectOptions): (progress: number) => OrbitPoint {
	const defaults = SCRATCH_BUTTON_EFFECT_CONFIG;
	const { left, right, top, bottom } = getOrbitBounds(width, height, options);
	const radius = Math.max(0, Math.min(
		(options.orbitCornerRadius ?? defaults.orbitCornerRadius) * width / 146,
		(right - left) / 2,
		(bottom - top) / 2,
	));
	const line = (x1: number, y1: number, x2: number, y2: number): OrbitSegment => ({
		length: Math.hypot(x2 - x1, y2 - y1),
		pointAt: (t) => ({ x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t }),
	});
	const arc = (x: number, y: number, startAngle: number): OrbitSegment => ({
		length: Math.PI * radius / 2,
		pointAt: (t) => {
			const angle = startAngle - t * Math.PI / 2;
			return { x: x + radius * Math.cos(angle), y: y + radius * Math.sin(angle) };
		},
	});
	const segments = [
		line(left + radius, bottom, right - radius, bottom),
		arc(right - radius, bottom - radius, Math.PI / 2),
		line(right, bottom - radius, right, top + radius),
		arc(right - radius, top + radius, 0),
		line(right - radius, top, left + radius, top),
		arc(left + radius, top + radius, -Math.PI / 2),
		line(left, top + radius, left, bottom - radius),
		arc(left + radius, bottom - radius, -Math.PI),
	];
	const perimeter = segments.reduce((sum, segment) => sum + segment.length, 0);
	return (progress) => {
		let distance = ((progress % 1 + 1) % 1) * perimeter;
		for (const segment of segments) {
			if (segment.length > 0 && distance <= segment.length) {
				return segment.pointAt(distance / segment.length);
			}
			distance -= segment.length;
		}
		return { x: left + radius, y: bottom };
	};
}

/**
 * Code-generated saber trail behind the card and glitter over its green panel.
 * Add the centered image to its parent first; add the label afterwards.
 * Effects inherit the controller transform and clean up with the image/scene.
 * The return value also allows callers to remove the effect explicitly.
 */
export function addScratchButtonEffect(
	scene: Scene,
	parent: GameObjects.Container,
	button: GameObjects.Image,
	options: ScratchButtonEffectOptions = SCRATCH_BUTTON_EFFECT_CONFIG,
): () => void {
	ensureParticleTexture(scene);
	const loopDurationMs = Math.max(1, options.loopDurationMs ?? SCRATCH_BUTTON_EFFECT_CONFIG.loopDurationMs);
	const glowColor = options.glowColor ?? SCRATCH_BUTTON_EFFECT_CONFIG.glowColor;
	const sparkleColor = options.sparkleColor ?? SCRATCH_BUTTON_EFFECT_CONFIG.sparkleColor;
	const sparkleCount = Math.max(1, Math.round(options.sparkleCount ?? SCRATCH_BUTTON_EFFECT_CONFIG.sparkleCount));
	const trailLength = Math.max(0, Math.min(1, options.trailLength ?? SCRATCH_BUTTON_EFFECT_CONFIG.trailLength));
	const glowSize = Math.max(0, options.glowSize ?? SCRATCH_BUTTON_EFFECT_CONFIG.glowSize);
	const glowBrightness = Math.max(0, options.glowBrightness ?? SCRATCH_BUTTON_EFFECT_CONFIG.glowBrightness);
	const sparkleSizeMin = Math.max(0, options.sparkleSizeMin ?? SCRATCH_BUTTON_EFFECT_CONFIG.sparkleSizeMin);
	const sparkleSizeMax = Math.max(sparkleSizeMin, options.sparkleSizeMax ?? SCRATCH_BUTTON_EFFECT_CONFIG.sparkleSizeMax);
	const sparkleSizeCurve = options.sparkleSizeOverLifetime ?? SCRATCH_BUTTON_EFFECT_CONFIG.sparkleSizeOverLifetime;
	const sparkleOpacityCurve = options.sparkleOpacityOverLifetime ?? SCRATCH_BUTTON_EFFECT_CONFIG.sparkleOpacityOverLifetime;
	const trailSparkCount = Math.max(0, Math.round(options.trailSparkCount ?? SCRATCH_BUTTON_EFFECT_CONFIG.trailSparkCount));
	const trailSparkSpread = Math.max(0, options.trailSparkSpread ?? SCRATCH_BUTTON_EFFECT_CONFIG.trailSparkSpread);
	const trailSparkSize = Math.max(0, options.trailSparkSize ?? SCRATCH_BUTTON_EFFECT_CONFIG.trailSparkSize);
	const glowScale = glowSize / 16;
	const opacity = (alpha: number): number => Math.min(1, alpha * glowBrightness);
	const width = button.width;
	const height = button.height;
	const artScale = width / 146;
	const orbitBounds = getOrbitBounds(width, height, options);
	const sparkleBoundsOffset = (options.sparkleBoundsOffset ?? SCRATCH_BUTTON_EFFECT_CONFIG.sparkleBoundsOffset) * artScale;
	// Large positive offsets collapse at the center instead of reversing the spawn range.
	const sparkleInsetX = Math.min(sparkleBoundsOffset, (orbitBounds.right - orbitBounds.left) / 2);
	const sparkleInsetY = Math.min(sparkleBoundsOffset, (orbitBounds.bottom - orbitBounds.top) / 2);
	const orbitPoint = createOrbit(width, height, options);
	const behind = scene.add.container(0, 0);
	const overlay = scene.add.container(0, 0);
	const haze: GameObjects.Image[] = [];
	for (let i = 0; i < TRAIL_SAMPLES; i++) {
		const image = scene.add.image(0, 0, TEXTURE_KEY, 'glow')
			.setTint(glowColor).setBlendMode('ADD');
		behind.add(image);
		haze.push(image);
	}
	// Image segments share the glow/spark atlas and additive blend mode, keeping the rear effect in one batch.
	const addRibbonImage = (color: number): GameObjects.Image => {
		const image = scene.add.image(0, 0, TEXTURE_KEY, 'ribbon')
			.setOrigin(0, 0.5).setTint(color).setBlendMode('ADD');
		behind.add(image);
		return image;
	};
	const ribbon = Array.from({ length: RIBBON_SAMPLES - 1 }, () => ({
		outer: addRibbonImage(glowColor),
		green: addRibbonImage(glowColor),
		core: addRibbonImage(0xf0ffe8),
	}));
	// Fixed seeds give a steady stream of fine sparks, already filled on the first frame.
	// Each spark stays near where the head passed, then drifts sideways as it ages.
	const trailSparks = Array.from({ length: trailSparkCount }, (_, index) => {
		const image = scene.add.image(0, 0, TEXTURE_KEY, 'fleck')
			.setTint(index % 3 === 0 ? glowColor : 0xf0ffe8).setBlendMode('ADD');
		behind.add(image);
		return {
			image,
			ageOffset: (index + Math.random()) / trailSparkCount,
			side: Math.random() * 2 - 1,
			drift: Math.random() * 2 - 1,
			size: 0.25 + Math.random() ** 2 * 0.75,
			twinkle: Math.random() * Math.PI * 2,
		};
	});
	const sparkleStartingSizes = new WeakMap<GameObjects.Particles.Particle, number>();
	const sparkleSizeAt = (base: number, progress: number): number =>
		base * Math.max(0, sampleLifetimeCurve(sparkleSizeCurve, progress));
	const sparkleOpacityAt = (progress: number): number =>
		Math.max(0, Math.min(1, sampleLifetimeCurve(sparkleOpacityCurve, progress)));
	const glitter = scene.add.particles(0, 0, TEXTURE_KEY, {
		frame: 'fleck',
		x: { min: orbitBounds.left + sparkleInsetX, max: orbitBounds.right - sparkleInsetX },
		y: { min: orbitBounds.top + sparkleInsetY, max: orbitBounds.bottom - sparkleInsetY },
		lifespan: { min: 500, max: loopDurationMs },
		frequency: loopDurationMs / sparkleCount,
		speedX: { min: -artScale, max: artScale },
		speedY: { min: -artScale, max: artScale },
		scale: {
			onEmit: (particle) => {
				const base = (sparkleSizeMin + Math.random() * (sparkleSizeMax - sparkleSizeMin)) / 16 * artScale;
				if (particle) sparkleStartingSizes.set(particle, base);
				return sparkleSizeAt(base, 0);
			},
			onUpdate: (particle, _key, progress) =>
				sparkleSizeAt(sparkleStartingSizes.get(particle) ?? sparkleSizeMin / 16 * artScale, progress),
		},
		alpha: {
			onEmit: () => sparkleOpacityAt(0),
			onUpdate: (_particle, _key, progress) => sparkleOpacityAt(progress),
		},
		tint: sparkleColor,
		blendMode: 'ADD',
		maxParticles: sparkleCount,
		advance: loopDurationMs,
	});
	overlay.add(glitter);
	let wireframeHead: GameObjects.Graphics | null = null;
	if (options.showOrbitWireframe ?? SCRATCH_BUTTON_EFFECT_CONFIG.showOrbitWireframe) {
		const wireframe = scene.add.graphics().lineStyle(0.75 * artScale, 0x00dfff, 0.9);
		wireframe.beginPath();
		for (let i = 0; i < 256; i++) {
			const point = orbitPoint(i / 256);
			if (i === 0) wireframe.moveTo(point.x, point.y);
			else wireframe.lineTo(point.x, point.y);
		}
		wireframe.closePath().strokePath();
		overlay.add(wireframe);
		wireframeHead = scene.add.graphics()
			.fillStyle(0xffb347, 1).fillCircle(0, 0, 1.5 * artScale);
		overlay.add(wireframeHead);
	}
	parent.addAt(behind, parent.getIndex(button));
	parent.addAt(overlay, parent.getIndex(button) + 1);

	let elapsed = 0;
	let trailElapsed = 0;
	let destroyed = false;
	const update = (_time: number, delta: number): void => {
		let visible = button.visible && button.alpha > 0;
		let ancestor: GameObjects.Container | null = parent;
		while (visible && ancestor) {
			visible = ancestor.visible && ancestor.alpha > 0;
			ancestor = ancestor.parentContainer;
		}
		for (const layer of [behind, overlay]) {
			layer.setPosition(button.x, button.y).setScale(button.scaleX, button.scaleY)
				.setRotation(button.rotation).setAlpha(button.alpha).setVisible(visible);
		}
		glitter.setActive(visible);
		if (!visible) return;
		elapsed = (elapsed + delta) % loopDurationMs;
		const progress = elapsed / loopDurationMs;
		trailElapsed += delta;
		const sampleCount = trailLength === 0 ? 1 : TRAIL_SAMPLES;
		for (let i = 0; i < TRAIL_SAMPLES; i++) {
			haze[i].setVisible(i < sampleCount);
			if (i >= sampleCount) continue;
			const strength = sampleCount === 1 ? 1 : i / (sampleCount - 1);
			const point = orbitPoint(progress - trailLength * (1 - strength));
			haze[i].setPosition(point.x, point.y)
				.setDisplaySize(glowSize * artScale, glowSize * artScale)
				.setAlpha(opacity(0.22 * Math.sqrt(strength)));
		}
		// Preserve the three stroke widths and tail fade using textured quads instead of Graphics.
		let previous = orbitPoint(progress - trailLength);
		for (let i = 0; i < ribbon.length; i++) {
			const strength = (i + 1) / (RIBBON_SAMPLES - 1);
			const point = orbitPoint(progress - trailLength * (1 - strength));
			const length = Math.hypot(point.x - previous.x, point.y - previous.y);
			const rotation = Math.atan2(point.y - previous.y, point.x - previous.x);
			const segment = ribbon[i];
			for (const image of [segment.outer, segment.green, segment.core]) {
				image.setVisible(trailLength > 0 && glowSize > 0)
					.setPosition(previous.x, previous.y).setRotation(rotation);
			}
			segment.outer.setDisplaySize(length, 4 * glowScale * artScale).setAlpha(opacity(0.12 * strength));
			segment.green.setDisplaySize(length, 1.5 * glowScale * artScale).setAlpha(opacity(0.65 * strength));
			segment.core.setDisplaySize(length, 0.55 * glowScale * artScale).setAlpha(opacity(strength ** 1.5));
			previous = point;
		}
		const sparkLifetime = loopDurationMs * trailLength;
		for (const spark of trailSparks) {
			spark.image.setVisible(sparkLifetime > 0 && glowSize > 0);
			if (sparkLifetime === 0) continue;
			const age = (trailElapsed / sparkLifetime + spark.ageOffset) % 1;
			const phase = progress - trailLength * age;
			const point = orbitPoint(phase);
			const before = orbitPoint(phase - 0.0001);
			const after = orbitPoint(phase + 0.0001);
			const length = Math.hypot(after.x - before.x, after.y - before.y) || 1;
			const tangentX = (after.x - before.x) / length;
			const tangentY = (after.y - before.y) / length;
			const spread = trailSparkSpread * artScale * (0.12 + age ** 0.8);
			const sideways = spark.side * spread;
			const drift = spark.drift * spread * 0.25;
			const twinkle = 0.65 + 0.35 * Math.sin(age * Math.PI * 8 + spark.twinkle) ** 2;
			const fade = Math.min(1, age / 0.06) * (1 - age) ** 0.6;
			const size = trailSparkSize * artScale * spark.size * (1 - age * 0.35);
			spark.image.setPosition(point.x - tangentY * sideways + tangentX * drift,
				point.y + tangentX * sideways + tangentY * drift)
				.setDisplaySize(size, size).setAlpha(opacity(fade * twinkle));
		}
		const head = orbitPoint(progress);
		wireframeHead?.setPosition(head.x, head.y);
	};
	const destroy = (): void => {
		if (destroyed) return;
		destroyed = true;
		scene.events.off('update', update);
		scene.events.off('shutdown', destroy);
		button.off('destroy', destroy);
		behind.destroy();
		overlay.destroy();
	};
	scene.events.on('update', update);
	scene.events.once('shutdown', destroy);
	button.once('destroy', destroy);
	update(0, 0);
	return destroy;
}
