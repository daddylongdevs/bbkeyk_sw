import type { SlotInitializeData } from "../../backend/GameAPI";
import { showModal, ModalType } from "../../managers/ModalManager";
import { formatCurrencyNumber } from "../../utils/NumberPrecisionFormatter";

type CurrencyInit = Pick<SlotInitializeData, "currency" | "currencySymbol">;

function normalizeText(value: unknown): string {
	if (typeof value !== "string") return "";
	return value.trim();
}

function isDemoMode(): boolean {
	try {
		const urlParams = new URLSearchParams(window.location.search);
		const demoParam = (urlParams.get("demo") || "").toLowerCase();
		if (demoParam === "true" || demoParam === "1" || demoParam === "yes") return true;
	} catch {}

	try {
		if (sessionStorage.getItem("demo") === "true") return true;
	} catch {}

	try {
		if (sessionStorage.getItem("demo") === "true") return true;
	} catch {}

	return false;
}

/**
 * Centralized currency display helper.
 *
 * Priority:
 * - Prefer `currencySymbol` when it is non-empty
 * - Otherwise fall back to currency code (`currency`)
 */
export class CurrencyManager {
	private static currencyCode = "";
	private static currencySymbol = "";

	private static missingCurrencyPopupShown = false;

	public static initializeFromInitData(initData: CurrencyInit | null | undefined): void {
		const code = normalizeText(initData?.currency);
		const symbol = normalizeText(initData?.currencySymbol);

		CurrencyManager.currencyCode = code;
		CurrencyManager.currencySymbol = symbol;

		if (isDemoMode()) {
			return;
		}

		if (CurrencyManager.currencyCode.length === 0 && CurrencyManager.currencySymbol.length === 0) {
			CurrencyManager.showMissingCurrencyPopup();
		}
	}

	public static getCurrencyCode(): string {
		return CurrencyManager.currencyCode;
	}

	public static getCurrencySymbol(): string {
		return CurrencyManager.currencySymbol;
	}

	public static getCurrencyGlyph(): string {
		if (CurrencyManager.currencySymbol.length > 0) return CurrencyManager.currencySymbol;
		if (CurrencyManager.currencyCode.length > 0) return CurrencyManager.currencyCode;
		return "";
	}

	public static getInlinePrefix(): string {
		if (CurrencyManager.currencySymbol.length > 0) return CurrencyManager.currencySymbol;
		if (CurrencyManager.currencyCode.length > 0) return `${CurrencyManager.currencyCode} `;
		return "";
	}

	public static formatAmount(amount: number): string {
		const safe = Number.isFinite(amount) ? amount : 0;
		const prefix = CurrencyManager.getCurrencyCode();
		const space = prefix && !prefix.endsWith(" ") ? " " : "";
		return `${prefix}${space}${formatCurrencyNumber(safe)}`;
	}

	public static stripCurrencyPrefix(text: string): string {
		let out = typeof text === "string" ? text : "";

		const symbol = CurrencyManager.currencySymbol;
		const code = CurrencyManager.currencyCode;

		if (symbol) out = out.replace(symbol, "");
		if (code) out = out.replace(code, "");

		return out.trim();
	}

	private static showMissingCurrencyPopup(): void {
		if (CurrencyManager.missingCurrencyPopupShown) {
			return;
		}
		showModal(ModalType.CURRENCY_ERROR);
		CurrencyManager.missingCurrencyPopupShown = true;
	}
}
