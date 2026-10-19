import * as signalR from '@microsoft/signalr';

export const GAME_TYPE_SCRATCH = 2;

export interface ScratchCellDto {
	index: number;
	symbol: string;
	prizeMultiplier?: number | null;
}

export interface ScratchBonusCellDto {
	index: number;
	prizeMultiplier: number;
}

export interface ScratchCardDto {
	tier: string;
	gridSize: string | number;
	gridDimension: number;
	matchCount: number;
	cells: ScratchCellDto[];
	bonusCells: ScratchBonusCellDto[];
	bonusTriggered: boolean;
	winMultiplier: number;
	appliedMultiplierSymbol: number;
	winAmount: number;
	isWin: boolean;
}

export interface ScratchPayTierDto {
	tier: string;
	/** Match symbol for this tier (Star, Diamond, Crown, Gem, Coin, Jackpot). */
	symbol?: string;
	multiplier: number;
}

export type ScratchGridSizeChoice = 0 | 1 | 2;

export interface ScratchGameSnapshot {
	message?: string;
	errorCode?: string | null;
	player?: { balance?: number; playerId?: string; timestamp?: number };
	config?: {
		defaultBet?: number;
		minBet?: number;
		maxBet?: number;
		scratchGridSize?: string | number;
		/** Active / default grid pay table (kept for older servers). */
		scratchPayTable?: ScratchPayTierDto[];
		/**
		 * Symbols + multipliers for every scratch dimension.
		 * Keys: ThreeByThree / FourByFour / FiveByFive (also accepts "0"|"1"|"2").
		 */
		scratchPayTablesByGrid?: Record<string, ScratchPayTierDto[]>;
		configuredRtpPercent?: number;
		rtp?: string | number;
	};
	round?: {
		status?: number | string;
		sessionId?: string | null;
		betAmount?: number;
		winAmount?: number;
		scratchGridSize?: string | number;
		scratchCard?: ScratchCardDto | null;
	};
}

export interface ScratchClientOptions {
	hubBaseUrl: string;
	/** Live JWT from the slot session (`sessionStorage.token`). */
	getAccessToken: () => string | null;
	/** Active slot operator session — live Join attaches to this instead of Initialize. */
	getSessionId?: () => string | null;
	/** Slot player id when attaching to the existing session. */
	getPlayerId?: () => string | null;
	/** Slot operator id. JoinScratch requires this as the ninth argument. */
	getOperatorId?: () => string | null;
	/** Demo API key when the slot is in demo mode. */
	getDemoApiKey?: () => string | null;
	/** Casino domain sent on slot initialize (`ancestorOrigins`). */
	getDomain?: () => string | null;
	/** Client IP returned/stored by slot initialize. */
	getIp?: () => string | null;
	/** Slot RTP (e.g. "95" / "97" / "99" or range label) so scratch uses the same math. */
	getRtp?: () => string | null;
	/** Slot currency from initialize. JoinScratch requires this as the tenth argument. */
	getCurrency?: () => string | null;
	/** Slot currency symbol from initialize. JoinScratch requires this as the eleventh argument. */
	getCurrencySymbol?: () => string | null;
	isDemo: () => boolean;
	gameId: string;
	lang?: string;
	onSessionReplaced?: () => void;
	onSnapshot?: (snap: ScratchGameSnapshot) => void;
}

function getUrlParam(name: string): string | null {
	try {
		return new URLSearchParams(window.location.search).get(name);
	} catch {
		return null;
	}
}

/**
 * SignalR client for galaxite scratch (GameType = 2).
 * Reuses the slot JWT / demo key and attaches Join to the slot operator session.
 */
export class ScratchClient {
	private connection: signalR.HubConnection | null = null;
	private joined = false;
	private lastSnapshot: ScratchGameSnapshot | null = null;
	private joinedSessionId: string | null = null;
	private connecting: Promise<void> | null = null;
	private joining: Promise<ScratchGameSnapshot> | null = null;
	private sessionReplaced = false;
	private sessionReplacedHandler?: () => void;

	constructor(private readonly options: ScratchClientOptions) {}

	getLastSnapshot(): ScratchGameSnapshot | null {
		return this.lastSnapshot;
	}

	/** Clear sticky errorCode/message so reopen does not re-show a consumed error. */
	clearLastError(): void {
		if (!this.lastSnapshot?.errorCode && !this.lastSnapshot?.message) {
			return;
		}
		this.lastSnapshot = {
			...this.lastSnapshot,
			errorCode: null,
			message: undefined,
		};
	}

