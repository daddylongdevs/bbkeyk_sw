/** Tuning shared by games that use addScratchButtonEffect. */
export interface ScratchButtonEffectOptions {
	/** Orbit duration in milliseconds. Lower values make the trail move faster. */
	loopDurationMs?: number;
	/** Hex color of the glow trail and trailing sparks. */
	glowColor?: number;
	/** Hex color of the glitter over the button. */
	sparkleColor?: number;
	/** Glitter particle limit; also controls the emission rate. */
	sparkleCount?: number;
	/** Randomized sparkle texture diameter in pixels at a 146 px button width. */
	sparkleSizeMin?: number;
	sparkleSizeMax?: number;
	/** Uniform sparkle spawn inset in pixels at a 146 px button width. Positive moves inward; negative expands outward. */
	sparkleBoundsOffset?: number;
	/** Size multipliers sampled evenly from birth to death; [1, 1] keeps the starting size. */
	sparkleSizeOverLifetime?: readonly number[];
	/** Opacity samples (0 to 1) spread evenly from birth to death. */
	sparkleOpacityOverLifetime?: readonly number[];
	/** Fraction of the orbit covered by the trail, from 0 (head only) to 1. */
	trailLength?: number;
	/** Fine particles surrounding the trail. 0 disables trail sparks. */
	trailSparkCount?: number;
	/** Sideways spark spread in pixels at a 146 px button width; grows toward the tail. */
	trailSparkSpread?: number;
	/** Maximum trail spark diameter in pixels at a 146 px button width. */
	trailSparkSize?: number;
	/** Glow diameter in pixels at a 146 px button width; also scales ribbon thickness. */
	glowSize?: number;
	/** Trail/glow/spark brightness multiplier. 0 hides them; 1 preserves the original intensity. */
	glowBrightness?: number;
	/** Left orbit and sparkle spawn edge as a fraction of button width, measured from its center. */
	orbitLeft?: number;
	/** Right orbit and sparkle spawn edge as a fraction of button width, measured from its center. */
	orbitRight?: number;
	/** Top orbit and sparkle spawn edge as a fraction of button height, measured from its center. */
	orbitTop?: number;
	/** Bottom orbit and sparkle spawn edge as a fraction of button height, measured from its center. */
	orbitBottom?: number;
	/** Corner radius in pixels at a 146 px button width. 0 gives square corners. */
	orbitCornerRadius?: number;
	/** Debug overlay: cyan orbit path and orange marker at the moving trail head. */
	showOrbitWireframe?: boolean;
}

/** Shared defaults. Games can spread this object and override their orbit before passing it to addScratchButtonEffect. */
export const SCRATCH_BUTTON_EFFECT_CONFIG: Required<ScratchButtonEffectOptions> = {
	loopDurationMs: 1800,
	glowColor: 0x89ff86,
	sparkleColor: 0xe5ffdc,
	sparkleCount: 160,
	sparkleSizeMin: 1.12,
	sparkleSizeMax: 2.52,
	sparkleBoundsOffset: 2,
	sparkleSizeOverLifetime: [1, 0.5],
	sparkleOpacityOverLifetime: [0, 0.4, 0.85, 0.3, 0],

	trailLength: 0.4,
	trailSparkCount: 160,
	trailSparkSpread: 12,
	trailSparkSize: 3.8,
	glowSize: 24,
	glowBrightness: 1.2,

	// Orbit bounds are relative to the centered button; sparkleBoundsOffset adjusts the sparkle spawn area.
	orbitLeft: -0.455,
	orbitRight: 0.44,
	orbitTop: -0.29,
	orbitBottom: 0.32,
	// Radius is capped at half the orbit's shorter side.
	orbitCornerRadius: 15,
	showOrbitWireframe: false,
};
