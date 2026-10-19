import type { Scene } from 'phaser';

export const SAFE_GAME_WIDTH = 428;
export const SAFE_GAME_HEIGHT = 926;
/**
 * Fixed world width for the mobile mode (desktop uses {@link SAFE_GAME_WIDTH}).
 * Slightly wider than the 428 safe column so the filler background shows on the sides;
 * the whole world is always FIT into the screen — never cropped, never viewport-derived.
 * Tune here only.
 */
export const MOBILE_GAME_WIDTH = 460;
export const MAX_EXTENDED_GAME_WIDTH = 580;
export const MOBILE_FILLER_OVERSCAN_WIDTH = 8;
export const MOBILE_FILLER_UNDERSCAN_WIDTH = 32;
export const SAFE_AREA_FULL_HEIGHT_TOLERANCE = 4;

export type SafeArea = {
    left: number;
    right: number;
    top: number;
    bottom: number;
    width: number;
    height: number;
    centerX: number;
    centerY: number;
    fullWidth: number;
    fullHeight: number;
    fullCenterX: number;
    fullCenterY: number;
    extraWidth: number;
    isExtended: boolean;
};

const readScaleDimension = (value: unknown, fallback: number): number => {
    const numeric = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
    return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
};

export const getSafeArea = (scene: Scene): SafeArea => {
    const fullWidth = readScaleDimension(scene.scale?.width, SAFE_GAME_WIDTH);
    const fullHeight = readScaleDimension(scene.scale?.height, SAFE_GAME_HEIGHT);
    const width = Math.min(SAFE_GAME_WIDTH, fullWidth);
    const height = Math.min(SAFE_GAME_HEIGHT, fullHeight);
    const left = Math.max(0, (fullWidth - width) * 0.5);
    const top = Math.max(0, (fullHeight - height) * 0.5);

    return {
        left,
        right: left + width,
        top,
        bottom: top + height,
        width,
        height,
        centerX: left + width * 0.5,
        centerY: top + height * 0.5,
        fullWidth,
        fullHeight,
        fullCenterX: fullWidth * 0.5,
        fullCenterY: fullHeight * 0.5,
        extraWidth: Math.max(0, fullWidth - width),
        isExtended: fullWidth > width + 0.5,
    };
};

export type VisibleGameRect = {
    x: number;
    y: number;
    width: number;
    height: number;
};

const visibleRectFromSafeArea = (scene: Scene, gameW: number, gameH: number): VisibleGameRect => {
    const safe = getSafeArea(scene);
    return {
        x: safe.left,
        y: safe.top,
        width: Math.max(1, Math.min(gameW, safe.width)),
        height: Math.max(1, Math.min(gameH, safe.height)),
    };
};

const readPositiveDataset = (value: string | undefined): number => {
    const numeric = value ? Number(value) : NaN;
    return Number.isFinite(numeric) && numeric > 1 ? numeric : 0;
};

/** Shell slot size — aligned with MobileViewport (CSS vars / host dataset before DOM rects). */
const readViewportParentSize = (): { parentW: number; parentH: number } => {
    let parentW = 0;
    let parentH = 0;

    try {
        const rootStyle = getComputedStyle(document.documentElement);
        const cssW = Number.parseFloat(rootStyle.getPropertyValue('--tb-viewport-width'));
        const cssH = Number.parseFloat(rootStyle.getPropertyValue('--tb-viewport-height'));
        if (Number.isFinite(cssW) && cssW > 1) parentW = cssW;
        if (Number.isFinite(cssH) && cssH > 1) parentH = cssH;
    } catch {
        // no-op
    }

    if (parentW < 1 || parentH < 1) {
        try {
            const hostW = readPositiveDataset(document.documentElement.dataset?.tbHostViewportWidth);
            const hostH = readPositiveDataset(document.documentElement.dataset?.tbHostViewportHeight);
            if (hostW > 0) parentW = hostW;
            if (hostH > 0) parentH = hostH;
        } catch {
            // no-op
        }
    }

    if (parentW < 1 || parentH < 1) {
        try {
            const container = document.getElementById('game-container') ?? document.getElementById('root');
            const parentRect = container?.getBoundingClientRect();
            if (parentRect && parentRect.width > 1 && parentRect.height > 1) {
                parentW = parentRect.width;
                parentH = parentRect.height;
            }
        } catch {
            // no-op
        }
    }

    return { parentW, parentH };
};