	isConnected(): boolean {
		return this.connection?.state === signalR.HubConnectionState.Connected;
	}

	/** Attach the slot scene handler when this client was opened during initialize. */
	setOnSessionReplaced(handler: () => void): void {
		this.sessionReplacedHandler = handler;
	}

	/** Start the hub websocket without joining. */
	connect(): Promise<void> {
		return this.ensureConnection();
	}

	isJoined(): boolean {
		return this.joined && this.isConnected();
	}

	/**
	 * Live scratch requires the slot JWT + operator sessionId.
	 * Demo requires an API key. When the slot session expires (idle / 401),
	 * the token is cleared and this returns false.
	 */
	isSessionReplaced(): boolean {
		return this.sessionReplaced;
	}

	isSlotSessionPlayable(): boolean {
		if (this.sessionReplaced) {
			return false;
		}
		if (this.options.isDemo()) {
			return true;
		}
		const token = this.options.getAccessToken()?.trim();
		const sessionId = this.resolveSlotSessionId();
		return !!token && !!sessionId;
	}

	async ensureJoined(): Promise<ScratchGameSnapshot> {
		this.assertSlotSessionPlayable();
		await this.ensureConnection();
		const wanted = this.resolveSlotSessionId();
		if (
			this.joined &&
			this.lastSnapshot &&
			!this.lastSnapshot.errorCode &&
			(!wanted || wanted === this.joinedSessionId)
		) {
			return this.lastSnapshot;
		}
		return this.join();
	}

	async join(): Promise<ScratchGameSnapshot> {
		this.assertSlotSessionPlayable();
		if (this.joining) {
			return this.joining;
		}
		this.joining = this.joinOnce().finally(() => {
			this.joining = null;
		});
		return this.joining;
	}

	async startRound(betAmount: number, gridSize: 0 | 1 | 2 = 0): Promise<ScratchGameSnapshot> {
		this.assertSlotSessionPlayable();
		await this.ensureJoined();
		const snap = (await this.connection!.invoke(
			'StartRound',
			Math.round(betAmount * 100) / 100,
			gridSize,
		)) as ScratchGameSnapshot;
		this.publish(snap);
		return snap;
	}

	async cashout(): Promise<ScratchGameSnapshot> {
		this.assertSlotSessionPlayable();
		await this.ensureJoined();
		const snap = (await this.connection!.invoke('Cashout')) as ScratchGameSnapshot;
		this.publish(snap);
		return snap;
	}

	async disconnect(): Promise<void> {
		this.joined = false;
		this.joinedSessionId = null;
		const conn = this.connection;
		this.connection = null;
		if (conn) {
			try {
				await conn.stop();
			} catch {
				/* noop */
			}
		}
	}

	private publish(snap: ScratchGameSnapshot): void {
		this.lastSnapshot = snap;
		this.options.onSnapshot?.(snap);
	}

	private async joinOnce(): Promise<ScratchGameSnapshot> {
		if (this.sessionReplaced) {
			throw new Error('Scratch session was replaced.');
		}
		await this.ensureConnection();
		const isDemo = this.options.isDemo();
		const sessionId = this.resolveSlotSessionId();
		if (!isDemo && !sessionId) {
			throw new Error('Scratch requires the active slot session.');
		}
		const lang = this.options.lang ?? getUrlParam('lang') ?? '';
		const playerId = this.options.getPlayerId?.()?.trim() || '';
		const ip = this.options.getIp?.()?.trim() || '';
		const domain = this.options.getDomain?.()?.trim() || '';
		const rtp = this.options.getRtp?.()?.trim() || '';
		const operatorId = this.options.getOperatorId?.()?.trim() || '';
		const currency = this.options.getCurrency?.()?.trim() || '';
		const currencySymbol = this.options.getCurrencySymbol?.()?.trim() || '';
		const snap = (await this.connection!.invoke(
			'JoinScratch',
			ip,
			domain,
			isDemo,
			this.options.gameId,
			lang,
			sessionId,
			playerId,
			rtp,
			operatorId,
			currency,
			currencySymbol,
		)) as ScratchGameSnapshot;
		this.joined = !snap.errorCode && !!(snap.round?.sessionId?.trim() || sessionId);
		this.joinedSessionId = this.joined
			? (snap.round?.sessionId?.trim() || sessionId || null)
			: null;
		this.publish(snap);
		return snap;
	}

