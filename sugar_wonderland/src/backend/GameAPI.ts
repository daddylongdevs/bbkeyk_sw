/// <reference types="vite/client" />
import { setDecimalPlaces } from "../utils/NumberPrecisionFormatter";
import { readWalletTimestamp } from "../utils/BalanceDisplayEpoch";
import {
    FreeRoundStatus,
    resolveFreeRoundStatus,
    type FreeRoundBetResponseDto as CoreFreeRoundBetResponse,
    type FreeRoundCountUpdateDto,
    type HistoryItemDto,
    type InitFreeSpinRoundDto,
    type LocalizationDataDto,
    type ReplayDataDto as CoreReplayData,
    type ReplayDateTimeDto,
    type SlotInitializeDataDto as CoreSlotInitializeData,
    type UnresolvedSpinDto as CoreUnresolvedSpin,
} from "@core/dto";
import { SpinData, type SlotData, resolveMaxWinRemainingFreespinItems } from "./SpinData";
import { GameData } from "../game/components/GameData";
import { gameStateManager } from "../managers/GameStateManager";
import { SoundEffectType } from "../managers/AudioManager";
import { checkAndHandleModal, showIdleSessionExpiredModal, type BackendErrorResponse } from "../managers/ModalManager";
import { gameEventManager, GameEventType } from "../event/EventManager";
import { resolveLocalizedLogoLanguage, type LocalizedLogoLanguage } from "@core/utils/LocalizedLogo";
import { claimPlayInstance, getPlayInstanceClaimedAt, isPlayInstanceReplaced, markPlayInstanceReplaced } from "./PlayInstanceLock";

export type SlotInitializeData = CoreSlotInitializeData<SpinData>;
export type UnresolvedSpin = CoreUnresolvedSpin<SpinData>;
export type ReplayData = CoreReplayData<SpinData>;
export type FreeRoundBetResponse = CoreFreeRoundBetResponse<SlotData>;
export { FreeRoundStatus, resolveFreeRoundStatus };
export type { HistoryItemDto, InitFreeSpinRoundDto, LocalizationDataDto, ReplayDateTimeDto, FreeRoundCountUpdateDto };

const spinDataSampleAssetUrls = import.meta.glob("../game/spinDataSample/*.json", {
    query: "?url",
    import: "default",
    eager: true,
}) as Record<string, string>;

const SAMPLE_DATA_URL_BY_NAME: Record<string, string> = Object.fromEntries(
    Object.entries(spinDataSampleAssetUrls).map(([path, url]) => {
        const fileName = path.split(/[\\/]/).pop() || path;
        const key = fileName.replace(/\.json$/i, "");
        return [key, String(url)];
    }),
);

/**
 * Function to parse URL query parameters
 * @param name - The name of the parameter to retrieve
 * @returns The value of the parameter or null if not found
 */
/**
 * Detection is now driven by `slot.hasMaxWin`; the bonus plays ALL freeSpin.items and stops
 * when the running total reaches `slot.totalWin`. We therefore no longer truncate items after a
 * per-item `isMaxWin` flag. Kept as a passthrough so existing call sites stay valid.
 */
export function truncateFreeSpinItemsAfterFirstMaxWin(
    items: any[] | undefined | null,
): any[] {
    return Array.isArray(items) ? items : (items ?? []);
}

function applyTruncateFreeSpinItems(slot: any): void {
    if (!slot) return;
    // Mirror the freeSpin/freespin key aliases (no item truncation in the slot.hasMaxWin model).
    if (!slot.freespin && slot.freeSpin) slot.freespin = slot.freeSpin;
    if (!slot.freeSpin && slot.freespin) slot.freeSpin = slot.freespin;
}

function normalizeMaxWinItemsInSpinData(spinData: any): any {
    if (!spinData || typeof spinData !== "object") return spinData;
    const slot = spinData.slot;
    if (!slot || typeof slot !== "object") return spinData;
    applyTruncateFreeSpinItems(slot);
    if (!slot.freespin && slot.freeSpin) {
        slot.freespin = slot.freeSpin;
    }
    if (!slot.freeSpin && slot.freespin) {
        slot.freeSpin = slot.freespin;
    }
    // Bridge legacy per-item isMaxWin → sequence-level slot.hasMaxWin. Detection (cap clamp in
    // applyTumbles, the free-spin loop stop in handleFreeSpinAutoplayWinStop, and the WIN_STOP
    // finalize) all key on slot.hasMaxWin. Buy-feature bonus responses can flag max win only on the
    // winning freeSpin item (items[k].isMaxWin) without setting slot.hasMaxWin, leaving the cap logic
    // inert — tumbles keep playing past slot.totalWin and the MaxWin drawer never triggers.
    if (slot.hasMaxWin !== true) {
        const fs = slot.freespin || slot.freeSpin;
        const items = Array.isArray(fs?.items) ? fs.items : [];
        if (items.some((it: any) => it?.isMaxWin === true)) {
            slot.hasMaxWin = true;
        }
    }
    return spinData;
}

function getUrlParameter(name: string): string {
    const urlParams = new URLSearchParams(window.location.search);
    let str : string = '';
    if(urlParams.get('start_game')){
        str = 'start_game';
    }
    else{
        str = urlParams.get(name) || '';
    }
    return str;
}

/**
 * Function to log all URL parameters for debugging
 * Only logs if there are any parameters present
 */
function logUrlParameters(): void {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.toString()) {
        console.log('🔍 URL Parameters:', Object.fromEntries(urlParams.entries()));
    }
}


const getApiBaseUrl = (): string => {
    // Same runtime source as other games: window.APP_CONFIG['game-url']
    // (injected by /app-config.js in deploy, or Vite injectAppConfig locally).
    const configuredUrl = (window as any)?.APP_CONFIG?.['game-url'];
    if (typeof configuredUrl === 'string' && configuredUrl.length > 0) {
        return configuredUrl.replace(/\/+$/, '');
    }
    return 'https://stg-game-launcher.dijoker.com';
};

export interface SlotInitializeResponse {
    data: SlotInitializeData;
}

/**
 * Request payload for the /api/v1/refresh_token endpoint.
 */
export interface RefreshTokenRequest {
    refreshToken: string;
}

/**
 * Response payload for the /api/v1/refresh_token endpoint.
 * Backend may return { data: { token: string } } or { token: string }.
 */
export interface RefreshTokenResponse {
    data?: { token?: string };
    token?: string;
}


export class GameAPI {  
    private static readonly GAME_ID: string = '00010525';
    private static DEMO_BALANCE: number = 10000;

    gameData: GameData;
    exitURL: string = '';
    private currentSpinData: SpinData | null = null;
    /** Buy-feature / scatter trigger payload — preserves slot.totalWin max-win cap across simulated free spins. */
    private bonusTriggerSpinData: SpinData | null = null;
    /** Full bonus session payload — preserves session slot.totalWin across simulated free-spin items. */
    private bonusSessionSpinData: SpinData | null = null;
    private currentFreeSpinIndex: number = 0; // Track current free spin item index
    private initializationData: SlotInitializeData | null = null; // Cached initialization response
    /** Casino domain passed to slot initialize (for scratch Join). */
    private joinDomain: string = '';
    /** Client IP from slot initialize response (for scratch Join). */
    private joinIp: string = '';
    private remainingInitFreeSpins: number = 0; // Free spin rounds from initialization still available
    private lastFreeRoundBetUpdate: FreeRoundCountUpdateDto | null = null;
    private initFreeSpinBet: number | null = null; // Bet size associated with initialization free spins
    private localizationData: LocalizationDataDto | null = null; // Cached localization response
    private unresolvedSpinUuid: string | null = null; // Cached unresolved-spin UUID from runtime spin data
    private replayData: ReplayData | null = null;

    // Sample data mode: load spins from src/game/spinDataSample/*.json (Vite asset URLs)
    // Enable via ?sampleData=<file_base_name> or ?useFakeData=true (alias: fake_spin_data)
    private fakeSpinData: { normalGame?: any[]; bonusGame?: any[] } | null = null;
    private fakeNormalSpinIndex: number = 0;
    private fakeBonusSpinIndex: number = 0;
    private sampleDataCache: Record<string, { normalGame?: any[]; bonusGame?: any[] } | null> = {};
    private sampleDataLoadPromise: Partial<Record<string, Promise<{ normalGame?: any[]; bonusGame?: any[] } | null>>> = {};

    constructor(gameData: GameData) {
        this.gameData = gameData;
    }

    private getSampleDataKey(): string | null {
        const params = new URLSearchParams(window.location.search);
        const paramKey = params.get("sampleData");
        const storageKey = sessionStorage.getItem("sampleData");
        const explicitKey = paramKey || storageKey;
        if (explicitKey) {
            return explicitKey.replace(/\.json$/i, "");
        }

        const maxWinFixture =
            params.get("maxWin") === "true" ||
            sessionStorage.getItem("maxWin") === "true";
        if (maxWinFixture) {
            return "max_win_data";
        }

        const useFakeData =
            params.get("useFakeData") === "true" ||
            sessionStorage.getItem("useFakeData") === "true";
        if (useFakeData) {
            return "fake_spin_data";
        }

        return null;
    }

    private getSampleDataUrl(): string | null {
        const key = this.getSampleDataKey();
        if (!key) return null;
        return SAMPLE_DATA_URL_BY_NAME[key] || null;
    }

    private isFakeDataModeEnabled(): boolean {
        return !!this.getSampleDataUrl();
    }

    public isFakeDataEnabled(): boolean {
        return this.isFakeDataModeEnabled();
    }

