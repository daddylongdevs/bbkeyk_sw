# Draw call debugger

For **Phaser 3 and 4 WebGL or Canvas 2D games**, enable it from a scene's `create()` with one call. No font assets or update/resize code are needed. Each game opts in explicitly.

```ts
import { enableDrawCallDebugger } from '@core/debug';

create() {
    enableDrawCallDebugger(this);
}
```

The overlay is anchored inside the **game canvas's bottom-left corner**, with a **5 CSS pixel margin** from both canvas edges. It follows the canvas when it is centered, resized, or moved by page scrolling. Camera scrolling and zoom do not affect its position.

Optional configuration:

```ts
enableDrawCallDebugger(this, {
    enabled: import.meta.env.DEV,
    position: 'top-right',
    margin: 10,
    fontSize: 16,
});
```

`enabled` defaults to `true`; pass your game's debug flag or `import.meta.env.DEV` to gate it. Supported corners are `bottom-left`, `bottom-right`, `top-left`, and `top-right`.

For a separate scratch canvas, pass `containOverlay: true`. The canvas parent must be positioned (for example, `position: absolute` or `relative`). The overlay is attached inside that parent so it slides, clips, and hides with the panel.

The counter reports commands in the last completed rendered frame across all scenes in this game. Each separate scratch game has its own counter. Panels rendered inside the main game are already included in that game's count. No Spector.js dependency is needed:

- **Phaser 3 WebGL:** wraps `gl.drawArrays` and `gl.drawElements`, including direct Spine drawing. Also counts WebGL 2 instanced draws or WebGL 1 `ANGLE_instanced_arrays` draws when available.
- **Phaser 4 WebGL:** wraps `renderer.drawElements` and `renderer.drawInstancedArrays`. Raw WebGL calls that bypass these methods are not counted.
- **Canvas 2D:** displays **Canvas Draws**, counting `drawImage`, `fill`, `stroke`, `fillRect`, `strokeRect`, `fillText`, `strokeText`, and `putImageData` calls on the game's output context. Offscreen canvas work, clearing, clipping, and transform changes are excluded. Canvas paint operations and WebGL draw calls are different metrics.

Both counters reset on the renderer's `prerender` event, so they do not accumulate across frames. The HTML overlay adds no WebGL draw calls or Canvas paint operations.

Main game scenes and existing scratch desktop hosts enable this only with `enabled: import.meta.env.DEV`, except `turbo_wrath`, `gnome_mans_land`, and `fruit_attack`, which do not opt in.

Only one debugger is installed per game. Repeated calls return the existing handle without changing its configuration. The scene that first enables it owns its lifetime: scene shutdown/destruction or game destruction automatically removes the overlay and hooks. Call it again when that scene restarts. The returned handle also exposes `getDrawCalls()` and `destroy()` for manual use.
