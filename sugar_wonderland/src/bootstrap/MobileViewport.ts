type PhaserGameLike = {
    canvas?: HTMLCanvasElement | null;
    events?: {
        once?: (eventName: string, handler: () => void) => void;
    };
    scale?: {
        fullscreenTarget?: HTMLElement;
        isFullscreen?: boolean;
        refresh?: () => void;
        on?: (eventName: string, handler: (...args: any[]) => void) => void;
        off?: (eventName: string, handler: (...args: any[]) => void) => void;
    };
};

type RegisteredGame = {
    game: PhaserGameLike;
    parentId: string;
};

type OrientationMode = 'portrait' | 'landscape';
type OrientationSource = 'viewport' | 'device' | 'host' | 'query' | 'fallback';

type ViewportState = {
    width: number;
    height: number;
    left: number;
    top: number;
    isLandscape: boolean;
    isPortrait: boolean;
    isMobileLike: boolean;
    shouldBlockOrientation: boolean;
    orientationSource: OrientationSource;
};

type FullscreenMode = 'none' | 'native' | 'soft';

export type MobileFullscreenState = {
    active: boolean;
    mode: FullscreenMode;
    nativeActive: boolean;
    softActive: boolean;
    nativeSupported: boolean;
    iOSLike: boolean;
};

type MobileViewportApi = {
    sync: () => void;
    getState: () => ViewportState;
    getFullscreenState: () => MobileFullscreenState;
    isFullscreen: () => boolean;
    requestFullscreen: () => Promise<MobileFullscreenState>;
    exitFullscreen: () => Promise<MobileFullscreenState>;
    toggleFullscreen: () => Promise<MobileFullscreenState>;
    showOrientationGate: () => void;
    hideOrientationGate: () => void;
    useAutomaticOrientationGate: () => void;
    setDesktopUi: (enabled: boolean) => void;
    setPhoneUi: (enabled: boolean) => void;
};

declare global {
    interface Window {
        tbMobileViewport?: MobileViewportApi;
        syncMobileViewport?: () => void;
        showOrientationGate?: () => void;
        hideOrientationGate?: () => void;
        useAutomaticOrientationGate?: () => void;
        requestMobileFullscreen?: () => Promise<MobileFullscreenState>;
        exitMobileFullscreen?: () => Promise<MobileFullscreenState>;
        toggleMobileFullscreen?: () => Promise<MobileFullscreenState>;
        tbSetDesktopUi?: (enabled: boolean) => void;
        tbSetPhoneUi?: (enabled: boolean) => void;
        showOrientationModal?: () => void;
        hideOrientationModal?: () => void;
        syncOrientationModal?: () => void;
    }
}

const GATE_ID = 'mobile-orientation-gate';
const SHELL_STYLE_ID = 'tb-mobile-viewport-shell-style';
const GAME_ID = 'sugar_wonderland';
const FORCE_DESKTOP_KEY = 'tb_force_desktop_behavior';
const FORCE_PHONE_KEY = 'tb_force_phone_ui';
const DISABLE_ORIENTATION_GATE_KEY = 'tb_disable_orientation_gate';
const FORCE_PHONE_QUERY_KEYS = ['tbPhoneUi', 'tb_phone_ui', 'tbForcePhone', 'forcePhone', 'forceMobile'];
const FORCE_DESKTOP_QUERY_KEYS = ['tbDesktopUi', 'tb_desktop_ui', 'tbForceDesktop', 'forceDesktop'];
const DISABLE_GATE_QUERY_KEYS = ['tbDisableOrientationGate', 'disableOrientationGate'];
const ORIENTATION_QUERY_KEYS = ['tbOrientation', 'tb_orientation', 'orientation', 'screenOrientation', 'deviceOrientation'];
const FORCE_LANDSCAPE_QUERY_KEYS = ['tbForceLandscape', 'forceLandscape', 'landscape'];
const FORCE_PORTRAIT_QUERY_KEYS = ['tbForcePortrait', 'forcePortrait', 'portrait'];
const REFRESH_DELAYS = [0, 60, 160, 320, 640, 1000];
const INPUT_EVENTS = [
    'pointerdown',
    'pointermove',
    'pointerup',
    'pointercancel',
    'touchstart',
    'touchmove',
    'touchend',
    'touchcancel',
    'mousedown',
    'mousemove',
    'mouseup',
    'click',
    'dblclick',
    'contextmenu',
    'wheel',
    'keydown',
    'keyup',
];

const registeredGames = new Set<RegisteredGame>();
const refreshTimers = new Set<number>();
/**
 * >0 while refreshGames() is driving Phaser's ScaleManager (refresh).
 * Phaser emits Scale RESIZE unconditionally from refresh(); without this guard the
 * RESIZE listener (onScaleResize → sync → scheduleRefresh) re-arms the 0 ms timer and
 * the pass cascade never settles — a perpetual ~120 pass/s loop that burned ~30% of
 * main-thread CPU (measured on a 4K portrait TV trace) and starved the frame budget.
 */
let refreshPassDepth = 0;

let syncQueuedTimerId: number | null = null;

let latestState: ViewportState = {
    width: 1,
    height: 1,
    left: 0,
    top: 0,
    isLandscape: false,
    isPortrait: true,
    isMobileLike: false,
    shouldBlockOrientation: false,
    orientationSource: 'fallback',
};
let started = false;
let listenersInstalled = false;
let gateOpen = false;
let manualGate: boolean | null = null;
let softFullscreen = false;
let hostOrientation: OrientationMode | null = null;
let hostMobileLike: boolean | null = null;
let shellObserver: MutationObserver | null = null;
let shellObserverSyncing = false;

const safeStorageGet = (key: string): string | null => {
    try {
        return window.localStorage.getItem(key);
    } catch {
        return null;
    }
};

const safeStorageSet = (key: string, enabled: boolean): void => {
    try {
        if (enabled) {
            window.localStorage.setItem(key, '1');
        } else {
            window.localStorage.removeItem(key);
        }
    } catch {
        // Storage may be blocked in embedded/private contexts.
    }
};

const isStorageEnabled = (key: string): boolean => safeStorageGet(key) === '1';

const queryFlagEnabled = (keys: string[]): boolean => {
    try {
        const params = new URLSearchParams(window.location.search || '');
        return keys.some((key) => {
            const value = params.get(key);
            if (value == null) return false;
            const normalized = value.trim().toLowerCase();
            return normalized === '' || normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
        });
    } catch {
        return false;
    }
};

