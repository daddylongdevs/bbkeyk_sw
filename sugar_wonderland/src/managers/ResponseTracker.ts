import { gameEventManager, GameEventType, SpinResponseEventData, BackendStatusEventData } from '../event/EventManager';

export interface ResponseInfo {
  responseId: string;
  timestamp: number;
  requestType: string;
  status: string;
  message?: string;
  data?: any;
}

export interface BackendStatusInfo {
  status: string;
  currentOperation?: string;
  timestamp: number;
  message?: string;
  responseId?: string;
}

/**
 * Response Tracker for monitoring backend responses and status
 * Provides tracking and monitoring capabilities for backend communication
 */
export class ResponseTracker {
  private static instance: ResponseTracker;
  private responses: Map<string, ResponseInfo> = new Map();
  private backendStatus: BackendStatusInfo | null = null;
  private responseCount = 0;
  private errorCount = 0;
  private lastResponseTime: number = 0;

  private constructor() {
    this.setupEventListeners();
  }

  public static getInstance(): ResponseTracker {
    if (!ResponseTracker.instance) {
      ResponseTracker.instance = new ResponseTracker();
    }
    return ResponseTracker.instance;
  }

  /**
   * Set up event listeners for response tracking
   */
  private setupEventListeners(): void {
    // Note: SPIN_RESPONSE event listener removed - now using SPIN_DATA_RESPONSE

    // Listen for backend status updates
    gameEventManager.on(GameEventType.BACKEND_READY, (data: any) => {
      if (data) {
        this.updateBackendStatus(data);
      }
    });
  }

  /**
   * Track a response from the backend
   */
  private trackResponse(data: SpinResponseEventData): void {
    const responseInfo: ResponseInfo = {
      responseId: data.responseId,
      timestamp: data.timestamp,
      requestType: data.requestType,
      status: data.status,
      message: data.message,
      data: {
        symbols: data.symbols,
        wins: data.wins,  // Changed from winLines to wins
        payout: data.payout,
        balance: data.balance,
        isBonus: data.isBonus
      }
    };

    this.responses.set(data.responseId, responseInfo);
    this.responseCount++;
    this.lastResponseTime = Date.now();

    console.log(`[ResponseTracker] Response tracked: ${data.responseId} (${data.requestType}) - Status: ${data.status}`);
    
    // Log response details
    if (data.status === 'SUCCESS') {
      console.log(`[ResponseTracker] Response successful - Payout: ${data.payout}, Balance: ${data.balance}`);
    } else if (data.status === 'ERROR') {
      this.errorCount++;
      console.error(`[ResponseTracker] Response error: ${data.message}`);
    }
  }

  /**
   * Update backend status information
   */
  private updateBackendStatus(data: BackendStatusEventData): void {
    this.backendStatus = {
      status: data.status,
      currentOperation: data.currentOperation,
      timestamp: data.timestamp,
      message: data.message,
      responseId: data.responseId
    };

    console.log(`[ResponseTracker] Backend status: ${data.status} - ${data.message}`);
    
    if (data.status === 'BUSY') {
      console.log(`[ResponseTracker] Backend is processing: ${data.currentOperation}`);
    } else if (data.status === 'READY') {
      console.log(`[ResponseTracker] Backend is ready for new requests`);
    }
  }

  /**
   * Get response information by ID
   */
  public getResponse(responseId: string): ResponseInfo | undefined {
    return this.responses.get(responseId);
  }

  /**
   * Get all responses
   */
  public getAllResponses(): ResponseInfo[] {
    return Array.from(this.responses.values());
  }

  /**
   * Get recent responses (last N responses)
   */
  public getRecentResponses(count: number = 10): ResponseInfo[] {
    const allResponses = this.getAllResponses();
    return allResponses
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, count);
  }

  /**
   * Get current backend status
   */
  public getBackendStatus(): BackendStatusInfo | null {
    return this.backendStatus;
  }

  /**
   * Check if backend is ready
   */
  public isBackendReady(): boolean {
    return this.backendStatus?.status === 'READY';
  }

  /**
   * Check if backend is busy
   */
  public isBackendBusy(): boolean {
    return this.backendStatus?.status === 'BUSY';
  }

  /**
   * Get response statistics
   */
  public getStats(): {
    totalResponses: number;
    errorCount: number;
    successRate: number;
    lastResponseTime: number;
    averageResponseTime?: number;
  } {
    const successCount = this.responseCount - this.errorCount;
    const successRate = this.responseCount > 0 ? (successCount / this.responseCount) * 100 : 0;

    return {
      totalResponses: this.responseCount,
      errorCount: this.errorCount,
      successRate,
      lastResponseTime: this.lastResponseTime
    };
  }

  /**
   * Wait for backend to be ready
   */
  public async waitForBackendReady(timeout: number = 5000): Promise<boolean> {
    return new Promise((resolve) => {
      if (this.isBackendReady()) {
        resolve(true);
        return;
      }

      const startTime = Date.now();
      const checkInterval = setInterval(() => {
        if (this.isBackendReady()) {
          clearInterval(checkInterval);
          resolve(true);
        } else if (Date.now() - startTime > timeout) {
          clearInterval(checkInterval);
          resolve(false);
        }
      }, 100);

      // Also listen for the next ready event
      const unsubscribe = gameEventManager.on(GameEventType.BACKEND_READY, (data: any) => {
        if (data?.status === 'READY') {
          clearInterval(checkInterval);
          unsubscribe();
          resolve(true);
        }
      });
    });
  }

  /**
   * Wait for a specific response
   */
  public async waitForResponse(responseId: string, timeout: number = 10000): Promise<ResponseInfo | null> {
    return new Promise((resolve) => {
      if (this.responses.has(responseId)) {
        resolve(this.responses.get(responseId) || null);
        return;
      }

      const startTime = Date.now();
      const checkInterval = setInterval(() => {
        if (this.responses.has(responseId)) {
          clearInterval(checkInterval);
          resolve(this.responses.get(responseId) || null);
        } else if (Date.now() - startTime > timeout) {
          clearInterval(checkInterval);
          resolve(null);
        }
      }, 100);
    });
  }

  /**
   * Clear old responses (keep only last N)
   */
  public clearOldResponses(keepCount: number = 100): void {
    if (this.responses.size <= keepCount) {
      return;
    }

    const allResponses = this.getAllResponses();
    const responsesToKeep = allResponses
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, keepCount);

    this.responses.clear();
    responsesToKeep.forEach(response => {
      this.responses.set(response.responseId, response);
    });

    console.log(`[ResponseTracker] Cleared old responses, keeping ${responsesToKeep.length} most recent`);
  }

  /**
   * Reset the tracker
   */
  public reset(): void {
    this.responses.clear();
    this.backendStatus = null;
    this.responseCount = 0;
    this.errorCount = 0;
    this.lastResponseTime = 0;
    console.log('[ResponseTracker] Tracker reset');
  }

  /**
   * Destroy the tracker
   */
  public destroy(): void {
    this.reset();
    console.log('[ResponseTracker] Tracker destroyed');
  }
}

// Export singleton instance
export const responseTracker = ResponseTracker.getInstance();
