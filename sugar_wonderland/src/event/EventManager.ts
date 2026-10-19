import { EventBus } from '../game/EventBus';
import type { FreeRoundCountUpdateDto as FreeRoundCountUpdateData } from '@core/dto';

// Define all game event types
export enum GameEventType {
  START = 'START',
  SPIN = 'SPIN',
  SPIN_DATA_RESPONSE = 'SPIN_DATA_RESPONSE', // New event for SpinData from GameAPI
  SPIN_RESPONSE_FAILED = 'SPIN_RESPONSE_FAILED', // Spin HTTP/network failure from GameAPI.doSpin
  REELS_START = 'REELS_START',
  REELS_STOP = 'REELS_STOP',
  WIN_START = 'WIN_START',
  WIN_STOP = 'WIN_STOP',
  /** Emitted after the bet-failed error popup is shown (e.g. DJ400BF). */
  BET_FAILED_ERROR = 'BET_FAILED_ERROR',
  /** Emitted when the bet-failed popup finishes closing (manual dismiss or auto-close). */
  BET_FAILED_POPUP_CLOSED = 'BET_FAILED_POPUP_CLOSED',
  // Tumble-specific win progress events
  TUMBLE_WIN_PROGRESS = 'TUMBLE_WIN_PROGRESS',   // payload: { cumulativeWin: number }
  TUMBLE_SEQUENCE_DONE = 'TUMBLE_SEQUENCE_DONE', // payload: { totalWin: number }
  // Bonus multiplier trigger
  MULTIPLIERS_TRIGGERED = 'MULTIPLIERS_TRIGGERED', // payload: { spinTotal: number, multiplierSum: number }
  // Emitted each time a multiplier PNG reaches the winnings display center
  MULTIPLIER_ARRIVED = 'MULTIPLIER_ARRIVED', // payload: { spinTotal: number, weight: number }
  // Emitted after all multiplier animations have completed (including overlay animations to center)
  MULTIPLIER_ANIMATIONS_COMPLETE = 'MULTIPLIER_ANIMATIONS_COMPLETE',
  // Emitted after scatter retrigger animation sequence has completed
  SCATTER_RETRIGGER_ANIMATION_COMPLETE = 'SCATTER_RETRIGGER_ANIMATION_COMPLETE',
  /**
   * Emitted immediately when a win dialog begins closing (on user click / auto-close),
   * before the fade-out tween completes.
   *
   * payload: { dialogType: string } — e.g. 'Congrats_KA' (TotalWin equivalent only)
   */
  WIN_DIALOG_CLOSING = 'WIN_DIALOG_CLOSING',
  /**
   * Emitted after the win-dialog fade-out completes.
   *
   * payload: { dialogType: string } — e.g. 'SuperW_KA', 'LargeW_KA', etc.
   */
  WIN_DIALOG_CLOSED = 'WIN_DIALOG_CLOSED',
  DIALOG_START = 'DIALOG_START',
  DIALOG_STOP = 'DIALOG_STOP',
  AUTO_START = 'AUTO_START',
  AUTO_STOP = 'AUTO_STOP',
  FREE_SPIN_AUTOPLAY = 'FREE_SPIN_AUTOPLAY',
  TURBO_ON = 'TURBO_ON',
  TURBO_OFF = 'TURBO_OFF',
  BET_UPDATE = 'BET_UPDATE',
  BALANCE_UPDATE = 'BALANCE_UPDATE',
  BALANCE_INITIALIZED = 'BALANCE_INITIALIZED',
  IS_BONUS = 'IS_BONUS',
  BACKEND_READY = 'BACKEND_READY',
  BACKEND_BUSY = 'BACKEND_BUSY',
  LOCALIZATION_READY = 'LOCALIZATION_READY',
  // Free round manager events
  FREEROUND_COUNT_UPDATE = 'FREEROUND_COUNT_UPDATE', // payload: FreeRoundCountUpdateData
  /** Emitted when an isFs bet should not play (fsStatus failed / cancelled). */
  FREEROUND_SPIN_ABORTED = 'FREEROUND_SPIN_ABORTED',
  // Additional events used by the backend
  RESPONSE = 'RESPONSE',
}

// Define event data interfaces
export interface SpinEventData {
  betAmount: number;
  autoPlay?: boolean;
}

export interface SpinDataEventData {
  spinData: any; // Will be typed as SpinData when imported
}

export interface AutoStartEventData {
  spinCount: number;
}

export interface BetFailedErrorEventData {
  popupType?: string;
}

export type { FreeRoundCountUpdateData };

export interface WinEventData {
  winLines: any[];
  totalWin: number;
}

export interface DialogEventData {
  dialogType: string;
  message?: string;
}

export interface BetUpdateEventData {
  newBet: number;
  previousBet: number;
}

export interface BalanceUpdateEventData {
  newBalance: number;
  previousBalance: number;
  change: number;
}

export interface BonusEventData {
  scatterCount: number;
  bonusType: string;
}

export interface BackendStatusEventData {
  status: 'READY' | 'BUSY' | 'PROCESSING' | 'ERROR';
  currentOperation?: string;
  timestamp: number;
  message?: string;
  responseId?: string;
}

// Tumble-specific event data
export interface TumbleWinProgressEventData {
  cumulativeWin: number;
}

export interface TumbleSequenceDoneEventData {
  totalWin: number;
}