/**
 * Game-space column actually on screen while the extended canvas is height-fit (ENVELOP)
 * and clipped at the sides: `gameH × (parentW / parentH)` wide, centered. This is the
 * *real* visible width (slightly more than the 428 safe column on most phones) so
 * full-bleed assets — backgrounds, cover spines, menu panels — reach the screen edges
 * instead of stopping at the safe column. HUD anchoring clamps it to the safe column
 * separately (see {@link getVisibleGameRect}).
 */
const computeHeightCoverVisibleRect = (
    gameW: number,
    gameH: number,
    parentW: number,
    parentH: number,
): VisibleGameRect => {
    let visibleW = parentW > 0 && parentH > 0 ? gameH * (parentW / parentH) : SAFE_GAME_WIDTH;
    visibleW = Math.max(1, Math.min(gameW, visibleW));
    return {
        x: (gameW - visibleW) * 0.5,
        y: 0,
        width: visibleW,
        height: gameH,
    };
};

/**
 * Both modes (desktop 428 / mobile MOBILE_GAME_WIDTH) are plain Phaser FIT — the whole
 * world is on screen — except mobile *fullscreen*, where MobileViewport ignores the
 * extended width and height-fits (ENVELOP), publishing 'height-cover'.
 */
const isHeightCoverViewport = (_gameW: number, _gameH: number, _parentW: number, _parentH: number): boolean => {
    return (document.documentElement.dataset?.tbActiveGameWidthMode ?? '') === 'height-cover';
};

/**
 * Game-space rectangle that is actually on screen after Phaser FIT / ENVELOP crop.
 * Height-cover (ENVELOP) scales the canvas larger than the parent and clips the sides;
 * UI that uses full `scale.width` then overflows.
 */
export const getVisibleGameRect = (scene: Scene): VisibleGameRect => {
    const gameW = readScaleDimension(scene.scale?.width, SAFE_GAME_WIDTH);
    const gameH = readScaleDimension(scene.scale?.height, SAFE_GAME_HEIGHT);
    const { parentW: parentWRaw, parentH: parentHRaw } = readViewportParentSize();
    let parentW = parentWRaw;
    let parentH = parentHRaw;

    const isMobileUi = document.documentElement.dataset?.tbMobileUi === 'true';
    const isExtended = gameW > SAFE_GAME_WIDTH + 0.5;
    const heightCover = isHeightCoverViewport(gameW, gameH, parentW, parentH);

    if (isExtended && heightCover) {
        if (parentW > 1 && parentH > 1) {
            // HUD / playfield anchors stay in the safe column even if a bit more is visible.
            const rect = computeHeightCoverVisibleRect(gameW, gameH, parentW, parentH);
            const width = Math.max(1, Math.min(rect.width, SAFE_GAME_WIDTH));
            return { x: (gameW - width) * 0.5, y: rect.y, width, height: rect.height };
        }
        return visibleRectFromSafeArea(scene, gameW, gameH);
    }

    let displayW = 0;
    let displayH = 0;

    try {
        const canvas = scene.game?.canvas;
        const canvasRect = canvas?.getBoundingClientRect();
        if (canvasRect && canvasRect.width > 1 && canvasRect.height > 1) {
            displayW = canvasRect.width;
            displayH = canvasRect.height;
        }
    } catch {
        // no-op
    }

    if (displayW < 1 || displayH < 1) {
        displayW = readScaleDimension((scene.scale as any)?.displaySize?.width, 0);
        displayH = readScaleDimension((scene.scale as any)?.displaySize?.height, 0);
    }
    if (parentW < 1 || parentH < 1) {
        const parentSizeW = readScaleDimension((scene.scale as any)?.parentSize?.width, 0);
        const parentSizeH = readScaleDimension((scene.scale as any)?.parentSize?.height, 0);
        if (parentW < 1) parentW = parentSizeW;
        if (parentH < 1) parentH = parentSizeH;
    }
    if (displayW < 1 || displayH < 1) {
        displayW = parentW;
        displayH = parentH;
    }

    if (parentW < 1 || parentH < 1 || displayW < 1 || displayH < 1) {
        if (isExtended) {
            return visibleRectFromSafeArea(scene, gameW, gameH);
        }
        return { x: 0, y: 0, width: gameW, height: gameH };
    }

    const horizontalCrop = displayW > parentW + 1.5;
    const verticalCrop = displayH > parentH + 1.5;

    if (!horizontalCrop && !verticalCrop) {
        // Extended mobile layout without DOM overflow signal — still clamp to safe column.
        if (isExtended && isMobileUi) {
            return visibleRectFromSafeArea(scene, gameW, gameH);
        }
        return { x: 0, y: 0, width: gameW, height: gameH };
    }

    let visibleW = gameW;
    let visibleH = gameH;
    let x = 0;
    let y = 0;

    if (horizontalCrop) {
        visibleW = gameW * (parentW / displayW);
        x = (gameW - visibleW) * 0.5;
    }
    if (verticalCrop) {
        visibleH = gameH * (parentH / displayH);
        y = (gameH - visibleH) * 0.5;
    }

    if (isExtended) {
        visibleW = Math.min(visibleW, SAFE_GAME_WIDTH);
        x = (gameW - visibleW) * 0.5;
    }

    return {
        x,
        y,
        width: Math.max(1, Math.min(gameW, visibleW)),
        height: Math.max(1, Math.min(gameH, visibleH)),
    };
};

