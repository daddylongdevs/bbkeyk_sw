import { SCRATCH_BUTTON_EFFECT_CONFIG, type ScratchButtonEffectOptions } from '@core/effects/ScratchButtonEffectConfig';

/** Shared VFX tuning with this game's orbit and sparkle spawn bounds. */
export const SUGAR_WONDERLAND_SCRATCH_BUTTON_EFFECT_CONFIG: Required<ScratchButtonEffectOptions> = {
	...SCRATCH_BUTTON_EFFECT_CONFIG,
	orbitLeft: -0.46,
	orbitRight: 0.44,
	orbitTop: -0.22,
	orbitBottom: 0.23,
	orbitCornerRadius: 15,
};
