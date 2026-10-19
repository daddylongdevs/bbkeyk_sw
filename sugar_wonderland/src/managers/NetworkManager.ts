export class NetworkManager {
    private isHighSpeed: boolean;

    constructor() {
        this.isHighSpeed = this.detectNetworkSpeed();
        console.log(`[NetworkManager] Network speed detected: ${this.isHighSpeed ? 'HIGH' : 'LOW'}`);
    }

    private detectNetworkSpeed(): boolean {
        return true;
    }

    public getNetworkSpeed(): boolean {
        return this.isHighSpeed;
    }

    public getAssetScale(): number {
        return this.isHighSpeed ? 1 : 2; 
    }
}