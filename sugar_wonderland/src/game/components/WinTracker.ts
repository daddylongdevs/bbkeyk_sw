import { Scene } from 'phaser';
import { SpinData } from '../../backend/SpinData';
import { ensureSpineFactory } from '../../utils/SpineGuard';
import { formatCurrencyNumber } from '../../utils/NumberPrecisionFormatter';

interface WinTrackerLayoutOptions {
  offsetX?: number;
  offsetY?: number;
  spacing?: number;
  iconScale?: number;
  innerGap?: number;
  multiplierIconScale?: number;
  multiplierIconGap?: number;
}

interface SymbolSummary {
  lines: number;
  totalWin: number;
  multiplier: number;
  baseValue: number;
  multiplierIcons?: Array<{ symbol: number; count: number }>;
  multiplierCount?: number;
}

interface WinTrackerRow {
  container: Phaser.GameObjects.Container;
  icon: any;
  shadow: Phaser.GameObjects.Image | null;
  countLabel: Phaser.GameObjects.Text;
  eqLabel: Phaser.GameObjects.Text;
  valueLabel: Phaser.GameObjects.Text;
}

export class WinTracker {
  // One reusable row per symbol (0-22), allocated only when first displayed.
  private readonly rows = new Map<number, WinTrackerRow>();
  private readonly maxCachedRows = 10;
  private container!: Phaser.GameObjects.Container;
  private scene!: Scene;
  private lastSpinData: SpinData | null = null;

  private baseX: number = 0;
  private baseY: number = 0;
  private offsetX: number = 0;
  private offsetY: number = -45;
  private itemSpacing: number = 80;
  private iconScale: number = 0.3;
  private innerGap: number = 13;
  private horizontalGap: number = 20;
  private multiplierIconScale: number = 2;
  private multiplierIconGap: number = 0.5;
  private autoHideTimer: Phaser.Time.TimerEvent | null = null;

  private readonly depth: number = 905;
  private readonly shadowOffsetX: number = 4;
  private readonly shadowOffsetY: number = 4;
  private readonly shadowAlpha: number = 0.45;
  private readonly labelFontSize: number = 14;
  private readonly labelFontFamily: string = 'Poppins-Bold';

  create(scene: Scene): void {
    if (this.container) this.destroy();
    this.scene = scene;
    scene.events.once('shutdown', this.destroy, this);
    this.baseX = scene.scale.width * 0.5;
    this.baseY = scene.scale.height * 0.76;

    this.container = scene.add.container(
      this.baseX + this.offsetX,
      this.baseY + this.offsetY
    );
    this.container.setDepth(this.depth);
    this.container.setVisible(false);
    this.container.setAlpha(1);
  }

  clear(): void {
    if (!this.container) {
      return;
    }
    this.stopHiding();
    this.hideRows();
    this.container.setVisible(false);
    this.container.setAlpha(1);
    this.lastSpinData = null;
  }

  updateFromSpinData(spinData: SpinData | null): void {
    this.lastSpinData = spinData;
  }

  showLatest(): void {
    if (!this.container) {
      return;
    }
    this.renderFromSpinData(this.lastSpinData);
  }

  /**
   * Show tracker for ONLY the current tumble using its outs array
   */
  public showForTumble(outs: Array<{ symbol?: number; count?: number; win?: number }> | null, spinData: SpinData | null): void {
    if (!this.container) return;
    const summary = this.buildSummaryFromTumbleOuts(outs, spinData);
    this.renderFromSummary(summary);
  }

  private renderFromSpinData(spinData: SpinData | null): void {
    const summary = this.buildSummary(spinData);
    this.renderFromSummary(summary);
  }

  private renderFromSummary(summary: Map<number, SymbolSummary> | null): void {
    this.stopHiding();
    this.hideRows();
    if (!summary) {
      this.container.setVisible(false);
      return;
    }

    this.container.setVisible(true);
    this.container.setAlpha(1);

    const items = Array.from(summary.entries()).sort(
      (a, b) => b[1].totalWin - a[1].totalWin
    );

    const spacing = this.itemSpacing;
    const isVertical = items.length >= 2;
    const lineSpacing = Math.max(this.labelFontSize + 12, 28);
    const startX = isVertical ? 0 : -((items.length - 1) * spacing) / 2;
    const startY = isVertical ? -((items.length - 1) * lineSpacing) / 2 : 0;
    let index = 0;

    for (const [symbolId, data] of items) {
      const x = isVertical ? startX : (startX + index * spacing);
      const y = isVertical ? (startY + index * lineSpacing) : 0;
      this.addSymbolItem(x, symbolId, data, y);
      index += 1;
    }
  }

