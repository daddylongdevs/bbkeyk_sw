# Scratch button: image + effect implementation

Use a static button image with the shared code-generated trail and glitter. Necronomicoin is the current reference implementation. Each game owns its button art, placement, interaction, and effect overrides.

## Files

| File | Purpose |
| --- | --- |
| [ScratchButtonEffect.ts](ScratchButtonEffect.ts) | Adds the trail behind the image and glitter above it; owns animation and cleanup. |
| [ScratchButtonEffectConfig.ts](ScratchButtonEffectConfig.ts) | Shared defaults and the ScratchButtonEffectOptions type. |
| [ScratchButtonEffectMath.ts](ScratchButtonEffectMath.ts) | Lifetime curve interpolation used by the effect. |
| [Necronomicoin config](../../necronomicoin/src/config/ScratchButtonEffectConfig.ts) | Game-specific overrides. |
| [Necronomicoin controller](../../necronomicoin/src/game/components/SlotController.ts) | Production image and effect integration. |
| [Necronomicoin assets](../../necronomicoin/src/config/AssetConfig.ts) | Button image loading and removal of the old button Spine preload. |

The effect needs the three core files listed above. No additional particle texture or dependency is needed: the effect generates its shared texture through Phaser. The examples use the game's existing @core alias pointing to the repository's core directory; Necronomicoin configures that alias in its Vite configurations.

## 1. Load the static button image

Put the image in the game's public assets and load it under the scratch_card texture key. Necronomicoin already has this entry in its AssetConfig image map:

```ts
'scratch_card': 'assets/controller/portrait/high/scratch_card.webp',
```

The corresponding file is necronomicoin/public/assets/controller/portrait/high/scratch_card.webp. Asset URLs are relative to the game's public directory.

Remove the old scratch_spin_button entry from the Spine preload map:

```ts
// Old entry to remove:
'scratch_spin_button': {
    atlas: 'assets/scratch/necronomicoin_sb/Scratch_Spin_Button.atlas',
    json: 'assets/scratch/necronomicoin_sb/Scratch_Spin_Button.json',
},
```

The migrated games use the static image and shared effect. Their old scratch-button Spine JSON, atlas, and atlas-page textures have been deleted. Keep other Spine assets and their plugin where the game still needs them.

## 2. Create the game's effect configuration

Create <game>/src/config/ScratchButtonEffectConfig.ts. In Necronomicoin:

```ts
import {
    SCRATCH_BUTTON_EFFECT_CONFIG,
    type ScratchButtonEffectOptions,
} from '@core/effects/ScratchButtonEffectConfig';

export const NECRONOMICOIN_SCRATCH_BUTTON_EFFECT_CONFIG:
    Required<ScratchButtonEffectOptions> = {
    ...SCRATCH_BUTTON_EFFECT_CONFIG,
    orbitLeft: -0.455,
    orbitRight: 0.44,
    orbitTop: -0.29,
    orbitBottom: 0.32,
    orbitCornerRadius: 15,
    showOrbitWireframe: false,
};
```

Use a game-specific export name in other games. Spread the shared defaults first, then override the properties that game needs. This lets common glow, trail, and glitter tuning stay in core while orbit bounds can vary by game. Any effect property, including sparkleBoundsOffset, can also be overridden here.

## 3. Replace the Spine button in the controller

Import the effect and game configuration in <game>/src/game/components/SlotController.ts:

```ts
import { addScratchButtonEffect } from '@core/effects/ScratchButtonEffect';
import { NECRONOMICOIN_SCRATCH_BUTTON_EFFECT_CONFIG }
    from '../../config/ScratchButtonEffectConfig';
```

Necronomicoin's createScratchCardButton method uses this implementation:

```ts
private createScratchCardButton(scene: Scene, assetScale: number): void {
    if (this.scratchCardButton || this.scratchCardRoot) return;

    const balanceX = scene.scale.width * 0.19;
    const scratchY = Math.round(scene.scale.height * 0.724 - 53);
    const root = scene.add.container(balanceX, scratchY)
        .setDepth(10).setName('hud_scratch_card_root');
    const scratchButton = scene.add.image(0, 0, 'scratch_card')
        .setOrigin(0.5, 0.5).setScale(assetScale)
        .setName('hud_scratch_card_button');
    scene.textures.get('scratch_card').setFilter(Phaser.Textures.FilterMode.LINEAR);

    root.add(scratchButton);
    this.controllerContainer.add(root);
    this.scratchCardRoot = root;
    this.scratchCardButton = scratchButton;
    this.bindScratchToggle(scratchButton);
    addScratchButtonEffect(
        scene, root, scratchButton, NECRONOMICOIN_SCRATCH_BUTTON_EFFECT_CONFIG,
    );
    this.addScratchCardLabel(scene, root);
}
```