	private async ensureConnection(): Promise<void> {
		if (this.connection?.state === signalR.HubConnectionState.Connected) {
			return;
		}
		if (this.connecting) {
			await this.connecting;
			const state = this.connection?.state as signalR.HubConnectionState | undefined;
			if (state === signalR.HubConnectionState.Connected) {
				return;
			}
		}
		this.connecting = this.connectOnce().finally(() => {
			this.connecting = null;
		});
		await this.connecting;
	}

	private assertSlotSessionPlayable(): void {
		if (this.isSlotSessionPlayable()) {
			return;
		}
		this.joined = false;
		this.joinedSessionId = null;
		throw new Error('Scratch requires a valid slot session.');
	}

	private async connectOnce(): Promise<void> {
		this.assertSlotSessionPlayable();
		if (this.connection) {
			try {
				await this.connection.stop();
			} catch {
				/* noop */
			}
			this.connection = null;
			this.joined = false;
			this.joinedSessionId = null;
		}

		const isDemo = this.options.isDemo();
		const hubBase = this.resolveHubBase();
		const hubUrl = new URL('/hubs/game', hubBase);
		if (isDemo) {
			const apiKey = this.options.getDemoApiKey?.() ?? '';
			if (!apiKey) {
				throw new Error('Scratch demo requires an API key (APP_CONFIG[\'api-key\']).');
			}
			hubUrl.searchParams.set('apiKey', apiKey);
		}

		const connection = new signalR.HubConnectionBuilder()
			.withUrl(hubUrl.toString(), {
				accessTokenFactory: () => (isDemo ? '' : (this.options.getAccessToken() ?? '')),
				transport: signalR.HttpTransportType.WebSockets,
				skipNegotiation: true,
				withCredentials: false,
			})
			.withAutomaticReconnect({
				nextRetryDelayInMilliseconds: (ctx) => {
					if (this.sessionReplaced) {
						return null;
					}
					const delays = [0, 2000, 10000, 30000];
					return ctx.previousRetryCount < delays.length
						? delays[ctx.previousRetryCount]
						: null;
				},
			})
			.build();

		connection.on('SessionReplaced', () => {
			this.sessionReplaced = true;
			this.joined = false;
			this.joinedSessionId = null;
			void connection.stop().catch(() => {
				/* noop */
			});
			this.options.onSessionReplaced?.();
			this.sessionReplacedHandler?.();
		});

		connection.onreconnected(() => {
			if (this.sessionReplaced) {
				void connection.stop().catch(() => {
					/* noop */
				});
				return;
			}
			this.joined = false;
			this.joinedSessionId = null;
			void this.join().catch((err) => {
				console.warn('[ScratchClient] Re-join after reconnect failed', err);
			});
		});

		await connection.start();
		this.connection = connection;
	}

	private resolveSlotSessionId(): string {
		return this.options.getSessionId?.()?.trim() || '';
	}

	private resolveHubBase(): string {
		const raw = this.options.hubBaseUrl?.trim();
		if (!raw) {
			throw new Error('Scratch hub URL is not configured (APP_CONFIG[\'websocket-url\']).');
		}
		return raw.endsWith('/') ? raw : `${raw}/`;
	}
}

export function isScratchRoundActive(round: ScratchGameSnapshot['round'] | undefined): boolean {
	if (!round) {
		return false;
	}
	const status = round.status;
	return status === 1 || status === 'Ongoing' || status === '1';
}

export function normalizeScratchGridSize(value: unknown): ScratchGridSizeChoice {
	const n = Number(value);
	if (n === 0 || n === 1 || n === 2) {
		return n;
	}
	return 0;
}

const GRID_PAY_TABLE_KEYS: Record<ScratchGridSizeChoice, string[]> = {
	0: ['ThreeByThree', '0'],
	1: ['FourByFour', '1'],
	2: ['FiveByFive', '2'],
};

/** Pay rows for a scratch dimension from join (`scratchPayTablesByGrid`), with flat-table fallback. */
export function scratchPayTableForGrid(
	config: ScratchGameSnapshot['config'] | undefined,
	gridSize: ScratchGridSizeChoice,
): ScratchPayTierDto[] | undefined {
	const byGrid = config?.scratchPayTablesByGrid;
	if (byGrid) {
		for (const key of GRID_PAY_TABLE_KEYS[gridSize]) {
			const rows = byGrid[key];
			if (Array.isArray(rows) && rows.length > 0) {
				return rows;
			}
		}
	}
	const flat = config?.scratchPayTable;
	return Array.isArray(flat) && flat.length > 0 ? flat : undefined;
}

