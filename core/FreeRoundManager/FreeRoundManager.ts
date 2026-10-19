import { Scene } from "phaser";
import {
  FreeRoundStatus,
  resolveFreeRoundStatus,
  type FreeRoundCountUpdateDto,
} from "../dto";
import {
  DEFAULT_FREE_ROUND_TEXTURES,
  FreeRoundEventName,
  FreeRoundGameAPIPort,
  FreeRoundInitializationData,
  FreeRoundManagerCreateOptions,
  FreeRoundManagerDeps,
  FreeRoundSlotControllerPort,
  FreeRoundTextKey,
  FREE_ROUND_TEXT_FALLBACKS,
  FreeRoundTextureKeys,
  extractTotalWin,
} from "./types";

/**
 * Shared initialization free-rounds UI manager.
 *
 * Owns the info panel, start/completion modals, spin-button re-skin, and
 * `isInFreeSpinRound` session flag coordination via injected ports.
 * Backend count updates arrive through `FREEROUND_COUNT_UPDATE`.
 *
 * Integration checklist and contracts:
 * @see ./IMPLEMENTATION.md
 */
export class FreeRoundManager {
  private container: Phaser.GameObjects.Container | null = null;
  private sceneRef: Scene | null = null;
  private background: Phaser.GameObjects.Image | null = null;
  private countText: Phaser.GameObjects.Text | null = null;
  private labelText: Phaser.GameObjects.Text | null = null;
  private spinButton: Phaser.GameObjects.Image | null = null;
  private spinIcon: Phaser.GameObjects.Image | null = null;
  private autoplayStopIcon: Phaser.GameObjects.Image | null = null;
  private initializationData: FreeRoundInitializationData | null = null;
  private slotControllerRef: FreeRoundSlotControllerPort | undefined;
  private gameAPIRef: FreeRoundGameAPIPort | null = null;
  private deps: FreeRoundManagerDeps | null = null;
  private textures: FreeRoundTextureKeys = { ...DEFAULT_FREE_ROUND_TEXTURES };

  private panelContainer: Phaser.GameObjects.Container | null = null;
  private panelOverlay: Phaser.GameObjects.Rectangle | null = null;
  private panelSpinsText: Phaser.GameObjects.Text | null = null;
  private panelBetText: Phaser.GameObjects.Text | null = null;

  private initialFreeSpins: number = 0;
  private remainingFreeSpins: number = 0;
  private initBet: number | null = null;
  private completionPanelShown: boolean = false;
  private lastFsCount: number = 0;
  private lastFsTotal: number | null = null;
  private lastEnvelopeBalance: number | null = null;
  private lastFsTotalAccumulatedWins: number | null = null;
  private accumulatedFreeRoundWin: number = 0;
  private trackingFreeRoundAutoplay: boolean = false;

  private getText(key: string): string {
    const mapped = this.deps?.getText(key);
    if (mapped && mapped !== key) {
      return mapped;
    }
    return FREE_ROUND_TEXT_FALLBACKS[key] ?? mapped ?? key;
  }

  private get gameState() {
    return this.deps!.gameState;
  }

  private get events() {
    return this.deps!.events;
  }

