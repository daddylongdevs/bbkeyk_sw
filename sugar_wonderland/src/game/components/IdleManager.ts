import { Scene } from 'phaser';
import { Events } from 'phaser';

/**
 * IdleManager tracks elapsed time from a start timestamp and emits a 'timeout' event
 * when elapsed time exceeds the configured max idle time. Uses a 1-second interval
 * and Date.now() so the check is based on wall-clock time (remains accurate when
 * the tab is in the background).
 */
export class IdleManager {
	/** Event name emitted when elapsed time exceeds maxIdleTime. */
	public static readonly TIMEOUT_EVENT = 'timeout';

	/** Event name emitted on each interval tick when the idle time is checked. */
	public static readonly CHECK_INTERVAL_EVENT = 'check_interval';

	public readonly events: Phaser.Events.EventEmitter;

	private scene: Scene;
	private maxIdleTimeMs: number;
	private startTimestamp: number = 0;
	private checkIntervalId: ReturnType<typeof setInterval> | null = null;

	private static readonly CHECK_INTERVAL_MS = 1000;

	constructor(scene: Scene, maxIdleTimeMs: number) {
		this.scene = scene;
		this.maxIdleTimeMs = maxIdleTimeMs;
		this.events = new Events.EventEmitter();
	}

	/**
	 * Start the idle timer: store current timestamp and begin checking every second
	 * whether elapsed time exceeds maxIdleTime. Emits 'timeout' when it does.
	 */
	public start(): void {
		this.startTimestamp = Date.now();
		if (this.checkIntervalId != null) {
			clearInterval(this.checkIntervalId);
		}
		this.checkIntervalId = setInterval(() => {
			const elapsed = Date.now() - this.startTimestamp;
			
			if (elapsed >= this.maxIdleTimeMs) {
				this.events.emit(IdleManager.TIMEOUT_EVENT);
				this.stop();
			}
			else
			{
				this.events.emit(IdleManager.CHECK_INTERVAL_EVENT, elapsed);
			}
		}, IdleManager.CHECK_INTERVAL_MS);
	}

	/**
	 * Stop the periodic check. Does not remove event listeners.
	 */
	public stop(): void {
		if (this.checkIntervalId != null) {
			clearInterval(this.checkIntervalId);
			this.checkIntervalId = null;
		}
	}

	/**
	 * Reset the idle window: set start timestamp to now. If the timer is running,
	 * the next check will use the new start time.
	 */
	public reset(): void {
		this.startTimestamp = Date.now();
	}

	/**
	 * Stop the timer and remove all listeners. Call when the manager is no longer needed.
	 */
	public destroy(): void {
		this.stop();
		this.events.removeAllListeners();
	}
}
