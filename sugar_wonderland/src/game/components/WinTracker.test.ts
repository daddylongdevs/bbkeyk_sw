import { describe, expect, it, vi } from 'vitest';
vi.mock('../../utils/SpineGuard', () => ({ ensureSpineFactory: () => true }));
import { WinTracker } from './WinTracker';

function harness(spine = true) {
  const objects: any[] = [];
  const timers: any[] = [];
  const tweens: any[] = [];
  let shutdown: () => void;
  const scene: any = {
    scale: { width: 428, height: 926 },
    events: { once: (_: string, fn: () => void, ctx: any) => { shutdown = fn.bind(ctx); }, off: vi.fn() },
    time: { delayedCall: (_: number, callback: () => void) => {
      const timer = { callback, remove: vi.fn() }; timers.push(timer); return timer;
    } },
    tweens: {
      add: (config: any) => { tweens.push(config); return config; },
      killTweensOf: vi.fn((target: any) => {
        for (const tween of tweens) if (tween.targets === target) tween.cancelled = true;
      }),
    },
    add: {},
  };
  const make = (kind: string, text = '') => {
    const obj: any = {
      kind, scene, text, list: [], parentContainer: null, visible: true, active: true,
      display: true, updating: kind === 'spine', scaleX: 1, scaleY: 1, alpha: 1,
      get displayWidth() { return (this.kind === 'text' ? this.text.length * 8 : 100) * this.scaleX; },
      setPosition(x: number, y: number) { this.x = x; this.y = y; return this; },
      setScale(v: number) { this.scaleX = this.scaleY = v; return this; },
      setOrigin() { return this; }, setTint() { return this; },
      setDepth(v: number) { this.depth = v; return this; },
      setAlpha(v: number) { this.alpha = v; return this; },
      setVisible(v: boolean) { this.visible = v; return this; },
      setActive(v: boolean) { this.active = v; return this; },
      setText(v: string) { this.text = v; return this; },
      addToUpdateList() { if (this.kind === 'spine') this.updating = true; return this; },
      removeFromUpdateList() { this.updating = false; return this; },
      removeFromDisplayList() { this.display = false; return this; },
      add(children: any) {
        for (const child of Array.isArray(children) ? children : [children]) {
          child.parentContainer?.remove(child);
          this.list.push(child); child.parentContainer = this; child.display = false;
        }
        return this;
      },
      remove(child: any) {
        this.list = this.list.filter((item: any) => item !== child);
        child.parentContainer = null; child.display = true; return this;
      },
      destroy: vi.fn(() => {
        if (!obj.scene) return;
        obj.parentContainer?.remove(obj);
        for (const child of [...obj.list]) child.destroy();
        obj.scene = null; obj.display = false; obj.updating = false;
      }),
    };
    if (kind === 'spine') {
      obj.animationState = { setAnimation: vi.fn(() => ({})), timeScale: 1 };
      obj.skeleton = { data: { findAnimation: () => ({ duration: 1 }) } };
    }
    objects.push(obj);
    return obj;
  };
  scene.add.container = (x: number, y: number) => make('container').setPosition(x, y);
  scene.add.text = (_x: number, _y: number, text: string) => make('text', text);
  scene.add.image = () => make('image');
  if (spine) scene.add.spine = () => make('spine');
  const tracker = new WinTracker();
  tracker.create(scene);
  tracker.setLayout({ iconScale: 0.05 });
  const root = objects[0];
  const show = (outs = [{ symbol: 1, count: 8, win: 10 }]) => tracker.showForTumble(outs, null);
  return { tracker, objects, root, show, timers, tweens, scene, shutdown: () => shutdown() };
}

describe('Sugar Wonderland WinTracker reuse', () => {
  it('reuses the same row tree across many clears, tumbles, and changes in values', () => {
    const h = harness();
    h.show();
    const row = h.root.list[0];
    const children = [...row.list];
    const allocationCount = h.objects.length;
    for (let round = 0; round < 100; round++) {
      h.tracker.clear();
      expect(row.visible || row.active || row.display).toBe(false);
      expect(children[0].updating).toBe(false);
      h.show([{ symbol: 1, count: 12, win: 1234.5 }]);
      expect(h.root.list[0]).toBe(row);
      expect(row.list).toEqual(children);
      expect(children.filter(obj => obj.kind === 'text').map(obj => obj.text)).toEqual(['12', '=', '1,234.50']);
      expect(children[0].updating).toBe(true);
    }
    expect(h.objects).toHaveLength(allocationCount);
  });

  it('preserves descending win order and centers a single row after a multi-row tumble', () => {
    const h = harness();
    h.show([{ symbol: 1, count: 8, win: 10 }, { symbol: 2, count: 9, win: 20 }]);
    const [larger, smaller] = h.root.list;
    expect(larger.y).toBe(-14);
    expect(smaller.y).toBe(14);
    expect(larger.list.at(-1).text).toBe('20.00');
    h.show();
    expect(h.root.list).toEqual([smaller]);
    expect([smaller.x, smaller.y]).toEqual([0, 0]);
    expect(larger.display || larger.visible || larger.list[0].updating).toBe(false);
    const first = smaller.list[1];
    const last = smaller.list.at(-1);
    expect(first.x - first.displayWidth / 2).toBe(-(last.x + last.displayWidth / 2));
  });

  it('cancels a previous fade and hide timer before displaying a new tumble', () => {
    const h = harness();
    h.show();
    h.tracker.autoHideAfter(1000);
    h.tracker.hideWithFade();
    h.show([{ symbol: 2, count: 8, win: 30 }]);
    expect(h.timers[0].remove).toHaveBeenCalledWith(false);
    expect(h.tweens[0].cancelled).toBe(true);
    expect(h.root.visible).toBe(true);
    expect(h.root.alpha).toBe(1);
  });

  it('reuses PNG fallback icons and shadows and destroys cached rows at shutdown', () => {
    const h = harness(false);
    h.show();
    const cached = h.root.list[0];
    expect(cached.list.filter(obj => obj.kind === 'image')).toHaveLength(2);
    h.tracker.clear();
    h.show([{ symbol: 2, count: 8, win: 30 }]);
    const active = h.root.list[0];
    h.shutdown();
    for (const row of [cached, active]) {
      expect(row.scene).toBeNull();
      expect(row.list.every((obj: any) => !obj.scene)).toBe(true);
    }
    expect((h.tracker as any).rows.size).toBe(0);
  });

  it('bounds retained rows even for unexpected symbol ids without limiting active rows', () => {
    const h = harness(false);
    h.show(Array.from({ length: 30 }, (_, symbol) => ({ symbol, count: 8, win: symbol + 1 })));
    expect(h.root.list).toHaveLength(30);
    h.tracker.clear();
    expect((h.tracker as any).rows.size).toBe(10);
    expect(h.root.list).toHaveLength(0);
  });
});