Keep the placement and scale appropriate to each game's HUD. Add the centered image to its container before calling addScratchButtonEffect, and add the label afterwards. The resulting order is trail/glow/sparks, button image, glitter, then label.

Reuse the game's existing click/touch handler. In Necronomicoin, bindScratchToggle applies the hand cursor, button sound, replay gating, and scratch-toggle event. The effect itself does not install interactions. The production label also remains the game's existing localized label.

Remove the old scratch-button Spine creation, animation playback, and any fallback shine animation that this effect replaces. Leave the controller's existing scratch availability and visibility rules in place.

### Cleanup and batching

The effect follows the image's position, scale, rotation, alpha, and visibility. It checks parent visibility, pauses while hidden, and cleans up when the image is destroyed or the scene shuts down. The function also returns a cleanup function for callers that need to remove only the effect:

```ts
const removeEffect = addScratchButtonEffect(scene, root, scratchButton, gameConfig);
// When explicitly removing the effect while keeping the image:
removeEffect();
```

Glow, ribbon segments, and trail sparks use the same texture and additive blend mode so the rear effect can batch together. Glitter is above the normal-blended card image and is rendered separately. Runtime draw-call totals also depend on the game's surrounding HUD and debug overlays.

## 4. Tune the effect

Edit shared defaults in core/effects/ScratchButtonEffectConfig.ts, or override them in the game's config.

| Properties | Meaning |
| --- | --- |
| loopDurationMs | Orbit duration in milliseconds; lower is faster. |
| orbitLeft, orbitRight | Horizontal edges as fractions of button width, measured from its center. |
| orbitTop, orbitBottom | Vertical edges as fractions of button height, measured from its center. |
| orbitCornerRadius | Radius of the trail's rounded corners; capped at half the shorter orbit side. |
| trailLength | Fraction of the orbit occupied by the trail, from 0 (head only) to 1. |
| glowSize, glowBrightness, glowColor | Glow diameter, brightness multiplier, and hexadecimal color. Glow size also scales ribbon thickness. |
| trailSparkCount, trailSparkSpread, trailSparkSize | Count, outward spread, and maximum diameter of the fine sparks around the trail. |
| sparkleCount, sparkleColor | Particle limit/emission density and hexadecimal color of glitter over the button. |
| sparkleSizeMin, sparkleSizeMax | Randomized starting glitter texture diameter. Both axes use the same size. |
| sparkleSizeOverLifetime | Evenly spaced size multipliers from birth to death. |
| sparkleOpacityOverLifetime | Evenly spaced opacity samples from birth to death, clamped to 0 through 1. |
| sparkleBoundsOffset | Uniform offset from the orbit bounds: positive inward, negative outward, 0 matches the orbit edges. |
| showOrbitWireframe | Shows the cyan orbit path and orange moving head marker; use false for normal rendering. |

Pixel-valued settings (sizes, spread, corner radius, and bounds offset) are specified at a reference button width of 146 px and scale with the button. Colors use numbers such as 0x89ff86.

Glitter uses a rectangular spawn area derived from the four orbit edges. sparkleBoundsOffset adjusts all four edges equally, without moving the trail. Excessive positive offsets collapse the spawn range at its center. The offset affects spawn positions; particle drift and visible texture size can extend beyond those positions. orbitCornerRadius rounds the trail path, rather than clipping glitter to the rounded outline.

For example:

```ts
sparkleBoundsOffset: 4,                       // Inset all edges by 4 reference pixels.
sparkleSizeOverLifetime: [0, 1, 0.5, 0],     // Grow, then shrink.
sparkleOpacityOverLifetime: [0, 1, 0.6, 0],  // Fade in, then out.
```

## 5. Manual verification

Run the game's normal static/build checks as appropriate, then manually inspect:

- Correct HUD position and scale, localized label, scratch toggle, and existing mode/replay behavior.
- Per-game orbit, glitter coverage and bounds offset, and particle lifetime tuning.
- Hiding or destroying the button removes its visible effect.

Static checks do not establish visual composition or an exact draw-call count.
