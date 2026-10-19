import { describe, expect, it, vi } from 'vitest';
import { SymbolPool, SYMBOL_POOL_FREE_CAP, SYMBOL_POOL_TOTAL_FREE_CAP } from './SymbolPool';

function harness() {
  const objects: any[] = [];
  const timers: any[] = [];
  let shutdown: () => void;
  const scene: any = {
    events: { once: (_event: string, callback: () => void, context: any) => { shutdown = callback.bind(context); } },
    tweens: { killTweensOf: vi.fn() },
    time: { delayedCall: (_ms: number, callback: () => void) => {
      const timer = { callback, remove: vi.fn() };
      timers.push(timer);
      return timer;
    } },
    add: { spine: () => {
      let onDestroy: () => void;
      const obj: any = {
        scene, parentContainer: null, visible: true, active: true, display: true, updates: true,
        animationState: {
          timeScale: 1, clearListeners: vi.fn(), clearTracks: vi.fn(), clearListenerNotifications: vi.fn(),
        },
        skeleton: { setToSetupPose: vi.fn(), color: { set: vi.fn() } },
        once: (_event: string, callback: () => void) => { onDestroy = callback; },
        destroy: vi.fn(() => { onDestroy?.(); obj.scene = null; obj.display = false; obj.updates = false; }),
        updatePose: vi.fn(), removeInteractive: vi.fn(), clearTint: vi.fn(), clearMask: vi.fn(),
        setPosition(x: number, y: number) { this.x = x; this.y = y; return this; },
        setScale(v: number) { this.scaleX = v; this.scaleY = v; return this; },
        setRotation(v: number) { this.rotation = v; return this; },
        setAlpha(v: number) { this.alpha = v; return this; },
        setDepth(v: number) { this.depth = v; return this; },
        setScrollFactor(v: number) { this.scrollFactorX = v; return this; },
        setVisible(v: boolean) { this.visible = v; return this; },
        setActive(v: boolean) { this.active = v; return this; },
        addToDisplayList() { this.display = true; },
        addToUpdateList() { this.updates = true; },
        removeFromDisplayList() { this.display = false; },
        removeFromUpdateList() { this.updates = false; },
      };
      objects.push(obj);
      return obj;
    } },
  };
  const pool = new SymbolPool(scene);
  const acquire = (key = 'symbol_1') => pool.acquire(key, `${key}-atlas`, 10, 20);
  return { pool, acquire, scene, objects, timers, shutdown: () => shutdown() };
}

describe('Sugar Wonderland symbol pool', () => {
  it('reuses a board over repeated drops without further allocation and resets state', () => {
    const h = harness();
    const first = Array.from({ length: 30 }, () => h.acquire());
    for (let round = 0; round < 100; round++) {
      const board = round === 0 ? first : Array.from({ length: 30 }, () => h.acquire());
      expect(new Set(board)).toEqual(new Set(first));
      for (const obj of board) {
        expect(obj.active && obj.visible && obj.display && obj.updates).toBe(true);
        expect([obj.x, obj.y, obj.scaleX, obj.alpha, obj.depth, obj.rotation]).toEqual([10, 20, 1, 1, 0, 0]);
        expect(obj.animationState.timeScale).toBe(1);
        obj.setScale(3).setAlpha(0).setRotation(2).setDepth(600);
        obj.animationState.timeScale = 0;
        obj.__hasSettled = true;
        h.pool.release(obj);
        expect(obj.active || obj.visible || obj.display || obj.updates).toBe(false);
        expect(obj.__hasSettled).toBeUndefined();
      }
    }
    expect(h.objects).toHaveLength(30);
  });

  it('caps free objects per skeleton while allowing overlapping active boards', () => {
    const h = harness();
    const board = Array.from({ length: 75 }, () => h.acquire());
    expect(h.objects).toHaveLength(75);
    expect(board.every(obj => !obj.destroy.mock.calls.length)).toBe(true);
    board.forEach(obj => h.pool.release(obj));
    expect(board.filter(obj => obj.scene)).toHaveLength(SYMBOL_POOL_FREE_CAP);
    expect(board.filter(obj => !obj.scene)).toHaveLength(45);
    const next = Array.from({ length: 30 }, () => h.acquire());
    expect(next.every(obj => board.includes(obj))).toBe(true);
  });

  it('caps total free objects across different skeletons and never substitutes a type', () => {
    const h = harness();
    const board = ['a', 'b', 'c'].flatMap(key => Array.from({ length: 30 }, () => h.acquire(key)));
    board.forEach(obj => h.pool.release(obj));
    expect(board.filter(obj => obj.scene)).toHaveLength(SYMBOL_POOL_TOTAL_FREE_CAP);
    expect(board.slice(0, 30)).toContain(h.acquire('a'));
    expect(board.slice(30, 60)).toContain(h.acquire('b'));
    expect(board).not.toContain(h.acquire('c'));
  });

  it('cancels symbol callbacks, settles interrupted work, and makes duplicate returns harmless', async () => {
    const h = harness();
    const obj = h.acquire();
    const callback = vi.fn();
    const settle = vi.fn();
    const oldUse = h.pool.currentUse(obj);
    h.pool.delay(obj, 500, callback);
    const pending = new Promise<void>(resolve => h.pool.onRelease(obj, () => { settle(); resolve(); }));
    obj.__skipDropResolve = vi.fn();
    const settleDrop = obj.__skipDropResolve;
    const overlay = { __bounceTween: { stop: vi.fn() }, destroy: vi.fn() };
    obj.__overlayImage = overlay;
    obj.parentContainer = { remove: () => { obj.parentContainer = null; obj.display = true; } };
    h.pool.release(obj);
    h.pool.release(obj);
    await pending;
    expect(settle).toHaveBeenCalledTimes(1);
    expect(settleDrop).toHaveBeenCalledTimes(1);
    expect(h.timers[0].remove).toHaveBeenCalledWith(false);
    expect(overlay.__bounceTween.stop).toHaveBeenCalledOnce();
    expect(overlay.destroy).toHaveBeenCalledOnce();
    expect(h.scene.tweens.killTweensOf).toHaveBeenCalledWith(overlay);
    expect(obj.display || obj.updates).toBe(false);
    expect(h.acquire()).toBe(obj);
    h.timers[0].callback(); // Even an already-queued callback cannot touch a later use.
    expect(callback).not.toHaveBeenCalled();
    expect(oldUse()).toBe(false);
    expect(h.pool.currentUse(obj)()).toBe(true);
  });

  it('destroys active and detached cached objects on shutdown, including scene-first destruction', () => {
    const h = harness();
    const cached = h.acquire('a');
    const active = h.acquire('b');
    const sceneDestroyed = h.acquire('c');
    h.pool.release(cached);
    sceneDestroyed.destroy(); // Phaser may destroy display children before our shutdown listener.
    h.shutdown();
    h.shutdown();
    for (const obj of [cached, active, sceneDestroyed]) expect(obj.destroy).toHaveBeenCalledOnce();
    expect(h.acquire()).toBeNull();
    expect((h.pool as any).entries.size).toBe(0);
    expect((h.pool as any).free.size).toBe(0);
  });
});