const queryValueMatches = (key: string, values: string[]): boolean => {
    try {
        const value = new URLSearchParams(window.location.search || '').get(key);
        return value != null && values.includes(value.trim().toLowerCase());
    } catch {
        return false;
    }
};

const normalizeBoolean = (value: unknown): boolean | null => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value === 1 ? true : value === 0 ? false : null;
    if (typeof value !== 'string') return null;

    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on', 'mobile', 'phone', 'tablet', 'android', 'ios', 'iphone', 'ipad'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off', 'desktop'].includes(normalized)) return false;
    return null;
};

const normalizeOrientation = (value: unknown): OrientationMode | null => {
    if (typeof value === 'boolean') return value ? 'landscape' : 'portrait';
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) return null;
        return Math.abs(value) === 90 ? 'landscape' : 'portrait';
    }
    if (typeof value !== 'string') return null;

    const normalized = value.trim().toLowerCase();
    if (!normalized) return null;
    if (normalized.includes('landscape') || normalized === 'horizontal') return 'landscape';
    if (normalized.includes('portrait') || normalized === 'vertical') return 'portrait';
    return null;
};

const queryOrientationOverride = (): { mode: OrientationMode; source: OrientationSource } | null => {
    if (queryFlagEnabled(FORCE_LANDSCAPE_QUERY_KEYS)) return { mode: 'landscape', source: 'query' };
    if (queryFlagEnabled(FORCE_PORTRAIT_QUERY_KEYS)) return { mode: 'portrait', source: 'query' };

    try {
        const params = new URLSearchParams(window.location.search || '');
        for (const key of ORIENTATION_QUERY_KEYS) {
            const mode = normalizeOrientation(params.get(key));
            if (mode) return { mode, source: 'query' };
        }
    } catch {
        // no-op
    }
    return null;
};

const dimensionOrientation = (width: number, height: number, tolerance = 8): OrientationMode | null => {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
    if (width > height + tolerance) return 'landscape';
    if (height > width + tolerance) return 'portrait';
    return null;
};

const readScreenOrientation = (): OrientationMode | null => {
    try {
        return normalizeOrientation(screen.orientation?.type);
    } catch {
        return null;
    }
};

const readLegacyOrientation = (): OrientationMode | null => {
    try {
        return normalizeOrientation((window as any).orientation);
    } catch {
        return null;
    }
};

const safeMatchMedia = (query: string): boolean => {
    try {
        return !!window.matchMedia?.(query).matches;
    } catch {
        return false;
    }
};

const hasMobileDeviceHint = (): boolean => {
    const ua = navigator.userAgent || '';
    const mobileUa = /android|iphone|ipad|ipod|iemobile|blackberry|mobile/i.test(ua);
    const iPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
    const coarsePointer = safeMatchMedia('(pointer: coarse)');
    const noHover = safeMatchMedia('(hover: none)');
    const touchCapable = navigator.maxTouchPoints > 0 || 'ontouchstart' in window;

    return mobileUa || iPadOS || coarsePointer || noHover || touchCapable;
};

const detectMobileLike = (width: number, height: number): boolean => {
    if (queryFlagEnabled(FORCE_DESKTOP_QUERY_KEYS)) return false;
    if (queryFlagEnabled(FORCE_PHONE_QUERY_KEYS)) return true;
    if (isStorageEnabled(FORCE_DESKTOP_KEY)) return false;
    if (isStorageEnabled(FORCE_PHONE_KEY)) return true;
    if (hostMobileLike === false) return false;

    const ua = navigator.userAgent || '';
    const mobileUa = /android|iphone|ipad|ipod|iemobile|blackberry|mobile/i.test(ua);
    const iPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
    const coarsePointer = safeMatchMedia('(pointer: coarse)');
    const noHover = safeMatchMedia('(hover: none)');
    const touchCapable = navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
    const launchDeviceMobile = queryValueMatches('device', ['mobile', 'phone', 'tablet']);
    const dpr = Number(window.devicePixelRatio) || 1;
    const minSide = Math.min(width, height);
    const maxSide = Math.max(width, height);
    const screenMinSide = Math.min(screen.width || width, screen.height || height);
    const screenMaxSide = Math.max(screen.width || width, screen.height || height);
    const compactPhoneViewport = minSide <= 620 && maxSide <= 1180;
    const compactTabletViewport = minSide <= 900 && maxSide <= 1400;
    const deviceSizedLikeMobile = screenMinSide <= 900 && screenMaxSide <= 1400;
    const desktopPointerProfile = !mobileUa && !iPadOS && !touchCapable && safeMatchMedia('(pointer: fine)') && safeMatchMedia('(hover: hover)');
    const devToolsMobileEmulation = compactTabletViewport && dpr >= 1.25 && safeMatchMedia('(max-width: 1200px)') && !desktopPointerProfile;
    const pointerMobileLike = (coarsePointer || noHover) && compactTabletViewport;
    const touchCompactMobileLike = touchCapable && deviceSizedLikeMobile && compactTabletViewport;
    const compactPhoneMobileLike = compactPhoneViewport && (
        mobileUa ||
        iPadOS ||
        pointerMobileLike ||
        touchCompactMobileLike
    );
    const launcherMobileHint = launchDeviceMobile && (
        mobileUa ||
        iPadOS ||
        pointerMobileLike ||
        touchCompactMobileLike ||
        devToolsMobileEmulation ||
        compactPhoneMobileLike
    );
    const hostMobileHint = hostMobileLike === true && (
        mobileUa ||
        iPadOS ||
        pointerMobileLike ||
        touchCompactMobileLike ||
        devToolsMobileEmulation ||
        compactPhoneMobileLike
    );

    return (
        hostMobileHint ||
        mobileUa ||
        iPadOS ||
        pointerMobileLike ||
        launcherMobileHint ||
        touchCompactMobileLike ||
        devToolsMobileEmulation ||
        compactPhoneMobileLike
    );
};

const orientationGateDisabled = (): boolean => {
    return isStorageEnabled(DISABLE_ORIENTATION_GATE_KEY) || queryFlagEnabled(DISABLE_GATE_QUERY_KEYS);
};