    private normalizeFakeSpinDataShape(rawData: any): { normalGame?: any[]; bonusGame?: any[] } | null {
        if (!rawData || typeof rawData !== "object") {
            return null;
        }

        const hasNamedLists =
            Array.isArray(rawData.normalGame) ||
            Array.isArray(rawData.bonusGame);
        if (hasNamedLists) {
            return {
                normalGame: Array.isArray(rawData.normalGame) ? rawData.normalGame : [],
                bonusGame: Array.isArray(rawData.bonusGame) ? rawData.bonusGame : [],
            };
        }

        if (Array.isArray(rawData)) {
            return {
                normalGame: rawData,
                bonusGame: [],
            };
        }

        if (rawData.slot && typeof rawData.slot === "object") {
            return {
                normalGame: [rawData],
                bonusGame: [],
            };
        }

        const wrappedList =
            (Array.isArray(rawData.data) && rawData.data) ||
            (Array.isArray(rawData.spins) && rawData.spins) ||
            null;
        if (wrappedList) {
            return {
                normalGame: wrappedList,
                bonusGame: [],
            };
        }

        return null;
    }

    private async loadFakeSpinData(): Promise<{ normalGame?: any[]; bonusGame?: any[] } | null> {
        const key = this.getSampleDataKey();
        const url = this.getSampleDataUrl();
        if (!key || !url) {
            return null;
        }
        const normalizedKey = key.replace(/\.json$/i, "");

        if (Object.prototype.hasOwnProperty.call(this.sampleDataCache, normalizedKey)) {
            this.fakeSpinData = this.sampleDataCache[normalizedKey];
            return this.fakeSpinData;
        }

        const inFlight = this.sampleDataLoadPromise[normalizedKey];
        if (inFlight) {
            this.fakeSpinData = await inFlight;
            return this.fakeSpinData;
        }

        this.sampleDataLoadPromise[normalizedKey] = (async () => {
            try {
                const res = await fetch(url, { cache: "no-store" });
                if (!res.ok) {
                    this.sampleDataCache[normalizedKey] = null;
                    return null;
                }
                const rawData = await res.json();
                const normalizedData = this.normalizeFakeSpinDataShape(rawData);
                this.sampleDataCache[normalizedKey] = normalizedData;
                return normalizedData;
            } catch {
                this.sampleDataCache[normalizedKey] = null;
                return null;
            }
        })();

        this.fakeSpinData = await this.sampleDataLoadPromise[normalizedKey];
        return this.fakeSpinData;
    }

    private getNextFakeSpin(isBonus: boolean, bet: number): SpinData | null {
        const data: any = this.fakeSpinData;
        if (!data) return null;

        const preferredList = isBonus ? data.bonusGame : data.normalGame;
        const fallbackList = isBonus ? data.normalGame : data.bonusGame;

        const normalizeToList = (value: any): any[] => {
            if (Array.isArray(value)) return value;
            if (value && typeof value === "object") return [value];
            return [];
        };

        let list = normalizeToList(preferredList);
        if (list.length === 0) {
            list = normalizeToList(fallbackList);
        }
        if (list.length === 0 && data.slot && typeof data.slot === "object") {
            list = [data];
        }
        if (list.length === 0) return null;

        const idx = isBonus ? this.fakeBonusSpinIndex : this.fakeNormalSpinIndex;
        const next = list[idx % list.length];
        if (isBonus) {
            this.fakeBonusSpinIndex += 1;
        } else {
            this.fakeNormalSpinIndex += 1;
        }

        const cloned = JSON.parse(JSON.stringify(next || {}));
        if (cloned) {
            if (!cloned.slot && (Array.isArray(cloned.area) || cloned.freeSpin || cloned.freespin)) {
                cloned.slot = {
                    area: cloned.area,
                    paylines: Array.isArray(cloned.paylines) ? cloned.paylines : [],
                    tumbles: Array.isArray(cloned.tumbles) ? cloned.tumbles : [],
                    freeSpin: cloned.freeSpin,
                    freespin: cloned.freespin,
                    totalWin: cloned.totalWin,
                };
            }

            if (!cloned.bet) {
                if (cloned.totalBet != null) {
                    cloned.bet = String(cloned.totalBet);
                } else {
                    cloned.bet = bet.toString();
                }
            }
            if (this.currentSpinData?.playerId) {
                cloned.playerId = this.currentSpinData.playerId;
            } else if (!cloned.playerId) {
                cloned.playerId = "demo-player";
            }
            if (cloned.slot) {
                if (!Array.isArray(cloned.slot.paylines)) {
                    cloned.slot.paylines = [];
                }
                if (!cloned.slot.freespin && cloned.slot.freeSpin) {
                    cloned.slot.freespin = cloned.slot.freeSpin;
                } else if (!cloned.slot.freeSpin && cloned.slot.freespin) {
                    cloned.slot.freeSpin = cloned.slot.freespin;
                }
            }
        }
        return cloned as SpinData;
    }

    private getFakeSpinForRequest(bet: number, buyFeat: number): SpinData | null {
        const isBuyFeatureSpin = buyFeat > 0;
        const useBonusList = !!gameStateManager.isBonus || isBuyFeatureSpin;
        return (
            this.getNextFakeSpin(useBonusList, bet) ||
            (isBuyFeatureSpin ? this.getNextFakeSpin(false, bet) : null) ||
            this.getNextFakeSpin(false, bet) ||
            this.getNextFakeSpin(true, bet)
        );
    }

    private buildFreeSpinFromItems(items: any[], baseSpin: SpinData): SpinData {
        const trimmedItems = truncateFreeSpinItemsAfterFirstMaxWin(items);
        items = trimmedItems;

        if (this.currentFreeSpinIndex >= items.length) {
            const nextIdx = items.findIndex((it: any) => Number(it?.spinsLeft || 0) > 0);
            if (nextIdx >= 0) {
                this.currentFreeSpinIndex = nextIdx;
            } else {
                throw new Error("No more free spins available");
            }
        }

        let currentItem = items[this.currentFreeSpinIndex];
        if (!currentItem || currentItem.spinsLeft <= 0) {
            const nextIdx = items.findIndex((it: any) => Number(it?.spinsLeft || 0) > 0);
            if (nextIdx >= 0) {
                this.currentFreeSpinIndex = nextIdx;
                currentItem = items[this.currentFreeSpinIndex];
            } else {
                throw new Error("No more free spins available");
            }
        }

        const baseSlot: any = baseSpin?.slot || {};
        const baseFs: any = baseSlot?.freespin || baseSlot?.freeSpin || {};
        const baseTotalWinRaw = baseSlot?.totalWin ?? (baseSpin as any)?.totalWin;
        const baseTotalWin = typeof baseTotalWinRaw === "number" ? baseTotalWinRaw : undefined;
        const baseMultiplierValue =
            typeof baseFs?.multiplierValue === "number" ? baseFs.multiplierValue : undefined;
        // Detection is driven by slot.hasMaxWin for the whole sequence; propagate it to every
        // simulated free spin so the client accumulates to slot.totalWin (the cap) and stops there.
        const baseHasMaxWin = baseSlot?.hasMaxWin === true;

        const slotObj: any = {
            area: currentItem.area,
            paylines: (currentItem as any)?.payline ?? (currentItem as any)?.paylines ?? [],
            freespin: {
                count: baseSlot?.freespin?.count ?? baseSlot?.freeSpin?.count,
                totalWin: baseSlot?.freespin?.totalWin ?? baseSlot?.freeSpin?.totalWin,
                items,
            },
        };
        if (typeof baseMultiplierValue === "number") {
            slotObj.freespin.multiplierValue = baseMultiplierValue;
        }
        // Always keep session slot.totalWin from the trigger/base spin — never per-item totals.
        if (typeof baseTotalWin === "number" && Number.isFinite(baseTotalWin)) {
            slotObj.totalWin = baseTotalWin;
        }
        if (baseHasMaxWin) {
            slotObj.hasMaxWin = true;
            const cap = this.getMaxWinCapTotal();
            if (cap > 0) {
                slotObj.totalWin = cap;
            }
        }
        if (!slotObj.freeSpin) {
            slotObj.freeSpin = slotObj.freespin;
        }

        try {
            const sourceTumbles =
                (currentItem as any)?.tumbles ??
                (currentItem as any)?.tumble ??
                (currentItem as any)?.tumbleSteps ??
                (currentItem as any)?.tumbling ??
                [];
            if (Array.isArray(sourceTumbles) && sourceTumbles.length > 0) {
                slotObj.tumbles = sourceTumbles;
            }
        } catch {
            /* ignore */
        }

        const freeSpinData: SpinData = {
            playerId: baseSpin.playerId,
            bet: baseSpin.bet,
            slot: slotObj,
        };

        this.currentSpinData = freeSpinData;
        this.currentFreeSpinIndex++;

        return freeSpinData;
    }

    public getReplayState(): boolean {
        return getUrlParameter('replay') === 'true';
    }

    public getReplayData(): ReplayData | null {
        return this.replayData;
    }

