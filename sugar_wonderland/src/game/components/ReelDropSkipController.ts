import { gameEventManager, GameEventType } from "../../event/EventManager";
import { gameStateManager } from "../../managers/GameStateManager";

type ReelDropSkipHost = {
  scene: Phaser.Scene;
  slotX: number;
  slotY: number;
  totalGridWidth: number;
  totalGridHeight: number;
  canRequestSkipReelDropsNow?: () => boolean;
  tryRequestSkipReelDrops?: () => boolean;
  isCriticalLockBlockingSkip?: () => boolean;
  onSkipActivated?: () => void;
};

export class ReelDropSkipController {
  private readonly scene: Phaser.Scene;
  private readonly host: ReelDropSkipHost;
  private skipRequested = false;
  private hitbox: Phaser.GameObjects.Zone | null = null;
  private unsubscribeFns: Array<() => void> = [];
  private destroyed = false;

  constructor(scene: Phaser.Scene, host: ReelDropSkipHost) {
    this.scene = scene;
    this.host = host;
  }

  public attach(): void {
    if (this.destroyed || this.hitbox) return;

    const zone = this.scene.add
      .zone(this.host.slotX, this.host.slotY, this.getGridWidth(), this.getGridHeight())
      .setOrigin(0.5, 0.5);

    try { zone.setDepth(20); } catch {}
    try { zone.disableInteractive(); } catch {}
    zone.on("pointerdown", () => this.requestSkip());
    this.hitbox = zone;

    this.unsubscribeFns.push(
      gameEventManager.on(GameEventType.REELS_STOP, () => this.clear()),
      gameEventManager.on(GameEventType.DIALOG_START, () => this.disableHitbox()),
    );

    try { this.scene.scale.on("resize", this.updateGeometry, this); } catch {}
    try { this.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy()); } catch {}
  }

  /**
   * Opens the skip hitbox for this spin. Call at pre-spin start (same moment as the spin button arms skip).
   * @param preserveSkipHandled When true (e.g. REELS_START after a pre-spin skip), do not reset skip state or re-enable the hitbox.
   */
  public beginSpinWindow(options?: { preserveSkipHandled?: boolean }): void {
    if (this.destroyed) return;
    const preserve = !!options?.preserveSkipHandled;
    if (!preserve) {
      this.skipRequested = false;
    }
    this.updateGeometry();
    if (!this.skipRequested) {
      this.enableHitbox();
    }
  }

  public endSpinWindow(): void {
    this.disableHitbox();
  }

  public requestSkip(): void {
    if (this.destroyed || this.skipRequested || !this.canSkipNow()) return;

    try {
      if (this.host.tryRequestSkipReelDrops?.()) {
        return;
      }
    } catch (error) {
      console.warn("[ReelDropSkipController] Failed to request reel drop skip:", error);
    }
  }

  /** Sync hitbox/UI after Symbols handled skip (same path as the spin/skip button). */
  public markSkipHandled(): void {
    if (this.destroyed) return;
    this.skipRequested = true;
    this.disableHitbox();
    try { this.host.onSkipActivated?.(); } catch {}
  }

  public clear(): void {
    this.skipRequested = false;
    this.disableHitbox();
  }

  public isSkipRequested(): boolean {
    return this.skipRequested;
  }

  public destroy(): void {
    if (this.destroyed) return;

    this.destroyed = true;
    this.skipRequested = false;
    this.disableHitbox();

    try { this.scene.scale.off("resize", this.updateGeometry, this); } catch {}

    for (const unsubscribe of this.unsubscribeFns.splice(0)) {
      try { unsubscribe(); } catch {}
    }

    try { this.hitbox?.destroy(); } catch {}
    this.hitbox = null;
  }

  private canSkipNow(): boolean {
    try {
      if (this.host.isCriticalLockBlockingSkip?.()) {
        const hostAny: any = this.host;
        if (
          !gameStateManager.isBonus ||
          !hostAny.enableBonusModeSkip ||
          !hostAny.isTumbleSequenceInProgress?.()
        ) {
          return false;
        }
      }
    } catch {}

    try {
      if (gameStateManager.isShowingWinDialog) return false;
    } catch {}

    try {
      if ((gameStateManager as any).isBuyFeatureSpin) return false;
    } catch {}

    try {
      if (this.host.canRequestSkipReelDropsNow?.()) return true;
    } catch {}

    try {
      const hostAny: any = this.host;
      if (
        gameStateManager.isBonus &&
        hostAny.enableBonusModeSkip &&
        hostAny.isTumbleSequenceInProgress?.()
      ) {
        return true;
      }
    } catch {}

    return false;
  }

  private enableHitbox(): void {
    if (!this.hitbox || this.destroyed) return;

    if (gameStateManager.isShowingWinDialog) {
      this.disableHitbox();
      return;
    }

    try { this.hitbox.setInteractive({ useHandCursor: false }); } catch {}
  }

  private disableHitbox(): void {
    try { this.hitbox?.disableInteractive(); } catch {}
  }

  private updateGeometry(): void {
    if (!this.hitbox || this.destroyed) return;

    try {
      this.hitbox.setPosition(this.host.slotX, this.host.slotY);
      this.hitbox.setSize(this.getGridWidth(), this.getGridHeight());
    } catch {}
  }

  private getGridWidth(): number {
    return Math.max(1, Number(this.host.totalGridWidth) || 1);
  }

  private getGridHeight(): number {
    return Math.max(1, Number(this.host.totalGridHeight) || 1);
  }
}