  /**
   * Create the free round UI. Idempotent — subsequent calls are ignored once created.
   */
  public create(options: FreeRoundManagerCreateOptions): void;
  /** @deprecated Prefer create({ scene, gameAPI, slotController, deps }). */
  public create(
    scene: Scene,
    gameAPI: FreeRoundGameAPIPort,
    slotController?: FreeRoundSlotControllerPort,
    deps?: FreeRoundManagerDeps,
  ): void;
  public create(
    sceneOrOptions: Scene | FreeRoundManagerCreateOptions,
    gameAPI?: FreeRoundGameAPIPort,
    slotController?: FreeRoundSlotControllerPort,
    deps?: FreeRoundManagerDeps,
  ): void {
    if (this.container) {
      return;
    }

    let scene: Scene;
    let api: FreeRoundGameAPIPort;
    let controller: FreeRoundSlotControllerPort | undefined;
    let managerDeps: FreeRoundManagerDeps;

    if (sceneOrOptions && typeof sceneOrOptions === "object" && "deps" in sceneOrOptions) {
      scene = sceneOrOptions.scene;
      api = sceneOrOptions.gameAPI;
      controller = sceneOrOptions.slotController;
      managerDeps = sceneOrOptions.deps;
    } else {
      scene = sceneOrOptions as Scene;
      api = gameAPI!;
      controller = slotController;
      managerDeps = deps!;
    }

    if (!managerDeps) {
      throw new Error("[FreeRoundManager] deps are required");
    }

    this.sceneRef = scene;
    this.deps = managerDeps;
    this.gameAPIRef = api;
    this.slotControllerRef = controller;
    this.textures = {
      ...DEFAULT_FREE_ROUND_TEXTURES,
      ...(managerDeps.textures ?? {}),
    };

    this.initializationData = api.getInitializationData();

    let spinButton: Phaser.GameObjects.Image | null = null;
    let spinIcon: Phaser.GameObjects.Image | null = null;
    let autoplayStopIcon: Phaser.GameObjects.Image | null = null;

    if (controller) {
      spinButton = controller.getSpinButton();
      spinIcon = controller.getSpinIcon();
      autoplayStopIcon = controller.getAutoplayStopIcon();
    }

    if (!spinButton) {
      spinButton =
        scene.children.list.find(
          (child): child is Phaser.GameObjects.Image =>
            child instanceof Phaser.GameObjects.Image && child.texture.key === this.textures.spin,
        ) || null;
    }
    if (!spinIcon) {
      spinIcon =
        scene.children.list.find(
          (child): child is Phaser.GameObjects.Image =>
            child instanceof Phaser.GameObjects.Image && child.texture.key === this.textures.spinIcon,
        ) || null;
    }
    if (!autoplayStopIcon) {
      autoplayStopIcon =
        scene.children.list.find(
          (child): child is Phaser.GameObjects.Image =>
            child instanceof Phaser.GameObjects.Image
            && child.texture.key === this.textures.autoplayStopIcon,
        ) || null;
    }

    this.spinButton = spinButton;
    this.spinIcon = spinIcon;
    this.autoplayStopIcon = autoplayStopIcon;

    this.initialFreeSpins = api.getRemainingInitFreeSpins();
    this.remainingFreeSpins = this.initialFreeSpins;
    this.initBet = api.getInitFreeSpinBet();
    const initialFreeSpins = this.initialFreeSpins;

    const x = spinButton ? spinButton.x : scene.scale.width * 0.5;
    const y = spinButton ? spinButton.y : scene.scale.height * 0.82;
    const scaleX = spinButton ? spinButton.scaleX : 1;
    const scaleY = spinButton ? spinButton.scaleY : 1;
    const depth = spinButton ? spinButton.depth + 1 : 20;

    this.container = scene.add.container(0, 0);

    let finalDepth = depth;
    let parentContainer: Phaser.GameObjects.Container | null = null;

    if (controller?.getPrimaryControllersContainer) {
      parentContainer = controller.getPrimaryControllersContainer() ?? null;
    }

    if (parentContainer) {
      parentContainer.add(this.container);
      finalDepth = Math.max(depth, 20);
    } else {
      finalDepth = Math.max(depth, 700);
    }

    this.container.setDepth(finalDepth);

    const panelPos = controller?.getFreeRoundInfoPanelPosition?.();
    const infoX = panelPos?.x ?? scene.scale.width * 0.5;
    const infoY = panelPos?.y ?? scene.scale.height * 0.724;
    const infoWidth = 125;
    const infoHeight = 55;
    const infoCornerRadius = 10;

    const borderTextureKey = `freeround_info_panel_${infoWidth}x${infoHeight}`;
    if (!scene.textures.exists(borderTextureKey)) {
      const canvasTexture = scene.textures.createCanvas(borderTextureKey, infoWidth, infoHeight);
      if (!canvasTexture) {
        const fallbackBg = scene.add.graphics();
        const outerX = infoX - infoWidth / 2;
        const outerY = infoY - infoHeight / 2;
        fallbackBg.lineStyle(1.5, 0xfdb832, 1.5);
        fallbackBg.strokeRoundedRect(outerX, outerY, infoWidth, infoHeight, infoCornerRadius);
        fallbackBg.fillStyle(0x000000, 0.65);
        fallbackBg.fillRoundedRect(
          outerX + 2,
          outerY + 2,
          infoWidth - 4,
          infoHeight - 4,
          infoCornerRadius - 2,
        );
        fallbackBg.setDepth(finalDepth);
        this.container.add(fallbackBg);
      } else {
        const ctx = canvasTexture.context;
        const lineWidth = 1;
        const radius = infoCornerRadius - 1;
        const inset = lineWidth / 2;
        const w = infoWidth - lineWidth;
        const h = infoHeight - lineWidth;

        ctx.clearRect(0, 0, infoWidth, infoHeight);

        const borderGradient = ctx.createLinearGradient(0, 0, 0, infoHeight);
        borderGradient.addColorStop(0.0, "#ffffff");
        borderGradient.addColorStop(0.25, "#ffd180");
        borderGradient.addColorStop(0.65, "#fdb832");
        borderGradient.addColorStop(1.0, "#b4720a");
        ctx.strokeStyle = borderGradient;
        ctx.lineWidth = lineWidth;

        const drawRoundedRectPath = (
          rx: number,
          ry: number,
          width: number,
          height: number,
          r: number,
        ) => {
          const right = rx + width;
          const bottom = ry + height;
          ctx.beginPath();
          ctx.moveTo(rx + r, ry);
          ctx.lineTo(right - r, ry);
          ctx.quadraticCurveTo(right, ry, right, ry + r);
          ctx.lineTo(right, bottom - r);
          ctx.quadraticCurveTo(right, bottom, right - r, bottom);
          ctx.lineTo(rx + r, bottom);
          ctx.quadraticCurveTo(rx, bottom, rx, bottom - r);
          ctx.lineTo(rx, ry + r);
          ctx.quadraticCurveTo(rx, ry, rx + r, ry);
          ctx.closePath();
        };

        drawRoundedRectPath(inset, inset, w, h, radius);
        ctx.stroke();

        const innerInset = inset + 1.5;
        const innerRadius = radius - 1.5;
        const innerW = infoWidth - innerInset * 2;
        const innerH = infoHeight - innerInset * 2;

        ctx.fillStyle = "#000000";
        drawRoundedRectPath(innerInset, innerInset, innerW, innerH, innerRadius);
        ctx.fill();

        canvasTexture.refresh();
      }
    }

    const infoBg = scene.add
      .image(infoX, infoY, borderTextureKey)
      .setOrigin(0.5, 0.5)
      .setDepth(finalDepth)
      .setAlpha(0.7);
    this.container.add(infoBg);

    this.labelText = scene.add.text(
      infoX,
      infoY,
      this.getText(FreeRoundTextKey.PANEL_LABEL),
      {
        fontSize: "12px",
        color: "#ffffff",
        fontFamily: "poppins-bold",
        align: "left",
      },
    );
    this.labelText.setOrigin(0.5, 0.5);
    this.labelText.setDepth(finalDepth + 1);
    this.container.add(this.labelText);
    this.applyFreeSpinLabelGradient();

    const initialDigitCount = Math.abs(this.remainingFreeSpins).toString().length;
    this.countText = scene.add.text(
      infoX,
      infoY,
      this.remainingFreeSpins.toString(),
      {
        fontSize: initialDigitCount > 2 ? "32px" : "36px",
        color: "#ffffff",
        fontFamily: "poppins-bold",
        align: "left",
        stroke: "#FFC45C",
        strokeThickness: 2,
        letterSpacing: 1,
      },
    );
    this.countText.setOrigin(0.5, 0.5);
    this.countText.setDepth(finalDepth + 1);
    this.container.add(this.countText);
    this.layoutInfoPanelLabelAndCount(infoX, infoWidth);

    this.events.on(FreeRoundEventName.FREEROUND_COUNT_UPDATE, (data: any) => {
      this.handleFreeRoundBetUpdate(data);
    });

    this.setupFreeRoundWinTracking();
    this.setupManualFreeRoundSpinConsumption();

    console.log("[FreeRoundManager] Created at", {
      x,
      y,
      scaleX,
      scaleY,
      initialFreeSpins,
      hasSpinButton: !!spinButton,
    });

    const shouldUseFreeSpin =
      !!this.initializationData
      && this.initializationData.hasFreeSpinRound
      && initialFreeSpins > 0;

    const rewardDelay = managerDeps.rewardPanelDelayMs ?? 500;

    if (shouldUseFreeSpin) {
      scene.time.delayedCall(rewardDelay, () => {
        if (!this.sceneRef) {
          return;
        }
        this.enableFreeSpinMode();
        this.createRewardPanel(this.sceneRef);
      });
    } else if (this.container) {
      // Do NOT call disableFreeSpinMode() here — it re-skins the spin button to
      // textures.spin, which spine-disc games no longer load (overlay is spin_icon).
      // That silently becomes Phaser __MISSING on every normal boot.
      this.container.setVisible(false);
    }
  }

