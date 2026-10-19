# Grouping container draw order

`groupContainerChildrenByKey` works with both Phaser 3 and Phaser 4 containers. It has no Phaser runtime import and needs no engine-specific adapter.

```ts
import { groupContainerChildrenByKey } from '@core/utils/ContainerDrawOrder';

const symbolKey = (child: Phaser.GameObjects.GameObject) => {
  const value = (child as any).symbolValue;
  return Number.isInteger(value) && value >= 0 && value <= 7 ? value : null;
};
const groupSymbols = () => groupContainerChildrenByKey(symbolContainer, symbolKey);

scene.events.on('prerender', groupSymbols);
// Remove this listener when the container or scene is disposed.
```

Keys sort numerically; equal-key children retain their relative order. Returning `null` or `undefined` leaves that child's exact list position unchanged. Logical reel arrays, object ownership, transforms, animations and depth values remain unchanged. The function scans the list on each call, but only allocates scratch arrays and sorts when keys are out of order.

Use it where changing the selected children's overlap order is acceptable, including during drops and wins if the game permits it. Excluded effects can still interrupt GPU batching because they remain in place. The utility improves draw order; it does not merge incompatible textures, shaders, blend modes or masks. A single Spine object may also contain several texture/blend transitions.

Aztec Lost Empire groups multiplier badges by value using negative keys so they remain behind the symbols, then groups incoming/outgoing symbols by their 0-7 values. Other grid effects retain their list positions. Aura frames use their multiplier values, keeping higher tiers above lower tiers and the highlight runner last. Other games opt in explicitly; installing the utility does not change them.
