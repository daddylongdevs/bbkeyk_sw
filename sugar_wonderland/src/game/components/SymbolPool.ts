import type { Scene } from 'phaser';

// Free objects only: overlapping boards may use more active objects.
export const SYMBOL_POOL_FREE_CAP = 30;
// Avoid retaining 30 of all eleven skeleton types after a long session.
export const SYMBOL_POOL_TOTAL_FREE_CAP = 60;

interface Entry {
  key: string;
  free: boolean;
  use: number;
  cleanups: Set<() => void>;
}

/** Owns only the grid's Spine objects; textures remain owned by the scene cache. */
export class SymbolPool {
  private free = new Map<string, any[]>();
  private entries = new Map<any, Entry>();
  private disposed = false;
  private freeCount = 0;

  constructor(private scene: Scene) {
    scene.events.once('shutdown', this.destroy, this);
  }

  acquire(key: string, atlasKey: string, x: number, y: number): any {
    if (this.disposed) return null;
    const cached = this.free.get(key)?.pop();
    if (cached) this.freeCount--;
    const obj = cached ?? (this.scene.add as any).spine(x, y, key, atlasKey);
    if (!obj) return null;
    if (!this.entries.has(obj)) {
      this.entries.set(obj, { key, free: false, use: 0, cleanups: new Set() });
      obj.once('destroy', () => {
        const entry = this.entries.get(obj);
        if (!entry) return;
        this.entries.delete(obj);
        for (const cleanup of entry.cleanups) cleanup();
        entry.cleanups.clear();
        if (entry.free) {
          const bucket = this.free.get(key);
          const index = bucket?.indexOf(obj) ?? -1;
          if (index >= 0) { bucket!.splice(index, 1); this.freeCount--; }
        }
      });
    }
    this.entries.get(obj)!.free = false;
    this.entries.get(obj)!.use++;
    obj.animationState.clearListeners();
    obj.animationState.clearTracks();
    obj.animationState.clearListenerNotifications();
    obj.animationState.timeScale = 1;
    obj.skeleton.setToSetupPose();
    obj.skeleton.color.set(1, 1, 1, 1);
    obj.updatePose(0);
    obj.setPosition(x, y).setScale(1).setRotation(0).setAlpha(1).setDepth(0);
    obj.setScrollFactor(1).setVisible(true).setActive(true);
    obj.clearTint?.();
    obj.clearMask?.();
    obj.blendMode = -1; // Spine owns attachment blend modes; preserve its constructor default.
    obj.cameraFilter = 0;
    obj.addToDisplayList();
    obj.addToUpdateList();
    return obj;
  }

  currentUse(obj: any): () => boolean {
    const entry = this.entries.get(obj);
    const use = entry?.use;
    return () => entry ? !entry.free && entry.use === use && this.entries.has(obj) : !!obj?.scene;
  }

  /** Settle a pending animation if its symbol is returned before completion. */
  onRelease(obj: any, callback: () => void): void {
    this.entries.get(obj)?.cleanups.add(callback);
  }

  /** Symbol-owned timers cannot mutate a later use of the same skeleton. */
  delay(obj: any, ms: number, callback: () => void): Phaser.Time.TimerEvent {
    const entry = this.entries.get(obj);
    const isCurrent = this.currentUse(obj);
    const cancel = () => timer.remove(false);
    const timer = this.scene.time.delayedCall(ms, () => {
      entry?.cleanups.delete(cancel);
      if (isCurrent()) callback();
    });
    entry?.cleanups.add(cancel);
    return timer;
  }

  release(obj: any): void {
    if (!obj?.scene) return;
    const entry = this.entries.get(obj);
    if (entry?.free) return;
    if (entry) entry.free = true; // Duplicate/reentrant returns are harmless.

    this.scene.tweens.killTweensOf(obj);
    const overlay = obj.__overlayImage;
    if (overlay) {
      overlay.__bounceTween?.stop();
      this.scene.tweens.killTweensOf(overlay);
      overlay.destroy();
    }
    obj.__overlayImage = null;
    // Floating win text owns its own fade and may outlive this symbol.
    obj.__winText = null;
    const settleDrop = obj.__skipDropResolve;
    obj.__skipDropResolve = null;
    settleDrop?.();
    if (entry) {
      for (const cleanup of entry.cleanups) cleanup();
      entry.cleanups.clear();
    }

    if (!entry) {
      obj.destroy();
      return;
    }
    obj.animationState.clearListeners();
    obj.animationState.clearTracks();
    obj.animationState.clearListenerNotifications();
    obj.removeInteractive?.();
    obj.parentContainer?.remove(obj, false);
    // Phaser Container.remove() reattaches exclusive children to the display list.
    obj.removeFromDisplayList();
    obj.removeFromUpdateList();
    obj.setActive(false).setVisible(false);
    delete obj.__pausedMultiplierWin;
    delete obj.__hasSettled;
    delete obj.__gridCol;
    delete obj.__gridRow;
    delete obj.symbolValue;

    const bucket = this.free.get(entry.key) ?? [];
    if (!this.disposed && bucket.length < SYMBOL_POOL_FREE_CAP && this.freeCount < SYMBOL_POOL_TOTAL_FREE_CAP) {
      bucket.push(obj);
      this.freeCount++;
      this.free.set(entry.key, bucket);
    } else {
      this.entries.delete(obj);
      obj.destroy();
    }
  }

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const obj of Array.from(this.entries.keys())) {
      const entry = this.entries.get(obj)!;
      if (!entry.free) this.release(obj);
      else obj.destroy();
    }
    this.entries.clear();
    this.free.clear();
    this.freeCount = 0;
  }
}