  public setFreeSpins(count: number): void {
    if (!this.sceneRef || !this.container || !this.container.scene) {
      return;
    }

    if (this.countText && this.countText.active) {
      this.countText.setText(count.toString());
    }
    if (this.panelSpinsText) {
      if (this.panelSpinsText.active) {
        this.panelSpinsText.setText(count.toString());
        this.applySpinCountGradient();
      } else {
        this.panelSpinsText = null;
      }
    }
  }

  private fillTemplate(template: string, vars: Record<string, string | number>): string {
    return template.replace(/\{(\w+)\}/g, (_match, name: string) => {
      const value = vars[name];
      return value === undefined || value === null ? "" : String(value);
    });
  }

  private formatAmount(amount: number): string {
    const isDemo = !!(
      this.gameAPIRef?.getDemoState?.()
      ?? (this.sceneRef as any)?.gameAPI?.getDemoState?.()
    );
    const prefix = this.deps?.getCurrencyPrefix(isDemo) ?? "";
    const formatted = this.deps?.formatCurrencyNumber(amount) ?? String(amount);
    return `${prefix} ${formatted}`.trim();
  }

  private creditedFromSpinsSegments(spinCount: number): Array<{ text: string; highlight?: boolean }> {
    const key =
      spinCount === 1 ? FreeRoundTextKey.CREDITED_FROM_SPIN : FreeRoundTextKey.CREDITED_FROM_SPINS;
    return this.segmentsFromCountTemplate(this.getText(key), spinCount);
  }

  private segmentsFromCountTemplate(
    template: string,
    count: number,
  ): Array<{ text: string; highlight?: boolean }> {
    const token = "{count}";
    const idx = template.indexOf(token);
    if (idx < 0) {
      return [{ text: this.fillTemplate(template, { count }) }];
    }

    const before = template.slice(0, idx);
    const after = template.slice(idx + token.length);
    const trailing = after.match(/^(\s+)((?:free\s+)?spins?)/i) ?? after.match(/^(\s*)(\S+)/);
    if (!trailing) {
      return [
        ...(before ? [{ text: before }] : []),
        { text: String(count), highlight: true },
        ...(after ? [{ text: after }] : []),
      ];
    }

    const spaces = trailing[1];
    const rawWord = trailing[2];
    const punctMatch = rawWord.match(/^(.*?)([.,;:!?]+)$/);
    const phrase = punctMatch ? punctMatch[1] : rawWord;
    const punct = punctMatch ? punctMatch[2] : "";
    const rest = after.slice(trailing[0].length);
    return [
      ...(before ? [{ text: before }] : []),
      { text: `${count}${spaces}${phrase}`, highlight: true },
      ...(punct || rest ? [{ text: `${punct}${rest}` }] : []),
    ];
  }

  private addCenteredRichText(
    scene: Scene,
    container: Phaser.GameObjects.Container,
    y: number,
    maxWidth: number,
    segments: Array<{ text: string; highlight?: boolean }>,
    fontSizePx: number,
    lineSpacing: number,
  ): void {
    const fontSize = `${fontSizePx}px`;
    const fontFamily = "poppins-bold";
    const measure = scene.add.text(0, 0, "", { fontSize, fontFamily }).setVisible(false);

    type Token = { text: string; highlight: boolean; lineBreak: boolean };
    const tokens: Token[] = [];

    const pushWords = (text: string, highlight: boolean) => {
      for (const part of text.split(/(\s+)/)) {
        if (part) {
          tokens.push({ text: part, highlight, lineBreak: false });
        }
      }
    };

    for (const seg of segments) {
      if (!seg.text) {
        continue;
      }
      const chunks = seg.text.split("\n");
      chunks.forEach((chunk, i) => {
        if (seg.highlight) {
          if (chunk) {
            tokens.push({ text: chunk, highlight: true, lineBreak: false });
          }
        } else {
          pushWords(chunk, false);
        }
        if (i < chunks.length - 1) {
          tokens.push({ text: "", highlight: false, lineBreak: true });
        }
      });
    }

    const lines: Token[][] = [[]];
    let lineWidth = 0;
    for (const token of tokens) {
      if (token.lineBreak) {
        lines.push([]);
        lineWidth = 0;
        continue;
      }
      measure.setText(token.text);
      const width = measure.width;
      const isSpace = /^\s+$/.test(token.text);
      if (!isSpace && lineWidth + width > maxWidth && lines[lines.length - 1].length > 0) {
        lines.push([]);
        lineWidth = 0;
      }
      if (isSpace && lineWidth === 0) {
        continue;
      }
      lines[lines.length - 1].push(token);
      lineWidth += width;
    }

    const lineHeight = fontSizePx + lineSpacing;
    let yOff = 0;
    for (const line of lines) {
      const lineContainer = scene.add.container(0, y + yOff);
      let xOff = 0;
      const objs: Phaser.GameObjects.Text[] = [];
      for (const token of line) {
        const t = scene.add
          .text(xOff, 0, token.text, {
            fontSize,
            fontFamily,
            color: token.highlight ? "#ffcc33" : "#ffffff",
          })
          .setOrigin(0, 0);
        if (token.highlight) {
          this.applySpinCountGradientToText(t);
        }
        objs.push(t);
        lineContainer.add(t);
        xOff += t.width;
      }
      for (const t of objs) {
        t.x -= xOff / 2;
      }
      container.add(lineContainer);
      yOff += lineHeight;
    }

    measure.destroy();
  }