  private buildSummary(spinData: SpinData | null): Map<number, SymbolSummary> | null {
    // Ignore paylines entirely; build summary only from tumble (cluster) wins
    if (!spinData || !spinData.slot) {
      return null;
    }
    const tumbles: any[] = Array.isArray((spinData.slot as any)?.tumbles) ? (spinData.slot as any).tumbles : [];
    if (tumbles.length === 0) {
      return null;
    }

    const summary = new Map<number, SymbolSummary>();
    for (const tumble of tumbles) {
      const outs = Array.isArray((tumble as any)?.symbols?.out) ? (tumble as any).symbols.out as Array<{ symbol?: number; count?: number; win?: number }> : [];
      for (const out of outs) {
        const symbolId = Number(out?.symbol);
        const count = Number(out?.count) || 0;
        const win = Number(out?.win) || 0;
        // Only include clusters (>=8) as winning symbols
        if (!isFinite(symbolId) || count <= 0 || count < 8) continue;
        const existing = summary.get(symbolId) || { lines: 0, totalWin: 0, multiplier: 1, baseValue: 0, multiplierIcons: [], multiplierCount: 1 };
        existing.lines += count;
        existing.totalWin += win;
        summary.set(symbolId, existing);
      }
    }

    // Derive multipliers from the current grid (slot.area)
    const multiplierIconMap = new Map<number, number>();
    let multiplierSum = 0;
    try {
      const area: number[][] = Array.isArray((spinData.slot as any)?.area) ? (spinData.slot as any).area : [];
      for (let col = 0; col < area.length; col++) {
        const column = area[col] || [];
        for (let row = 0; row < column.length; row++) {
          const value = Number(column[row]);
          if (!isFinite(value)) continue;
          if (value >= 10 && value <= 22) {
            multiplierIconMap.set(value, (multiplierIconMap.get(value) || 0) + 1);
            multiplierSum += this.getMultiplierNumeric(value);
          }
        }
      }
    } catch {}
    // Do not show multiplier icons in WinTracker
    const multiplierIcons: Array<{ symbol: number; count: number }> = [];
    const hasMultipliers = false;

    for (const [symbolId, data] of Array.from(summary.entries())) {
      if (data.totalWin > 0 && data.lines > 0) {
        data.baseValue = data.totalWin / data.lines;
      } else {
        data.baseValue = 0;
      }
      // Do not attach multiplier icons/count to the row
      data.multiplierIcons = multiplierIcons;
      data.multiplierCount = 0;
      summary.set(symbolId, data);
    }

    return summary.size > 0 ? summary : null;
  }

  private createRow(symbolId: number): WinTrackerRow {
    const { icon, isSpine } = this.createSymbolIcon(symbolId);
    const container = this.scene.add.container(0, 0);
    container.removeFromDisplayList();
    let shadow: Phaser.GameObjects.Image | null = null;
    if (!isSpine) {
      shadow = this.scene.add.image(0, 0, `symbol_${symbolId}`);
      shadow.setOrigin(0.5, 0.5).setTint(0x000000).setAlpha(this.shadowAlpha);
      container.add(shadow);
    }
    const makeLabel = (text: string) => this.scene.add.text(0, 0, text, {
      fontSize: `${this.labelFontSize}px`,
      color: '#ffffff',
      fontFamily: this.labelFontFamily,
      stroke: '#99030A',
      strokeThickness: 4,
      align: 'center',
    }).setOrigin(0.5, 0.5);
    const countLabel = makeLabel('');
    const eqLabel = makeLabel('=');
    const valueLabel = makeLabel('');
    container.add([icon, countLabel, eqLabel, valueLabel]);
    return { container, icon, shadow, countLabel, eqLabel, valueLabel };
  }