/** Menu / modal overlays — full canvas when FIT shows everything; safe column when cropped. */
export const getMenuViewportRect = (scene: Scene): VisibleGameRect => {
    const gameW = readScaleDimension(scene.scale?.width, SAFE_GAME_WIDTH);
    const gameH = readScaleDimension(scene.scale?.height, SAFE_GAME_HEIGHT);

    if (gameW <= SAFE_GAME_WIDTH + 0.5) {
        return getVisibleGameRect(scene);
    }

    const { parentW, parentH } = readViewportParentSize();
    const heightCover = isHeightCoverViewport(gameW, gameH, parentW, parentH);

    // FIT — entire extended canvas is visible (no side crop).
    if (!heightCover) {
        return { x: 0, y: 0, width: gameW, height: gameH };
    }

    if (parentW > 1 && parentH > 1) {
        return computeHeightCoverVisibleRect(gameW, gameH, parentW, parentH);
    }
    return visibleRectFromSafeArea(scene, gameW, gameH);
};

/** Scrollable body width inside a menu panel (panel width minus horizontal insets). */
export const resolveMenuContentWidth = (panelWidth: number): number => {
    const inset = getMenuContentHorizontalInset(panelWidth);
    return Math.max(1, panelWidth - inset * 2);
};

/** Horizontal inset for menu tab bodies — keeps section content off clipped edges. */
export const getMenuContentHorizontalInset = (panelWidth: number): number => {
    if (panelWidth >= 520) return 20;
    if (panelWidth >= 440) return 16;
    if (panelWidth >= 380) return 14;
    return Math.max(12, Math.round(panelWidth * 0.045));
};

export const safeX = (scene: Scene, legacyX: number): number => getSafeArea(scene).left + legacyX;
export const safeY = (scene: Scene, legacyY: number): number => getSafeArea(scene).top + legacyY;
export const safeFractionX = (scene: Scene, fraction: number): number => {
    const area = getSafeArea(scene);
    return area.left + area.width * fraction;
};
export const safeFractionY = (scene: Scene, fraction: number): number => {
    const area = getSafeArea(scene);
    return area.top + area.height * fraction;
};
export const safeCenterX = (scene: Scene): number => getSafeArea(scene).centerX;
export const safeCenterY = (scene: Scene): number => getSafeArea(scene).centerY;
export const safeRight = (scene: Scene, margin = 0): number => getSafeArea(scene).right - margin;
export const safeWidth = (scene: Scene): number => getSafeArea(scene).width;