    /**
     * Load spin transaction result for replay mode and cache {@link ReplayData}.
     */
    public async initReplayData(): Promise<void> {
        if (!this.getReplayState()) {
            return;
        }

        const token = getUrlParameter('token') || '';
        if (token) {
            sessionStorage.setItem('token', token);
        }
        if (!token) {
            console.warn('[GameAPI] Replay mode: no token in URL, cannot fetch replay data');
            return;
        }

        const apiUrl = `${getApiBaseUrl()}/api/v1/transactions/result/spin`;
        let response: Response;
        try {
            response = await fetch(apiUrl, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                }
            });
        } catch (e) {
            console.error('[GameAPI] Replay fetch failed:', e);
            return;
        }

        if (!response.ok) {
            const parsed = await this.readBackendErrorResponse(response);
            checkAndHandleModal(parsed);
            return;
        }

        const raw = await response.json();
        const data = raw?.data ?? raw;
        const spinData: SpinData = {
            playerId: data.playerId,
            bet: data.baseBet ?? data.bet,
            slot: data.result,
        };

        this.replayData = {
            ...data,
            currency: data?.currency || 'USD',
            currencySymbol: data?.currencySymbol || (data?.currency && data.currency !== 'USD' ? '' : '$'),
            spinData,
        };

        // Reuse the existing display initialization path for replay currency.
        this.initializationData = {
            gameId: GameAPI.GAME_ID,
            sessionId: '',
            lang: 'en',
            currency: this.replayData.currency || 'USD',
            currencySymbol: this.replayData.currencySymbol,
            currencyDecimalPlaces: Number.isFinite(data?.currencyDecimalPlaces)
                ? Math.max(0, Math.min(10, Math.floor(data.currencyDecimalPlaces))) : 2,
            hasFreeSpinRound: false,
            freeSpinRound: null,
            hasUnresolvedSpin: false,
            unresolvedSpinIndex: 0,
            unresolvedSpin: null,
        };
        setDecimalPlaces(this.initializationData.currencyDecimalPlaces ?? 2);
        this.currentSpinData = normalizeMaxWinItemsInSpinData(spinData) as SpinData;
        console.log('[GameAPI] Replay data loaded:', this.replayData?.round_id);
    }

    /**
     * 1. Generate game URL token upon game initialization
     * This method generates a game token that can be used for subsequent API calls
     */
    public async generateGameUrlToken(): Promise<{url: string, token: string}> {
        const apiUrl = `${getApiBaseUrl()}/api/v1/generate_url`;
        
        const requestBody = {
            "operator_id": "18b03717-33a7-46d6-9c70-acee80c54d03",
            "bank_id": "1",
            "player_id": 2,
            "game_id": GameAPI.GAME_ID,
            "device": "mobile",
            "lang": "en",
            "currency": "USD",
            "quit_link": "www.quit.com",
            "is_demo": 0,
            "free_spin": "1",
            "session": "623a9cd6-0d55-46ce-9016-36f7ea2de678",
            "player_name": "test",
            "modify_uid": "111"
          };

        const headers = {
            'Content-Type': 'application/json',
            'Accept': '*/*',
            'Connection': 'keep-alive',
            'Accept-Encoding': 'gzip, deflate, br',
            'x-access-token': 'taVHVt4xD8NLwvlo3TgExmiSaGOiuiKAeGB9Qwla6XKpmSRMUwy2pZuuYJYNqFLr',
            'x-brand': '6194bf3a-b863-4302-b691-9cc8fe9b56c8'
        };

        try {
            
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(requestBody)
            });

            //console.log('Response status:', response.status);
            //console.log('Response ok:', response.ok);

            if (!response.ok) {
                const errorText = await response.text();
                //console.error('Response error text:', errorText);
                throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
            }

            const data = await response.json();
            
            return {
                url: data.data.url,
                token: data.data.token 
            };
        } catch (error) {
            //console.error('Error generating game URL:', error);
            throw error;
        }
    }

    /**
     * Initialize the game with token generation
     * This method should be called when the game starts to get the game token
     * Only generates a new token if token URL parameter is not present
     */
    public async initializeGame(): Promise<string> {
        // Local sample spins (e.g. ?maxWin=true): same session setup as demo, spins from spinDataSample.
        if (this.isFakeDataModeEnabled()) {
            sessionStorage.setItem('demo', 'true');
            return '';
        }

        const isDemo = getUrlParameter('demo') === 'true';
        sessionStorage.setItem('demo', isDemo ? 'true' : 'false');

        if (isDemo) {
            return '';
        }

        if (this.getReplayState()) {
            const t = getUrlParameter('token') || sessionStorage.getItem('token') || '';
            if (t) {
                sessionStorage.setItem('token', t);
            }
            return t;
        }

        try {
            // Check if token is already in the URL parameters
            const existingToken = getUrlParameter('token');
            
            console.log('Game token found in URL parameters:', existingToken);
            
            if (existingToken) {
                sessionStorage.setItem('token', existingToken);
                console.log('Game initialized with existing token from URL');
                return existingToken;
            }
            return sessionStorage.getItem('token') || '';
            
        } catch (error) {
            console.error('Error initializing game:', error);
            throw error;
        }
    }

    /**
     * Initialize refresh token from URL parameters
     * This method should be called at game startup to read and store the refresh token
     */
    public async initializeRefreshToken(): Promise<string> {
        const isDemo = this.getDemoState();
        if (isDemo || this.isFakeDataModeEnabled()) {
            return '';
        }

        try {
            // Check if refresh token is already in the URL parameters
            const refreshToken = getUrlParameter('refresh_token');
            
            console.log('Game refresh token found in URL parameters:', refreshToken);
            
            // Store the existing token in sessionStorage
            if (refreshToken) {
                sessionStorage.setItem('refresh_token', refreshToken);
                console.log('Game initialized with existing refresh token from URL');
            }
            return sessionStorage.getItem('refresh_token') || '';
            
        } catch (error) {
            console.error('Error getting refresh token from URL:', error);
            throw error;
        }
    }

    /**
     * Check if a refresh token is available in storage
     */
    private hasRefreshToken(): boolean {
        const refreshToken =
            sessionStorage.getItem('refresh_token') ||
            '';
        const hasToken = refreshToken.length > 0;
        console.log('[GameAPI] hasRefreshToken check:', hasToken, refreshToken ? 'token exists' : 'no token');
        return hasToken;
    }

    /**
     * Call the refresh_token API to obtain a new access token using the stored refresh token.
     * On success, stores the new token in sessionStorage and returns it.
     * @throws Error if no refresh token is available or the API call fails
     */
    public async refreshAccessToken(): Promise<string> {
        const refreshToken =
            sessionStorage.getItem('refresh_token') ||
            '';

        if (!refreshToken) {
            throw new Error('No refresh token available.');
        }

        const apiUrl = `${getApiBaseUrl()}/api/v1/refresh_token`;
        const requestBody: RefreshTokenRequest = { refreshToken };

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: this.stampPlayInstance({
                'Content-Type': 'application/json'
            }),
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const parsed = await this.readBackendErrorResponse(response);
            if (this.noteInactivePlaySession(parsed)) {
                this.throwSuperseded();
            }
            const code = (parsed?.errorCode ?? '').trim();
            if (code) {
                checkAndHandleModal(parsed);
            } else {
                checkAndHandleModal({ errorCode: 'DJ401UA' });
            }
            const errorText = parsed.message_text || parsed.message || (await response.clone().text().catch(() => ''));
            throw new Error(`Refresh token failed: ${response.status}, ${errorText}`);
        }

        const data: RefreshTokenResponse = await response.json();
        const newToken =
            (data?.data?.token) ??
            (data?.token) ??
            '';

        if (!newToken) {
            throw new Error('Refresh token response missing token');
        }

        // Store the new token in sessionStorage
        sessionStorage.setItem('token', newToken);

        console.log('[GameAPI] Token refreshed successfully');
        return newToken;
    }

    /**
     * Try to refresh the access token using the refresh token.
     * Returns the new token on success, or null on failure (does not throw).
     */
    private async tryRefreshAndGetNewToken(): Promise<string | null> {
        try {
            console.log('[GameAPI] Attempting to refresh access token...');
            const newToken = await this.refreshAccessToken();
            console.log('[GameAPI] Token refresh succeeded, new token obtained');
            return newToken;
        } catch (e) {
            console.warn('[GameAPI] Token refresh failed:', e);
            return null;
        }
    }

    /**
     * Call the backend game initialization endpoint.
     * This should be called once at the very start of the game after the token is available.
     */
    public async initializeSlotSession(): Promise<SlotInitializeData | null> {
        if (this.getReplayState() && this.initializationData) {
            return this.initializationData;
        }

        this.captureJoinDomainFromLocation();
        if (this.isFakeDataModeEnabled()) {
            const payload: SlotInitializeData = {
                gameId: GameAPI.GAME_ID,
                playerId: '',
                sessionId: '',
                lang: 'en',
                currency: 'USD',
                currencySymbol: '$',
                hasFreeSpinRound: false,
                freeSpinRound: null,
                hasUnresolvedSpin: false,
                unresolvedSpinIndex: 0,
                unresolvedSpin: null,
            };
            this.initializationData = payload;
            this.joinIp = typeof (payload as any)?.ip === 'string' ? String((payload as any).ip).trim() : this.joinIp;
            if (!this.joinDomain && typeof (payload as any)?.domain === 'string') {
                this.joinDomain = String((payload as any).domain).trim();
            }
            this.remainingInitFreeSpins = 0;
            this.lastFreeRoundBetUpdate = null;
            this.initFreeSpinBet = null;
            return payload;
        }

        if (this.getDemoState() || this.getReplayState()) {
            console.log('[GameAPI] Demo or replay mode — skipping slot session initialization');
            return null;
        }

        let token =
            sessionStorage.getItem('token') ||
            '';

        if (!token) {
            // Check if refresh token exists before attempting refresh
            if (!this.hasRefreshToken()) {
                // No refresh token available, show popup immediately
                this.showTokenExpiredPopup();
                throw new Error('No game token available. Please initialize the game first.');
            }
            
            // Refresh token exists, try to get new access token
            const newToken = await this.tryRefreshAndGetNewToken();
            if (newToken) {
                token = newToken;
            } else {
                // Refresh token exists but refresh failed, show popup
                this.showTokenExpiredPopup();
                throw new Error('No game token available. Please initialize the game first.');
            }
        }

        const apiUrl = `${getApiBaseUrl()}/api/v1/slots/initialize`;

        try {
            console.log('[GameAPI] Calling slots initialize endpoint...', apiUrl);
            const [casino] = window.location.ancestorOrigins;
            this.joinDomain = typeof casino === 'string' ? casino : '';
            const game_slug = window.location.pathname.replace(/^\/|\/$/g, '');

            let currentToken = token;
            const initializeBody = JSON.stringify({
                domain: casino,
                path: game_slug,
                playInstanceId: this.getPlayInstanceId(),
                playInstanceClaimedAt: getPlayInstanceClaimedAt(),
            });
            let response = await fetch(apiUrl, {
                method: 'POST',
                headers: this.stampPlayInstance({
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${currentToken}`
                }),
                body: initializeBody,
            });

            if (!response.ok && response.status === 401) {
                const parsed = await this.readBackendErrorResponse(response);
                if (this.noteInactivePlaySession(parsed)) {
                    this.throwSuperseded();
                }
                if (parsed.errorCode === 'DJ401TE') {
                    // Special-case refresh flow stays in GameAPI.
                    const newToken = await this.tryRefreshAndGetNewToken();
                    if (newToken) {
                        currentToken = newToken;
                        response = await fetch(apiUrl, {
                            method: 'POST',
                            headers: this.stampPlayInstance({
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${currentToken}`
                            }),
                            body: initializeBody,
                        });
                    }
                } else {
                    checkAndHandleModal(parsed);
                }
            }

            if (!response.ok) {
                const parsed = await this.readBackendErrorResponse(response);
                if (this.noteInactivePlaySession(parsed)) {
                    this.throwSuperseded();
                }
                checkAndHandleModal(parsed);
                const errorText =
                    parsed.message_text ||
                    parsed.message ||
                    (await response.clone().text().catch(() => ''));
                const error = new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
                if (response.status === 401) {
                    sessionStorage.removeItem('token');
                }
                throw error;
            }

            const raw = await response.json();
            const rawPayload = (raw && raw.data) ? raw.data : raw;
            const takeoverToken = typeof rawPayload?.accessToken === 'string'
                ? rawPayload.accessToken.trim()
                : '';
            if (takeoverToken) {
                sessionStorage.setItem('token', takeoverToken);
                delete rawPayload.accessToken;
            }
            const payload = this.normalizeSlotInitializeData(rawPayload);

            // // TEST OVERRIDE: force free spin round for local testing with new format.
            // // Remove or comment this block out for production.
            // payload.hasFreeSpinRound = true;
            // payload.freeSpinRound = [
            //     {
            //         bet: '10.00',
            //         totalFreeSpin: 2,
            //         usedFreeSpin: 0,
            //         remainingFreeSpin: 2
            //     }
            // ];

            // Cache the initialization data for later retrieval
            this.initializationData = payload;
            this.joinIp = typeof (payload as any)?.ip === 'string' ? String((payload as any).ip).trim() : this.joinIp;
            if (!this.joinDomain && typeof (payload as any)?.domain === 'string') {
                this.joinDomain = String((payload as any).domain).trim();
            }
            // Remaining count from the raw payload (legacy number | array) before DTO coerce.
            this.remainingInitFreeSpins = this.extractRemainingInitFreeSpins(rawPayload);

            console.log('[GameAPI] Slot initialization data received (possibly overridden for testing):', payload);
            console.log('[GameAPI] InitFreeSpinRoundDto:', payload.freeSpinRound);
            this.claimSinglePlayInstance();

            return payload;
        } catch (error) {
            console.error('[GameAPI] Error calling slots initialize endpoint:', error);
            throw error;
        }
    }

    /**
     * Coerce initialize JSON onto the shared DTO. Legacy `freeSpinRound` number/object
     * becomes `null` here; remaining-count extraction still runs on the raw payload.
     */
    private normalizeSlotInitializeData(raw: any): SlotInitializeData {
        return {
            ...raw,
            gameId: String(raw?.gameId ?? ""),
            sessionId: String(raw?.sessionId ?? ""),
            lang: String(raw?.lang ?? ""),
            currency: String(raw?.currency ?? ""),
            hasFreeSpinRound: raw?.hasFreeSpinRound === true,
            freeSpinRound: Array.isArray(raw?.freeSpinRound) ? raw.freeSpinRound : null,
            unresolvedSpin: raw?.unresolvedSpin ?? null,
        };
    }

    /**
     * Helper to extract the remaining free spins from the initialization payload,
     * supporting both the legacy numeric format and the new array format.
     */
    private extractRemainingInitFreeSpins(payload: {
        hasFreeSpinRound?: boolean;
        freeSpinRound?: unknown;
    } | null): number {
        if (!payload || !payload.hasFreeSpinRound || payload.freeSpinRound == null) {
            return 0;
        }

        const fs: any = payload.freeSpinRound;
        if (typeof fs === 'number') {
            return fs;
        }

        if (Array.isArray(fs) && fs.length > 0) {
            const first = fs[0] as InitFreeSpinRoundDto;
            if (typeof first.remainingFreeSpin === 'number') {
                return first.remainingFreeSpin;
            }
            if (typeof first.totalFreeSpin === 'number' && typeof first.usedFreeSpin === 'number') {
                return Math.max(0, first.totalFreeSpin - first.usedFreeSpin);
            }
        }

        return 0;
    }

    /**
     * Get the cached initialization data, if available.
     */
    public getInitializationData(): SlotInitializeData | null {
        return this.initializationData;
    }

    /** Casino domain used for slot initialize — scratch JoinScratch must reuse it. */
        private captureJoinDomainFromLocation(): void {
        try {
            const [casino] = window.location.ancestorOrigins;
            if (typeof casino === 'string' && casino) {
                this.joinDomain = casino;
            }
        } catch {
            /* ignore */
        }
    }

