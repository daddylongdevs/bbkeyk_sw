import { GameObjects, Scene } from "phaser";
import type { SlotInitializeData, UnresolvedSpin } from "../backend/GameAPI";
import { gameStateManager } from "./GameStateManager";

class UnresolvedSpinPopup extends GameObjects.Container {
    private background: GameObjects.Graphics;
    private messageText: GameObjects.Text;
    private buttonImage: GameObjects.Image;
    private buttonText: GameObjects.Text;
    private overlay: Phaser.GameObjects.Graphics;
    private onContinue: (() => void) | undefined;

    constructor(scene: Scene, onContinue?: () => void) {
        super(scene, scene.scale.width / 2, scene.scale.height / 2);
        this.onContinue = onContinue;

        this.overlay = new GameObjects.Graphics(scene);
        this.overlay.fillStyle(0x000000, 0.6);
        this.overlay.fillRect(0, 0, scene.scale.width, scene.scale.height);
        this.overlay.setScrollFactor(0);
        this.overlay.setInteractive(
            new Phaser.Geom.Rectangle(0, 0, scene.scale.width, scene.scale.height),
            Phaser.Geom.Rectangle.Contains
        );
        this.overlay.setVisible(false);
        scene.add.existing(this.overlay);

        const width = scene.scale.width * 0.8;
        const height = scene.scale.height * 0.28;

        this.background = new GameObjects.Graphics(scene);
        this.background.fillStyle(0x000000, 0.8);
        this.background.fillRoundedRect(-width / 2, -height / 2, width, height, 20);

        this.messageText = new GameObjects.Text(
            scene,
            0,
            -25,
            "You have an ongoing free spin round from the last session.",
            {
                fontFamily: "Poppins-Regular",
                fontSize: "21px",
                color: "#ffffff",
                align: "center",
                wordWrap: { width: scene.scale.width * 0.7, useAdvancedWrap: true },
            }
        ).setOrigin(0.5);

        this.buttonImage = new GameObjects.Image(scene, 0, 75, "long_button")
            .setOrigin(0.5)
            .setDisplaySize(291.2, 49.6)
            .setScale(0.8);

        this.buttonText = new GameObjects.Text(scene, 0, 75, "Continue", {
            fontFamily: "Poppins-Bold",
            fontSize: "24px",
            color: "#000000",
            align: "center",
        }).setOrigin(0.5);

        this.buttonImage.setInteractive({ useHandCursor: true });
        this.buttonImage.on("pointerdown", () => {
            try {
                (window as any).audioManager?.playSoundEffect?.("button_fx");
            } catch {}
            this.hide(() => this.onContinue?.());
        });
        this.buttonImage.on("pointerover", () => this.buttonImage.setTint(0xcccccc));
        this.buttonImage.on("pointerout", () => this.buttonImage.clearTint());

        this.add([this.background, this.messageText, this.buttonImage, this.buttonText]);
        this.setVisible(false);
        scene.add.existing(this);
    }

    public show(): void {
        this.overlay.setVisible(true);
        this.overlay.setDepth(9999);
        this.setVisible(true);
        this.setDepth(10000);
        this.setScale(0.5);
        this.setAlpha(0);
        this.scene.tweens.add({
            targets: this,
            scaleX: 1,
            scaleY: 1,
            alpha: 1,
            duration: 300,
            ease: "Back.Out",
        });
    }

    public hide(callback?: () => void): void {
        this.scene.tweens.add({
            targets: this,
            scaleX: 0.5,
            scaleY: 0.5,
            alpha: 0,
            duration: 240,
            ease: "Back.In",
            onComplete: () => {
                this.setVisible(false);
                this.overlay.setVisible(false);
                callback?.();
            },
        });
    }

    public override destroy(fromScene?: boolean): void {
        this.overlay.destroy();
        super.destroy(fromScene);
    }
}

export class UnresolvedSpinManager {
    private static instance: UnresolvedSpinManager;

    private _unresolvedSpin: UnresolvedSpin | null = null;
    private _popup: UnresolvedSpinPopup | null = null;