const detectOrientation = (
    width: number,
    height: number,
    isMobileLike: boolean,
): { mode: OrientationMode; source: OrientationSource } => {
    const queryOverride = queryOrientationOverride();
    if (queryOverride) return queryOverride;

    const viewportMode = dimensionOrientation(width, height);
    const legacyMode = readLegacyOrientation();
    const screenMode = readScreenOrientation();
    const mediaLandscape = safeMatchMedia('(orientation: landscape)');
    const mediaPortrait = safeMatchMedia('(orientation: portrait)');
    const mediaMode = mediaLandscape ? 'landscape' : mediaPortrait ? 'portrait' : null;
    const outerMode = dimensionOrientation(window.outerWidth || 0, window.outerHeight || 0);
    const screenSizeMode = dimensionOrientation(Number(screen.width) || 0, Number(screen.height) || 0);
    const screenAvailMode = dimensionOrientation(Number(screen.availWidth) || 0, Number(screen.availHeight) || 0);
    const viewportPortraitBeatsLandscapeHint = isMobileLike &&
        (viewportMode === 'portrait' || mediaMode === 'portrait') &&
        legacyMode !== 'landscape' &&
        mediaMode !== 'landscape';

    if (hostOrientation === 'landscape' && !viewportPortraitBeatsLandscapeHint) return { mode: 'landscape', source: 'host' };
    if (legacyMode) return { mode: legacyMode, source: 'device' };
    if (screenMode === 'landscape' && !viewportPortraitBeatsLandscapeHint) return { mode: 'landscape', source: 'device' };
    if (viewportMode === 'landscape') return { mode: 'landscape', source: 'viewport' };
    if (mediaMode === 'landscape') return { mode: 'landscape', source: 'device' };
    if (viewportPortraitBeatsLandscapeHint) {
        return { mode: 'portrait', source: viewportMode === 'portrait' ? 'viewport' : 'device' };
    }

    if (isMobileLike || hasMobileDeviceHint()) {
        const landscapeHints = [outerMode, screenSizeMode, screenAvailMode].filter((mode) => mode === 'landscape').length;
        const portraitHints = [screenMode, viewportMode, mediaMode, outerMode, screenSizeMode, screenAvailMode]
            .filter((mode) => mode === 'portrait').length;

        if (landscapeHints >= 2 && landscapeHints >= portraitHints) {
            return { mode: 'landscape', source: 'device' };
        }
        if (outerMode === 'landscape' && screenMode !== 'portrait') {
            return { mode: 'landscape', source: 'device' };
        }
    }

    if (hostOrientation === 'portrait') return { mode: 'portrait', source: 'host' };
    if (screenMode) return { mode: screenMode, source: 'device' };
    if (viewportMode) return { mode: viewportMode, source: 'viewport' };
    if (mediaMode) return { mode: mediaMode, source: 'device' };
    return { mode: 'portrait', source: 'fallback' };
};

const detectIOSLike = (): boolean => {
    const ua = navigator.userAgent || '';
    return /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
};

const getFullscreenTarget = (): HTMLElement => {
    return (document.getElementById('root') as HTMLElement | null) || document.documentElement;
};

const getNativeFullscreenElement = (): Element | null => {
    const doc: any = document as any;
    return doc.fullscreenElement || doc.webkitFullscreenElement || doc.mozFullScreenElement || doc.msFullscreenElement || null;
};

const getGateHost = (): HTMLElement | null => {
    const fullscreenElement = getNativeFullscreenElement();
    if (fullscreenElement instanceof HTMLElement) return fullscreenElement;
    return document.body || null;
};

const isNativeFullscreenSupported = (): boolean => {
    const target: any = getFullscreenTarget() as any;
    return !!(
        target.requestFullscreen ||
        target.webkitRequestFullscreen ||
        target.mozRequestFullScreen ||
        target.msRequestFullscreen
    );
};

export const getMobileFullscreenState = (): MobileFullscreenState => {
    const nativeActive = !!getNativeFullscreenElement();
    const softActive = softFullscreen && !nativeActive;
    const mode: FullscreenMode = nativeActive ? 'native' : softActive ? 'soft' : 'none';

    return {
        active: nativeActive || softActive,
        mode,
        nativeActive,
        softActive,
        nativeSupported: isNativeFullscreenSupported(),
        iOSLike: detectIOSLike(),
    };
};

const getViewportState = (): ViewportState => {
    const vv = window.visualViewport;
    const width = Math.max(1, Math.round(vv?.width || window.innerWidth || document.documentElement.clientWidth || 1));
    const height = Math.max(1, Math.round(vv?.height || window.innerHeight || document.documentElement.clientHeight || 1));
    const left = Math.round(vv?.offsetLeft || 0);
    const top = Math.round(vv?.offsetTop || 0);
    const isMobileLike = detectMobileLike(width, height);
    const orientation = detectOrientation(width, height, isMobileLike);
    const isLandscape = orientation.mode === 'landscape';
    const isPortrait = !isLandscape;
    const autoBlock = !orientationGateDisabled() && isMobileLike && isLandscape;
    const shouldBlockOrientation = manualGate === null ? autoBlock : manualGate;

    return {
        width,
        height,
        left,
        top,
        isLandscape,
        isPortrait,
        isMobileLike,
        shouldBlockOrientation,
        orientationSource: orientation.source,
    };
};

const setCssVar = (name: string, value: string): void => {
    try {
        document.documentElement.style.setProperty(name, value);
    } catch {
        // no-op
    }
};

const setStyle = (el: HTMLElement | null | undefined, property: string, value: string, priority: 'important' | '' = ''): void => {
    if (!el) return;
    try {
        el.style.setProperty(property, value, priority);
    } catch {
        // no-op
    }
};