  private addSymbolItem(x: number, symbolId: number, data: SymbolSummary, y: number = 0): void {
    let row = this.rows.get(symbolId);
    if (!row) {
      row = this.createRow(symbolId);
      this.rows.set(symbolId, row);
    }
    const { icon, shadow, countLabel, eqLabel, valueLabel } = row;
    countLabel.setText(`${data.lines}`);
    valueLabel.setText(formatCurrencyNumber(data.totalWin));
    icon.setScale(this.iconScale);
    shadow?.setScale(this.iconScale);
    const iconDW = icon.displayWidth ?? icon.width ?? 40;
    const gap = Math.max(6, Math.floor(this.innerGap * 0.6));
    // Multiplier icons are intentionally omitted by both summary builders.
    const totalWidth = countLabel.displayWidth + gap + iconDW + gap
      + eqLabel.displayWidth + gap + valueLabel.displayWidth;
    let cursor = -totalWidth * 0.5;
    countLabel.setPosition(cursor + countLabel.displayWidth * 0.5, 0);
    cursor += countLabel.displayWidth + gap;
    icon.setPosition(cursor + iconDW * 0.5, 0);
    shadow?.setPosition(icon.x + this.shadowOffsetX, icon.y + this.shadowOffsetY);
    cursor += iconDW + gap;
    eqLabel.setPosition(cursor + eqLabel.displayWidth * 0.5, 0);
    cursor += eqLabel.displayWidth + gap;
    valueLabel.setPosition(cursor + valueLabel.displayWidth * 0.5, 0);
    row.container.setPosition(x, y).setActive(true).setVisible(true);
    this.container.add(row.container);
    icon.setActive(true);
    icon.addToUpdateList();
  }

  private hideRows(): void {
    for (const [symbolId, row] of this.rows) {
      row.icon.setActive(false);
      row.icon.removeFromUpdateList();
      row.container.setActive(false).setVisible(false);
      if (row.container.parentContainer) this.container.remove(row.container, false);
      // Container.remove() reattaches its child to the scene display list.
      row.container.removeFromDisplayList();
      if (this.rows.size > this.maxCachedRows) {
        row.container.destroy();
        this.rows.delete(symbolId);
      }
    }
  }

  private stopHiding(): void {
    this.autoHideTimer?.remove(false);
    this.autoHideTimer = null;
    if (this.container?.scene) this.scene.tweens.killTweensOf(this.container);
  }

  public destroy(): void {
    this.stopHiding();
    this.scene?.events.off('shutdown', this.destroy, this);
    for (const row of this.rows.values()) row.container.destroy();
    this.rows.clear();
    this.container?.destroy();
    this.container = undefined!;
    this.lastSpinData = null;
  }

  private buildSummaryFromTumbleOuts(
    outs: Array<{ symbol?: number; count?: number; win?: number }> | null,
    spinData: SpinData | null
  ): Map<number, SymbolSummary> | null {
    if (!outs || outs.length === 0) return null;
    const summary = new Map<number, SymbolSummary>();
    for (const out of outs) {
      const symbolId = Number(out?.symbol);
      const count = Number(out?.count) || 0;
      const win = Number(out?.win) || 0;
      if (!isFinite(symbolId) || count < 8 || win <= 0) continue;
      const existing = summary.get(symbolId) || {
        lines: 0,
        totalWin: 0,
        multiplier: 1,
        baseValue: 0,
        multiplierIcons: [],
        multiplierCount: 1
      };
      existing.lines += count;
      existing.totalWin += win;
      summary.set(symbolId, existing);
    }
    if (summary.size === 0) return null;

    // Attach multipliers from current grid state
    const multiplierIconMap = new Map<number, number>();
    let multiplierSum = 0;
    try {
      const area: number[][] = Array.isArray((spinData as any)?.slot?.area) ? (spinData as any).slot.area : [];
      for (let c = 0; c < area.length; c++) {
        const col = area[c] || [];
        for (let r = 0; r < col.length; r++) {
          const v = Number(col[r]);
          if (!isFinite(v)) continue;
          if (v >= 10 && v <= 22) {
            multiplierIconMap.set(v, (multiplierIconMap.get(v) || 0) + 1);
            multiplierSum += this.getMultiplierNumeric(v);
          }
        }
      }
    } catch {}
    // Do not show multiplier icons in WinTracker
    const multiplierIcons: Array<{ symbol: number; count: number }> = [];
    const hasMultipliers = false;

    for (const [symbolId, data] of Array.from(summary.entries())) {
      data.baseValue = data.totalWin > 0 && data.lines > 0 ? (data.totalWin / data.lines) : 0;
      data.multiplierIcons = multiplierIcons;
      data.multiplierCount = 0;
      summary.set(symbolId, data);
    }
    return summary;
  }

