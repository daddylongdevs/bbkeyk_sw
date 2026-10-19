# Canvas animation frame caching guideline

Use this guideline before applying [CanvasAnimationFrameCache](./CanvasAnimationFrameCache.ts) to a scratch card Canvas 2D renderer. Audit **every symbol reachable through the scratch card's symbol map**, then cache the expensive animations selectively. The utility stores frames; it does not discover symbols, choose animations, or classify priorities automatically.

## 1. Inventory the actual scratch visuals

Trace the game's scratch symbol map, preload list, visual factory, animation selection, and win/reveal presentation. For every mapped symbol, record:

- Server symbol name, displayed name or multiplier, and static texture.
- Spine asset and the exact animation selected by the presentation code. Do not assume the first exported animation is the intended clip.
- Every reachable visual state: static/setup pose, idle, reveal, win, and disappearance, where applicable.
- The real fallback when a clip is unavailable: PNG pulse, text, another Spine, or shared hit/Poof effects. List these costs too.
- Whether the static image remains visible or is replaced during animation.
- How many instances can animate together in a legal card, including matching symbols and special multipliers. Check all supported grid sizes and desktop/in-main placements.

Include static-only and blank symbols in the report. Mark exported but unused symbols/clips as unused; do not cache them merely because their assets are loaded. Keep the audit scoped to the scratch canvas, with shared effects listed separately to avoid double-counting them.

## 2. Measure uncached animation cost

Measure **Canvas API paint operations per rendered frame**, not GPU draw calls and not a cumulative count over the animation's duration.

1. Keep transparent-slot culling enabled and bypass frame caching for the measurement. The idle baseline and animated sample must use the same renderer, culling, scale, and presentation.
2. Sample the whole selected clip, including attachment/sequence changes, alpha fades, its endpoint, and loop transitions. Start with the adapter's sampling rate (Rainbow Fist currently uses 60 fps). Inspect authored key times as well if brief peaks could fall between samples.
3. Count output-context paint calls. The current scratch triangle renderer submits one `drawImage` per nondegenerate triangle; a region attachment uses two triangles. Skip fully transparent slots. Triangle totals from JSON are only an upper bound: some attachments may never be active together.
4. Include retained PNGs, badges, and associated effects in the animated visual's count. Measure the same visual at rest as its baseline. Avoid counting unrelated panel chrome or sand activity as symbol animation cost.
5. Record the minimum and peak animated draws, peak **additional** draws, and the likely simultaneous count. Mark static estimates, headless renderer samples, and browser observations distinctly; do not describe estimates as runtime measurements.

For a visual whose static baseline is constant:

```text
per-symbol peak additional draws = max(0, peak animated output draws - resting output draws)
concurrent potential additional draws = sum(per-symbol peak additional draws × simultaneous instances)
```

If the baseline varies, compare corresponding presentation states. Sum-of-peaks concurrency is a **potential upper bound**, unless the clips' peaks are known to coincide. Report a synchronized sample when available. Do not add a shared effect twice or multiply an effect that only plays once for the whole match.

The [draw debugger](../debug/README.md) counts the output canvas only. Offscreen baking is excluded from its overlay, so a lower counter alone does not prove a reduction in total first-use work.

## 3. Assign caching priority

Apply these bands to **additional draws per frame**. Report both the individual symbol band and the concurrent presentation band; an expensive concurrent presentation can elevate the implementation priority.

| Additional draws | Priority | Action |
| --- | --- | --- |
| More than 1000 | Force | Implement animation frame caching; preserve visual correctness and the memory safeguards below. |
| 100 through 1000, inclusive | High | Prioritize implementing animation frame caching. |
| Fewer than 100 | Low | Usually leave the animation live to save memory. Cache only with evidence of another substantial benefit. |

Audit all symbols; **do not enable caching for all symbols by default**. A large exported mesh is insufficient justification if the actual scratch presentation never renders it.

For Spine Canvas integrations, [SpineCanvasFrameCache](./SpineCanvasFrameCache.ts) provides shared sampled playback using the game's own Spine runtime. Register eligible symbols only. Its `cacheRegions: false` option keeps cheap region attachments live in draw order while caching mesh groups; use this when large aura/ray images would otherwise dominate memory. Physics-bearing poses are stepped at 60 fps, and cached loops repeat their sampled first-cycle motion.

## 4. Estimate memory and choose eligible clips

For each candidate, report cached frame rate, duration, output resolution, blend-layer count, and estimated pixel memory:

```text
estimated pixel bytes = sum(canvas width × canvas height × 4)
                       across unique cached frames and layers
```

Include the utility's one-pixel bounds padding and all retained resolution variants. This is pixel data, not a guarantee of total browser memory use. A shared frame is counted once regardless of how many cells replay it. Prefer actual per-frame bounds over the largest possible bounds for every frame.