const ensureShellStyle = (): void => {
    if (!document.head || document.getElementById(SHELL_STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = SHELL_STYLE_ID;
    style.textContent = `
:root {
  --tb-shell-background-image: url("./fullscreen_bg.webp");
}
html,
body {
  background-color: #000000 !important;
  background-image: var(--tb-shell-background-image) !important;
  background-size: cover !important;
  background-position: center bottom !important;
  background-repeat: no-repeat !important;
  overflow: hidden !important;
}
#root {
  position: relative !important;
  z-index: 10 !important;
  background: transparent !important;
}
#root:fullscreen,
#root:-webkit-full-screen,
.tb-native-fullscreen,
.tb-soft-fullscreen {
  background-color: #000000 !important;
  background-image: var(--tb-shell-background-image) !important;
  background-size: cover !important;
  background-position: center bottom !important;
  background-repeat: no-repeat !important;
}
.background-container,
.background-image,
.background-container .background-image {
  display: none !important;
  visibility: hidden !important;
  pointer-events: none !important;
}
.mobile-orientation-gate {
  position: fixed !important;
  inset: var(--tb-viewport-top, 0px) auto auto var(--tb-viewport-left, 0px) !important;
  width: var(--tb-viewport-width, 100dvw) !important;
  height: var(--tb-viewport-height, 100dvh) !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  padding: max(24px, env(safe-area-inset-top)) max(24px, env(safe-area-inset-right)) max(24px, env(safe-area-inset-bottom)) max(24px, env(safe-area-inset-left)) !important;
  box-sizing: border-box !important;
  background: radial-gradient(circle at 50% 36%, rgba(102, 212, 73, 0.18), rgba(2, 7, 12, 0) 36%), rgba(2, 7, 12, 0.88) !important;
  color: #ffffff !important;
  font-family: Arial, Helvetica, sans-serif !important;
  text-align: center !important;
  pointer-events: auto !important;
  touch-action: none !important;
  user-select: none !important;
  -webkit-user-select: none !important;
  isolation: isolate !important;
  z-index: 2147483647 !important;
}
.mobile-orientation-gate[hidden],
.mobile-orientation-gate--hidden {
  display: none !important;
  visibility: hidden !important;
  pointer-events: none !important;
}
.mobile-orientation-gate__panel {
  width: min(320px, calc(var(--tb-viewport-width, 100dvw) - 48px)) !important;
  display: flex !important;
  flex-direction: column !important;
  align-items: center !important;
  justify-content: center !important;
  gap: clamp(10px, 2vmin, 18px) !important;
  text-align: center !important;
  transform: translateY(-2px) !important;
}
.mobile-orientation-gate__icon {
  position: relative !important;
  width: clamp(100px, 16vmin, 134px) !important;
  height: clamp(100px, 16vmin, 134px) !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  --gate-loop-duration: 2s;
}
.mobile-orientation-gate__circ-wrap {
  position: absolute !important;
  left: 50% !important;
  top: 50% !important;
  width: min(108%, 136px) !important;
  height: min(108%, 136px) !important;
  transform: translate(-50%, -50%) !important;
  opacity: 0;
  pointer-events: none !important;
  z-index: 0 !important;
  animation: tb-gate-seq-circ-fade var(--gate-loop-duration) ease-in-out infinite !important;
  filter: drop-shadow(0 0 12px rgba(102, 212, 73, 0.55)) drop-shadow(0 0 28px rgba(102, 212, 73, 0.25)) !important;
}
.mobile-orientation-gate__circ-spin {
  width: 100% !important;
  height: 100% !important;
  transform-origin: 50% 50% !important;
  will-change: transform !important;
  animation: tb-gate-seq-circ-spin var(--gate-loop-duration) linear infinite !important;
}
.mobile-orientation-gate__circ-svg {
  display: block !important;
  width: 100% !important;
  height: 100% !important;
  overflow: visible !important;
}
.mobile-orientation-gate__circ-path {
  filter: none !important;
}
.mobile-orientation-gate__phone {
  position: relative !important;
  z-index: 2 !important;
  width: clamp(32px, 5vmin, 44px) !important;
  height: clamp(52px, 8vmin, 70px) !important;
  border: clamp(3px, 0.45vmin, 4px) solid rgba(255, 255, 255, 0.96) !important;
  border-radius: clamp(10px, 1.5vmin, 14px) !important;
  box-sizing: border-box !important;
  background: rgba(255, 255, 255, 0.06) !important;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.1), 0 16px 34px rgba(0, 0, 0, 0.36) !important;
  transform-origin: 50% 50% !important;
  animation: tb-gate-seq-phone var(--gate-loop-duration) linear infinite, tb-gate-seq-phone-paint var(--gate-loop-duration) linear infinite !important;
}
.mobile-orientation-gate__phone::before {
  content: "" !important;
  position: absolute !important;
  left: 50% !important;
  top: 11% !important;
  width: 34% !important;
  height: 4% !important;
  border-radius: 999px !important;
  background: rgba(255, 255, 255, 0.82) !important;
  transform: translateX(-50%) !important;
  animation: tb-gate-seq-phone-detail var(--gate-loop-duration) linear infinite !important;
}
.mobile-orientation-gate__phone::after {
  content: "" !important;
  position: absolute !important;
  left: 50% !important;
  bottom: 11% !important;
  width: 16% !important;
  height: 10% !important;
  border-radius: 999px !important;
  background: #ffffff !important;
  transform: translateX(-50%) !important;
  animation: tb-gate-seq-phone-detail-solid var(--gate-loop-duration) linear infinite !important;
}
.mobile-orientation-gate__copy {
  display: block !important;
  color: #ffffff !important;
}
.mobile-orientation-gate__title {
  margin: 0 !important;
  font-family: Poppins-Bold, Arial, Helvetica, sans-serif !important;
  font-size: clamp(20px, 3.2vmin, 30px) !important;
  font-weight: 700 !important;
  line-height: 1.15 !important;
  color: #ffffff !important;
  text-shadow: 0 2px 12px rgba(0, 0, 0, 0.5) !important;
  white-space: nowrap !important;
}
.mobile-orientation-gate__text {
  margin: 8px 0 0 !important;
  font-family: Poppins-Regular, Arial, Helvetica, sans-serif !important;
  font-size: clamp(13px, 1.8vmin, 16px) !important;
  font-weight: 400 !important;
  line-height: 1.45 !important;
  color: rgba(255, 255, 255, 0.78) !important;
  max-width: 320px !important;
}
.tb-orientation-blocked #root {
  pointer-events: none !important;
}
@keyframes tb-gate-seq-phone {
  0%, 6% { transform: rotate(90deg); }
  28%, 62% { transform: rotate(0deg); }
  82%, 100% { transform: rotate(90deg); }
}
@keyframes tb-gate-seq-phone-paint {
  0%, 21% {
    border-color: rgba(255, 255, 255, 0.96);
    background: rgba(255, 255, 255, 0.06);
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.1), 0 16px 34px rgba(0, 0, 0, 0.36);
  }
  28%, 61% {
    border-color: #66d449;
    background: rgba(102, 212, 73, 0.12);
    box-shadow: 0 0 0 1px rgba(102, 212, 73, 0.45), 0 16px 34px rgba(0, 0, 0, 0.36), 0 0 14px rgba(102, 212, 73, 0.35);
  }
  69%, 100% {
    border-color: rgba(255, 255, 255, 0.96);
    background: rgba(255, 255, 255, 0.06);
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.1), 0 16px 34px rgba(0, 0, 0, 0.36);
  }
}
@keyframes tb-gate-seq-phone-detail {
  0%, 21% { background: rgba(255, 255, 255, 0.82); }
  28%, 61% { background: #66d449; }
  69%, 100% { background: rgba(255, 255, 255, 0.82); }
}
@keyframes tb-gate-seq-phone-detail-solid {
  0%, 21% { background: #ffffff; }
  28%, 61% { background: #66d449; }
  69%, 100% { background: #ffffff; }
}
@keyframes tb-gate-seq-circ-fade {
  0%, 5% {
    opacity: 0;
    transform: translate(-50%, -50%) scale(0.92);
  }
  14%, 58% {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1);
  }
  68%, 100% {
    opacity: 0;
    transform: translate(-50%, -50%) scale(0.94);
  }
}
@keyframes tb-gate-seq-circ-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(-360deg); }
}
@media (prefers-reduced-motion: reduce) {
  .mobile-orientation-gate__phone {
    animation: none !important;
    transform: rotate(0deg) !important;
    border-color: rgba(255, 255, 255, 0.96) !important;
    background: rgba(255, 255, 255, 0.06) !important;
  }
  .mobile-orientation-gate__phone::before,
  .mobile-orientation-gate__phone::after,
  .mobile-orientation-gate__circ-wrap,
  .mobile-orientation-gate__circ-spin {
    animation: none !important;
  }
  .mobile-orientation-gate__circ-wrap {
    opacity: 0.75 !important;
    transform: translate(-50%, -50%) scale(1) !important;
  }
}
`;
    document.head.appendChild(style);
};

const suppressLegacyBackgroundLayers = (): void => {
    try {
        document.querySelectorAll<HTMLElement>('.background-container, .background-image').forEach((el) => {
            setStyle(el, 'display', 'none', 'important');
            setStyle(el, 'visibility', 'hidden', 'important');
            setStyle(el, 'pointer-events', 'none', 'important');
            setStyle(el, 'z-index', '0', 'important');
            el.setAttribute('aria-hidden', 'true');
        });
    } catch {
        // no-op
    }
};

const applyBox = (el: HTMLElement | null | undefined, state: ViewportState): void => {
    if (!el) return;
    el.style.width = `${state.width}px`;
    el.style.height = `${state.height}px`;
    el.style.minHeight = `${state.height}px`;
    el.style.boxSizing = 'border-box';
};

const applyFixedViewportBox = (el: HTMLElement | null | undefined, state: ViewportState): void => {
    if (!el) return;
    el.style.top = `${state.top}px`;
    el.style.left = `${state.left}px`;
    el.style.width = `${state.width}px`;
    el.style.height = `${state.height}px`;
};

const applyTouchSafeStyles = (el: HTMLElement | null | undefined): void => {
    if (!el) return;
    el.style.touchAction = 'none';
    (el.style as any).msTouchAction = 'none';
    el.style.userSelect = 'none';
    (el.style as any).webkitUserSelect = 'none';
    (el.style as any).webkitTapHighlightColor = 'transparent';
    (el.style as any).overscrollBehavior = 'contain';
};

const applyFullscreenClasses = (): void => {
    const fullscreen = getMobileFullscreenState();
    const html = document.documentElement;
    const body = document.body;

    html.classList.toggle('tb-native-fullscreen', fullscreen.nativeActive);
    html.classList.toggle('tb-soft-fullscreen', fullscreen.softActive);
    html.dataset.tbFullscreen = fullscreen.mode;

    body?.classList.toggle('tb-native-fullscreen', fullscreen.nativeActive);
    body?.classList.toggle('tb-soft-fullscreen', fullscreen.softActive);
};

const applyViewportShell = (state: ViewportState): void => {
    ensureShellStyle();
    suppressLegacyBackgroundLayers();

    setCssVar('--tb-viewport-width', `${state.width}px`);
    setCssVar('--tb-viewport-height', `${state.height}px`);
    setCssVar('--tb-viewport-left', `${state.left}px`);
    setCssVar('--tb-viewport-top', `${state.top}px`);

    document.documentElement.classList.add('tb-viewport-managed');
    document.documentElement.dataset.tbMobileUi = state.isMobileLike ? 'true' : 'false';
    document.documentElement.dataset.tbOrientation = state.isLandscape ? 'landscape' : 'portrait';
    document.documentElement.dataset.tbOrientationSource = state.orientationSource;
    applyFullscreenClasses();

    const body = document.body;
    const root = document.getElementById('root') as HTMLElement | null;
    const app = document.getElementById('app') as HTMLElement | null;
    const container = document.getElementById('game-container') as HTMLElement | null;

    applyBox(body, state);
    applyBox(root, state);
    applyBox(app, state);
    applyBox(container, state);

    if (body) {
        setStyle(body, 'overflow', 'hidden', 'important');
        setStyle(body, 'position', body.style.position || 'relative');
        setStyle(body, 'isolation', 'isolate');
    }
    if (root) {
        setStyle(root, 'position', 'relative', 'important');
        setStyle(root, 'z-index', '10', 'important');
        root.style.display = root.style.display || 'flex';
        root.style.alignItems = root.style.alignItems || 'center';
        root.style.justifyContent = root.style.justifyContent || 'center';
    }
    if (app) {
        app.style.position = app.style.position || 'relative';
        app.style.zIndex = app.style.zIndex || '1';
    }
    if (container) {
        container.style.position = container.style.position || 'relative';
        container.style.zIndex = container.style.zIndex || '1';
        container.style.aspectRatio = '';
        container.style.maxWidth = `${state.width}px`;
        container.style.maxHeight = `${state.height}px`;
        container.style.overflow = 'hidden';
    }

    applyFixedViewportBox(document.getElementById('boot-loader') as HTMLElement | null, state);
    applyFixedViewportBox(document.getElementById(GATE_ID) as HTMLElement | null, state);
};

const ensureGate = (): HTMLElement | null => {
    if (!document.body) return null;

    ensureShellStyle();
    const gateHost = getGateHost();
    if (!gateHost) return null;

    let gate = document.getElementById(GATE_ID) as HTMLElement | null;
    if (gate) {
        if (gate.parentElement !== gateHost) {
            gateHost.appendChild(gate);
        }
        return gate;
    }

    gate = document.createElement('div');
    gate.id = GATE_ID;
    gate.className = 'mobile-orientation-gate mobile-orientation-gate--hidden';
    gate.setAttribute('role', 'dialog');
    gate.setAttribute('aria-modal', 'true');
    gate.setAttribute('aria-labelledby', 'mobile-orientation-gate-title');
    gate.setAttribute('aria-describedby', 'mobile-orientation-gate-description');
    gate.setAttribute('aria-hidden', 'true');
    gate.hidden = true;
    gate.innerHTML = [
        '<div class="mobile-orientation-gate__panel">',
        '<div class="mobile-orientation-gate__icon" aria-hidden="true">',
        '<div class="mobile-orientation-gate__circ-wrap">',
        '<div class="mobile-orientation-gate__circ-spin">',
        '<svg class="mobile-orientation-gate__circ-svg" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">',
        '<path class="mobile-orientation-gate__circ-path" fill="none" stroke="#66D449" stroke-width="3.25" stroke-linecap="round"',
        ' stroke-linejoin="round" d="M 50 13 A 37 37 0 1 1 13 50"/>',
        '<g class="mobile-orientation-gate__circ-arrow" transform="translate(50,13) rotate(180)" aria-hidden="true">',
        '<polygon points="-4,-4 -4,4 14,0" fill="#66D449"/>',
        '</g>',
        '</svg>',
        '</div>',
        '</div>',
        '<div class="mobile-orientation-gate__phone"></div>',
        '</div>',
        '<div class="mobile-orientation-gate__copy">',
        '<p id="mobile-orientation-gate-title" class="mobile-orientation-gate__title">Rotate to portrait</p>',
        '<p id="mobile-orientation-gate-description" class="mobile-orientation-gate__text">Please switch back to Portrait mode to continue the game.</p>',
        '</div>',
        '</div>',
    ].join('');

    gateHost.appendChild(gate);
    return gate;
};

const emitState = (state: ViewportState, reason = 'sync'): void => {
    const detail = { ...state, reason };
    try {
        window.dispatchEvent(new CustomEvent('tb-mobile-viewport:change', { detail }));
    } catch {
        // no-op
    }
    try {
        window.dispatchEvent(new CustomEvent('orientation-modal:change', {
            detail: {
                open: state.shouldBlockOrientation,
                reason,
                auto: manualGate === null,
            },
        }));
    } catch {
        // Legacy compatibility for older ports.
    }
    try {
        if (window.parent && window.parent !== window) {
            window.parent.postMessage({
                type: 'dijoker:game-orientation',
                game: GAME_ID,
                blocked: state.shouldBlockOrientation,
                orientation: state.isLandscape ? 'landscape' : 'portrait',
                orientationSource: state.orientationSource,
                viewport: {
                    width: state.width,
                    height: state.height,
                    left: state.left,
                    top: state.top,
                },
            }, '*');
        }
    } catch {
        // Embedded providers may block parent access.
    }
};

const emitFullscreenState = (): void => {
    const detail = getMobileFullscreenState();
    try {
        window.dispatchEvent(new CustomEvent('tb-mobile-fullscreen:change', { detail }));
    } catch {
        // no-op
    }
    try {
        if (window.parent && window.parent !== window) {
            window.parent.postMessage({
                type: 'dijoker:game-fullscreen',
                game: GAME_ID,
                active: detail.active,
                mode: detail.mode,
                nativeActive: detail.nativeActive,
                softActive: detail.softActive,
                nativeSupported: detail.nativeSupported,
                iOSLike: detail.iOSLike,
                viewport: {
                    width: latestState.width,
                    height: latestState.height,
                    left: latestState.left,
                    top: latestState.top,
                },
            }, '*');
        }
    } catch {
        // Embedded providers may block parent access.
    }
};

const setGate = (open: boolean, state: ViewportState): boolean => {
    const gate = ensureGate();
    if (!gate) return false;

    const changed = open !== gateOpen;
    gateOpen = open;
    gate.hidden = !open;
    gate.classList.toggle('mobile-orientation-gate--hidden', !open);
    gate.setAttribute('aria-hidden', open ? 'false' : 'true');
    setStyle(gate, 'display', open ? 'flex' : 'none', 'important');
    setStyle(gate, 'visibility', open ? 'visible' : 'hidden', 'important');
    setStyle(gate, 'pointer-events', open ? 'auto' : 'none', 'important');
    setStyle(gate, 'z-index', '2147483647', 'important');
    applyFixedViewportBox(gate, state);

    document.documentElement.classList.toggle('tb-orientation-blocked', open);
    document.body?.classList.toggle('tb-orientation-blocked', open);

    const root = document.getElementById('root') as any;
    if (root) {
        try {
            root.inert = false;
            root.removeAttribute('inert');
            if (!open) root.removeAttribute('aria-hidden');
        } catch {
            if (!open) root.removeAttribute('aria-hidden');
        }
    }

    if (open) {
        try {
            const active = document.activeElement as HTMLElement | null;
            active?.blur?.();
        } catch {
            // no-op
        }
    }

    if (changed) {
        emitState(state, open ? 'orientation-gate-open' : 'orientation-gate-close');
    }
    return changed;
};

const refreshGames = (): void => {
    registeredGames.forEach((entry) => {
        const root = document.getElementById('root') as HTMLElement | null;
        const container = document.getElementById(entry.parentId) as HTMLElement | null;
        const canvas = entry.game.canvas || null;

        try {
            if (root && entry.game.scale) {
                entry.game.scale.fullscreenTarget = root;
            }
        } catch {
            // no-op
        }

        applyTouchSafeStyles(root);
        applyTouchSafeStyles(container);
        applyTouchSafeStyles(canvas);

        try {
            if (canvas && !canvas.hasAttribute('tabindex')) {
                canvas.setAttribute('tabindex', '0');
            }
        } catch {
            // no-op
        }

        refreshPassDepth += 1;
        try {
            entry.game.scale?.refresh?.();
        } catch {
            // no-op
        } finally {
            refreshPassDepth -= 1;
        }
    });
};

const hasStateChanged = (previous: ViewportState, next: ViewportState): boolean => {
    return (
        previous.width !== next.width
        || previous.height !== next.height
        || previous.left !== next.left
        || previous.top !== next.top
        || previous.isLandscape !== next.isLandscape
        || previous.isPortrait !== next.isPortrait
        || previous.isMobileLike !== next.isMobileLike
        || previous.shouldBlockOrientation !== next.shouldBlockOrientation
        || previous.orientationSource !== next.orientationSource
    );
};

const runRefreshPass = (): void => {
    const nextState = getViewportState();
    const stateChanged = hasStateChanged(latestState, nextState);
    latestState = nextState;
    if (stateChanged) {
        applyViewportShell(latestState);
    }
    setGate(latestState.shouldBlockOrientation, latestState);
    refreshGames();
};

const scheduleRefresh = (): void => {
    if (refreshTimers.size > 0) {
        return;
    }
    REFRESH_DELAYS.forEach((delay) => {
        const timerId = window.setTimeout(() => {
            refreshTimers.delete(timerId);
            runRefreshPass();
        }, delay);
        refreshTimers.add(timerId);
    });
};

const performSync = (): void => {
    const nextState = getViewportState();
    const stateChanged = hasStateChanged(latestState, nextState);
    latestState = nextState;
    if (stateChanged) {
        applyViewportShell(latestState);
    }
    const gateChanged = setGate(latestState.shouldBlockOrientation, latestState);
    if (stateChanged && !gateChanged) {
        emitState(latestState, 'sync');
    }
    refreshGames();
    scheduleRefresh();
};

const sync = (): void => {
    if (syncQueuedTimerId != null) {
        return;
    }
    syncQueuedTimerId = window.setTimeout(() => {
        syncQueuedTimerId = null;
        performSync();
    }, 0);
};

const isGateActuallyOpen = (): boolean => {
    const gate = document.getElementById(GATE_ID) as HTMLElement | null;
    return !!(
        gateOpen &&
        gate &&
        !gate.hidden &&
        gate.getAttribute('aria-hidden') !== 'true' &&
        !gate.classList.contains('mobile-orientation-gate--hidden')
    );
};

const blockInputWhenGateOpen = (event: Event): void => {
    if (!isGateActuallyOpen()) return;
    try {
        if (event.cancelable) event.preventDefault();
    } catch {
        // no-op
    }
    try {
        event.stopImmediatePropagation();
    } catch {
        event.stopPropagation();
    }
};

const handleFullscreenChange = (): void => {
    if (getNativeFullscreenElement()) {
        softFullscreen = false;
    }
    applyFullscreenClasses();
    sync();
    emitFullscreenState();
};

const readMessagePayload = (raw: unknown): Record<string, any> | null => {
    if (!raw) return null;
    if (typeof raw === 'string') {
        try {
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === 'object' ? parsed as Record<string, any> : null;
        } catch {
            return null;
        }
    }
    return typeof raw === 'object' ? raw as Record<string, any> : null;
};

const handleHostMessage = (event: MessageEvent): void => {
    const data = readMessagePayload(event.data);
    if (!data) return;

    const nested = readMessagePayload(data.payload) || readMessagePayload(data.detail) || {};
    const orientation = normalizeOrientation(
        data.orientation ??
        data.deviceOrientation ??
        data.screenOrientation ??
        data.mode ??
        nested.orientation ??
        nested.deviceOrientation ??
        nested.screenOrientation,
    );
    const mobileLike = normalizeBoolean(
        data.mobile ??
        data.isMobile ??
        data.mobileLike ??
        data.deviceMobile ??
        data.device ??
        nested.mobile ??
        nested.isMobile ??
        nested.mobileLike ??
        nested.device,
    );

    if (!orientation && mobileLike === null) return;

    let changed = false;
    if (orientation && orientation !== hostOrientation) {
        hostOrientation = orientation;
        changed = true;
    }
    if (mobileLike !== null && mobileLike !== hostMobileLike) {
        hostMobileLike = mobileLike;
        changed = true;
    }

    if (changed) {
        sync();
    }
};

const installShellObserver = (): void => {
    if (shellObserver || !document.body || typeof MutationObserver === 'undefined') return;
    try {
        shellObserver = new MutationObserver(() => {
            if (shellObserverSyncing) return;
            shellObserverSyncing = true;
            window.requestAnimationFrame(() => {
                try {
                    suppressLegacyBackgroundLayers();
                    applyViewportShell(latestState);
                    setGate(latestState.shouldBlockOrientation, latestState);
                } finally {
                    shellObserverSyncing = false;
                }
            });
        });
        shellObserver.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'inert'],
        });
    } catch {
        shellObserver = null;
    }
};

