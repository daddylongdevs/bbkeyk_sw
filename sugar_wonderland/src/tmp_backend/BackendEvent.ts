import { Events } from 'phaser';

export class BackendEvent {
  private static emitter = new Events.EventEmitter();
  
  public static emit(event: BackendEvents, ...args: any[]) {
    BackendEvent.emitter.emit(event, ...args);
  }

  public static on(event: BackendEvents, callback: (...args: any[]) => void) {
    BackendEvent.emitter.on(event, callback);
  }

  public static off(event: BackendEvents, callback: (...args: any[]) => void) {
    BackendEvent.emitter.off(event, callback);
  }

  public static once(event: BackendEvents, callback: (...args: any[]) => void) {
    BackendEvent.emitter.once(event, callback);
  }

  public static removeAllListeners(event: BackendEvents): void {
    BackendEvent.emitter.removeAllListeners(event);
  }

  public static clear(): void {
    for (const event of Object.values(BackendEvents)) {
      BackendEvent.emitter.removeAllListeners(event);
    }
  }
}




export enum BackendEvents {
  // Frontend Events
  START = 'START',
  SPIN = 'SPIN',
  BALANCE = 'BALANCE',
  TOTAL_WIN = 'TOTAL_WIN',

  // Backend Events
  START_RESPONSE = 'START_RESPONSE',
  SPIN_RESPONSE = 'SPIN_RESPONSE',
  BALANCE_RESPONSE = 'BALANCE_RESPONSE',
  TOTAL_WIN_RESPONSE = 'TOTAL_WIN_RESPONSE',
  SCATTER_RESPONSE = 'SCATTER_RESPONSE',
}




/*
  BackendEvents
    Need event check

  ClientEvents
    SPIN

*/
