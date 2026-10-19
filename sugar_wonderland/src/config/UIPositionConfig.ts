/**
 * Big-screen / HiRes / runtime-mipmap knobs.
 * Ported from the joker_ace HiResRender + SpineAtlasMipmaps work (Phaser 3.90).
 * Kept under this filename so bootstrap/utils imports stay copy-paste portable.
 */

/**
 * ─── Spin button (`start_btn_spine`) ─────────────────────────────────────────
 *
 * Visual = Spine `start_btn_spine` (idle = keyframe 0; full `"animation"` on press).
 * Hit = non-rendering Phaser `Zone` sized by {@link SPIN_BUTTON_HIT_SIZE} (never an Image).
 * Overlays = `spin_icon` (idle rotate) + `autoplay_stop_icon` (autoplay / skip).
 *
 * Scale: `assetScale × SPIN_BUTTON_SPINE_SCALE_MODIFIER`
 * Offsets: px × assetScale, applied from the shared button anchor center.
 */
export const SPIN_BUTTON_SPINE_SCALE_MODIFIER = 0.2;
export const SPIN_BUTTON_SPINE_OFFSET_X = 0.5;
export const SPIN_BUTTON_SPINE_OFFSET_Y = 1.5;
/** On-screen hit diameter in logical px (before assetScale). */
export const SPIN_BUTTON_HIT_SIZE = 90;

/**
 * Scratch toggle above the balance.
 * Reference on-screen width in pixels before assetScale.
 */
export const SCRATCH_BUTTON_TARGET_WIDTH = 146;

export const SPIN_ICON_OFFSET_X = 0;
export const SPIN_ICON_OFFSET_Y = 0;
export const AUTOPLAY_STOP_ICON_OFFSET_X = 0;
export const AUTOPLAY_STOP_ICON_OFFSET_Y = 0;

/**
 * ─── Free-round spin button (`freeround_bg` + `Button_Bonus_Buttom`) ──────────
 * Used only while initialization free-round spins are active.
 * Scale: `assetScale × FREEROUND_SPIN_DISC_SCALE_MODIFIER` / `…_VFX_SCALE_MODIFIER`.
 */
export const FREEROUND_SPIN_DISC_SCALE_MODIFIER = 1.2;
export const FREEROUND_SPIN_VFX_SCALE_MODIFIER = 1.2;
export const FREEROUND_SPIN_DISC_OFFSET_X = 0;
export const FREEROUND_SPIN_DISC_OFFSET_Y = 0;

/**
 * ─── Runtime mipmaps (WebGL1-safe) ───────────────────────────────────────────
 *
 * Phaser 3 runs on WebGL1, which only mipmaps power-of-two textures. Spine
 * atlases are typically NPOT, so at runtime NPOT pages are stretched to the next
 * POT size (normalized UVs stay valid) and a mip chain is generated. Asset files
 * stay exactly as authored.
 *
 * Mipmaps only affect *minified* sampling (texture drawn smaller than its source).
 * They remove sparkle/shimmer; they never blur 1:1 or magnified pixels.
 * On a TV the canvas is still rendered at game resolution and CSS-upscaled unless
 * HiRes Render is also enabled — mipmaps cannot fix upscale softness alone.
 */
export const GAME_VISUAL_MIPMAPS_ENABLED = true;
/**
 * Minification filter for mipmapped pages:
 *   'sharp'   = LINEAR_MIPMAP_NEAREST — bilinear in-level, snaps to one mip level.
 *   'linear'  = LINEAR_MIPMAP_LINEAR (trilinear) — smoothest, slightly softer.
 *   'nearest' = NEAREST_MIPMAP_LINEAR — nearest texel; can look crunchy. Legacy.
 */
export const GAME_VISUAL_MIPMAP_MIN_FILTER: 'sharp' | 'linear' | 'nearest' = 'sharp';
/**
 * Anisotropic filtering level (EXT_texture_filter_anisotropic; 0/1 = off).
 * 4 is a good TV default; clamped to GPU max.
 */
export const GAME_VISUAL_MIPMAP_ANISOTROPY = 4;
/**
 * Only enable mipmaps when the larger CSS screen axis is ≥ this many px.
 * `0` = always.
 */
export const GAME_VISUAL_MIPMAPS_MIN_SCREEN_MAX_AXIS_PX = 1000;
/** Grid symbol Spine atlases (`symbol_*_sugar_spine`, `symbol_bombs_sw`). */
export const SYMBOL_SPINE_MIPMAPS_ENABLED = true;

/**
 * ─── High-resolution render (35"+ TVs / 4K / HiDPI desktops) ─────────────────
 *
 * Phaser FIT keeps the canvas backing store at the logical game size (428 × 926)
 * and CSS-upscales it — on a 4K TV that is a ~2.3× stretch. `HiResRender` keeps
 * the *logical* game size unchanged (`scene.scale.width/height`, all layout code)
 * and only enlarges the physical backing store: `baseSize = gameSize × R`, with
 * every full-frame camera zoomed by R (origin 0,0 so scrollFactor-0 objects stay put).
 *
 * Debug: `?renderScale=2` forces a scale, `?hires=0` disables. `window.__hiResRender`.
 */
export const HI_RES_RENDER_ENABLED = true;
/** Only engage when the larger CSS screen axis is ≥ this (phones stay at 1×). */
export const HI_RES_RENDER_MIN_SCREEN_MAX_AXIS_PX = 1000;
/** Hard cap on the render scale (2.25 ≈ 4K TV portrait-fit). */
export const HI_RES_RENDER_MAX_SCALE = 2.5;
/** Pixel budget for the backing store. Lower this if TV boxes stutter. */
export const HI_RES_RENDER_MAX_CANVAS_PIXELS = 2_600_000;
/** Quantize R to this step so text/atlas sampling stays stable. */
export const HI_RES_RENDER_SCALE_STEP = 0.25;
/** Bump `Text` canvas resolution to ≥ R so vector text stays crisp under the zoom. */
export const HI_RES_RENDER_TEXT_RESOLUTION_ENABLED = true;