const BASE_LEGEND_SYMBOL_ORDER = ['Star', 'Diamond', 'Crown', 'Gem', 'Coin', 'Jackpot'] as const;

function isMysteryTier(tier: string | undefined): boolean {
	return /Ms1|Ms2/i.test(tier || '');
}

function mysteryFactorFromPayTable(
	rows: ScratchPayTierDto[],
	which: 'Ms1' | 'Ms2',
	fallback: number,
): number | null {
	const has =
		which === 'Ms1'
			? rows.some((r) => /Ms1/i.test(r.tier || ''))
			: rows.some((r) => /Ms2/i.test(r.tier || ''));
	if (!has) return null;
	const base = rows.find((r) => r.tier === 'SmallWin')?.multiplier ?? 1;
	const msTier = which === 'Ms1' ? 'SmallWinMs1' : 'SmallWinMs2';
	const ms = rows.find((r) => r.tier === msTier)?.multiplier;
	if (typeof ms === 'number' && base > 0) {
		const factor = ms / base;
		return Number.isFinite(factor) && factor > 0 ? factor : fallback;
	}
	return fallback;
}

/**
 * Legend rows for the selected grid: unique match symbols + Ms1/Ms2 factors when the
 * join pay table for that dimension includes those mystery tiers.
 */
export function scratchLegendRowsForGrid(
	config: ScratchGameSnapshot['config'] | undefined,
	gridSize: ScratchGridSizeChoice,
	fallback: ReadonlyArray<{
		symbol: string;
		multiplier: number;
		jackpotByGrid?: { three: number; four: number; five: number };
	}>,
	ms1Fallback = 2,
	ms2Fallback = 3,
): Array<{ symbol: string; mult: number; label?: string }> {
	const fromServer = scratchPayTableForGrid(config, gridSize);
	const hasPerGrid = !!config?.scratchPayTablesByGrid;
	const gridKey = gridSize === 0 ? 'three' : gridSize === 1 ? 'four' : 'five';

	const rows: Array<{ symbol: string; mult: number; label?: string }> = fallback.map((base) => {
		const serverRow = fromServer?.find(
			(r) =>
				r.symbol === base.symbol &&
				!isMysteryTier(r.tier) &&
				(base.symbol !== 'Jackpot' || /Jackpot/i.test(r.tier || '')),
		);
		let mult = serverRow?.multiplier ?? base.multiplier;
		if (base.jackpotByGrid && !serverRow) {
			mult = base.jackpotByGrid[gridKey];
		} else if (base.symbol === 'Jackpot' && serverRow) {
			// Flat legacy table is usually 5×5 — only trust Jackpot when per-grid data exists
			// or the selected grid is 5×5.
			mult = hasPerGrid || gridSize === 2 ? serverRow.multiplier : (base.jackpotByGrid?.[gridKey] ?? serverRow.multiplier);
		}
		return { symbol: base.symbol, mult };
	});

	// If join sent symbols not in the hardcoded fallback, append them (stable order).
	if (fromServer?.length) {
		const known = new Set(rows.map((r) => r.symbol));
		for (const symbol of BASE_LEGEND_SYMBOL_ORDER) {
			if (known.has(symbol)) continue;
			const serverRow = fromServer.find(
				(r) => r.symbol === symbol && !isMysteryTier(r.tier),
			);
			if (!serverRow) continue;
			rows.push({ symbol, mult: serverRow.multiplier });
			known.add(symbol);
		}
	}

	// Per-grid join tables encode which mystery symbols exist; flat legacy tables do not.
	const ms1 = hasPerGrid
		? mysteryFactorFromPayTable(fromServer ?? [], 'Ms1', ms1Fallback)
		: gridSize >= 1
			? ms1Fallback
			: null;
	const ms2 = hasPerGrid
		? mysteryFactorFromPayTable(fromServer ?? [], 'Ms2', ms2Fallback)
		: gridSize >= 2
			? ms2Fallback
			: null;
	if (ms1 != null) {
		rows.push({ symbol: 'Ms1', mult: ms1, label: `+×${ms1}` });
	}
	if (ms2 != null) {
		rows.push({ symbol: 'Ms2', mult: ms2, label: `+×${ms2}` });
	}
	return rows;
}

