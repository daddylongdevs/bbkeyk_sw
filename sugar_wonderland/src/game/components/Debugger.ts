import { Scene } from "phaser";
import { BackendEvent, BackendEvents } from "../../tmp_backend/BackendEvent";
import { Data } from "../../tmp_backend/Data";
import { Payout } from "../../tmp_backend/Payout";


export class Debugger {
  public scene: Scene;
  public container: Phaser.GameObjects.Container;

  constructor() { }

  public preload(scene: Scene) {
    this.scene = scene;

  }

  public create() {
    this.createWinBreakdownTexts();
  }

  private createWinBreakdownTexts() {
    BackendEvent.on(BackendEvents.SPIN_RESPONSE, async (data: Data) => {
      // console.log(Payout.getMultiplierMatrix(data));
    });
  }
}