export interface MultipliersTriggeredEventData {
  spinTotal: number;
  multiplierSum: number;
}

export interface MultiplierArrivedEventData {
  spinTotal: number;
  weight: number;
}

// Union type for all event data
export type GameEventData = 
  | SpinEventData
  | SpinDataEventData
  | WinEventData
  | DialogEventData
  | BetUpdateEventData
  | BalanceUpdateEventData
  | BonusEventData
  | AutoStartEventData
  | BetFailedErrorEventData
  | BackendStatusEventData
  | TumbleWinProgressEventData
  | TumbleSequenceDoneEventData
  | MultipliersTriggeredEventData
  | MultiplierArrivedEventData
  | undefined;

// Event listener type
export type GameEventListener = (data?: GameEventData) => void;

// Event listener storage
interface EventListenerMap {
  [eventType: string]: GameEventListener[];
}

/**
 * Central Event Manager for handling all game events
 * Provides a clean interface for emitting and listening to game events
 */
export class EventManager {
  private static instance: EventManager;
  private listeners: EventListenerMap = {};
  private isInitialized = false;

  private constructor() {
    // Private constructor for singleton pattern
  }

  /**
   * Get the singleton instance of EventManager
   */
  public static getInstance(): EventManager {
    if (!EventManager.instance) {
      EventManager.instance = new EventManager();
    }
    return EventManager.instance;
  }

  /**
   * Initialize the event manager and set up global event handling
   */
  public initialize(): void {
    if (this.isInitialized) {
      return;
    }

    // Set up global event handling through Phaser EventBus
    this.setupGlobalEventHandling();
    this.isInitialized = true;
  }

  /**
   * Emit a game event
   * @param eventType - The type of event to emit
   * @param data - Optional data to pass with the event
   */
  public emit(eventType: GameEventType, data?: GameEventData): void {
    // Emit to local listeners
    if (this.listeners[eventType]) {
      this.listeners[eventType].forEach(listener => {
        try {
          listener(data);
        } catch (error) {
          console.error(`Error in event listener for ${eventType}:`, error);
        }
      });
    }

    // Emit to global EventBus for Phaser integration
    EventBus.emit(eventType, data);
  }

  /**
   * Subscribe to a game event
   * @param eventType - The type of event to listen for
   * @param listener - The callback function to execute when the event occurs
   * @returns Function to unsubscribe from the event
   */
  public on(eventType: GameEventType, listener: GameEventListener): () => void {
    if (!this.listeners[eventType]) {
      this.listeners[eventType] = [];
    }

    this.listeners[eventType].push(listener);

    // Return unsubscribe function
    return () => {
      this.off(eventType, listener);
    };
  }

  /**
   * Unsubscribe from a game event
   * @param eventType - The type of event to unsubscribe from
   * @param listener - The specific listener to remove
   */
  public off(eventType: GameEventType, listener: GameEventListener): void {
    if (this.listeners[eventType]) {
      const index = this.listeners[eventType].indexOf(listener);
      if (index > -1) {
        this.listeners[eventType].splice(index, 1);
      }
    }
  }

  /**
   * Subscribe to a game event once (auto-unsubscribes after first execution)
   * @param eventType - The type of event to listen for
   * @param listener - The callback function to execute when the event occurs
   */
  public once(eventType: GameEventType, listener: GameEventListener): void {
    const onceListener = (data?: GameEventData) => {
      listener(data);
      this.off(eventType, onceListener);
    };

    this.on(eventType, onceListener);
  }

  /**
   * Remove all listeners for a specific event type
   * @param eventType - The type of event to clear
   */
  public clear(eventType: GameEventType): void {
    if (this.listeners[eventType]) {
      this.listeners[eventType] = [];
    }
  }

  /**
   * Remove all listeners for all event types
   */
  public clearAll(): void {
    this.listeners = {};
  }

  /**
   * Get the count of listeners for a specific event type
   * @param eventType - The type of event to check
   * @returns Number of active listeners
   */
  public getListenerCount(eventType: GameEventType): number {
    return this.listeners[eventType] ? this.listeners[eventType].length : 0;
  }

  /**
   * Check if there are any listeners for a specific event type
   * @param eventType - The type of event to check
   * @returns True if there are active listeners
   */
  public hasListeners(eventType: GameEventType): boolean {
    return this.getListenerCount(eventType) > 0;
  }

  /**
   * Set up global event handling through Phaser EventBus
   * This allows Phaser scenes and components to listen to game events
   */
  private setupGlobalEventHandling(): void {
    // Forward events from local listeners to global EventBus
    Object.values(GameEventType).forEach(eventType => {
      this.on(eventType as GameEventType, (data) => {
        // Events are already emitted to EventBus in the emit method
        // This is just for any additional global handling if needed
      });
    });
  }

  /**
   * Clean up resources and remove all listeners
   */
  public destroy(): void {
    this.clearAll();
    this.isInitialized = false;
  }
}

// Export a singleton instance for easy access
export const gameEventManager = EventManager.getInstance();

// Convenience functions for common event emissions
export const emitGameEvent = (eventType: GameEventType, data?: GameEventData) => {
  gameEventManager.emit(eventType, data);
};

export const onGameEvent = (eventType: GameEventType, listener: GameEventListener) => {
  return gameEventManager.on(eventType, listener);
};

export const onceGameEvent = (eventType: GameEventType, listener: GameEventListener) => {
  gameEventManager.once(eventType, listener);
};