  private createSymbolIcon(symbolId: number): { icon: any; isSpine: boolean } {
    // Try to create a spine-based icon for standard symbols (0–9)
    try {
      if (symbolId >= 0 && symbolId <= 9) {
        if (ensureSpineFactory(this.scene, 'WinTracker')) {
          const sugarKey = `symbol_${symbolId}_sugar_spine`;
          const sugarAtlasKey = `${sugarKey}-atlas`;
          const go: any = (this.scene.add as any).spine?.(0, 0, sugarKey, sugarAtlasKey);
          if (go) {
            try { go.setOrigin?.(0.5, 0.5); } catch {}
            // Small icon scale
            try { go.setScale?.(this.iconScale); } catch {}
            // Play idle if present
            try {
              const idle = `Symbol${symbolId}_SW_Idle`;
              if (go.animationState?.setAnimation) {
                const entry = go.animationState.setAnimation(0, idle, true);
                try {
                  const duration = (go as any)?.skeleton?.data?.findAnimation?.(idle)?.duration;
                  if (typeof duration === 'number' && duration > 0 && entry) {
                    (entry as any).trackTime = Math.random() * duration;
                  }
                } catch {}
                try {
                  const speedJitter = 0.95 + Math.random() * 0.1;
                  (go.animationState as any).timeScale = speedJitter;
                } catch {}
              }
            } catch {}
            return { icon: go, isSpine: true };
          }
        }
      }
    } catch {}

    // Try multipliers (10–22) using shared skeleton
    try {
      if (symbolId >= 10 && symbolId <= 22) {
        if (ensureSpineFactory(this.scene, 'WinTracker')) {
          const multiKey = `symbol_bombs_sw`;
          const multiAtlasKey = `${multiKey}-atlas`;
          const go: any = (this.scene.add as any).spine?.(0, 0, multiKey, multiAtlasKey);
          if (go) {
            try { go.setOrigin?.(0.5, 0.5); } catch {}
            try { go.setScale?.(this.iconScale); } catch {}
            try {
              const base = this.getMultiplierAnimationBase(symbolId);
              const idle = base ? `${base}_Idle` : null;
              if (idle && go.animationState?.setAnimation) {
                const entry = go.animationState.setAnimation(0, idle, true);
                try {
                  const duration = (go as any)?.skeleton?.data?.findAnimation?.(idle)?.duration;
                  if (typeof duration === 'number' && duration > 0 && entry) {
                    (entry as any).trackTime = Math.random() * duration;
                  }
                } catch {}
                try {
                  const speedJitter = 0.95 + Math.random() * 0.1;
                  (go.animationState as any).timeScale = speedJitter;
                } catch {}
              }
            } catch {}
            return { icon: go, isSpine: true };
          }
        }
      }
    } catch {}

    // Fallback to PNG sprite
    const key = `symbol_${symbolId}`;
    const img = this.scene.add.image(0, 0, key);
    img.setOrigin(0.5, 0.5);
    img.setScale(this.iconScale);
    return { icon: img, isSpine: false };
  }

  private getMultiplierAnimationBase(value: number): string | null {
    if (value >= 10 && value <= 16) return 'Symbols11_SW';
    if (value >= 17 && value <= 20) return 'Symbols10_SW';
    if (value >= 21 && value <= 22) return 'Symbols12_SW';
    return null;
  }