  private normalizeCountUpdate(data: any): FreeRoundCountUpdateDto {
    if (typeof data === "number") {
      return {
        fsCount: data,
        fsStatus: FreeRoundStatus.PENDING,
      };
    }
    const fsCount = typeof data?.fsCount === "number" ? data.fsCount : this.remainingFreeSpins;
    return {
      fsCount,
      fsStatus: resolveFreeRoundStatus(data?.fsStatus),
      fsTotal: typeof data?.fsTotal === "number" ? data.fsTotal : undefined,
      fsTotalAccumulatedWin:
        typeof data?.fsTotalAccumulatedWin === "number" ? data.fsTotalAccumulatedWin : undefined,
      balance: typeof data?.balance === "number" ? data.balance : undefined,
      totalWin: typeof data?.totalWin === "number" ? data.totalWin : undefined,
    };
  }

  private handleFreeRoundBetUpdate(data: any): void {
    const update = this.normalizeCountUpdate(data);
    console.log("[FreeRoundManager] Received FREEROUND_COUNT_UPDATE:", update);

    this.remainingFreeSpins = update.fsCount;
    this.lastFsCount = update.fsCount;
    this.setFreeSpins(update.fsCount);

    if (typeof update.fsTotal === "number") {
      this.lastFsTotal = update.fsTotal;
    }
    if (typeof update.balance === "number") {
      this.lastEnvelopeBalance = update.balance;
    }
    if (typeof update.fsTotalAccumulatedWin === "number") {
      this.lastFsTotalAccumulatedWins = update.fsTotalAccumulatedWin;
    }

    const status = update.fsStatus;
    if (status === FreeRoundStatus.FAILED) {
      this.showWhenSpinIdle(() => this.showFailedPanel(), false);
      return;
    }
    if (status === FreeRoundStatus.CANCELLED) {
      this.queueEndModal(() => this.showCancelledPanel(), false);
      return;
    }
    if (status === FreeRoundStatus.PARTIAL) {
      this.queueEndModal(() => this.showPartialPanel(), true);
      return;
    }

    const treatAsComplete =
      status === FreeRoundStatus.COMPLETE
      || (status === FreeRoundStatus.PENDING && update.fsCount <= 0);
    if (treatAsComplete) {
      this.queueEndModal(() => this.showCompletionCreditedPanel(), true);
    }
  }

  private isSpinPresentationBusy(waitForWinPresentation: boolean): boolean {
    const gs = this.gameState;
    if (gs.isReelSpinning || gs.isProcessingSpin === true) {
      return true;
    }
    if (!waitForWinPresentation) {
      return false;
    }
    return gs.isShowingWinDialog || gs.isShowingWinlines;
  }

  private showWhenSpinIdle(show: () => void, waitForWinPresentation: boolean): void {
    if (!this.sceneRef || !this.deps) {
      show();
      return;
    }

    if (!this.isSpinPresentationBusy(waitForWinPresentation)) {
      show();
      return;
    }

    const maybeUnsub = (result: (() => void) | void): (() => void) | null =>
      typeof result === "function" ? result : null;

    let settled = false;
    let pollEvent: Phaser.Time.TimerEvent | null = null;
    let reelsStopUnsub: (() => void) | null = null;
    let winStopUnsub: (() => void) | null = null;
    let winDialogClosedUnsub: (() => void) | null = null;
    let abortedUnsub: (() => void) | null = null;

    const cleanup = () => {
      if (pollEvent) {
        try { pollEvent.remove(false); } catch {}
        pollEvent = null;
      }
      if (reelsStopUnsub) reelsStopUnsub();
      if (winStopUnsub) winStopUnsub();
      if (winDialogClosedUnsub) winDialogClosedUnsub();
      if (abortedUnsub) abortedUnsub();
      reelsStopUnsub = null;
      winStopUnsub = null;
      winDialogClosedUnsub = null;
      abortedUnsub = null;
    };

    const tryShow = () => {
      if (settled || this.isSpinPresentationBusy(waitForWinPresentation)) {
        return;
      }
      settled = true;
      cleanup();
      show();
    };

    reelsStopUnsub = maybeUnsub(this.events.on(FreeRoundEventName.REELS_STOP, () => tryShow()));
    winStopUnsub = maybeUnsub(this.events.on(FreeRoundEventName.WIN_STOP, () => tryShow()));
    winDialogClosedUnsub = maybeUnsub(
      this.events.on(FreeRoundEventName.WIN_DIALOG_CLOSED, () => tryShow()),
    );
    abortedUnsub = maybeUnsub(
      this.events.on(FreeRoundEventName.FREEROUND_SPIN_ABORTED, () => tryShow()),
    );

    // Tumble games clear isProcessingSpin / isShowingWinDialog without a follow-up
    // event (WIN_STOP fires while presentation is still finishing; win dialogs are
    // delayed after TUMBLE_SEQUENCE_DONE). Poll so the complete modal is not stuck
    // waiting for an event that never comes.
    pollEvent = this.sceneRef.time.addEvent({
      delay: 50,
      loop: true,
      callback: tryShow,
    });
  }

  private queueEndModal(show: () => void, waitForWinPresentation: boolean): void {
    if (this.completionPanelShown) {
      return;
    }
    this.completionPanelShown = true;
    this.showWhenSpinIdle(show, waitForWinPresentation);
  }

  private getDisplayedFreeRoundWin(): number {
    if (
      typeof this.lastFsTotalAccumulatedWins === "number"
      && Number.isFinite(this.lastFsTotalAccumulatedWins)
    ) {
      return this.lastFsTotalAccumulatedWins;
    }
    return this.getFinalFreeRoundTotalWin();
  }

  private getDisplayedFsTotal(): number {
    if (typeof this.lastFsTotal === "number" && Number.isFinite(this.lastFsTotal) && this.lastFsTotal > 0) {
      return this.lastFsTotal;
    }
    return this.initialFreeSpins;
  }

  private finishFreeRoundMode(): void {
    this.stopTrackingFreeRoundAutoplayWins();
    this.disableFreeSpinMode();
    this.slotControllerRef?.enableControlsAfterFreeRounds();
  }

  public show(): void {
    if (this.container) {
      this.container.setVisible(true);
    }
  }

  public hide(): void {
    if (this.container) {
      this.container.setVisible(false);
    }
  }

  private applySpinCountGradient(): void {
    this.applySpinCountGradientToText(this.panelSpinsText);
  }

