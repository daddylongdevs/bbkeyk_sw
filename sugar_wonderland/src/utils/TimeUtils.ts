/**
 * Utility functions for time formatting
 */

/**
 * Get current time in military format (24-hour format)
 * @returns Formatted time string as "HH:MM:SS"
 */
export function getMilitaryTime(): string {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
}