/** Base match-symbol multiplier for a grid, preferring join pay-table rows. */
export function scratchBaseMultiplierForSymbol(
	symbol: string,
	config: ScratchGameSnapshot['config'] | undefined,
	gridSize: ScratchGridSizeChoice,
	fallback: (symbol: string, gridDim: number) => number,
): number {
	const fromServer = scratchPayTableForGrid(config, gridSize);
	const hasPerGrid = !!config?.scratchPayTablesByGrid;
	const serverRow = fromServer?.find(
		(r) =>
			r.symbol === symbol &&
			!isMysteryTier(r.tier) &&
			(symbol !== 'Jackpot' || /Jackpot/i.test(r.tier || '')),
	);
	if (
		serverRow &&
		typeof serverRow.multiplier === 'number' &&
		(symbol !== 'Jackpot' || hasPerGrid || gridSize === 2)
	) {
		return serverRow.multiplier;
	}
	const dim = gridSize === 0 ? 3 : gridSize === 1 ? 4 : 5;
	return fallback(symbol, dim);
}

/** Ms1/Ms2 additional factors for a grid from join (or null when that special is unavailable). */
export function scratchMysteryFactorsForGrid(
	config: ScratchGameSnapshot['config'] | undefined,
	gridSize: ScratchGridSizeChoice,
	ms1Fallback = 2,
	ms2Fallback = 3,
): { ms1: number | null; ms2: number | null } {
	const fromServer = scratchPayTableForGrid(config, gridSize);
	if (config?.scratchPayTablesByGrid && fromServer?.length) {
		return {
			ms1: mysteryFactorFromPayTable(fromServer, 'Ms1', ms1Fallback),
			ms2: mysteryFactorFromPayTable(fromServer, 'Ms2', ms2Fallback),
		};
	}
	return {
		ms1: gridSize >= 1 ? ms1Fallback : null,
		ms2: gridSize >= 2 ? ms2Fallback : null,
	};
}

export function scratchGridDimension(
	card: ScratchCardDto | null | undefined,
	config: ScratchGameSnapshot['config'],
): number {
	if (card?.gridDimension) {
		return Number(card.gridDimension);
	}
	const named = card?.gridSize ?? config?.scratchGridSize;
	if (named === 'ThreeByThree' || named === 0 || named === '0') return 3;
	if (named === 'FourByFour' || named === 1 || named === '1') return 4;
	if (named === 'FiveByFive' || named === 2 || named === '2') return 5;
	const cells = card?.cells?.length ?? 0;
	if (cells === 9) return 3;
	if (cells === 16) return 4;
	return 5;
}

export function scratchGridSizeChoiceFromDimension(dim: number): ScratchGridSizeChoice {
	if (dim <= 3) return 0;
	if (dim === 4) return 1;
	return 2;
}


const SCRATCH_DEMO_API_KEY_FALLBACK = 'Y2hhaW50YWJsZWV4YWN0anVtcGV4YW1wbGV5b3VuZ2U=';

function scratchHubBaseUrl(): string {
	const configuredUrl = (window as unknown as { APP_CONFIG?: Record<string, string> })
		?.APP_CONFIG?.['websocket-url'];
	if (typeof configuredUrl === 'string' && configuredUrl.trim().length > 0) {
		return configuredUrl.trim().replace(/\/?$/, '/');
	}
	return 'https://stg-crashgame-api.dijoker.com/';
}

function scratchDemoApiKey(): string | null {
	const cfg = (window as unknown as { APP_CONFIG?: Record<string, string> })?.APP_CONFIG;
	const configuredKey = cfg?.['api-key'];
	if (typeof configuredKey === 'string' && configuredKey.trim().length > 0) {
		return configuredKey.trim();
	}
	return SCRATCH_DEMO_API_KEY_FALLBACK;
}

type ScratchHubGameApi = {
	getDemoState?: () => boolean;
	getReplayState?: () => boolean;
	getAccessToken?: () => string | null;
	getSessionId?: () => string | null;
	getInitializationData?: () => any;
	getPlayerId?: () => string | null;
	getOperatorId?: () => string | null;
	getJoinDomain?: () => string | null;
	getJoinIp?: () => string | null;
	getRtp?: () => string | null;
	getGameId?: () => string | null;
};