const announceViewportReady = (): void => {
    try {
        if (window.parent && window.parent !== window) {
            window.parent.postMessage({
                type: 'dijoker:game-viewport-ready',
                game: GAME_ID,
                wants: ['orientation', 'fullscreen', 'viewport'],
                viewport: {
                    width: latestState.width,
                    height: latestState.height,
                    left: latestState.left,
                    top: latestState.top,
                },
            }, '*');
        }
    } catch {
        // Embedded providers may block parent access.
    }
};

const installGlobalListeners = (): void => {
    if (listenersInstalled) return;
    listenersInstalled = true;

    window.addEventListener('resize', sync, { passive: true });
    window.addEventListener('orientationchange', sync as EventListener, { passive: true });
    window.addEventListener('pageshow', sync, { passive: true });
    window.addEventListener('focus', sync, { passive: true });
    window.addEventListener('message', handleHostMessage);
    document.addEventListener('visibilitychange', sync, { passive: true });
    document.addEventListener('fullscreenchange', handleFullscreenChange, { passive: true });
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange as EventListener, { passive: true } as AddEventListenerOptions);

    try {
        window.visualViewport?.addEventListener('resize', sync, { passive: true });
        window.visualViewport?.addEventListener('scroll', sync, { passive: true });
    } catch {
        // no-op
    }

    try {
        screen.orientation?.addEventListener?.('change', sync as EventListener, { passive: true } as AddEventListenerOptions);
    } catch {
        // no-op
    }

    INPUT_EVENTS.forEach((eventName) => {
        document.addEventListener(eventName, blockInputWhenGateOpen, { capture: true, passive: false });
    });
};