- Cache at scratch display resolution, including its backing scale. Include resolution/scale changes in the key.
- Share frames by asset, selected animation, sampled time, and all other baked appearance inputs. Exclude screen position so matching cells reuse frames.
- Preserve blend layers in draw order; do not flatten backdrop-dependent blends indiscriminately.
- Keep an explicit memory budget. The core utility defaults to **32 MiB** of cached pixel data, evicts least-recently-used frames, and rejects a frame over budget or a layer exceeding 2048 pixels on either edge.
- Check the combined working set of simultaneously used clips. Repeated eviction and rebaking can erase the benefit of caching.
- Keep live rendering for unsupported animation state, rejected frames, and low-cost effects. Do not change event timing or completion callbacks to drive cached playback.
- Release cached canvases on both scene shutdown and destruction. Avoid retaining them after the scratch host is destroyed.

Lazy caching still rasterizes triangles on a cache miss. Compare cold playback, warm replay, and memory use separately. Lower the sampling rate or resolution only as an explicit visual tradeoff, with manual validation.

## 5. Required audit report

Provide one row per symbol and selected animation/state, plus separate rows for shared effects:

| Symbol / state | Asset / selected clip | Resting draws | Uncached animated min–peak | Peak additional / instance | Simultaneous instances | Concurrent additional potential | Priority | Estimated cache MiB | Recommendation / current status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Fill every reachable symbol, including static-only ones | Exact key / name, or static | Baseline | Sample or labeled bound | Animated minus baseline | Legal count or labeled scenario | Sum without double-counting | Individual and concurrent | Unique frames, not instances | Cache / keep live / review, with reason |

List unresolved or missing assets explicitly. Do not invent animation names, legal symbol counts, or memory figures to complete the table. End with forced-caching candidates first, then high-priority candidates and low-cost visuals that should remain live.

## Rainbow Fist reference audit

Source: `rainbow_fist/src/sidegames/scratch/symbolMap.ts`, `ScratchPanel.ts`, and `ScratchDesktopHost.ts`. Counts below were checked on 2026-10-16 using the installed Spine runtime and the scratch triangle renderer with transparent-slot culling, caching bypassed, and a mock Canvas context. Spine clips were sampled at 60 fps. These are headless paint-call samples, not browser performance measurements.

All nine mapped symbols use a static image at rest, costing one output draw per cell. Only Symbol0, Symbol1, and Symbol2 have reachable symbol win clips through this map. Symbol3 and Symbol4 are preloaded but are not mapped scratch symbols.

| Scratch symbol / display | Actual win visual | Uncached animated draws / instance | Peak additional / instance | Per-instance priority | Current status |
| --- | --- | --- | --- | --- | --- |
| Blank | `dijoker_face`, static | 1 | 0 | Low | Keep static; no win animation. |
| Star / x1 | `Symbol2_RF_win` | 4–957 | 956 | High | Already cached; three matching instances elevate the concurrent case to Force. |
| Ms1 / +x2 | `Symbol1_RF_win` | 0–337 | 336 | High | Already cached. |
| Ms2 / +x3 | `Symbol0_RF_win` | 3610–3614 | 3613 | Force | Already cached. |
| Diamond / x2 | `symbol5` PNG, then shared Poof | At most 4 (derived bound) | 3 | Low | Keep live; no dedicated symbol Spine clip. |
| Crown / x5 | `symbol6` PNG, then shared Poof | At most 4 (derived bound) | 3 | Low | Keep live; no dedicated symbol Spine clip. |
| Gem / x10 | `symbol7` PNG, then shared Poof | At most 4 (derived bound) | 3 | Low | Keep live; no dedicated symbol Spine clip. |
| Coin / x25 | `symbol8` PNG, then shared Poof | At most 4 (derived bound) | 3 | Low | Keep live; no dedicated symbol Spine clip. |
| Jackpot | `symbol9` PNG, then shared Poof | At most 4 (derived bound) | 3 | Low | Keep live; no dedicated symbol Spine clip. |
| Shared fallback effect | `hit_effect` → `Poof_RF_Explosion` | 4 while the effect renders | 4 effect-only; already included in PNG rows | Low | Keep live; the PNG is hidden during this effect. |

The PNG fallback-cycle bound is derived from its hide/show scheduling and the sampled four-draw Poof clip. If the effect is unavailable, the static fallback adds no animation paint calls. The shared-effect row is explanatory and must not be added again to those symbol rows.

Three simultaneous x1 wins contribute a potential **2868 additional draws/frame** (`3 × (957 - 1)`), or 2871 animated draws before unrelated panel drawing. That concurrent case forces x1 caching; its individual result is already high priority. Determine other simultaneous counts from legal cards rather than assuming every grid cell can contain a special multiplier.

The existing cache harness measured about **26 MiB** of pixel data for the three cached win clips together at a 68-pixel cell size, 2× backing scale, and 60 fps. That is a reference configuration; measure again for other scales or additional clips. Normal-blend cached frames replay as at most one output image per instance; fully transparent frames can use zero draws.

Reproduce the current cache checks without launching the game:

```powershell
cd rainbow_fist
node --test tests/scratch-frame-cache.test.mjs
```

Those tests cover cache reuse, memory limits, disposal, placement, sampled geometry, and blend-layer ordering. They do not replace manual checks of visual quality, first-use smoothness, or browser memory.

See also the [Boobies Trap audit](../../boobies_trap/src/sidegames/scratch/CanvasAnimationAudit.md) for selective mesh caching, per-symbol costs, and memory estimates.