let warmedScratchClient: ScratchClient | null = null;

/** Join the scratch hub as soon as slot initialize has a playable live session. Replay does not join. */
export function startScratchHubAfterInitialize(gameAPI: ScratchHubGameApi): void {
	if (warmedScratchClient) {
		return;
	}
	try {
		if (gameAPI.getReplayState?.()) {
			return;
		}
		const isDemo = !!gameAPI.getDemoState?.();
		if (!isDemo) {
			const token = (gameAPI.getAccessToken?.() || sessionStorage.getItem('token') || '').trim();
			const sessionId = (gameAPI.getSessionId?.() || gameAPI.getInitializationData?.()?.sessionId || '').trim();
			if (!token || !sessionId) {
				return;
			}
		}
		const client = new ScratchClient({
			hubBaseUrl: scratchHubBaseUrl(),
			getAccessToken: () => gameAPI.getAccessToken?.() ?? sessionStorage.getItem('token'),
			getSessionId: () => gameAPI.getSessionId?.() ?? gameAPI.getInitializationData?.()?.sessionId ?? '',
			getPlayerId: () => gameAPI.getPlayerId?.() ?? gameAPI.getInitializationData?.()?.playerId ?? '',
			getOperatorId: () => gameAPI.getOperatorId?.() ?? '',
			getDemoApiKey: () => scratchDemoApiKey(),
			getDomain: () => gameAPI.getJoinDomain?.() ?? gameAPI.getInitializationData?.()?.domain ?? '',
			getIp: () => gameAPI.getJoinIp?.() ?? gameAPI.getInitializationData?.()?.ip ?? '',
			getRtp: () => gameAPI.getRtp?.() ?? '',
			getCurrency: () => {
				const value = gameAPI.getInitializationData?.()?.currency;
				return value == null ? '' : String(value);
			},
			getCurrencySymbol: () => {
				const value = gameAPI.getInitializationData?.()?.currencySymbol;
				return value == null ? '' : String(value);
			},
			isDemo: () => !!gameAPI.getDemoState?.(),
			gameId: gameAPI.getGameId?.() ?? '',
		});
		warmedScratchClient = client;
		void client.ensureJoined().catch((err) => {
			console.warn('[ScratchClient] JoinScratch after initialize failed', err);
		});
	} catch (err) {
		console.warn('[ScratchClient] Hub connect after initialize failed', err);
	}
}

export function takeWarmedScratchClient(): ScratchClient | null {
	const client = warmedScratchClient;
	warmedScratchClient = null;
	return client;
}
/** True when the page is a scratch-card replay (`replay=true` and `type=scratch`). */
export function isScratchReplayRequest(): boolean {
	try {
		const params = new URLSearchParams(window.location.search);
		if (params.get('replay') !== 'true') {
			return false;
		}
		return (params.get('type') || '').trim().toLowerCase() === 'scratch';
	} catch {
		return false;
	}
}

/** True when this page is a slot replay, not a scratch-card replay. */
export function isNonScratchReplayRequest(): boolean {
	try {
		const params = new URLSearchParams(window.location.search);
		if (params.get('replay') !== 'true') {
			return false;
		}
		return (params.get('type') || '').trim().toLowerCase() !== 'scratch';
	} catch {
		return false;
	}
}

/** Scratch round object from a replay envelope (`results`, `result`, or stored spin slot). */
export function readScratchReplayResults(replayData: any): any | null {
	if (!replayData || typeof replayData !== 'object') {
		return null;
	}
	const candidates = [
		replayData.results,
		replayData.result,
		replayData.spinData && replayData.spinData.slot,
		replayData.spinData,
	];
	for (const candidate of candidates) {
		const parsed = parseScratchReplayPayload(candidate);
		if (parsed) {
			return parsed;
		}
	}
	return parseScratchReplayPayload(replayData);
}

function parseScratchReplayPayload(raw: unknown): any | null {
	let value: unknown = raw;
	if (typeof value === 'string') {
		const trimmed = value.trim();
		if (!trimmed) {
			return null;
		}
		try {
			value = JSON.parse(trimmed);
		} catch {
			return null;
		}
	}
	if (!value || typeof value !== 'object') {
		return null;
	}
	const obj = value as Record<string, unknown>;
	if (obj.scratchCard || obj.$game === 'scratch' || obj.scratchGridSize != null) {
		return obj;
	}
	return null;
}

