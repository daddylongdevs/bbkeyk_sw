// BackendEvent import removed - no longer needed in this file


export class GameData {
	static WIN_UP_HEIGHT: number = 50;

	/** Bet ladder; single source of truth for SlotController, BetOptions, AutoplayOptions, BuyFeature. Overwritten from initialization data in Game.create() when available. */
	public betLevels: number[] = [
		0.2, 0.4, 0.6, 0.8, 1,
		1.2, 1.6, 2, 2.4, 2.8,
		3.2, 3.6, 4, 5, 6,
		8, 10, 14, 18, 24,
		32, 40, 60, 80, 100,
		110, 120, 130, 140, 150
	];

  public isAutoPlaying: boolean = false;
  public isShowingWinlines: boolean = false; // Track if winline animations are playing
	public isTurbo: boolean = false;
	public isReelSpinning: boolean = false;
	public isEnhancedBet: boolean = false; // Track amplify bet toggle state
	public winUpHeight: number = GameData.WIN_UP_HEIGHT;
	public winUpDuration: number = 0;
	public dropDuration: number = 0;
	public dropReelsDelay: number = 0;
	public dropReelsDuration: number = 0;
	public compressionDelayMultiplier: number = 1;
	// Tumble-only timing controls (do not affect global spin timings)
	public tumbleStaggerMs: number = 200; // base stagger used by tumble sequences
	public tumbleDropStaggerMs: number | null = null; // if null, defaults to tumbleStaggerMs * 0.25
	public tumbleDropStartDelayMs: number = 0; // additional start delay before dropping ins (post-compression)
	public tumbleSkipPreHop: boolean = true; // if true, skip pre-hop and start falling immediately
	public tumbleOverlapDropsDuringCompression: boolean = true; // if true, start drops while compression tweens are running

	public constructor() {
		setSpeed(this, 1.0);
	}
}

import { DROP_REEL_START_INTERVAL_RATIO } from '../../config/GameConfig';

// Global time multiplier for symbol drop and reset animations
// Lower than 1.0 = faster; higher than 1.0 = slower
export const DROP_RESET_TIME_MULTIPLIER: number = 0.8;

export function setSpeed(data: GameData, DELAY_BETWEEN_SPINS: number) {
	// Apply global multiplier to win-up (reset) and drop durations
	data.winUpDuration = DELAY_BETWEEN_SPINS * 0.1 * DROP_RESET_TIME_MULTIPLIER;
	data.dropDuration = DELAY_BETWEEN_SPINS * 0.3 * DROP_RESET_TIME_MULTIPLIER;
    data.dropReelsDelay = DELAY_BETWEEN_SPINS * DROP_REEL_START_INTERVAL_RATIO;
	data.dropReelsDuration = DELAY_BETWEEN_SPINS * 0.4 * DROP_RESET_TIME_MULTIPLIER;
}

export function gameSpin(data: GameData) {
	// This function is deprecated - use GameStateManager.isReelSpinning instead
	// The spinning state is now managed centrally by GameStateManager
	console.warn('[GameData] gameSpin function is deprecated - use GameStateManager.isReelSpinning instead');
}

export function isWinlinesShowing(data: GameData): boolean {
	return data.isShowingWinlines;
}

export function pauseAutoplayForWinlines(data: GameData): void {
	data.isShowingWinlines = true;
	console.log('[GameData] Autoplay paused for winline animations');
}

export function resumeAutoplayAfterWinlines(data: GameData): void {
	data.isShowingWinlines = false;
	console.log('[GameData] Autoplay resumed after winline animations');
}