    private constructor() {}

    public static getInstance(): UnresolvedSpinManager {
        if (!UnresolvedSpinManager.instance) {
            UnresolvedSpinManager.instance = new UnresolvedSpinManager();
        }
        return UnresolvedSpinManager.instance;
    }

    public get hasUnresolvedSpin(): boolean {
        return this._unresolvedSpin != null;
    }

    public get unresolvedSpin(): UnresolvedSpin | null {
        return this._unresolvedSpin;
    }

    public setFromInitializationData(data: SlotInitializeData | null): void {
        if (!data) {
            this._unresolvedSpin = null;
            return;
        }

        const raw = data.unresolvedSpin;
        if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
            this._unresolvedSpin = null;
            return;
        }

        const spin = raw as Record<string, unknown>;
        const uuidRaw = spin.uuid;
        const betSizeRaw = spin.bet_size ?? spin.betSize;
        const modeRaw = spin.mode;
        const indexRaw = spin.index;
        const responseRaw = spin.response ?? spin.spinData ?? spin.data ?? null;

        const uuid =
            typeof uuidRaw === "string"
                ? uuidRaw
                : uuidRaw != null
                  ? String(uuidRaw)
                  : "";
        const betSize =
            typeof betSizeRaw === "string"
                ? betSizeRaw
                : betSizeRaw != null
                  ? String(betSizeRaw)
                  : undefined;
        const mode =
            typeof modeRaw === "string"
                ? modeRaw
                : modeRaw != null
                  ? String(modeRaw)
                  : undefined;
        const index = typeof indexRaw === "number" ? indexRaw : 0;
        const response = responseRaw as UnresolvedSpin["response"] | null | undefined;
        const normalizedResponse =
            response != null && typeof response === "object" && !Array.isArray(response)
                ? ({ ...(response as unknown as Record<string, unknown>) } as UnresolvedSpin["response"] & Record<string, unknown>)
                : ({} as UnresolvedSpin["response"] & Record<string, unknown>);
        const responseIsEmpty =
            response == null ||
            (typeof response === "object" &&
                !Array.isArray(response) &&
                Object.keys(response as unknown as Record<string, unknown>).length === 0);

        if (!uuid && index === 0 && responseIsEmpty) {
            this._unresolvedSpin = null;
            return;
        }

        if (
            betSize &&
            (normalizedResponse as Record<string, unknown>).bet == null
        ) {
            normalizedResponse.bet = betSize;
        }

