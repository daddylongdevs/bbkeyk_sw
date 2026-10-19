export interface ScreenConfig {
    isPortrait: boolean;
}

export class ScreenModeManager {
    private isPortrait: boolean;
    private forcedMode: 'portrait' | 'landscape' | null;
    private orientationChangeCallbacks: Array<(config: ScreenConfig) => void> = [];

    constructor() {
        this.isPortrait = this.detectOrientation();
        this.forcedMode = null;
        console.log(`[ScreenModeManager] Initial screen orientation detected: ${this.isPortrait ? 'PORTRAIT' : 'LANDSCAPE'}`);
        
        // Add event listener for orientation changes
        window.addEventListener('resize', this.handleOrientationChange.bind(this));
        window.addEventListener('orientationchange', this.handleOrientationChange.bind(this));
    }

    private detectOrientation(): boolean {
        const isPortrait = window.innerHeight > window.innerWidth;
        console.log(`[ScreenModeManager] Window dimensions: ${window.innerWidth}x${window.innerHeight}`);
        return isPortrait;
    }

    private handleOrientationChange(): void {
        if (this.forcedMode) {
            // If orientation is forced, don't update based on actual screen changes
            return;
        }
        
        const newIsPortrait = this.detectOrientation();
        if (newIsPortrait !== this.isPortrait) {
            this.isPortrait = newIsPortrait;
            console.log(`[ScreenModeManager] Screen orientation changed to: ${this.isPortrait ? 'PORTRAIT' : 'LANDSCAPE'}`);
            
            // Notify all callbacks
            const config = this.getScreenConfig();
            this.orientationChangeCallbacks.forEach(callback => callback(config));
        }
    }

    public forceOrientation(mode: 'portrait' | 'landscape'): void {
        this.forcedMode = mode;
        this.isPortrait = mode === 'portrait';
        console.log(`[ScreenModeManager] Screen orientation FORCED to: ${mode.toUpperCase()}`);
        
        // Notify all callbacks
        const config = this.getScreenConfig();
        this.orientationChangeCallbacks.forEach(callback => callback(config));
    }

    public getScreenConfig(): ScreenConfig {
        return { isPortrait: this.isPortrait };
    }

    public onOrientationChange(callback: (config: ScreenConfig) => void): void {
        this.orientationChangeCallbacks.push(callback);
    }

    public removeOrientationChangeListener(callback: (config: ScreenConfig) => void): void {
        const index = this.orientationChangeCallbacks.indexOf(callback);
        if (index > -1) {
            this.orientationChangeCallbacks.splice(index, 1);
        }
    }
}