public getJoinDomain(): string {
        return this.joinDomain || this.initializationData?.domain?.trim() || '';
    }

    /** Client IP from slot initialize — scratch JoinScratch must reuse it. */
    public getJoinIp(): string {
        return this.joinIp || this.initializationData?.ip?.trim() || '';
    }

    /** Operator session created by slot initialize — scratch Join must reuse this id. */
    public getSessionId(): string {
        return this.initializationData?.sessionId?.trim() || '';
    }

    public getPlayerId(): string {
        const fromInit = this.initializationData?.playerId?.trim() || '';
        return fromInit || this.readTokenClaim(['player_id', 'playerId', 'pId']);
    }

    /** Operator id from slot initialize or the launch token. Together with player id, one live instance may play. */
    public getOperatorId(): string {
        const raw = this.initializationData as (SlotInitializeData & {
            operatorId?: string;
            operator_id?: string;
        }) | null;
        const fromInit = String(raw?.operatorId ?? raw?.operator_id ?? '').trim();
        return fromInit || this.readTokenClaim(['operator_id', 'operatorId', 'oId']);
    }

    private playInstanceId = '';
    private playSessionSuperseded = false;

    /** Stable id for this page. A newer page with the same operator and player replaces it. */
    public getPlayInstanceId(): string {
        if (!this.playInstanceId) {
            const cryptoApi = globalThis.crypto;
            this.playInstanceId = cryptoApi?.randomUUID?.()
                ?? `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
        }
        return this.playInstanceId;
    }

    private stampPlayInstance(headers: Record<string, string>): Record<string, string> {
        headers['X-Play-Instance'] = this.getPlayInstanceId();
        return headers;
    }

    private readTokenClaim(names: string[]): string {
        try {
            const token = sessionStorage.getItem('token') || '';
            const part = token.split('.')[1];
            if (!part) {
                return '';
            }
            let b64 = part.replace(/-/g, '+').replace(/_/g, '/');
            const pad = b64.length % 4;
            if (pad) {
                b64 += '='.repeat(4 - pad);
            }
            const json = JSON.parse(atob(b64)) as Record<string, unknown>;
            for (const name of names) {
                const value = json[name];
                if (typeof value === 'string' && value.trim()) {
                    return value.trim();
                }
                if (typeof value === 'number' && Number.isFinite(value)) {
                    return String(value);
                }
            }
        } catch {
            /* token is not a JWT */
        }
        return '';
    }

    private claimSinglePlayInstance(): void {
        const operatorId = this.getOperatorId();
        const playerId = this.getPlayerId();
        if (!operatorId || !playerId) {
            console.warn('[GameAPI] Play-instance lock skipped; operator or player id is missing');
            return;
        }
        claimPlayInstance(
            { operatorId, playerId },
            this.getPlayInstanceId(),
        );
    }

    public hasLostPlayInstance(): boolean {
        return this.playSessionSuperseded || isPlayInstanceReplaced();
    }

    /** Stop this page when another window with the same operator and player is the live one. */
    public rejectIfPlayInstanceLost(): boolean {
        if (!this.hasLostPlayInstance()) {
            return false;
        }
        const alreadyNotified = isPlayInstanceReplaced();
        this.noteInactivePlaySession({ message: 'Session is not active' });
        if (alreadyNotified) {
            try {
                window.dispatchEvent(new CustomEvent('sugar-play-session-replaced'));
            } catch {
                /* noop */
            }
        }
        return true;
    }

    public noteInactivePlaySession(parsed?: BackendErrorResponse | null): boolean {
        const message = `${parsed?.message ?? ''} ${parsed?.message_text ?? ''}`.toLowerCase();
        const inactive = message.includes('session is not active') || message.includes('not active');
        if (!inactive && !this.hasLostPlayInstance()) {
            return false;
        }
        this.markPlaySessionSuperseded();
        markPlayInstanceReplaced();
        return true;
    }

    private throwSuperseded(): never {
        const error = new Error('Play session was opened in another instance.');
        (error as { popupHandled?: boolean }).popupHandled = true;
        throw error;
    }

    public isPlaySessionSuperseded(): boolean {
        return this.playSessionSuperseded;
    }

    /** Another instance with the same operator + player took over. This one must stop. */
    public markPlaySessionSuperseded(): void {
        this.playSessionSuperseded = true;
    }

    public getMaxWin(): number | null {
        const v = this.getDemoState()
            ? this.localizationData?.maxWin
            : (this.initializationData?.maxWin ?? this.localizationData?.maxWin);
        return v != null ? v : null;
    }

    public getRtpRange(): string | null {
        const v = this.getDemoState()
            ? this.localizationData?.rtp
            : (this.initializationData?.rtpRange ?? this.localizationData?.rtp);
        return v != null ? v : null;
    }

    /** Slot configured RTP value from initialize (not the display range). */
    public getRtp(): string | null {
        if (this.getDemoState()) {
            const demo = this.localizationData?.rtp;
            if (demo != null && String(demo).trim()) {
                return String(demo).trim();
            }
            return null;
        }
        const v = this.initializationData?.rtp;
        if (v != null && String(v).trim()) {
            return String(v).trim();
        }
        return null;
    }


    /**
     * Cache an unresolved-spin UUID from runtime spin data (e.g. a scatter-triggered bonus).
     */
    public setUnresolvedSpinUuid(uuid?: string | null): void {
        if (typeof uuid === 'string' && uuid.length > 0) {
            this.unresolvedSpinUuid = uuid;
        } else {
            this.unresolvedSpinUuid = null;
        }
    }

    /**
     * Get the unresolved-spin UUID, preferring the runtime value and falling back to init data.
     */
    public getUnresolvedSpinUuid(): string | null {
        if (typeof this.unresolvedSpinUuid === 'string' && this.unresolvedSpinUuid.length > 0) {
            return this.unresolvedSpinUuid;
        }

        const uuid = this.initializationData?.unresolvedSpin?.uuid;
        return (typeof uuid === 'string' && uuid.length > 0) ? uuid : null;
    }

    /**
     * PATCH the unresolved-spin endpoint once a bonus spin completes.
     */
    public async patchUnresolvedSpin(currentWin?: number): Promise<void> {
        if (this.getReplayState()) {
            return;
        }

        const uuid = this.getUnresolvedSpinUuid();
        if (!uuid) {
            return;
        }

        const token =
            sessionStorage.getItem('token') ||
            '';

        if (!token) {
            console.warn('[GameAPI] patchUnresolvedSpin: no token, skipping');
            return;
        }

        const apiUrl = `${getApiBaseUrl()}/api/v1/unresolved-spin/${uuid}`;
        const headers: Record<string, string> = this.stampPlayInstance({
            'Authorization': `Bearer ${token}`
        });
        const body =
            currentWin !== undefined && currentWin !== null
                ? JSON.stringify({ current_win: currentWin })
                : undefined;

        if (body) {
            headers['Content-Type'] = 'application/json';
        }

        try {
            const response = await fetch(apiUrl, {
                method: 'PATCH',
                headers,
                body: body ?? ''
            });

            if (!response.ok) {
                const errText = await response.text();
                console.warn('[GameAPI] patchUnresolvedSpin failed:', response.status, errText);
            }
        } catch (err) {
            console.warn('[GameAPI] patchUnresolvedSpin error:', err);
        }
    }

    /**
     * PATCH /api/v1/unresolved-spin/{uuid}/complete — force-complete an unresolved spin.
     * @returns true when the request succeeded; false on skip, HTTP error, or network failure.
     */
    /** Wallet balance from the last successful unresolved-spin /complete response. */
    private lastUnresolvedCompleteBalance: number | null = null;
    private lastUnresolvedCompleteTimestamp: number | undefined;


    /** Wallet from the last successful unresolved-spin /complete response (null if none). */
    public getLastUnresolvedCompleteBalance(): number | null {
    return this.lastUnresolvedCompleteBalance;
    }
    public getLastUnresolvedCompleteTimestamp(): number | undefined {
    return this.lastUnresolvedCompleteTimestamp;
    }

    /** Read and clear the last /complete response balance. */
    public consumeLastUnresolvedCompleteBalance(): number | null {
    const value = this.lastUnresolvedCompleteBalance;
    this.lastUnresolvedCompleteBalance = null;
    this.lastUnresolvedCompleteTimestamp = undefined;
    return value;
    }

    private async captureBalanceFromUnresolvedCompleteResponse(response: Response): Promise<void> {
    try {
        const text = await response.text();
        if (!text || !text.trim()) {
            return;
        }
        let data: any = null;
        try {
            data = JSON.parse(text);
        } catch {
            return;
        }
        const balance = this.extractBalanceFromUnresolvedCompletePayload(data);
        if (balance != null) {
            this.lastUnresolvedCompleteBalance = balance;
            this.lastUnresolvedCompleteTimestamp = readWalletTimestamp(data);
            console.log('[GameAPI] Stored unresolved-spin /complete balance:', balance);
        }
    } catch (err) {
        console.warn('[GameAPI] Failed to parse unresolved-spin /complete body:', err);
    }
    }

    private extractBalanceFromUnresolvedCompletePayload(payload: any): number | null {
    if (!payload || typeof payload !== 'object') {
        return null;
    }
    const candidates = [
        payload.balance,
        payload.data?.balance,
        payload.walletBalance,
        payload.wallet?.balance,
        payload.player?.balance,
    ];
    for (const c of candidates) {
        if (c === undefined || c === null) continue;
        const v = Number(String(c).replace(/,/g, ''));
        if (Number.isFinite(v) && v >= 0) {
            return Math.round(v * 100) / 100;
        }
    }
    return null;
    }

    public async forceCompleteUnresolvedSpin(): Promise<boolean> {
        if (this.getReplayState()) {
            return false;
        }

        const uuid = this.getUnresolvedSpinUuid();
        if (!uuid) return false;

        const token =
            sessionStorage.getItem('token') ||
            '';
        if (!token) {
            console.warn('[GameAPI] forceCompleteUnresolvedSpin: no token, skipping');
            return false;
        }

        const apiUrl = `${getApiBaseUrl()}/api/v1/unresolved-spin/${uuid}/complete`;
        const headers: Record<string, string> = this.stampPlayInstance({
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
        });

        try {
            const response = await fetch(apiUrl, {
                method: 'PATCH',
                headers,
                body: '',
            });
            if (!response.ok) {
                const errText = await response.text();
                console.warn('[GameAPI] forceCompleteUnresolvedSpin failed:', response.status, errText);
                return false;
            }
            await this.captureBalanceFromUnresolvedCompleteResponse(response);
            console.log('[GameAPI] forceCompleteUnresolvedSpin succeeded for uuid:', uuid);
            return true;
        } catch (err) {
            console.warn('[GameAPI] forceCompleteUnresolvedSpin error:', err);
            return false;
        }
    }

    /**
     * Get the remaining free spin rounds from initialization (derived from payload).
     */
    public getRemainingInitFreeSpins(): number {
        return this.remainingInitFreeSpins;
    }

    /** Last isFs bet envelope fields (fsCount / fsStatus / fsTotal / fsTotalAccumulatedWin / balance / slot.totalWin). */
    public getLastFreeRoundBetUpdate(): FreeRoundCountUpdateDto | null {
        return this.lastFreeRoundBetUpdate;
    }

    private emitFreeRoundBetUpdate(update: FreeRoundCountUpdateDto): void {
        this.lastFreeRoundBetUpdate = update;
        if (typeof update.fsCount === "number") {
            this.remainingInitFreeSpins = Math.max(0, update.fsCount);
        }
        console.log("[GameAPI] Emitting FREEROUND_COUNT_UPDATE:", update);
        gameEventManager.emit(GameEventType.FREEROUND_COUNT_UPDATE, update as any);
    }

    private buildFreeRoundBetUpdate(envelope: FreeRoundBetResponse): FreeRoundCountUpdateDto {
        const fsCount =
            typeof envelope.fsCount === "number" ? envelope.fsCount : this.remainingInitFreeSpins;
        const slotTotalWin = Number((envelope.slot as { totalWin?: number } | undefined)?.totalWin);
        const balance = Number(envelope.balance);
        return {
            fsCount,
            fsStatus: resolveFreeRoundStatus(envelope.fsStatus),
            fsTotal: typeof envelope.fsTotal === "number" ? envelope.fsTotal : undefined,
            balance: Number.isFinite(balance) ? balance : undefined,
            totalWin: Number.isFinite(slotTotalWin) ? slotTotalWin : undefined,
            fsTotalAccumulatedWin: typeof envelope?.fsTotalAccumulatedWin === "number" ? envelope.fsTotalAccumulatedWin : undefined,
        };
    }

    /**
     * Fetch locale JSON from the backend and cache it for getLocalizationData().
     */
    public async fetchLocalizationData(): Promise<void> {
        const apiUrl = `${getApiBaseUrl()}/api/v1/slots/locale`;
        const requestBody = this.createLocaleAPIResponseBody();

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
        }

        const raw = await response.json();
        const data = raw?.data ?? raw;
        const locale =
            typeof data?.locale === 'string'
                ? data.locale
                : data?.locale && typeof data.locale === 'object'
                    ? JSON.stringify(data.locale)
                    : null;

        const payload: LocalizationDataDto = {
            sessionId: data?.sessionId ?? requestBody.sessionId,
            gameId: data?.gameId ?? requestBody.gameId,
            lang: data?.lang ?? requestBody.lang,
            locale: locale ?? '',
            maxWin: data?.maxWin ?? null,
            rtp: data?.rtp ?? data?.rtpRange ?? null,
        };

        console.log('[GameAPI] Localization data received:', payload);

        this.localizationData = payload;
    }

    private createLocaleAPIResponseBody(): Pick<LocalizationDataDto, 'sessionId' | 'gameId' | 'lang'> {
        const isDemo = this.getDemoState();
        if (isDemo) {
            const language = getUrlParameter('lang');
            return {
                sessionId: '',
                gameId: GameAPI.GAME_ID,
                lang: language !== '' ? language : 'en',
            };
        }

        const initData = this.initializationData;

        return {
            sessionId: initData?.sessionId ?? '',
            gameId: initData?.gameId ?? GameAPI.GAME_ID,
            lang: initData?.lang ?? 'en',
        };
    }

    /**
     * Get the cached localization data, if available.
     */
    public getLocalizationData(): LocalizationDataDto | null {
        return this.localizationData;
    }

    /**
     * Initialization language takes precedence; the locale response fills in
     * when initialization does not provide a supported logo language.
     */
    public getLocalizedLogoLanguage(): LocalizedLogoLanguage | undefined {
        return resolveLocalizedLogoLanguage(
            this.initializationData?.lang,
            this.localizationData?.lang,
        );
    }

    /**
     * Get the bet size associated with initialization free spins, if available.
     */
    public getInitFreeSpinBet(): number | null {
        // Prefer cached value if already extracted
        if (this.initFreeSpinBet != null) {
            return this.initFreeSpinBet;
        }

        const payload = this.initializationData;
        if (!payload || !payload.hasFreeSpinRound || payload.freeSpinRound == null) {
            return null;
        }

        const fs: any = payload.freeSpinRound;
        if (Array.isArray(fs) && fs.length > 0) {
            const first = fs[0] as InitFreeSpinRoundDto;
            if (typeof first.bet === 'string') {
                const parsed = parseFloat(first.bet);
                if (!isNaN(parsed)) {
                    this.initFreeSpinBet = parsed;
                    return parsed;
                }
            }
        }

        return null;
    }

    public async gameLauncher(): Promise<void> {
        try {
            sessionStorage.removeItem('token');
            sessionStorage.removeItem('exit_url');
            sessionStorage.removeItem('what_device');
            sessionStorage.removeItem('demo');

            sessionStorage.removeItem('token');
            sessionStorage.removeItem('exit_url');
            sessionStorage.removeItem('what_device');
            sessionStorage.removeItem('demo');
            
            console.log('Starting gameLauncher...');
            let token1 = '';
            let tokenParam = getUrlParameter('token');
            
            if(tokenParam){
                token1 = tokenParam;
                sessionStorage.setItem('token', token1);
            }

            let deviceUrl = getUrlParameter('device');
            if(deviceUrl){
                sessionStorage.setItem('what_device',deviceUrl);
                sessionStorage.setItem('what_device',deviceUrl);
            }

            let apiUrl = getUrlParameter('api_exit');
            if(apiUrl){
                this.exitURL = apiUrl;
                sessionStorage.setItem('exit_url',apiUrl);
                sessionStorage.setItem('exit_url',apiUrl);
            }

            let startGame = getUrlParameter('start_game');
            if(startGame){
                console.log('startGame');
                let {token} = await this.generateGameUrlToken();
                token1 = token;
                sessionStorage.setItem('token', token);
            }

            if (!token1 && !startGame) {
                throw new Error();
            }
        } catch (error) {
            throw new Error();
        }
    }
    public async getBalance(): Promise<any> {
        // Check if demo mode is active
        const isDemo = this.getDemoState();

        // Return mock balance for demo mode or fake sample data mode
        if (isDemo || this.isFakeDataModeEnabled()) {
            return {
                data: {
                    balance: GameAPI.DEMO_BALANCE
                }
            };
        }

        try {
            let token = sessionStorage.getItem('token') || '';
            if (!token) {
                // Check if refresh token exists before attempting refresh
                if (!this.hasRefreshToken()) {
                    // No refresh token available, show popup immediately
                    this.showTokenExpiredPopup();
                    throw new Error('No authentication token available');
                }
                
                // Refresh token exists, try to get new access token
                const newToken = await this.tryRefreshAndGetNewToken();
                if (newToken) {
                    token = newToken;
                } else {
                    // Refresh token exists but refresh failed, show popup
                    this.showTokenExpiredPopup();
                    throw new Error('No authentication token available');
                }
            }

            const apiUrl = `${getApiBaseUrl()}/api/v1/slots/balance`;
            let currentToken = token;
            let response = await fetch(apiUrl, {
                method: 'POST',
                headers: this.stampPlayInstance({
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${currentToken}`
                })
            });

            if (!response.ok && response.status === 401) {
                const parsed = await this.readBackendErrorResponse(response);
                if (this.noteInactivePlaySession(parsed)) {
                    this.throwSuperseded();
                }
                if (parsed.errorCode === 'DJ401TE') {
                    const newToken = await this.tryRefreshAndGetNewToken();
                    if (newToken) {
                        currentToken = newToken;
                        response = await fetch(apiUrl, {
                            method: 'POST',
                            headers: this.stampPlayInstance({
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${currentToken}`
                            })
                        });
                    }
                } else {
                    checkAndHandleModal(parsed);
                }
            }

            if (!response.ok) {
                const parsed = await this.readBackendErrorResponse(response);
                if (this.noteInactivePlaySession(parsed)) {
                    this.throwSuperseded();
                }
                checkAndHandleModal(parsed);
                if (response.status === 401 && !this.isPlaySessionSuperseded()) {
                    sessionStorage.removeItem('token');
                }
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            return data;
        } catch (error) {
            console.error('Error in getBalance:', error);
            throw error;
        }
    }

    /**
     * Show session timeout popup and clear token/refresh_token from storage.
     * Call this when the user has been idle past the configured timeout (e.g. from IdleManager).
     */
    public handleIdleSessionExpired(): void {
        showIdleSessionExpiredModal();
        sessionStorage.removeItem('token');
        sessionStorage.removeItem('refresh_token');
        sessionStorage.removeItem('token');
        sessionStorage.removeItem('refresh_token');
    }

    private showTokenExpiredPopup(): void {
        checkAndHandleModal({ errorCode: 'DJ401UA' });
    }

    /**
     * Check if an error is related to token expiration
     */
    private isTokenExpiredError(error: any): boolean {
        const errorMessage = error?.message?.toLowerCase() || '';
        return (
            errorMessage.includes('token') || 
            errorMessage.includes('expired') || 
            errorMessage.includes('unauthorized') ||
            errorMessage.includes('auth') ||
            errorMessage.includes('jwt') ||
            errorMessage.includes('session') ||
            errorMessage.includes('401') ||
            errorMessage.includes('403')
        );
    }

    /**
     * Determine if an HTTP failure should be treated as an auth/session expiry issue.
     * Some endpoints may return 400 for auth problems, so we only classify 400 as auth
     * when the backend message explicitly indicates token/session/authentication failure.
     * HARDENING NOTE: This helper was added for "session expired" false-positive protection.
     * To roll back to legacy behavior, remove this helper and treat all 400 as auth failures.
     */
    private isAuthHttpFailure(status: number, errorText: string = ''): boolean {
        if (status === 401 || status === 403) {
            return true;
        }
        if (status !== 400) {
            return false;
        }
        const msg = (errorText || '').toLowerCase();
        return (
            msg.includes('token') ||
            msg.includes('expired') ||
            msg.includes('unauthorized') ||
            msg.includes('auth') ||
            msg.includes('jwt') ||
            msg.includes('session')
        );
    }

    /**
     * 2. Post a spin request to the server
     * This method sends a spin request and returns the server response
     */
    public async doSpin(bet: number, buyFeat: number, isEnhancedBet: boolean, isFs: boolean = false, preBetBalance?: number): Promise<SpinData> {
        if (this.rejectIfPlayInstanceLost()) {
            this.throwSuperseded();
        }
        // New buy-feature purchase = new bonus session; drop prior max-win session snapshots.
        if (buyFeat > 0) {
            this.clearBonusSessionSnapshots();
            this.resetFreeSpinIndex();
        }

        // Check if demo mode is active
        const isDemo = this.getDemoState();

        if (!isDemo && this.getReplayState() && this.replayData?.spinData) {
            const spinData = this.assignCurrentSpinData(this.replayData.spinData);
            console.log('[GameAPI] Replay mode: returning cached replay spinData');
            return spinData;
        }

        // SAMPLE DATA MODE: return data from src/game/spinDataSample/*.json
        if (this.isFakeDataModeEnabled()) {
            const fakeData = await this.loadFakeSpinData();
            if (fakeData) {
                const fakeSpin = this.getFakeSpinForRequest(bet, buyFeat);
                if (fakeSpin) {
                    this.assignCurrentSpinData(fakeSpin);
                    return this.currentSpinData!;
                }
            }
        }

        // Only require token if not in demo mode
        if (!isDemo) {
            let token = sessionStorage.getItem('token') || '';
            if (!token) {
                // Check if refresh token exists before attempting refresh
                if (!this.hasRefreshToken()) {
                    // No refresh token available, show popup immediately
                    this.showTokenExpiredPopup();
                    throw new Error('No game token available. Please initialize the game first.');
                }
                
                // Refresh token exists, try to get new access token
                const newToken = await this.tryRefreshAndGetNewToken();
                if (!newToken) {
                    // Refresh token exists but refresh failed, show popup
                    this.showTokenExpiredPopup();
                    throw new Error('No game token available. Please initialize the game first.');
                }
            }
        }
        
        try {
            // Demo mode uses analytics endpoint with simplified request body
            if (isDemo) {
                console.log('[GameAPI] Demo mode detected - using analytics endpoint');
                // Build headers - include Authorization only if token exists
                const headers: Record<string, string> = {
                    'Content-Type': 'application/json'
                };

                const token = sessionStorage.getItem('token');
                if (token) {
                    headers['Authorization'] = `Bearer ${token}`;
                }

                const requestBody: Record<string, unknown> = {
                    bet: bet.toString(),
                    gameId: GameAPI.GAME_ID,
                    isEnhancedBet: isEnhancedBet,
                    buyFeat: buyFeat,
                    isFs: false
                };
                // Demo: send pre-bet wallet so analytics can return a coherent post-bet balance.
                const walletSnapshot = Number(preBetBalance ?? GameAPI.DEMO_BALANCE);
                if (Number.isFinite(walletSnapshot) && walletSnapshot >= 0) {
                    requestBody.balance = walletSnapshot;
                }

                const response = await fetch(`${getApiBaseUrl()}/api/v1/analytics/spin`, {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify(requestBody)
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
                }

                const responseData = await response.json();
                if (!responseData.bet) {
                    responseData.bet = bet.toString();
                }

                const spinData = this.assignCurrentSpinData(responseData as SpinData);
                const slotAny: any = spinData.slot;
                const fsItems = slotAny?.freespin?.items || slotAny?.freeSpin?.items;
                if (Array.isArray(fsItems) && fsItems.length > 0 && (buyFeat > 0 || slotAny?.hasMaxWin === true)) {
                    this.resetFreeSpinIndex();
                }
                return spinData;
            }

            // Tag isFs from session flag / remaining grant. Do not decrement locally —
            // remaining is always the backend fsCount from the last isFs response.
            if (
                buyFeat === 0 &&
                (isFs || this.remainingInitFreeSpins > 0 || gameStateManager.isInFreeSpinRound === true)
            ) {
                isFs = true;
                console.log('[GameAPI] Initialization free-round spin (isFs). Remaining:', this.remainingInitFreeSpins);
            }

            // Build headers - include Authorization only if token exists
            const headers: Record<string, string> = {
                'Content-Type': 'application/json'
            };
            
            let token = sessionStorage.getItem('token') || '';
            if (token) {
                headers['Authorization'] = `Bearer ${token}`;
            }
            this.stampPlayInstance(headers);

            const url = `${getApiBaseUrl()}/api/v1/slots/bet`;
            const requestBody = {
                action: 'spin',
                bet: bet.toString(),
                line: 1, // Try different line count
                buyFeat: buyFeat, // Use the parameter value
                isEnhancedBet: isEnhancedBet, // Use the parameter value
                // Mark whether this spin is using a free spin round granted at initialization
                isFs: isFs
            };

            let currentToken = token;
            let response = await fetch(url, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(requestBody)
            });

            if (!response.ok && response.status === 401) {
                const parsed = await this.readBackendErrorResponse(response);
                if (this.noteInactivePlaySession(parsed)) {
                    this.throwSuperseded();
                }
                if (parsed.errorCode === 'DJ401TE') {
                    const newToken = await this.tryRefreshAndGetNewToken();
                    if (newToken) {
                        currentToken = newToken;
                        headers['Authorization'] = `Bearer ${currentToken}`;
                        this.stampPlayInstance(headers);
                        response = await fetch(url, {
                            method: 'POST',
                            headers: headers,
                            body: JSON.stringify(requestBody)
                        });
                    }
                } else {
                    checkAndHandleModal(parsed);
                }
            }

            if (!response.ok) {
                const parsed = await this.readBackendErrorResponse(response);
                if (this.noteInactivePlaySession(parsed)) {
                    this.throwSuperseded();
                }
                const errorText =
                    parsed.message_text ||
                    parsed.message ||
                    (await response.clone().text().catch(() => ''));
                
                // Special handling for 422 "No valid freespins available" during free spin rounds
                // This means the free spins have ended, so we should treat it as a graceful completion
                if (response.status === 422 && isFs && errorText.includes('No valid freespins available')) {
                    console.log('[GameAPI] 422 error: No valid freespins available - ending free spin round gracefully');
                    this.emitFreeRoundBetUpdate({
                        fsCount: 0,
                        fsStatus: FreeRoundStatus.COMPLETE,
                    });
                    return null as any;
                }
                
                const error = new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
                
                const popupHandled = checkAndHandleModal(parsed);
                if (popupHandled) {
                    (error as any).popupHandled = true;
                }
                if (response.status === 401) {
                    sessionStorage.removeItem('token');
                }
                
                throw error;
            }

            const responseData = await response.json();

            // Initialization free-round envelope (`isFs: true`): shared fields + per-game slot.
            if (isFs) {
                const envelope = responseData as FreeRoundBetResponse;
                this.emitFreeRoundBetUpdate(this.buildFreeRoundBetUpdate(envelope));
            }

            // Ensure bet is included (playable SpinData). Envelope fields stay on the JSON.
            if (!responseData.bet) {
                responseData.bet = bet.toString();
            }

            // If this response contains bonus free-spin items, save it for bonus mode
            console.log('[GameAPI] Checking response for free spin data...');
            console.log('[GameAPI] Response has slot:', !!responseData.slot);
            console.log('[GameAPI] Response has freespin:', !!responseData.slot?.freespin);
            console.log('[GameAPI] Response has freespin.items:', !!responseData.slot?.freespin?.items);
            console.log('[GameAPI] Response has freeSpin:', !!responseData.slot?.freeSpin);
            console.log('[GameAPI] Response has freeSpin.items:', !!responseData.slot?.freeSpin?.items);
            console.log('[GameAPI] Current isBonus state:', gameStateManager.isBonus);
            console.log('[GameAPI] Current currentSpinData has freespin:', !!this.currentSpinData?.slot?.freespin?.items);
            
            if (responseData.slot && (responseData.slot.freespin?.items || responseData.slot.freeSpin?.items)) {
                console.log('[GameAPI] Free spin data detected in response - saving for bonus mode');
                const items = responseData.slot.freespin?.items || responseData.slot.freeSpin?.items;
                console.log('[GameAPI] Free spin items count:', items.length);
                this.assignCurrentSpinData(responseData);
                console.log('[GameAPI] Free spin data saved to currentSpinData');
            } else if (gameStateManager.isBonus && this.currentSpinData && (this.currentSpinData.slot?.freespin?.items || this.currentSpinData.slot?.freeSpin?.items)) {
                console.log('[GameAPI] Preserving original free spin data during bonus mode');
                // Don't overwrite the original free spin data - keep it for simulation
            } else {
                console.log('[GameAPI] No free spin data detected - storing regular response');
                this.assignCurrentSpinData(responseData);
            }

            console.log('🎰 ===== SERVER RESPONSE DEBUG =====');
            console.log('📊 Full server response:', responseData);
            console.log('🎯 Freespin data:', responseData.slot?.freespin);
            console.log('🎯 Freespin count:', responseData.slot?.freespin?.count);
            console.log('🎯 Freespin items:', responseData.slot?.freespin?.items);
            console.log('🎯 Freespin items length:', responseData.slot?.freespin?.items?.length);
            console.log('🎲 Grid symbols:', responseData.slot?.area);
            console.log('💰 Paylines:', responseData.slot?.paylines);
            console.log('🎰 ===== END SERVER RESPONSE =====');
            
            return this.currentSpinData!;
            
        } catch (error) {
            console.error('Error in doSpin:', error);
            throw error;
        }
    }

    /**
     * Simulate a free spin using pre-determined data from SpinData.freespin.items
     * This method uses the area and paylines from the freespin items instead of calling the API
     */
    public async simulateFreeSpin(): Promise<SpinData> {
        if (this.isFakeDataModeEnabled()) {
            const fakeData = await this.loadFakeSpinData();
            if (!fakeData) {
                throw new Error("Fake data mode is enabled, but sample data could not be loaded from spinDataSample.");
            }

            const bonusEntry = Array.isArray(fakeData.bonusGame) ? fakeData.bonusGame[0] : null;
            const normalEntry = Array.isArray(fakeData.normalGame) ? fakeData.normalGame[0] : null;
            const fakeItems =
                bonusEntry?.slot?.freespin?.items ||
                bonusEntry?.slot?.freeSpin?.items ||
                normalEntry?.slot?.freespin?.items ||
                normalEntry?.slot?.freeSpin?.items ||
                this.currentSpinData?.slot?.freespin?.items ||
                this.currentSpinData?.slot?.freeSpin?.items;

            if (Array.isArray(fakeItems) && fakeItems.length > 0) {
                const baseSpin = (this.bonusSessionSpinData ?? this.bonusTriggerSpinData ?? this.currentSpinData ?? bonusEntry ?? normalEntry) as SpinData;
                if ((window as any).audioManager) {
                    (window as any).audioManager.playSoundEffect(SoundEffectType.SPIN);
                }
                return this.buildFreeSpinFromItems(fakeItems, baseSpin);
            }

            const betValue = Number(this.currentSpinData?.bet || 0) || 0;
            const fakeSpin = this.getNextFakeSpin(true, betValue);
            if (fakeSpin) {
                this.currentSpinData = fakeSpin;
                return fakeSpin;
            }

            throw new Error("Fake data mode is enabled, but no bonus sample data is available for free spin simulation.");
        }

        if (!this.currentSpinData || (!this.currentSpinData.slot?.freespin?.items && !this.currentSpinData.slot?.freeSpin?.items)) {
            console.error('[GameAPI] No free spin data available. Current spin data:', this.currentSpinData);
            console.error('[GameAPI] Available freespin data:', this.currentSpinData?.slot?.freespin);
            throw new Error('No free spin data available. Please ensure SpinData contains freespin items.');
        }

        const freespinData = this.currentSpinData.slot.freespin || this.currentSpinData.slot.freeSpin;
        const items = truncateFreeSpinItemsAfterFirstMaxWin(freespinData.items);

        if ((window as any).audioManager) {
            (window as any).audioManager.playSoundEffect(SoundEffectType.SPIN);
            console.log('[GameAPI] Playing spin sound effect for free spin simulation');
        }

        return this.buildFreeSpinFromItems(items, (this.bonusSessionSpinData ?? this.bonusTriggerSpinData ?? this.currentSpinData)!);
    }

    /**
     * Max-win cap from the buy-feature / scatter trigger spin's slot.totalWin (not freeSpin.totalWin).
     */
    public getMaxWinCapTotal(): number {
        const slot: any = this.bonusSessionSpinData?.slot ?? this.bonusTriggerSpinData?.slot;
        return this.getBonusSessionTotalWinFromSlot(slot);
    }

    /**
     * Authoritative session total from the trigger/session spin snapshot.
     * slot.totalWin is the cap when hasMaxWin; base/bonus.win may exceed it uncapped.
     */
    public getBonusSessionTotalWin(): number {
        const slot: any = this.bonusSessionSpinData?.slot ?? this.bonusTriggerSpinData?.slot ?? this.currentSpinData?.slot;
        if (!slot) return 0;
        return this.getBonusSessionTotalWinFromSlot(slot);
    }

    /** Snapshot of the bet response that started the bonus (authoritative slot.totalWin). */
    public getBonusSessionSpinData(): SpinData | null {
        return this.bonusSessionSpinData;
    }

    /**
     * Authoritative session/cap total from a trigger/session slot. Prefer slot.totalWin (the cap
     * when hasMaxWin); fall back to base.win + bonus.win. Buy-feature spins can arrive with
     * slot.totalWin = 0 and the session total only in bonus.win — without this fallback the cap
     * resolves to 0 and the max-win drawer never triggers. Mirrors beelze_bop.
     */
    private getBonusSessionTotalWinFromSlot(slot: any): number {
        if (!slot) return 0;
        const slotTotal = Number(slot.totalWin ?? 0);
        if (Number.isFinite(slotTotal) && slotTotal > 0) {
            return slotTotal;
        }
        const baseWin = Number(slot?.base?.win ?? 0);
        const bonusWin = Number(slot?.bonus?.win ?? 0);
        if (Number.isFinite(baseWin) && Number.isFinite(bonusWin) && (baseWin + bonusWin) > 0) {
            return baseWin + bonusWin;
        }
        return 0;
    }

    private captureBonusSessionSpinIfNeeded(spinData: SpinData | null): void {
        if (!spinData?.slot) return;
        const fs = spinData.slot.freespin || spinData.slot.freeSpin;
        const items = Array.isArray(fs?.items) ? fs.items : [];
        if (items.length === 0) return;

        const total = Number(spinData.slot.totalWin);
        if (!Number.isFinite(total)) return;

        // Always refresh — a prior max-win buy feature must not pin slot.totalWin for the next session.
        this.bonusSessionSpinData = JSON.parse(JSON.stringify(spinData)) as SpinData;
        console.log(`[GameAPI] Captured bonus session spin — slot.totalWin=${total}`);
    }

    private captureBonusTriggerSpinIfNeeded(spinData: SpinData | null): void {
        if (!spinData?.slot) return;
        const slot: any = spinData.slot;
        // Detection is slot.hasMaxWin only (no per-item isMaxWin). Capture even for a base-game
        // max win (no freeSpin.items) so getMaxWinCapTotal() resolves the cap for the single spin.
        if (slot.hasMaxWin !== true) return;

        // Cap = slot.totalWin, or base.win + bonus.win when totalWin is 0 (buy-feature spins).
        const cap = this.getBonusSessionTotalWinFromSlot(slot);
        if (!Number.isFinite(cap) || cap <= 0) return;

        this.bonusTriggerSpinData = JSON.parse(JSON.stringify(spinData)) as SpinData;
        console.log(`[GameAPI] Captured max-win spin snapshot — cap=${cap}`);
    }

    private assignCurrentSpinData(spinData: SpinData): SpinData {
        const normalized = normalizeMaxWinItemsInSpinData(spinData) as SpinData;
        this.currentSpinData = normalized;
        const slot: any = normalized?.slot;
        const fs = slot?.freespin || slot?.freeSpin;
        const items = Array.isArray(fs?.items) ? fs.items : [];
        if (items.length === 0) {
            this.clearBonusSessionSnapshots();
        } else {
            this.captureBonusSessionSpinIfNeeded(normalized);
        }
        // Detection is slot.hasMaxWin only — drop a stale trigger snapshot when this spin is not max-win.
        if (slot?.hasMaxWin !== true) {
            this.bonusTriggerSpinData = null;
        }
        this.captureBonusTriggerSpinIfNeeded(normalized);
        return normalized;
    }

    /**
     * Get the current spin data
     * Returns the last spin data that was received from the server
     */
    public getCurrentSpinData(): SpinData | null {
        return this.currentSpinData;
    }

    /**
     * Set the current free spin index explicitly.
     * Used when resuming an unresolved free-spin round.
     */
    public setCurrentFreeSpinIndex(index: number): void {
        const safeIndex = Number.isFinite(index) ? Math.max(0, Math.floor(index)) : 0;
        console.log('🎰 Setting current free spin index to', safeIndex);
        this.currentFreeSpinIndex = safeIndex;
    }

    /**
     * Current free-spin item index (next item to simulate). After {@link simulateFreeSpin}, this is incremented.
     */
    public getCurrentFreeSpinIndex(): number {
        return this.currentFreeSpinIndex;
    }

    /**
     * Free-spin item that was just applied by simulateFreeSpin / buildFreeSpinFromItems.
     * Index is incremented after each simulated spin, so the played item is index - 1.
     */
    public getLastPlayedFreeSpinItem(): any | null {
        if (!this.currentSpinData) return null;
        const slot: any = this.currentSpinData.slot;
        const fs = slot?.freespin || slot?.freeSpin;
        const items = Array.isArray(fs?.items) ? fs.items : [];
        const playedIndex = this.currentFreeSpinIndex - 1;
        if (playedIndex < 0 || playedIndex >= items.length) return null;
        return items[playedIndex] ?? null;
    }

    /**
     * Reset the free spin index when starting a new scatter bonus
     * This should be called when a new scatter bonus is triggered
     */
    public resetFreeSpinIndex(): void {
        console.log('🎰 Resetting free spin index to 0');
        this.currentFreeSpinIndex = 0;
    }

    /**
     * Clear the current spin data
     * Useful for resetting state between spins
     */
    /** Clear trigger/session snapshots used for max-win cap and Congrats slot.totalWin. */
    public clearBonusSessionSnapshots(): void {
        this.bonusTriggerSpinData = null;
        this.bonusSessionSpinData = null;
    }

    public clearCurrentSpinData(): void {
        this.currentSpinData = null;
        this.clearBonusSessionSnapshots();
    }

    /**
     * Set the free spin data for simulation
     * This method should be called when free spins are triggered to provide the data for simulation
     */
    public setFreeSpinData(spinData: SpinData): void {
        console.log('[GameAPI] Setting free spin data for simulation:', spinData);
        this.assignCurrentSpinData(spinData);
        this.resetFreeSpinIndex(); // Reset the index when setting new data
    }

    /** Zero remaining freespin steps and advance the sim index after max win. */
    public resolveRemainingFreeSpinsOnMaxWin(): void {
        if (!this.currentSpinData) {
            return;
        }
        resolveMaxWinRemainingFreespinItems(this.currentSpinData);
        const fs = this.currentSpinData.slot?.freespin || this.currentSpinData.slot?.freeSpin;
        const itemCount = Array.isArray(fs?.items) ? fs.items.length : 0;
        if (itemCount > 0) {
            this.currentFreeSpinIndex = itemCount;
            console.log('[GameAPI] Max win — resolved remaining freespin items, index=', this.currentFreeSpinIndex);
        }
    }

    /**
     * Initialize the player's balance on game start
     * This method calls getBalance and updates the GameData with the current balance
     */
    public async initializeBalance(): Promise<number> {
        const isDemo = this.getDemoState();
        if (isDemo || this.isFakeDataModeEnabled()) {
            return GameAPI.DEMO_BALANCE;
        }

        if (this.getReplayState()) {
            return -1;
        }

        try {
            console.log('[GameAPI] Initializing player balance...');
            
            const balanceResponse = await this.getBalance();
            console.log('[GameAPI] Balance response received:', balanceResponse);
            
            // Extract balance from response - adjust this based on actual API response structure
            let balance = 0;
            if (balanceResponse && balanceResponse.data && balanceResponse.data.balance !== undefined) {
                balance = parseFloat(balanceResponse.data.balance);
            } else if (balanceResponse && balanceResponse.balance !== undefined) {
                balance = parseFloat(balanceResponse.balance);
            } else {
                console.warn('[GameAPI] Unexpected balance response structure:', balanceResponse);
                // Fallback to a default balance if structure is unexpected
                balance = 0;
            }
            
            console.log(`[GameAPI] Initialized balance: $${balance}`);
            return balance;
            
        } catch (error) {
            console.error('[GameAPI] Error initializing balance:', error);
            // Return a default balance if API call fails
            const defaultBalance = 0;
            console.log(`[GameAPI] Using default balance: $${defaultBalance}`);
            return defaultBalance;
        }
    }

    public async getHistory(page: number, limit: number): Promise<any> {
        // Check if demo mode is active - don't make API call in demo mode
        const isDemo = this.getDemoState();
        if (isDemo) {
            // Return empty history data for demo mode
            return {
                data: [],
                meta: {
                    page: 1,
                    pageCount: 1,
                    totalPages: 1,
                    total: 0
                }
            };
        }

        const apiUrl = `${getApiBaseUrl()}/api/v1/games/me/histories`;
        let token = sessionStorage.getItem('token') || '';

        let response = await fetch(`${apiUrl}?limit=${limit}&page=${page}`, {
            method: 'GET',
            headers: this.stampPlayInstance({
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            })
        });

        if (!response.ok && response.status === 401) {
            const parsed = await this.readBackendErrorResponse(response);
            if (this.noteInactivePlaySession(parsed)) {
                this.throwSuperseded();
            }
            if (parsed.errorCode === 'DJ401TE') {
                const newToken = await this.tryRefreshAndGetNewToken();
                if (newToken) {
                    token = newToken;
                    response = await fetch(`${apiUrl}?limit=${limit}&page=${page}`, {
                        method: 'GET',
                        headers: this.stampPlayInstance({
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${token}`
                        })
                    });
                }
            }
        }

        const data = await response.json();
        return data;
    }

    /**
     * Demo / local-fixture mode (no live spins, demo balance, no unresolved-spin resume).
     * True for ?demo=true or sample-data flags such as ?maxWin=true.
     */
    public getDemoState(): boolean {
        if (this.isFakeDataModeEnabled()) {
            return true;
        }
        const demoValue =
            getUrlParameter('demo') === 'true' ||
            sessionStorage.getItem('demo') === 'true';
        console.log('[GameAPI] Getting demo state', demoValue);
        return demoValue;
    }

    /**
     * Get the game ID constant
     * @returns The game ID string
     */
    public getGameId(): string {
        return GameAPI.GAME_ID;
    }

    /** Access JWT used by the slot session (shared with scratch Join). */
    public getAccessToken(): string {
        return sessionStorage.getItem('token')
            || getUrlParameter('token')
            || '';
    }

    /**
     * Get the demo balance constant
     * @returns The demo balance number
     */
    public getDemoBalance(): number {
        return GameAPI.DEMO_BALANCE;
    }

    /**
     * Update the demo balance value
     * @param newBalance - The new balance value to set
     */
    public updateDemoBalance(newBalance: number): void {
        console.log(`[GameAPI] Demo balance updated from $${GameAPI.DEMO_BALANCE} to: $${newBalance}`);
        GameAPI.DEMO_BALANCE = newBalance;
    }

    private async readBackendErrorResponse(response: Response): Promise<BackendErrorResponse> {
        const status = response.status;
        try {
            const json: any = await response.clone().json();
            const data = (json && typeof json === 'object' && 'data' in json) ? (json as any).data : json;
            const errorCode = typeof data?.errorCode === 'string' ? data.errorCode : undefined;
            const message_text = typeof data?.message_text === 'string' ? data.message_text : undefined;
            const message = typeof data?.message === 'string' ? data.message : undefined;
            return { status, errorCode, message_text, message };
        } catch {
            const text = await response.clone().text().catch(() => '');
            return { status, message: text };
        }
    }
}   