        this._unresolvedSpin = {
            uuid: uuid || "unknown",
            betSize,
            mode,
            index,
            response: normalizedResponse,
        };
    }

    public clear(): void {
        this._unresolvedSpin = null;
    }

    public showPopupIfUnresolved(scene: Scene, onContinue?: () => void): boolean {
        if (!this.hasUnresolvedSpin) {
            return false;
        }

        if (this._popup) {
            this._popup.destroy(true);
            this._popup = null;
        }

        this._popup = new UnresolvedSpinPopup(scene, () => {
            this._popup = null;
            onContinue?.();
        });
        this._popup.show();
        return true;
    }

    public getUnresolvedBonusDisplayTotal(): number {
        const unresolved = this._unresolvedSpin;
        if (!unresolved?.response) {
            return 0;
        }

        const spinData: any = unresolved.response;
        const slot: any = spinData?.slot ?? {};
        const fs: any = slot.freespin ?? slot.freeSpin;
        const items: any[] = Array.isArray(fs?.items) ? fs.items : [];
        const index = typeof unresolved.index === "number" && unresolved.index >= 0 ? unresolved.index : 0;
        const baseWin = this.getUnresolvedTriggerSpinTotal(slot, fs, spinData?.bet ?? unresolved.betSize);

        let previousItemsTotal = 0;
        for (let i = 0; i < index && i < items.length; i++) {
            const item = items[i];
            const win = this.toPositiveNumber(item?.totalWin ?? item?.subTotalWin);
            if (win > 0) {
                previousItemsTotal += win;
            }
        }

        return baseWin + previousItemsTotal;
    }

    private toPositiveNumber(value: unknown): number {
        const numeric =
            typeof value === "number"
                ? value
                : typeof value === "string"
                  ? Number(value)
                  : NaN;
        return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
    }

    private getUnresolvedTriggerSpinTotal(slot: any, fs: any, betSize?: unknown): number {
        const explicitTotal =
            this.toPositiveNumber(slot?.baseSpinTotalWin) ||
            this.toPositiveNumber(slot?.triggerSpinTotalWin) ||
            this.toPositiveNumber(slot?.scatterTriggerTotalWin) ||
            this.toPositiveNumber(fs?.baseSpinTotalWin) ||
            this.toPositiveNumber(fs?.triggerSpinTotalWin) ||
            this.toPositiveNumber(fs?.triggerTotalWin);

        if (explicitTotal > 0) {
            return explicitTotal;
        }

        const scatterBaseWin =
            this.toPositiveNumber(slot?.scatterBaseWin) ||
            this.toPositiveNumber(fs?.scatterBaseWin) ||
            this.getScatterTriggerPayout(slot?.area, betSize);

        const tumbleWin = this.getCurrentSpinTumbleWin(slot?.tumbles);
        return scatterBaseWin + tumbleWin;
    }

    private getScatterTriggerPayout(area: unknown, betSize?: unknown): number {
        const bet = this.toPositiveNumber(betSize);
        if (bet <= 0 || !Array.isArray(area)) {
            return 0;
        }

        let scatterCount = 0;
        for (const column of area) {
            if (!Array.isArray(column)) {
                continue;
            }
            for (const symbol of column) {
                if (symbol === 0) {
                    scatterCount++;
                }
            }
        }

        const scatterMultiplier =
            scatterCount >= 6 ? 100 :
            scatterCount === 5 ? 5 :
            scatterCount === 4 ? 3 : 0;

        return bet * scatterMultiplier;
    }

    private getCurrentSpinTumbleWin(tumbles: unknown): number {
        if (!Array.isArray(tumbles)) {
            return 0;
        }

        let total = 0;
        for (const tumble of tumbles) {
            total += this.toPositiveNumber((tumble as any)?.win);
        }
        return total;
    }

    public applyBonusModeVisuals(scene: Scene): void {
        if (!this.hasUnresolvedSpin) {
            return;
        }

        const sceneAny: any = scene as any;
		const unresolved = this._unresolvedSpin;
		const spinData: any = unresolved?.response ?? {};
		const slot: any = spinData?.slot ?? {};
		const fs: any = slot?.freespin ?? slot?.freeSpin;
		const triggerBaseWin = this.getUnresolvedTriggerSpinTotal(slot, fs, spinData?.bet ?? unresolved?.betSize);
        gameStateManager.isBonus = true;
        gameStateManager.isScatter = false;

        try { scene.events.emit("setBonusMode", true); } catch {}
        try { scene.events.emit("showBonusBackground"); } catch {}
        try { scene.events.emit("showBonusHeader"); } catch {}

        try { sceneAny.background?.getContainer?.().setVisible(false); } catch {}
        try { sceneAny.bonusBackground?.getContainer?.().setVisible(true); } catch {}
        try { sceneAny.header?.getContainer?.().setVisible(false); } catch {}
        try { sceneAny.bonusHeader?.getContainer?.().setVisible(true); } catch {}

        const displayTotal = this.getUnresolvedBonusDisplayTotal();
        if (displayTotal > 0) {
			try { sceneAny.bonusHeader?.seedCumulativeWin?.(triggerBaseWin, displayTotal); } catch {}
            try { sceneAny.bonusHeader?.setWinningsLabel?.("TOTAL WIN"); } catch {}
            try { sceneAny.bonusHeader?.updateWinningsDisplay?.(displayTotal); } catch {}
        }
    }
}

export const unresolvedSpinManager = UnresolvedSpinManager.getInstance();