const start = (): void => {
    if (started) return;
    started = true;
    ensureShellStyle();
    suppressLegacyBackgroundLayers();
    ensureGate();
    installGlobalListeners();
    installShellObserver();
    sync();
    announceViewportReady();
};

const requestPortraitLock = async (): Promise<void> => {
    try {
        if (screen.orientation?.lock) {
            await screen.orientation.lock('portrait');
        }
    } catch {
        // Unsupported on iOS Safari and most non-fullscreen iframe contexts.
    }
};

const scrollToViewportOrigin = (): void => {
    try {
        window.scrollTo(0, 0);
    } catch {
        // no-op
    }
};

const setSoftFullscreen = (enabled: boolean): void => {
    softFullscreen = enabled;
    applyFullscreenClasses();
    scrollToViewportOrigin();
    sync();
    emitFullscreenState();
};

const requestNativeFullscreen = async (): Promise<boolean> => {
    const target: any = getFullscreenTarget() as any;
    try {
        if (target.requestFullscreen) {
            await target.requestFullscreen({ navigationUI: 'hide' });
            return true;
        }
        if (target.webkitRequestFullscreen) {
            await target.webkitRequestFullscreen();
            return true;
        }
        if (target.mozRequestFullScreen) {
            await target.mozRequestFullScreen();
            return true;
        }
        if (target.msRequestFullscreen) {
            await target.msRequestFullscreen();
            return true;
        }
    } catch {
        try {
            if (target.requestFullscreen) {
                await target.requestFullscreen();
                return true;
            }
        } catch {
            // Unsupported, denied, or blocked by iframe/browser policy.
        }
    }
    return false;
};