  private getPaylineMultiplier(payline: any): number {
    try {
      const arr = (payline && Array.isArray(payline.multipliers)) ? payline.multipliers : [];
      let factor = 1;
      for (const m of arr) {
        const base = this.getMultiplierValueForSymbol(m?.symbol);
        const count = Math.max(0, Math.floor(m?.count || 0));
        if (base > 1 && count > 0) {
          factor *= Math.pow(base, count);
        }
      }
      return Math.max(1, Math.floor(factor));
    } catch {
      return 1;
    }
  }

  private getPaylineMultiplierStats(payline: any): { product: number; sum: number; icons: Array<{ symbol: number; count: number }> } {
    try {
      const arr = (payline && Array.isArray(payline.multipliers)) ? payline.multipliers : [];
      let product = 1;
      let sum = 0;
      const iconMap = new Map<number, number>();
      for (const m of arr) {
        const base = this.getMultiplierValueForSymbol(m?.symbol);
        const count = Math.max(0, Math.floor(m?.count || 0));
        if (base > 1 && count > 0) {
          product *= Math.pow(base, count);
          sum += base * count;
          iconMap.set(m.symbol, (iconMap.get(m.symbol) || 0) + count);
        }
      }
      if (sum === 0) sum = 1;
      const icons = Array.from(iconMap.entries()).map(([symbol, count]) => ({ symbol, count }));
      return { product: Math.max(1, Math.floor(product)), sum, icons };
    } catch {
      return { product: 1, sum: 1, icons: [] };
    }
  }

  private getMultiplierValueForSymbol(symbolId: number | undefined): number {
    return this.getMultiplierNumeric(Number(symbolId));
  }

  // Map multiplier symbol value (10–22) to numeric multiplier, matching Symbols logic
  private getMultiplierNumeric(value: number): number {
    switch (value) {
      case 10: return 2;
      case 11: return 3;
      case 12: return 4;
      case 13: return 5;
      case 14: return 6;
      case 15: return 8;
      case 16: return 10;
      case 17: return 12;
      case 18: return 15;
      case 19: return 20;
      case 20: return 25;
      case 21: return 50;
      case 22: return 100;
      default: return 1;
    }
  }

  public setLayout(options: WinTrackerLayoutOptions): void {
    if (typeof options.offsetX === 'number') {
      this.offsetX = options.offsetX;
    }
    if (typeof options.offsetY === 'number') {
      this.offsetY = options.offsetY;
    }
    if (typeof options.spacing === 'number' && options.spacing > 0) {
      this.itemSpacing = options.spacing;
    }
    if (typeof options.iconScale === 'number' && options.iconScale > 0) {
      this.iconScale = options.iconScale;
    }
    if (typeof options.innerGap === 'number' && options.innerGap >= 0) {
      this.innerGap = options.innerGap;
    }
    if (typeof options.multiplierIconScale === 'number' && options.multiplierIconScale > 0) {
      this.multiplierIconScale = options.multiplierIconScale;
    }
    if (typeof options.multiplierIconGap === 'number' && options.multiplierIconGap > 0) {
      this.multiplierIconGap = options.multiplierIconGap;
    }

    if (this.container) {
      this.container.setPosition(
        this.baseX + this.offsetX,
        this.baseY + this.offsetY
      );
    }
  }

  public autoHideAfter(delayMs: number): void {
    if (!this.scene || !this.container) {
      return;
    }
    if (this.autoHideTimer) {
      try { this.autoHideTimer.remove(false); } catch {}
      this.autoHideTimer = null;
    }
    this.autoHideTimer = this.scene.time.delayedCall(delayMs, () => {
      this.autoHideTimer = null;
      this.fadeOut(250);
    });
  }

  /**
   * Fade the tracker out before clearing it.
   * Used by callers instead of instantly hiding to give a smoother UX.
   */
  public hideWithFade(durationMs: number = 250): void {
    this.fadeOut(durationMs);
  }

  private fadeOut(durationMs: number): void {
    if (!this.scene || !this.container) {
      return;
    }
    if (!this.container.visible) {
      return;
    }
    try {
      this.scene.tweens.killTweensOf(this.container);
    } catch {}
    this.scene.tweens.add({
      targets: this.container,
      alpha: 0,
      duration: durationMs,
      ease: 'Cubic.easeIn',
      onComplete: () => {
        this.clear();
      }
    });
  }
}

export default WinTracker;