  private applySpinCountGradientToText(target: Phaser.GameObjects.Text | null): void {
    if (!target) {
      return;
    }

    const text = target as any;
    const ctx: CanvasRenderingContext2D | undefined = text.context;
    if (!ctx) {
      return;
    }

    if (typeof text.updateText === "function") {
      text.updateText();
    }

    const h = target.height || 1;
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, "#FFD180");
    gradient.addColorStop(0.5, "#FDB832");
    gradient.addColorStop(1, "#B4720A");

    target.setFill(gradient as any);
  }

  private applyBetValueGradientToText(target: Phaser.GameObjects.Text | null): void {
    if (!target) {
      return;
    }

    const anyText = target as any;
    const ctx: CanvasRenderingContext2D | undefined = anyText.context;
    if (!ctx) {
      return;
    }

    if (typeof anyText.updateText === "function") {
      anyText.updateText();
    }

    const h = target.height || 1;
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, "#66D449");
    gradient.addColorStop(1, "#379557");

    target.setFill(gradient as any);
  }

  /**
   * Place the remaining-spins label and value once, using measured widths.
   * No fixed left/right padding: leftover width becomes equal side space, and the
   * gap between them is 8px minimum and 24px maximum. Positions stay fixed afterwards.
   */
  private layoutInfoPanelLabelAndCount(infoX: number, infoWidth: number): void {
    if (!this.labelText || !this.countText) {
      return;
    }

    const labelAny = this.labelText as any;
    const countAny = this.countText as any;
    if (typeof labelAny.updateText === "function") {
      labelAny.updateText();
    }
    if (typeof countAny.updateText === "function") {
      countAny.updateText();
    }

    const minGap = 8;
    const maxGap = 14;
    const labelWidth = this.labelText.displayWidth || this.labelText.width;
    const countWidth = this.countText.displayWidth || this.countText.width;
    const extra = infoWidth - labelWidth - countWidth;

    let gap: number;
    let leftPad: number;
    if (extra <= minGap) {
      gap = Math.max(0, extra);
      leftPad = 0;
    } else if (extra <= maxGap) {
      gap = extra;
      leftPad = 0;
    } else {
      gap = maxGap;
      leftPad = (extra - maxGap) / 2;
    }

    const startX = infoX - infoWidth / 2 + leftPad;
    this.labelText.setX(startX + labelWidth / 2);
    this.countText.setX(startX + labelWidth + gap + countWidth / 2);
  }

  private applyFreeSpinLabelGradient(): void {
    if (!this.labelText) {
      return;
    }

    const anyText = this.labelText as any;
    const ctx: CanvasRenderingContext2D | undefined = anyText.context;
    if (!ctx) {
      return;
    }

    if (typeof anyText.updateText === "function") {
      anyText.updateText();
    }

    const h = this.labelText.height || 1;
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0.0, "#ffffff");
    gradient.addColorStop(0.25, "#ffd180");
    gradient.addColorStop(0.65, "#fdb832");
    gradient.addColorStop(1.0, "#b4720a");

    this.labelText.setFill(gradient as any);
  }

  private startTrackingFreeRoundAutoplayWins(): void {
    this.accumulatedFreeRoundWin = 0;
    this.trackingFreeRoundAutoplay = true;
    console.log("[FreeRoundManager] Started tracking freeround autoplay total win");
  }

  private stopTrackingFreeRoundAutoplayWins(): void {
    if (!this.trackingFreeRoundAutoplay) {
      return;
    }
    this.trackingFreeRoundAutoplay = false;
    console.log(
      "[FreeRoundManager] Stopped tracking freeround autoplay total win. Final accumulated value:",
      this.accumulatedFreeRoundWin,
    );
  }

  private getFinalFreeRoundTotalWin(): number {
    return this.accumulatedFreeRoundWin;
  }

  private setupFreeRoundWinTracking(): void {
    const eventsToListen = new Set<string>([
      FreeRoundEventName.SPIN_DATA_RESPONSE,
      FreeRoundEventName.SPIN_RESPONSE_RECEIVED,
    ]);
    if (this.deps?.spinDataReceivedEvent) {
      eventsToListen.add(this.deps.spinDataReceivedEvent);
    }

    // Dedup when a game emits more than one of the listened spin-success events for the same payload.
    let lastAccumulatedSpinData: unknown = null;

    const onSpinDataReceived = (data: any) => {
      if (!this.trackingFreeRoundAutoplay) {
        return;
      }
      if (!this.sceneRef || !this.deps) {
        return;
      }

      if (this.gameState.isBonus) {
        return;
      }

      if (!this.gameState.isInFreeSpinRound()) {
        return;
      }

      try {
        // Prefer event payload so we don't race Symbols assigning currentSpinData.
        const spinData = data?.spinData ?? (this.sceneRef as any)?.symbols?.currentSpinData;
        if (!spinData || !spinData.slot) {
          return;
        }

        if (spinData === lastAccumulatedSpinData) {
          return;
        }
        lastAccumulatedSpinData = spinData;

        const spinWin = (this.deps.extractSpinWin ?? extractTotalWin)(spinData.slot);

        if (spinWin > 0) {
          this.accumulatedFreeRoundWin += spinWin;
          console.log(
            `[FreeRoundManager] spin-success (freeround): added spinWin=$${spinWin}, accumulatedFreeRoundWin=$${this.accumulatedFreeRoundWin}`,
          );
        } else {
          console.log("[FreeRoundManager] No win detected for this free spin (spinWin=0)");
        }
      } catch (e) {
        console.warn(
          "[FreeRoundManager] Failed to accumulate freeround win on spin-success event:",
          e,
        );
      }
    };

    for (const eventName of eventsToListen) {
      this.events.on(eventName, onSpinDataReceived);
    }
  }

  private setupManualFreeRoundSpinConsumption(): void {
    console.log("[FreeRoundManager] Manual spin consumption disabled - using backend fsCount instead");
  }

  private animatePanelIn(scene: Scene, container: Phaser.GameObjects.Container | null): void {
    if (!container) return;
    container.setScale(0.8);
    container.setAlpha(0);

    scene.tweens.add({
      targets: container,
      scaleX: 1,
      scaleY: 1,
      alpha: 1,
      duration: 280,
      ease: "Back.Out",
    });
  }

  private animatePanelOut(
    scene: Scene,
    container: Phaser.GameObjects.Container | null,
    onComplete: () => void,
  ): void {
    if (!container) {
      onComplete();
      return;
    }

    scene.tweens.add({
      targets: container,
      scaleX: 0.8,
      scaleY: 0.8,
      alpha: 0,
      duration: 220,
      ease: "Back.In",
      onComplete: () => {
        onComplete();
      },
    });
  }

  private createRewardPanel(scene: Scene): void {
    if (this.panelContainer || this.initialFreeSpins <= 0 || !this.deps) {
      return;
    }

    const panelWidth = 397;
    const panelHeight = 442;
    const centerX = scene.scale.width * 0.5;
    const centerY = scene.scale.height * 0.5;

    this.panelOverlay = scene.add.rectangle(
      scene.scale.width * 0.5,
      scene.scale.height * 0.5,
      scene.scale.width,
      scene.scale.height,
      0x000000,
      0,
    );
    this.panelOverlay.setOrigin(0.5, 0.5);
    this.panelOverlay.setScrollFactor(0);
    this.panelOverlay.setDepth(9999);
    this.panelOverlay.setInteractive({ useHandCursor: false });

    this.panelContainer = scene.add.container(centerX, centerY);
    this.panelContainer.setDepth(10000);
    this.animatePanelIn(scene, this.panelContainer);

    const bg = scene.add.graphics();
    bg.setAlpha(0.85);
    bg.fillStyle(0x000000, 0.95);
    bg.lineStyle(2, 0xffffff, 0.12);
    const panelRadius = 16;
    bg.fillRoundedRect(-panelWidth / 2, -panelHeight / 2, panelWidth, panelHeight, panelRadius);
    bg.strokeRoundedRect(-panelWidth / 2, -panelHeight / 2, panelWidth, panelHeight, panelRadius);
    this.panelContainer.add(bg);

    const titleText = scene.add
      .text(0, -panelHeight / 2 + 60, this.getText(FreeRoundTextKey.REWARD_TITLE), {
        fontSize: "24px",
        color: "#00ff00",
        fontFamily: "poppins-bold",
      })
      .setOrigin(0.5, 0.5);
    this.applyBetValueGradientToText(titleText);
    this.panelContainer.add(titleText);

    const subtitleText = scene.add
      .text(0, -panelHeight / 2 + 110, this.getText(FreeRoundTextKey.GRANTED_SUBTITLE), {
        fontSize: "24px",
        color: "#ffffff",
        fontFamily: "poppins-bold",
      })
      .setOrigin(0.5, 0.5);
    this.panelContainer.add(subtitleText);

    const cardWidth = 144;
    const cardHeight = 135;
    const cardY = 0;
    const cardBg = scene.add.graphics();
    cardBg.fillStyle(0x212121, 1);
    cardBg.lineStyle(3, 0x4d4d4d, 1);
    const cardRadius = 12;
    cardBg.fillRoundedRect(-cardWidth / 2, cardY - cardHeight / 2, cardWidth, cardHeight, cardRadius);
    cardBg.strokeRoundedRect(
      -cardWidth / 2,
      cardY - cardHeight / 2,
      cardWidth,
      cardHeight,
      cardRadius,
    );
    this.panelContainer.add(cardBg);

    this.panelSpinsText = scene.add
      .text(0, cardY - 25, this.initialFreeSpins.toString(), {
        fontSize: "64px",
        color: "#ffcc33",
        fontFamily: "poppins-bold",
      })
      .setOrigin(0.5, 0.5);
    this.applySpinCountGradient();
    this.panelContainer.add(this.panelSpinsText);

    if (this.panelSpinsText) {
      this.panelSpinsText.setScale(1);
      scene.tweens.add({
        targets: this.panelSpinsText,
        scaleX: 1.08,
        scaleY: 1.08,
        duration: 500,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      });
    }

    const spinsLabel = scene.add
      .text(0, cardY + 15, this.getText(FreeRoundTextKey.SPINS_LABEL), {
        fontSize: "20px",
        color: "#ffffff",
        fontFamily: "poppins-bold",
      })
      .setOrigin(0.5, 0.5);
    this.panelContainer.add(spinsLabel);

    const isDemo = !!(
      this.gameAPIRef?.getDemoState?.()
      ?? (scene as any).gameAPI?.getDemoState?.()
    );
    const currencyPrefix = this.deps.getCurrencyPrefix(isDemo);
    const betValue =
      this.initBet != null
        ? this.initBet
        : (this.slotControllerRef?.getBaseBetAmount?.() ?? 0);

    const betDisplay = this.deps.formatCurrencyNumber(betValue);

    const withText = scene.add.text(0, 0, this.getText(FreeRoundTextKey.WITH_LABEL), {
      fontSize: "14px",
      color: "#ffffff",
      fontFamily: "poppins-regular",
    });

    this.panelBetText = scene.add.text(0, 0, `${currencyPrefix} ${betDisplay}`.trim(), {
      fontSize: "20px",
      color: "#379557",
      fontFamily: "poppins-bold",
    });

    const spacing = 6;
    const totalWidth = withText.width + spacing + this.panelBetText.width;
    const baseX = -totalWidth / 2;
    const betY = cardY + 45;

    withText.setPosition(baseX + withText.width / 2, betY);
    this.panelBetText.setPosition(
      baseX + withText.width + spacing + this.panelBetText.width / 2,
      betY,
    );

    withText.setOrigin(0.5, 0.5);
    this.panelBetText.setOrigin(0.5, 0.5);

    this.panelContainer.add(withText);
    this.panelContainer.add(this.panelBetText);
    this.applyBetValueGradientToText(this.panelBetText);

    const buttonY = panelHeight / 2 - 85;
    const buttonImage = scene.add
      .image(0, buttonY, this.textures.spinNowButton)
      .setOrigin(0.5, 0.5);
    this.panelContainer.add(buttonImage);

    const buttonLabel = scene.add
      .text(0, buttonY, this.getText(FreeRoundTextKey.SPIN_NOW_BUTTON), {
        fontSize: "24px",
        color: "#000000",
        fontFamily: "poppins-bold",
      })
      .setOrigin(0.5, 0.5);
    this.panelContainer.add(buttonLabel);

    buttonImage.setInteractive({ useHandCursor: true });
    buttonImage.on("pointerdown", () => {
      if (!this.sceneRef) {
        if (this.panelContainer) {
          this.panelContainer.setVisible(false);
        }
        if (this.panelOverlay) {
          this.panelOverlay.setVisible(false);
          this.panelOverlay.disableInteractive();
        }
        this.onFreeRoundStartPromptClosed();
        return;
      }

      this.animatePanelOut(this.sceneRef, this.panelContainer, () => {
        if (this.panelContainer) {
          this.panelContainer.setVisible(false);
        }
        if (this.panelOverlay) {
          this.panelOverlay.setVisible(false);
          this.panelOverlay.disableInteractive();
        }

        this.onFreeRoundStartPromptClosed();
      });
    });
  }

  private onFreeRoundStartPromptClosed(): void {
    if (this.slotControllerRef && this.initialFreeSpins > 0) {
      this.startTrackingFreeRoundAutoplayWins();
      this.remainingFreeSpins = this.initialFreeSpins;
      this.setFreeSpins(this.remainingFreeSpins);
    }

    this.slotControllerRef?.setAwaitingFreeRoundStartPrompt(false);
    this.slotControllerRef?.applyFreeRoundIdleControlState?.();
  }

  private showFreeRoundStatusPanel(config: {
    title: string;
    body?: string;
    bodySegments?: Array<{ text: string; highlight?: boolean }>;
    /** When set, rendered on its own line above the body in the win-amount gradient. */
    amount?: string;
    panelHeight?: number;
    onClosed: () => void;
  }): void {
    if (!this.sceneRef || !this.deps) {
      config.onClosed();
      return;
    }

    const scene = this.sceneRef;
    const panelWidth = 397;
    const panelHeight = config.panelHeight ?? 340;
    const centerX = scene.scale.width * 0.5;
    const centerY = scene.scale.height * 0.5;

    if (!this.panelOverlay) {
      this.panelOverlay = scene.add.rectangle(
        scene.scale.width * 0.5,
        scene.scale.height * 0.5,
        scene.scale.width,
        scene.scale.height,
        0x000000,
        0.6,
      );
      this.panelOverlay.setOrigin(0.5, 0.5);
      this.panelOverlay.setScrollFactor(0);
      this.panelOverlay.setDepth(9999);
    }
    this.panelOverlay.setVisible(true);
    this.panelOverlay.setInteractive({ useHandCursor: false });

    if (!this.panelContainer) {
      this.panelContainer = scene.add.container(centerX, centerY);
    }
    this.panelContainer.removeAll(true);
    this.panelContainer.setPosition(centerX, centerY);
    this.panelContainer.setDepth(10000);
    this.panelContainer.setVisible(true);
    this.animatePanelIn(scene, this.panelContainer);

    const bg = scene.add.graphics();
    bg.fillStyle(0x000000, 0.95);
    bg.setAlpha(0.85);
    bg.lineStyle(2, 0xffffff, 0.12);
    const panelRadius = 16;
    bg.fillRoundedRect(-panelWidth / 2, -panelHeight / 2, panelWidth, panelHeight, panelRadius);
    bg.strokeRoundedRect(-panelWidth / 2, -panelHeight / 2, panelWidth, panelHeight, panelRadius);
    this.panelContainer.add(bg);

    const titleText = scene.add
      .text(0, -panelHeight / 2 + 50, config.title, {
        fontSize: "24px",
        color: "#00ff00",
        fontFamily: "poppins-bold",
      })
      .setOrigin(0.5, 0.5);
    this.applyBetValueGradientToText(titleText);
    this.panelContainer.add(titleText);

    const buttonY = panelHeight / 2 - 70;
    const hasAmount = typeof config.amount === "string" && config.amount.length > 0;
    const titleY = -panelHeight / 2 + 50;

    const bodyMaxWidth = panelWidth - 56;
    const bodyY = hasAmount ? titleY + 70 + 35 : -10;
    const bodyFontSize = hasAmount ? 22 : 20;

    if (hasAmount) {
      const amountY = titleY + 70;
      const amountText = scene.add
        .text(0, amountY, config.amount as string, {
          fontSize: "32px",
          color: "#00ff00",
          fontFamily: "poppins-bold",
        })
        .setOrigin(0.5, 0.5);
      this.applyBetValueGradientToText(amountText);
      this.panelContainer.add(amountText);
    }

    if (config.bodySegments && config.bodySegments.length > 0) {
      this.addCenteredRichText(
        scene,
        this.panelContainer,
        bodyY,
        bodyMaxWidth,
        config.bodySegments,
        bodyFontSize,
        8,
      );
    } else if (config.body) {
      const body = scene.add
        .text(0, bodyY, config.body, {
          fontSize: `${bodyFontSize}px`,
          color: "#ffffff",
          fontFamily: "poppins-bold",
          align: "center",
          wordWrap: { width: bodyMaxWidth },
          lineSpacing: 8,
        })
        .setOrigin(0.5, hasAmount ? 0 : 0.5);
      this.panelContainer.add(body);
    }

    const buttonImage = scene.add
      .image(0, buttonY, this.textures.spinNowButton)
      .setOrigin(0.5, 0.5);
    this.panelContainer.add(buttonImage);

    const buttonLabel = scene.add
      .text(0, buttonY, this.getText(FreeRoundTextKey.OK), {
        fontSize: "24px",
        color: "#000000",
        fontFamily: "poppins-bold",
      })
      .setOrigin(0.5, 0.5);
    this.panelContainer.add(buttonLabel);

    const hidePanel = (afterHide: () => void) => {
      if (!this.sceneRef) {
        if (this.panelContainer) {
          this.panelContainer.setVisible(false);
        }
        if (this.panelOverlay) {
          this.panelOverlay.setVisible(false);
          this.panelOverlay.disableInteractive();
        }
        afterHide();
        return;
      }

      this.animatePanelOut(this.sceneRef, this.panelContainer, () => {
        if (this.panelContainer) {
          this.panelContainer.setVisible(false);
        }
        if (this.panelOverlay) {
          this.panelOverlay.setVisible(false);
          this.panelOverlay.disableInteractive();
        }
        afterHide();
      });
    };

    buttonImage.setInteractive({ useHandCursor: true });
    buttonImage.on("pointerdown", () => {
      hidePanel(config.onClosed);
    });
  }

  private showCompletionCreditedPanel(): void {
    const totalWin = this.getDisplayedFreeRoundWin();
    const fsTotal = this.getDisplayedFsTotal();
    this.showFreeRoundStatusPanel({
      title: this.getText(FreeRoundTextKey.DONE_TITLE),
      amount: this.formatAmount(totalWin),
      bodySegments: this.creditedFromSpinsSegments(fsTotal),
      panelHeight: 340,
      onClosed: () => this.finishFreeRoundMode(),
    });
  }

  private showPartialPanel(): void {
    const totalWin = this.getDisplayedFreeRoundWin();
    const fsTotal = this.getDisplayedFsTotal();
    const remaining = Math.max(0, this.lastFsCount);
    const consumed = Math.max(0, fsTotal - remaining);
    const remainingKey =
      remaining === 1
        ? FreeRoundTextKey.PARTIAL_REMAINING_CANCELLED_ONE
        : FreeRoundTextKey.PARTIAL_REMAINING_CANCELLED;
    this.showFreeRoundStatusPanel({
      title: this.getText(FreeRoundTextKey.DONE_TITLE),
      amount: this.formatAmount(totalWin),
      bodySegments: [
        ...this.creditedFromSpinsSegments(consumed),
        { text: "\n\n" },
        ...this.segmentsFromCountTemplate(this.getText(remainingKey), remaining),
      ],
      panelHeight: 420,
      onClosed: () => this.finishFreeRoundMode(),
    });
  }

  private showFailedPanel(): void {
    this.showFreeRoundStatusPanel({
      title: this.getText(FreeRoundTextKey.FAILED_TITLE),
      body: this.getText(FreeRoundTextKey.FAILED_BODY),
      panelHeight: 318,
      onClosed: () => {
        if (
          this.lastEnvelopeBalance != null
          && Number.isFinite(this.lastEnvelopeBalance)
        ) {
          this.slotControllerRef?.applyFreeRoundEndBalance?.(this.lastEnvelopeBalance);
        }
        this.slotControllerRef?.restoreSpinAfterFreeRoundErrorModal?.();
        this.slotControllerRef?.updateSpinButtonState?.();
      },
    });
  }

  private showCancelledPanel(): void {
    this.showFreeRoundStatusPanel({
      title: this.getText(FreeRoundTextKey.CANCELLED_TITLE),
      body: this.getText(FreeRoundTextKey.CANCELLED_BODY),
      panelHeight: 318,
      onClosed: () => {
        if (
          this.lastEnvelopeBalance != null
          && Number.isFinite(this.lastEnvelopeBalance)
        ) {
          this.slotControllerRef?.applyFreeRoundEndBalance?.(this.lastEnvelopeBalance);
        }
        this.finishFreeRoundMode();
      },
    });
  }

  public enableFreeSpinMode(): void {
    if (this.container) {
      this.container.setVisible(true);
    }

    console.log(
      "[FreeRoundManager] Enabling free spin mode (re-skinning SlotController spin button for free rounds)",
    );

    const visuals = this.slotControllerRef?.setFreeRoundSpinButtonVisuals;
    if (typeof visuals === "function") {
      try {
        visuals.call(this.slotControllerRef, true);
      } catch (e) {
        console.warn("[FreeRoundManager] setFreeRoundSpinButtonVisuals(true) failed:", e);
      }
    } else if (this.spinButton) {
      try {
        const scene = this.sceneRef;
        const key = this.textures.freeroundBg;
        if (scene?.textures?.exists(key)) {
          this.spinButton.setTexture(key);
        } else {
          console.warn(
            `[FreeRoundManager] Skipping freeround disc setTexture — missing texture "${key}"`,
          );
        }
        this.spinButton.setVisible(true);
        this.spinButton.setInteractive();
      } catch (e) {
        console.warn("[FreeRoundManager] Failed to set freeround_bg texture on spin button:", e);
      }
    }
    if (this.autoplayStopIcon) {
      this.autoplayStopIcon.setVisible(false);
    }

    this.slotControllerRef?.disableControlsForFreeRounds();
    this.slotControllerRef?.setAwaitingFreeRoundStartPrompt(true);
    this.lastFsTotalAccumulatedWins = null;

    try {
      this.deps?.gameState.setInFreeSpinRound(true);
    } catch {
      // Optional flag
    }
  }

  public disableFreeSpinMode(): void {
    if (this.container) {
      this.container.setVisible(false);
    }

    console.log(
      "[FreeRoundManager] Disabling free spin mode (restoring normal spin button visuals)",
    );

    const visuals = this.slotControllerRef?.setFreeRoundSpinButtonVisuals;
    if (typeof visuals === "function") {
      try {
        visuals.call(this.slotControllerRef, false);
      } catch (e) {
        console.warn("[FreeRoundManager] setFreeRoundSpinButtonVisuals(false) failed:", e);
      }
    } else if (this.spinButton) {
      try {
        const scene = this.sceneRef;
        const spinKey = this.textures.spin;
        const iconKey = this.textures.spinIcon;
        if (scene?.textures?.exists(spinKey)) {
          this.spinButton.setTexture(spinKey);
        } else if (scene?.textures?.exists(iconKey)) {
          // Spine-disc games: getSpinButton() may be the spin_icon overlay.
          this.spinButton.setTexture(iconKey);
        } else {
          console.warn(
            `[FreeRoundManager] Skipping spin restore setTexture — missing "${spinKey}" / "${iconKey}"`,
          );
        }
        this.spinButton.setVisible(true);
        this.spinButton.setInteractive();
      } catch (e) {
        console.warn("[FreeRoundManager] Failed to restore spin texture on spin button:", e);
      }
    }
    if (this.spinIcon) {
      this.spinIcon.setVisible(true);
    }
    // Keep STOP hidden unless autoplay/skip HUD owns it — do not force-show on FR exit.

    try {
      this.deps?.gameState.setInFreeSpinRound(false);
    } catch {
      // Optional flag
    }
  }

  public isPromptVisible(): boolean {
    return !!(this.panelContainer && this.panelContainer.visible && this.panelContainer.active);
  }

  public destroy(): void {
    if (this.container) {
      this.container.destroy(true);
      this.container = null;
    }
    if (this.panelOverlay) {
      this.panelOverlay.destroy();
      this.panelOverlay = null;
    }
    this.background = null;
    this.countText = null;
    this.labelText = null;
  }
}
