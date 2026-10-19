/**
 * Turbo Configuration - Centralized turbo settings
 * 
 * This file contains all turbo-related multipliers and settings.
 * Change values here to affect all turbo-affected functions across the codebase.
 * 
 * USAGE EXAMPLES:
 * - To make turbo 2x faster: change TURBO_SPEED_MULTIPLIER to 0.5
 * - To make turbo 8x faster: change TURBO_SPEED_MULTIPLIER to 0.125
 * - To disable turbo: change TURBO_SPEED_MULTIPLIER to 1.0
 * 
 * AFFECTED COMPONENTS:
 * - SlotController: Winline animation speeds
 * - Backend: Spin delays between spins
 * - Symbols: Animation timing and delays
 * - WinLineDrawer: Winline animation timing and speed
 * - All other components using turbo multipliers
 */

export class TurboConfig {
    // Main turbo speed multiplier (4x faster = 0.25x duration)
    // Change this value to affect ALL turbo-affected functions
    // Previously 0.15 (~6.67x faster); raised slightly to 0.25 to soften turbo speed.
    public static readonly TURBO_SPEED_MULTIPLIER: number = 0.7;
    
    // Turbo delay multiplier for spin timing
    public static readonly TURBO_DELAY_MULTIPLIER: number = 0.7;
    
    // Turbo duration multiplier for animations
    public static readonly TURBO_DURATION_MULTIPLIER: number = 0.7;
    
    // Winline animation speed multiplier (4x faster = 4.0x speed)
    public static readonly WINLINE_ANIMATION_SPEED_MULTIPLIER: number = 4.0;
    
    // Get the appropriate multiplier based on turbo state
    public static getMultiplier(isTurbo: boolean): number {
        return isTurbo ? this.TURBO_SPEED_MULTIPLIER : 1.0;
    }
    
    // Get the delay multiplier specifically
    public static getDelayMultiplier(isTurbo: boolean): number {
        return isTurbo ? this.TURBO_DELAY_MULTIPLIER : 0.7;
    }
    
    // Get the duration multiplier specifically
    public static getDurationMultiplier(isTurbo: boolean): number {
        return isTurbo ? this.TURBO_DURATION_MULTIPLIER : 1.0;
    }
    
    // Apply turbo speed to a value
    public static applyTurboSpeed(value: number, isTurbo: boolean): number {
        return value * this.getMultiplier(isTurbo);
    }
    
    // Apply turbo delay to a value
    public static applyTurboDelay(value: number, isTurbo: boolean): number {
        return value * this.getDelayMultiplier(isTurbo);
    }
    
    // Apply turbo duration to a value
    public static applyTurboDuration(value: number, isTurbo: boolean): number {
        return value * this.getDurationMultiplier(isTurbo);
    }
}