const exitNativeFullscreen = async (): Promise<void> => {
    const doc: any = document as any;
    try {
        if (doc.exitFullscreen && getNativeFullscreenElement()) {
            await doc.exitFullscreen();
            return;
        }
        if (doc.webkitExitFullscreen && getNativeFullscreenElement()) {
            await doc.webkitExitFullscreen();
            return;
        }
        if (doc.mozCancelFullScreen && getNativeFullscreenElement()) {
            await doc.mozCancelFullScreen();
            return;
        }
        if (doc.msExitFullscreen && getNativeFullscreenElement()) {
            await doc.msExitFullscreen();
        }
    } catch {
        // no-op
    }
};

export const requestMobileFullscreen = async (): Promise<MobileFullscreenState> => {
    try {
        if (window.parent && window.parent !== window) {
            window.parent.postMessage({
                type: 'dijoker:game-fullscreen-request',
                game: GAME_ID,
                requested: true,
            }, '*');
        }
    } catch {
        // Embedded providers may block parent access.
    }

    const usedNativeFullscreen = await requestNativeFullscreen();
    if (usedNativeFullscreen) {
        softFullscreen = false;
        applyFullscreenClasses();
        scrollToViewportOrigin();
        await requestPortraitLock();
        sync();
        emitFullscreenState();
        return getMobileFullscreenState();
    }

    setSoftFullscreen(true);
    return getMobileFullscreenState();
};

export const exitMobileFullscreen = async (): Promise<MobileFullscreenState> => {
    if (getNativeFullscreenElement()) {
        await exitNativeFullscreen();
    }
    if (softFullscreen) {
        softFullscreen = false;
    }
    applyFullscreenClasses();
    scrollToViewportOrigin();
    sync();
    emitFullscreenState();
    return getMobileFullscreenState();
};

export const toggleMobileFullscreen = async (): Promise<MobileFullscreenState> => {
    return getMobileFullscreenState().active ? exitMobileFullscreen() : requestMobileFullscreen();
};

export const registerMobileViewportGame = (
    game: PhaserGameLike,
    options: { parent?: string } = {},
): (() => void) => {
    const parentId = options.parent || 'game-container';
    const entry: RegisteredGame = { game, parentId };
    let cleaned = false;

    registeredGames.add(entry);

    const preventCanvasGesture = (event: Event): void => {
        try {
            if (event.cancelable) event.preventDefault();
        } catch {
            // no-op
        }
    };
    const onLeaveFullscreen = (): void => {
        try {
            game.canvas?.focus?.();
        } catch {
            // no-op
        }
    };
    const onScaleResize = (): void => {
        // RESIZE caused by our own refresh pass: shell/gate/state were just applied by
        // runRefreshPass, and the remaining REFRESH_DELAYS timers are still armed.
        // Re-syncing here would clear + re-arm them forever (see refreshPassDepth).
        if (refreshPassDepth > 0) return;
        sync();
    };

    try {
        const canvas = game.canvas || null;
        canvas?.addEventListener('touchstart', preventCanvasGesture, { passive: false });
        canvas?.addEventListener('touchmove', preventCanvasGesture, { passive: false });
        canvas?.addEventListener('touchend', preventCanvasGesture, { passive: false });
        canvas?.addEventListener('touchcancel', preventCanvasGesture, { passive: false });
    } catch {
        // no-op
    }

    try {
        game.scale?.on?.('leavefullscreen', onLeaveFullscreen);
        game.scale?.on?.('enterfullscreen', requestPortraitLock);
        game.scale?.on?.('resize', onScaleResize);
    } catch {
        // no-op
    }

    const cleanup = (): void => {
        if (cleaned) return;
        cleaned = true;
        registeredGames.delete(entry);
        try {
            const canvas = game.canvas || null;
            canvas?.removeEventListener('touchstart', preventCanvasGesture);
            canvas?.removeEventListener('touchmove', preventCanvasGesture);
            canvas?.removeEventListener('touchend', preventCanvasGesture);
            canvas?.removeEventListener('touchcancel', preventCanvasGesture);
        } catch {
            // no-op
        }
        try {
            game.scale?.off?.('leavefullscreen', onLeaveFullscreen);
            game.scale?.off?.('enterfullscreen', requestPortraitLock);
            game.scale?.off?.('resize', onScaleResize);
        } catch {
            // no-op
        }
    };

    try {
        game.events?.once?.('destroy', cleanup);
    } catch {
        // no-op
    }

    sync();
    return cleanup;
};

const setManualGate = (value: boolean | null): void => {
    manualGate = value;
    sync();
};

const setDesktopUi = (enabled: boolean): void => {
    safeStorageSet(FORCE_DESKTOP_KEY, enabled);
    if (enabled) safeStorageSet(FORCE_PHONE_KEY, false);
    sync();
};

const setPhoneUi = (enabled: boolean): void => {
    safeStorageSet(FORCE_PHONE_KEY, enabled);
    if (enabled) safeStorageSet(FORCE_DESKTOP_KEY, false);
    sync();
};

const api: MobileViewportApi = {
    sync,
    getState: () => ({ ...latestState }),
    getFullscreenState: getMobileFullscreenState,
    isFullscreen: () => getMobileFullscreenState().active,
    requestFullscreen: requestMobileFullscreen,
    exitFullscreen: exitMobileFullscreen,
    toggleFullscreen: toggleMobileFullscreen,
    showOrientationGate: () => setManualGate(true),
    hideOrientationGate: () => setManualGate(false),
    useAutomaticOrientationGate: () => setManualGate(null),
    setDesktopUi,
    setPhoneUi,
};

window.tbMobileViewport = api;
window.syncMobileViewport = api.sync;
window.showOrientationGate = api.showOrientationGate;
window.hideOrientationGate = api.hideOrientationGate;
window.useAutomaticOrientationGate = api.useAutomaticOrientationGate;
window.requestMobileFullscreen = api.requestFullscreen;
window.exitMobileFullscreen = api.exitFullscreen;
window.toggleMobileFullscreen = api.toggleFullscreen;
window.tbSetDesktopUi = api.setDesktopUi;
window.tbSetPhoneUi = api.setPhoneUi;

// Compatibility with the previous guide/helpers.
window.showOrientationModal = api.showOrientationGate;
window.hideOrientationModal = api.hideOrientationGate;
window.syncOrientationModal = api.sync;

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
    start();
}

export {};
